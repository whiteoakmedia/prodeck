//! Live viewer count from Google Analytics 4.
//!
//! Church Online Platform has no pull API and its webhooks carry no concurrent
//! -viewer event (and land 24–48h later), so the only live number available for
//! the web player is GA4's realtime report. COP already fires GA4 on the watch
//! page, so this needs no change on the streaming side at all.
//!
//! Auth is a service account: a self-signed RS256 JWT exchanged for an access
//! token. No consent screen and no refresh token to lapse, which matters
//! because the booth Mac runs this unattended.
//!
//! NOTE: this counts the *web player only*. Anyone watching the Facebook
//! simulcast is invisible here — see the widget's own caption.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const SCOPE: &str = "https://www.googleapis.com/auth/analytics.readonly";
const POLL_SECS: u64 = 30;
/// ~30 minutes of history at the poll interval — enough for a sparkline.
const HISTORY_MAX: usize = 60;

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[derive(Serialize, Clone, Default)]
pub struct Ga4Sample {
    pub at: u64,
    pub viewers: u32,
}

#[derive(Default)]
pub struct Ga4Inner {
    pub configured: bool,
    pub viewers: Option<u32>,
    pub history: VecDeque<Ga4Sample>,
    pub updated: Option<u64>,
    pub error: Option<String>,
    /// Cached access token and the epoch second it expires.
    token: Option<(String, u64)>,
}

pub type Ga4State = Arc<Mutex<Ga4Inner>>;

pub fn new_state() -> Ga4State {
    Arc::new(Mutex::new(Ga4Inner::default()))
}

#[derive(Deserialize)]
struct KeyFile {
    client_email: String,
    private_key: String,
    #[serde(default = "default_token_uri")]
    token_uri: String,
}
fn default_token_uri() -> String {
    "https://oauth2.googleapis.com/token".into()
}

#[derive(Serialize)]
struct Claims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    exp: u64,
    iat: u64,
}

/// Mint a JWT for the service account and trade it for an access token.
async fn fetch_token(key: &KeyFile) -> Result<(String, u64), String> {
    use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
    let iat = now_secs();
    let exp = iat + 3600;
    let claims = Claims { iss: &key.client_email, scope: SCOPE, aud: &key.token_uri, exp, iat };
    let enc = EncodingKey::from_rsa_pem(key.private_key.as_bytes())
        .map_err(|e| format!("service-account private key is not a valid RSA PEM: {e}"))?;
    let jwt = encode(&Header::new(Algorithm::RS256), &claims, &enc)
        .map_err(|e| format!("could not sign the auth token: {e}"))?;

    let client = reqwest::Client::new();
    let res = client
        .post(&key.token_uri)
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", &jwt),
        ])
        .send()
        .await
        .map_err(|e| format!("could not reach Google for a token: {e}"))?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let msg = body
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(format!("Google refused the service account ({status}): {msg}"));
    }
    let tok = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("Google returned no access_token")?
        .to_string();
    Ok((tok, exp - 60))
}

/// Realtime active users over GA4's default window (the last 30 minutes) — the
/// same figure GA4's own realtime UI shows, so the two always agree.
async fn fetch_viewers(token: &str, property: &str, path_filter: &str) -> Result<u32, String> {
    // NO minuteRanges: the default realtime window (last 30 minutes) is what
    // GA4's own UI reports, and it is the right number for a video page.
    // Narrowing to the last minute undercounted badly — GA4 only credits a user
    // to the minute they fired an event, so someone twelve minutes into the
    // stream sends nothing and disappears from a 1-minute window while still
    // watching. Measured live: 56 over 30 min vs 2 over 1 min.
    let mut body = json!({
        "metrics": [{ "name": "activeUsers" }],
    });
    if !path_filter.is_empty() {
        body["dimensionFilter"] = json!({
            "filter": {
                "fieldName": "unifiedScreenName",
                "stringFilter": { "matchType": "CONTAINS", "value": path_filter, "caseSensitive": false }
            }
        });
    }

    let url = format!(
        "https://analyticsdata.googleapis.com/v1beta/properties/{}:runRealtimeReport",
        urlencoding::encode(property)
    );
    let client = reqwest::Client::new();
    let res = client
        .post(&url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("could not reach the Analytics API: {e}"))?;
    let status = res.status();
    let json: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let msg = json
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        // 403 here almost always means one specific thing, so say it plainly
        // rather than making the operator read Google's wording.
        if status.as_u16() == 403 {
            return Err(format!(
                "Analytics rejected the service account — add it as a Viewer on property {property}, and check the Analytics Data API is enabled. ({msg})"
            ));
        }
        return Err(format!("Analytics error {status}: {msg}"));
    }

    // No rows simply means nobody is on the page right now — that is a zero,
    // not a failure.
    let n = json
        .get("rows")
        .and_then(|r| r.as_array())
        .and_then(|r| r.first())
        .and_then(|row| row.get("metricValues"))
        .and_then(|m| m.as_array())
        .and_then(|m| m.first())
        .and_then(|v| v.get("value"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);
    Ok(n)
}

async fn poll_once(app: &AppHandle) {
    let (property, key_path, path_filter) = {
        let st = app.state::<crate::settings::SettingsState>();
        let s = st.lock().unwrap_or_else(|p| p.into_inner());
        (s.ga4_property_id.clone(), s.ga4_key_path.clone(), s.ga4_page_filter.clone())
    };

    let state = app.state::<Ga4State>();
    if property.trim().is_empty() || key_path.trim().is_empty() {
        let mut g = state.lock().unwrap_or_else(|p| p.into_inner());
        g.configured = false;
        g.viewers = None;
        g.error = None;
        return;
    }

    let set_err = |msg: String| {
        let mut g = state.lock().unwrap_or_else(|p| p.into_inner());
        g.configured = true;
        g.error = Some(msg);
        // Keep the last known count on screen rather than blanking it — a
        // transient API hiccup should not read as "nobody is watching".
    };

    let raw = match std::fs::read_to_string(&key_path) {
        Ok(v) => v,
        Err(e) => return set_err(format!("can't read the service-account key at {key_path}: {e}")),
    };
    let key: KeyFile = match serde_json::from_str(&raw) {
        Ok(k) => k,
        Err(_) => {
            return set_err(
                "that key file isn't a service-account key — it should contain client_email and private_key".into(),
            )
        }
    };

    // Reuse the cached token until it is nearly expired.
    let cached = {
        let g = state.lock().unwrap_or_else(|p| p.into_inner());
        g.token.clone()
    };
    let token = match cached {
        Some((t, exp)) if exp > now_secs() => t,
        _ => match fetch_token(&key).await {
            Ok((t, exp)) => {
                let mut g = state.lock().unwrap_or_else(|p| p.into_inner());
                g.token = Some((t.clone(), exp));
                t
            }
            Err(e) => return set_err(e),
        },
    };

    match fetch_viewers(&token, property.trim(), path_filter.trim()).await {
        Ok(n) => {
            let mut g = state.lock().unwrap_or_else(|p| p.into_inner());
            g.configured = true;
            g.error = None;
            g.viewers = Some(n);
            g.updated = Some(now_secs());
            g.history.push_back(Ga4Sample { at: now_secs(), viewers: n });
            while g.history.len() > HISTORY_MAX {
                g.history.pop_front();
            }
        }
        Err(e) => {
            // An expired/revoked token should retry cleanly on the next tick.
            let mut g = state.lock().unwrap_or_else(|p| p.into_inner());
            g.token = None;
            g.configured = true;
            g.error = Some(e);
        }
    }
}

pub fn snapshot(state: &Ga4State) -> Value {
    let g = state.lock().unwrap_or_else(|p| p.into_inner());
    json!({
        "configured": g.configured,
        "viewers": g.viewers,
        "updated": g.updated,
        "error": g.error,
        "history": g.history.iter().collect::<Vec<_>>(),
    })
}

#[tauri::command]
pub fn ga4_state(state: tauri::State<'_, Ga4State>) -> Value {
    snapshot(state.inner())
}

pub fn spawn_ga4_poll(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        loop {
            poll_once(&app).await;
            tokio::time::sleep(Duration::from_secs(POLL_SECS)).await;
        }
    });
}
