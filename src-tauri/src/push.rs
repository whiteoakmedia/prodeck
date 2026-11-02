// Web Push — what makes a page reach a phone that's asleep in a pocket.
//
// Without this the crew PWA only buzzes while it's open on screen, which is
// exactly when nobody needs telling. The booth holds a VAPID keypair (generated
// once, private half never leaves this machine), phones register a push
// subscription against their crew identity, and pages fan out to them.
//
// Two limits worth knowing before debugging "it didn't push":
//  * Browsers only allow push in a SECURE context. On plain LAN http:// the
//    subscribe call never happens, so there are no subscriptions to send to.
//    This lights up when the HTTPS hostname exists.
//  * iOS delivers no web push at all until the PWA is installed to the Home
//    Screen — hence the S01 onboarding screen existing in the first place.
//
// Quiet hours are deliberately NOT implemented here: the design is explicit
// that quiet hours never suppresses a page ("pages still ring"). They belong to
// chat notifications, which aren't pushed yet.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use web_push::{
    request_builder::build_request, ContentEncoding, SubscriptionInfo, VapidSignatureBuilder,
    WebPushMessageBuilder,
};

const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::URL_SAFE_NO_PAD;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    /// Crew user id — a subscription belongs to a person, not a browser, so
    /// re-subscribing from the same phone replaces rather than duplicates.
    pub user_id: String,
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub created_ms: u64,
}

/// A phone running the ProDeck Crew app. Apple only takes notifications for
/// the app signed with White Oak's key, so these go out through the
/// prodeck-push relay (push-edge/) instead of straight from here. Keyed by
/// token, not person: someone's phone and iPad both ring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSub {
    pub user_id: String,
    /// "apns" today; "fcm" once Android has a push project.
    pub platform: String,
    pub token: String,
    pub created_ms: u64,
}

/// A person's app devices kept at most: an old phone traded in keeps its token
/// until Apple calls it dead, which can take a while.
const MAX_APPS_PER_PERSON: usize = 3;

fn relay_url() -> String {
    std::env::var("PRODECK_PUSH_RELAY").unwrap_or_else(|_| "https://prodeck-push.taplink-edge.workers.dev".into())
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Store {
    /// Raw 32-byte P-256 scalar, base64url. Leaves the booth ONLY to the
    /// crew-edge worker (edge_snapshot), so the cloud can push when the booth
    /// is off. Rotating it still invalidates every subscription.
    vapid_private: String,
    /// Uncompressed SEC1 point, base64url — this is the applicationServerKey
    /// the browser needs, and the only half that leaves the machine.
    vapid_public: String,
    subs: Vec<Subscription>,
    #[serde(default)]
    apps: Vec<AppSub>,
}

#[derive(Default)]
pub struct PushInner {
    store: Mutex<Store>,
}

pub type PushState = Arc<PushInner>;

fn store_path() -> PathBuf {
    let mut dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    dir.push("ProDeck");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("push.json")
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl PushInner {
    pub fn load() -> Self {
        let path = store_path();
        // "Only when genuinely absent" was the intent, but the old code could
        // not tell absent from unreadable — both collapsed to Default, which
        // then minted a NEW keypair and wrote it, invalidating every phone's
        // push subscription. That presents as "pages stopped arriving on
        // Sunday" with nothing anywhere pointing at the cause. And since this
        // was the only file in the app written non-atomically, a crash mid-write
        // produced exactly the truncated file that triggered it.
        let (mut store, readable): (Store, bool) = match std::fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<Store>(&raw) {
                Ok(s) => (s, true),
                Err(e) => {
                    crate::diag::log(format!("[push] {} could not be parsed: {e}", path.display()));
                    let bak = path.with_extension("bak.json");
                    match std::fs::read_to_string(&bak)
                        .ok()
                        .and_then(|b| serde_json::from_str::<Store>(&b).ok())
                    {
                        Some(s) => {
                            crate::diag::log("[push] recovered keys from the backup".to_string());
                            (s, true)
                        }
                        None => {
                            let kept = path
                                .with_extension(format!("corrupt-{}.json", crate::identity::now_ms()));
                            let _ = std::fs::write(&kept, &raw);
                            crate::diag::log(format!(
                                "[push] no usable backup — kept {} and minting a new keypair;                                  every phone must re-enable page notifications",
                                kept.display()
                            ));
                            (Store::default(), false)
                        }
                    }
                }
            },
            Err(_) => (Store::default(), false), // genuinely absent: first run
        };
        let _ = readable;
        if store.vapid_private.is_empty() || store.vapid_public.is_empty() {
            let (priv_b64, pub_b64) = generate_vapid();
            store.vapid_private = priv_b64;
            store.vapid_public = pub_b64;
            let _ = crate::settings::write_json_atomic_backed_up(
                path.clone(),
                serde_json::to_string_pretty(&store).unwrap_or_default(),
            );
        }
        Self {
            store: Mutex::new(store),
        }
    }

    fn persist(&self, s: &Store) {
        let _ = crate::settings::write_json_atomic_backed_up(
            store_path(),
            serde_json::to_string_pretty(s).unwrap_or_default(),
        );
    }
}

fn generate_vapid() -> (String, String) {
    use p256::ecdsa::SigningKey;
    use p256::elliptic_curve::sec1::ToEncodedPoint;
    let signing = SigningKey::random(&mut rand_core_compat::OsRng);
    let private = B64.encode(signing.to_bytes());
    let public = B64.encode(
        signing
            .verifying_key()
            .as_affine()
            .to_encoded_point(false)
            .as_bytes(),
    );
    (private, public)
}

// p256 0.13 wants a rand_core 0.6 RNG; expose the OS one under that trait.
mod rand_core_compat {
    pub use p256::elliptic_curve::rand_core::OsRng;
}

pub fn public_key(push: &PushState) -> String {
    push.store
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .vapid_public
        .clone()
}

/// What the cloud mirror needs to buzz phones while the booth is off: the
/// VAPID keypair and each person's endpoint. Sending the private half to the
/// crew-edge worker is a deliberate phase-2 decision — it is the same trust
/// domain that already holds the PCO secrets (design/CREW_CLOUD.md). The
/// p256dh/auth encryption keys stay booth-only: edge pushes are payload-less
/// (RFC 8030 allows an empty POST), so the edge never encrypts a payload and
/// never needs them.
pub fn edge_snapshot(push: &PushState) -> serde_json::Value {
    let s = push.store.lock().unwrap_or_else(|p| p.into_inner());
    json!({
        "vapidPub": s.vapid_public,
        "vapidPriv": s.vapid_private,
        "subs": s
            .subs
            .iter()
            .map(|x| json!({ "user": x.user_id, "endpoint": x.endpoint }))
            .collect::<Vec<_>>(),
    })
}

/// Register (or replace) a phone's subscription for a crew user.
pub fn subscribe(
    push: &PushState,
    user_id: String,
    endpoint: String,
    p256dh: String,
    auth: String,
) -> Result<(), String> {
    if endpoint.is_empty() || p256dh.is_empty() || auth.is_empty() {
        return Err("incomplete push subscription".into());
    }
    let mut s = push.store.lock().unwrap_or_else(|p| p.into_inner());
    // One live subscription per person: a phone that re-subscribes (new browser
    // session, reinstalled PWA) must not leave a dead endpoint behind that we'd
    // keep pushing to forever.
    s.subs.retain(|x| x.user_id != user_id);
    s.subs.push(Subscription {
        user_id,
        endpoint,
        p256dh,
        auth,
        created_ms: now_ms(),
    });
    push.persist(&s);
    Ok(())
}

pub fn unsubscribe(push: &PushState, user_id: &str) {
    let mut s = push.store.lock().unwrap_or_else(|p| p.into_inner());
    s.subs.retain(|x| x.user_id != user_id);
    s.apps.retain(|x| x.user_id != user_id);
    push.persist(&s);
}

/// Register a phone running the ProDeck Crew app. The same phone signing in
/// as someone else moves to them.
pub fn subscribe_app(push: &PushState, user_id: String, platform: String, token: String) -> Result<(), String> {
    if platform != "apns" {
        return Err("this phone's notifications aren't supported yet".into());
    }
    if !(64..=200).contains(&token.len()) || !token.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("that isn't a push token".into());
    }
    let mut s = push.store.lock().unwrap_or_else(|p| p.into_inner());
    s.apps.retain(|x| x.token != token);
    s.apps.push(AppSub { user_id: user_id.clone(), platform, token, created_ms: now_ms() });
    // Newest last, so the oldest of this person's devices go first.
    let mine = s.apps.iter().filter(|x| x.user_id == user_id).count();
    if mine > MAX_APPS_PER_PERSON {
        let mut extra = mine - MAX_APPS_PER_PERSON;
        s.apps.retain(|x| {
            if extra > 0 && x.user_id == user_id {
                extra -= 1;
                false
            } else {
                true
            }
        });
    }
    push.persist(&s);
    Ok(())
}

/// Stop one app phone, and only if it belongs to this person.
pub fn unsubscribe_app(push: &PushState, user_id: &str, token: &str) {
    let mut s = push.store.lock().unwrap_or_else(|p| p.into_inner());
    s.apps.retain(|x| !(x.token == token && x.user_id == user_id));
    push.persist(&s);
}

/// Crew who will feel a page on a locked phone: they turned notifications on
/// and the phone hasn't thrown that away since.
pub fn notified_users(push: &PushState) -> std::collections::HashSet<String> {
    let s = push.store.lock().unwrap_or_else(|p| p.into_inner());
    s.subs.iter().map(|x| x.user_id.clone()).chain(s.apps.iter().map(|x| x.user_id.clone())).collect()
}

fn subs_for(push: &PushState, user_ids: &[String]) -> Vec<Subscription> {
    push.store
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .subs
        .iter()
        .filter(|s| user_ids.iter().any(|id| id == &s.user_id))
        .cloned()
        .collect()
}

fn apps_for(push: &PushState, user_ids: &[String]) -> Vec<AppSub> {
    push.store
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .apps
        .iter()
        .filter(|s| user_ids.iter().any(|id| id == &s.user_id))
        .cloned()
        .collect()
}

/// What the relay is asked to send: the notification's words only. Nothing
/// about the church or the person goes with it.
fn relay_body(apps: &[AppSub], payload: &serde_json::Value) -> serde_json::Value {
    let text = |k: &str| payload.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    json!({
        "to": apps.iter().map(|a| json!({ "p": a.platform, "t": a.token })).collect::<Vec<_>>(),
        "title": text("title"),
        "body": text("body"),
        "tag": text("tag"),
        "page": payload.get("page").and_then(|v| v.as_bool()).unwrap_or(false),
    })
}

async fn send_apps(client: &reqwest::Client, push: &PushState, apps: &[AppSub], payload: &serde_json::Value) {
    let r = client.post(format!("{}/v1/send", relay_url())).json(&relay_body(apps, payload)).send().await;
    match r {
        Ok(r) if r.status().is_success() => {
            let v: serde_json::Value = r.json().await.unwrap_or_default();
            let dead: Vec<String> = v
                .get("dead")
                .and_then(|d| d.as_array())
                .map(|d| d.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            if !dead.is_empty() {
                // The app was deleted from those phones; stop sending to them.
                let mut s = push.store.lock().unwrap_or_else(|p| p.into_inner());
                s.apps.retain(|x| !dead.contains(&x.token));
                push.persist(&s);
            }
        }
        Ok(r) => {
            let code = r.status().as_u16();
            let why = r.text().await.unwrap_or_default();
            crate::diag::log(format!("[push] the app push relay refused a page: {code} {}", why.chars().take(120).collect::<String>()));
        }
        Err(e) => crate::diag::log(format!("[push] couldn't reach the app push relay: {e}")),
    }
}

fn drop_endpoint(push: &PushState, endpoint: &str) {
    let mut s = push.store.lock().unwrap_or_else(|p| p.into_inner());
    s.subs.retain(|x| x.endpoint != endpoint);
    push.persist(&s);
}

/// Fire-and-forget push to a set of crew users. Never blocks the caller: a
/// page must appear on open screens instantly even if a push service is slow.
pub fn notify(app: &AppHandle, user_ids: Vec<String>, payload: serde_json::Value) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let push = app.state::<PushState>().inner().clone();
        let private = {
            let s = push.store.lock().unwrap_or_else(|p| p.into_inner());
            s.vapid_private.clone()
        };
        let targets = subs_for(&push, &user_ids);
        let apps = apps_for(&push, &user_ids);
        if targets.is_empty() && apps.is_empty() {
            return;
        }
        let body = serde_json::to_vec(&payload).unwrap_or_default();
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build();
        let Ok(client) = client else { return };
        if !apps.is_empty() {
            send_apps(&client, &push, &apps, &payload).await;
        }

        for sub in targets {
            let info = SubscriptionInfo::new(
                sub.endpoint.clone(),
                sub.p256dh.clone(),
                sub.auth.clone(),
            );
            let sig = match VapidSignatureBuilder::from_base64(
                &private,
                web_push::URL_SAFE_NO_PAD,
                &info,
            ) {
                Ok(b) => match b.build() {
                    Ok(s) => s,
                    Err(_) => continue,
                },
                Err(_) => continue,
            };
            let mut builder = WebPushMessageBuilder::new(&info);
            builder.set_payload(ContentEncoding::Aes128Gcm, &body);
            builder.set_vapid_signature(sig);
            let Ok(message) = builder.build() else { continue };

            // Built by web-push, sent by the reqwest client already in the tree.
            let req = build_request::<bytes::Bytes>(message);
            let (parts, req_body) = req.into_parts();
            let mut rb = client.post(parts.uri.to_string());
            for (k, v) in parts.headers.iter() {
                rb = rb.header(k.as_str(), v.as_bytes());
            }
            match rb.body(req_body.to_vec()).send().await {
                Ok(r) => {
                    // 404/410 mean the browser threw the subscription away —
                    // keeping it would mean pushing into the void every service.
                    let code = r.status().as_u16();
                    if code == 404 || code == 410 {
                        drop_endpoint(&push, &sub.endpoint);
                    } else if !r.status().is_success() {
                        // Silent until now, so a page that never arrived left
                        // nothing to find. Host only: the endpoint is a secret.
                        let host = sub.endpoint.split('/').nth(2).unwrap_or("?").to_string();
                        let why = r.text().await.unwrap_or_default();
                        crate::diag::log(format!("[push] {host} refused a page: {code} {}", why.chars().take(120).collect::<String>()));
                    }
                }
                Err(_) => { /* transient — keep the subscription */ }
            }
        }
    });
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn push_public_key(push: tauri::State<'_, PushState>) -> serde_json::Value {
    json!({ "key": public_key(push.inner()) })
}

#[tauri::command]
pub fn push_subscribe(
    user_id: String,
    endpoint: String,
    p256dh: String,
    auth: String,
    push: tauri::State<'_, PushState>,
) -> Result<(), String> {
    subscribe(push.inner(), user_id, endpoint, p256dh, auth)
}

#[tauri::command]
pub fn push_unsubscribe(user_id: String, push: tauri::State<'_, PushState>) {
    unsubscribe(push.inner(), &user_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    // A malformed key is the worst failure mode here: every phone's subscribe
    // call fails at the browser, long before anything reaches the booth, so
    // there is nothing in a log to find.
    #[test]
    fn vapid_keys_have_the_shapes_browsers_and_web_push_require() {
        let (private, public) = generate_vapid();

        let priv_bytes = B64.decode(&private).expect("private key must be base64url");
        assert_eq!(priv_bytes.len(), 32, "P-256 scalar is 32 bytes");

        let pub_bytes = B64.decode(&public).expect("public key must be base64url");
        assert_eq!(pub_bytes.len(), 65, "applicationServerKey is an uncompressed point");
        assert_eq!(pub_bytes[0], 0x04, "uncompressed points start with 0x04");

        // Neither may carry base64 padding — pushManager.subscribe rejects it.
        assert!(!private.contains('=') && !public.contains('='));
    }

    fn tok(c: char) -> String {
        std::iter::repeat(c).take(64).collect()
    }

    // An app phone moves with whoever signs in on it, a person's oldest
    // devices fall off past the cap, and only real tokens get in.
    #[test]
    fn app_phones_are_kept_per_token_and_capped_per_person() {
        let push: PushState = Arc::new(PushInner::default());
        subscribe_app(&push, "a".into(), "apns".into(), tok('1')).unwrap();
        subscribe_app(&push, "b".into(), "apns".into(), tok('1')).unwrap();
        assert_eq!(apps_for(&push, &["a".into()]).len(), 0);
        assert_eq!(apps_for(&push, &["b".into()]).len(), 1);

        for c in ['2', '3', '4'] {
            subscribe_app(&push, "b".into(), "apns".into(), tok(c)).unwrap();
        }
        let left: Vec<String> = apps_for(&push, &["b".into()]).into_iter().map(|x| x.token).collect();
        assert_eq!(left, vec![tok('2'), tok('3'), tok('4')]);

        assert!(subscribe_app(&push, "b".into(), "apns".into(), "not a token".into()).is_err());
        assert!(subscribe_app(&push, "b".into(), "fcm".into(), tok('5')).is_err());

        unsubscribe_app(&push, "a", &tok('2'));
        assert_eq!(apps_for(&push, &["b".into()]).len(), 3, "only your own phone");
        unsubscribe_app(&push, "b", &tok('2'));
        assert_eq!(apps_for(&push, &["b".into()]).len(), 2);
        assert!(notified_users(&push).contains("b"));
    }

    #[test]
    fn relay_gets_the_words_and_tokens_only() {
        let apps = vec![AppSub { user_id: "u1".into(), platform: "apns".into(), token: tok('a'), created_ms: 0 }];
        let body = relay_body(&apps, &json!({ "title": "ProDeck · Page", "body": "Zach: mics", "tag": "page-1", "page": true, "pageId": "p1", "url": "/" }));
        assert_eq!(body["to"][0]["t"], tok('a'));
        assert_eq!(body["page"], true);
        assert!(body.get("pageId").is_none() && body.to_string().find("u1").is_none());
    }

    // The private half must be loadable by the signer we actually sign with.
    #[test]
    fn generated_key_is_accepted_by_the_vapid_signer() {
        let (private, _) = generate_vapid();
        let info = SubscriptionInfo::new(
            "https://push.example.com/x",
            // A syntactically valid receiver key/auth from the crate's own docs.
            "BLMbF9ffKBiWQLCKvTHb6LO8Nb6dcUh6TItC455vu2kElga6PQvUmaFyCdykxY2nOSSL3yKgfbmFLRTUaGv4yV8",
            "xS03Fi5ErfTNH_l9WHE9Ig",
        );
        let built = VapidSignatureBuilder::from_base64(&private, web_push::URL_SAFE_NO_PAD, &info)
            .expect("signer must accept our own key")
            .build();
        assert!(built.is_ok(), "VAPID signature must build");
    }
}
