use base64::Engine;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProPresenterConfig {
    pub host: String,
    pub port: u16,
}

impl ProPresenterConfig {
    fn base(&self) -> String {
        // IPv6 literals must be bracketed in a URL.
        let host = if self.host.contains(':') && !self.host.starts_with('[') {
            format!("[{}]", self.host)
        } else {
            self.host.clone()
        };
        format!("http://{}:{}", host, self.port)
    }
}

pub struct ProPresenterConnection {
    pub config: ProPresenterConfig,
    pub client: reqwest::Client,
    pub tasks: Vec<JoinHandle<()>>,
}

impl ProPresenterConnection {
    fn abort(&mut self) {
        for t in self.tasks.drain(..) {
            t.abort();
        }
    }
}

pub type ProPresenterState = Arc<Mutex<Option<ProPresenterConnection>>>;

pub(crate) async fn current_config(
    state: &ProPresenterState,
) -> Result<(reqwest::Client, String), String> {
    let s = state.lock().await;
    let c = s.as_ref().ok_or_else(|| "Not connected".to_string())?;
    Ok((c.client.clone(), c.config.base()))
}

// ---------------------------------------------------------------------------
// Connect / disconnect
// ---------------------------------------------------------------------------

/// Probe a single host:port for the ProPresenter REST API (`/v1/version`).
async fn try_version(
    client: &reqwest::Client,
    cfg: &ProPresenterConfig,
) -> Result<serde_json::Value, String> {
    // ProPresenter's version endpoint is /version (not under /v1).
    let resp = client
        .get(format!("{}/version", cfg.base()))
        .send()
        .await
        .map_err(|_| format!(":{} no response (unreachable / firewalled)", cfg.port))?;
    if !resp.status().is_success() {
        return Err(format!(":{} returned HTTP {}", cfg.port, resp.status()));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str::<serde_json::Value>(&text)
        .map_err(|_| format!(":{} responded but isn't the ProPresenter API", cfg.port))
}

#[tauri::command]
pub async fn pp_connect(
    config: ProPresenterConfig,
    state: tauri::State<'_, ProPresenterState>,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .build()
        .map_err(|e| e.to_string())?;

    // The REST API often isn't on the Bonjour-advertised port (that's the stage
    // display). Try the requested port, then fall back to the API default 1025,
    // and use whichever actually serves /v1/version.
    let mut candidates = vec![config.port];
    if config.port != 1025 {
        candidates.push(1025);
    }
    let mut errors = Vec::new();
    let mut found: Option<(ProPresenterConfig, serde_json::Value)> = None;
    for port in candidates {
        let cfg = ProPresenterConfig {
            host: config.host.clone(),
            port,
        };
        match try_version(&client, &cfg).await {
            Ok(v) => {
                found = Some((cfg, v));
                break;
            }
            Err(e) => errors.push(e),
        }
    }
    let (cfg, version) = found.ok_or_else(|| {
        format!(
            "No ProPresenter API found on {} — {}. Enable Preferences → Network and open the port.",
            config.host,
            errors.join("; ")
        )
    })?;

    // Tear down any prior connection.
    {
        let mut s = state.lock().await;
        if let Some(mut old) = s.take() {
            old.abort();
        }
    }

    // The status endpoints are long-lived chunked streams. The 4s command
    // timeout on `client` would abort them every few seconds (showing up as
    // recurring "error decoding response body" retries), so give the streams a
    // dedicated client with only a connect timeout and no overall deadline.
    let stream_client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(4))
        .build()
        .map_err(|e| e.to_string())?;
    let tasks = spawn_status_streams(&stream_client, &cfg, app.clone());

    {
        let mut s = state.lock().await;
        *s = Some(ProPresenterConnection {
            config: cfg.clone(),
            client,
            tasks,
        });
    }

    app.emit("pp:connected", &cfg).ok();
    Ok(version)
}

#[tauri::command]
pub async fn pp_disconnect(
    state: tauri::State<'_, ProPresenterState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut s = state.lock().await;
    if let Some(mut c) = s.take() {
        c.abort();
    }
    app.emit("pp:disconnected", ()).ok();
    Ok(())
}

#[tauri::command]
pub async fn pp_is_connected(state: tauri::State<'_, ProPresenterState>) -> Result<bool, String> {
    Ok(state.lock().await.is_some())
}

// ---------------------------------------------------------------------------
// Generic REST passthrough (GET / PUT / DELETE)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn pp_get(
    path: String,
    state: tauri::State<'_, ProPresenterState>,
) -> Result<serde_json::Value, String> {
    let (client, base) = current_config(&state).await?;
    let url = format!("{}/v1/{}", base, path.trim_start_matches('/'));
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if resp.status().as_u16() == 204 {
        return Ok(serde_json::Value::Null);
    }
    resp.json::<serde_json::Value>()
        .await
        .or(Ok(serde_json::Value::Null))
}

#[tauri::command]
pub async fn pp_put(
    path: String,
    body: Option<serde_json::Value>,
    state: tauri::State<'_, ProPresenterState>,
) -> Result<(), String> {
    let (client, base) = current_config(&state).await?;
    let url = format!("{}/v1/{}", base, path.trim_start_matches('/'));
    let mut req = client.put(&url);
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    ensure_ok(resp)
}

#[tauri::command]
pub async fn pp_delete(
    path: String,
    state: tauri::State<'_, ProPresenterState>,
) -> Result<(), String> {
    let (client, base) = current_config(&state).await?;
    let url = format!("{}/v1/{}", base, path.trim_start_matches('/'));
    client.delete(&url).send().await.map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Typed control helpers (thin wrappers used by the UI)
// ---------------------------------------------------------------------------

// ProPresenter's trigger / clear / action endpoints respond to GET — a PUT to
// them returns 404. (Reads also use GET, so only writes-that-set-data like the
// stage message stay PUT/DELETE.)
// Treat any non-2xx ProPresenter response as a failure, so a dead trigger/clear
// surfaces to the operator instead of silently appearing to succeed.
fn ensure_ok(resp: reqwest::Response) -> Result<(), String> {
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("ProPresenter returned {}", resp.status()))
    }
}

macro_rules! get_cmd {
    ($name:ident, $path:expr) => {
        #[tauri::command]
        pub async fn $name(state: tauri::State<'_, ProPresenterState>) -> Result<(), String> {
            let (client, base) = current_config(&state).await?;
            let resp = client
                .get(format!("{}{}", base, $path))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            ensure_ok(resp)
        }
    };
}

get_cmd!(pp_trigger_next, "/v1/trigger/next");
get_cmd!(pp_trigger_previous, "/v1/trigger/previous");

/// Generic GET-based ProPresenter action (slide/prop trigger, clears, …). The
/// frontend routes all "do this now" actions through here; returns an error on
/// a non-success status so failures surface instead of silently doing nothing.
#[tauri::command]
pub async fn pp_action(
    path: String,
    state: tauri::State<'_, ProPresenterState>,
) -> Result<(), String> {
    let (client, base) = current_config(&state).await?;
    let url = format!("{}/v1/{}", base, path.trim_start_matches('/'));
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("ProPresenter returned {} for {}", resp.status(), path));
    }
    Ok(())
}

#[tauri::command]
pub async fn pp_clear_layer(
    layer: String,
    state: tauri::State<'_, ProPresenterState>,
) -> Result<(), String> {
    let (client, base) = current_config(&state).await?;
    let resp = client
        .get(format!("{}/v1/clear/layer/{}", base, layer))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    ensure_ok(resp)
}

#[tauri::command]
pub async fn pp_trigger_macro(
    id: String,
    state: tauri::State<'_, ProPresenterState>,
) -> Result<(), String> {
    let (client, base) = current_config(&state).await?;
    let resp = client
        .get(format!("{}/v1/macro/{}/trigger", base, urlencoding::encode(&id)))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    ensure_ok(resp)
}

#[tauri::command]
pub async fn pp_trigger_look(
    id: String,
    state: tauri::State<'_, ProPresenterState>,
) -> Result<(), String> {
    let (client, base) = current_config(&state).await?;
    let resp = client
        .get(format!("{}/v1/look/{}/trigger", base, urlencoding::encode(&id)))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    ensure_ok(resp)
}

#[tauri::command]
pub async fn pp_timer_op(
    id: String,
    op: String, // "start" | "stop" | "reset"
    state: tauri::State<'_, ProPresenterState>,
) -> Result<(), String> {
    let (client, base) = current_config(&state).await?;
    let resp = client
        .get(format!(
            "{}/v1/timer/{}/{}",
            base,
            urlencoding::encode(&id),
            op
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    ensure_ok(resp)
}

#[tauri::command]
pub async fn pp_set_stage_message(
    message: String,
    state: tauri::State<'_, ProPresenterState>,
) -> Result<(), String> {
    let (client, base) = current_config(&state).await?;
    let resp = client
        .put(format!("{}/v1/stage/message", base))
        .json(&message)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    ensure_ok(resp)
}

#[tauri::command]
pub async fn pp_clear_stage_message(
    state: tauri::State<'_, ProPresenterState>,
) -> Result<(), String> {
    let (client, base) = current_config(&state).await?;
    let resp = client
        .delete(format!("{}/v1/stage/message", base))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    ensure_ok(resp)
}

/// Fetch a slide thumbnail and return it as a base64 data URL.
#[tauri::command]
pub async fn pp_thumbnail(
    uuid: String,
    index: u32,
    quality: Option<u32>,
    state: tauri::State<'_, ProPresenterState>,
) -> Result<String, String> {
    let (client, base) = current_config(&state).await?;
    let q = quality.unwrap_or(400);
    let url = format!(
        "{}/v1/presentation/{}/thumbnail/{}?quality={}",
        base,
        urlencoding::encode(&uuid),
        index,
        q
    );
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("thumbnail status {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

/// Fetch a thumbnail for a slide of a PLAYLIST ITEM. Unlike the presentation
/// thumbnail, the cue index here is the position within the item's selected
/// arrangement (the order we display), and it doesn't depend on the
/// presentation's current_arrangement state — so the image always matches the
/// slide we show. Returns a base64 data URL.
#[tauri::command]
pub async fn pp_playlist_thumbnail(
    playlist_id: String,
    item_index: u32,
    cue_index: u32,
    quality: Option<u32>,
    state: tauri::State<'_, ProPresenterState>,
) -> Result<String, String> {
    let (client, base) = current_config(&state).await?;
    let q = quality.unwrap_or(400);
    let url = format!(
        "{}/v1/playlist/{}/{}/thumbnail/{}?quality={}",
        base,
        urlencoding::encode(&playlist_id),
        item_index,
        cue_index,
        q
    );
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("thumbnail status {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

// ---------------------------------------------------------------------------
// Live status streaming (ProPresenter chunked HTTP API)
// ---------------------------------------------------------------------------

fn spawn_status_streams(
    client: &reqwest::Client,
    config: &ProPresenterConfig,
    app: AppHandle,
) -> Vec<JoinHandle<()>> {
    // (stream name, endpoint path)
    let endpoints = [
        // status/slide carries the current slide's NOTES, which drive TapLink
        // (tap:<keyword> → NFC destination switch). See tap.rs.
        ("current_slide", "status/slide"),
        // The announcements layer is a separate slide state (the pre-service
        // loop runs there) with its own streams — TapLink watches both layers.
        ("active_announcement", "announcement/active"),
        ("announcement_slide_index", "announcement/slide_index"),
        ("slide_index", "presentation/slide_index"),
        ("active_presentation", "presentation/active"),
        ("layers", "status/layers"),
        ("current_timers", "timers/current"),
        ("current_look", "look/current"),
        ("stage_message", "stage/message"),
    ];

    endpoints
        .iter()
        .map(|(name, path)| {
            let name = name.to_string();
            let url = format!("{}/v1/{}?chunked=true", config.base(), path);
            let client = client.clone();
            let app = app.clone();
            tokio::spawn(async move {
                loop {
                    if let Err(e) = stream_one(&client, &url, &name, &app).await {
                        // Surface transient errors but keep retrying so the UI
                        // recovers automatically when ProPresenter comes back.
                        app.emit(
                            "pp:stream_error",
                            serde_json::json!({ "stream": name, "error": e }),
                        )
                        .ok();
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
            })
        })
        .collect()
}

async fn stream_one(
    client: &reqwest::Client,
    url: &str,
    name: &str,
    app: &AppHandle,
) -> Result<(), String> {
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut chunker = JsonChunker::default();
    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&bytes);
        let mut objects = Vec::new();
        chunker.push(&text, &mut objects);
        for obj in objects {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&obj) {
                if name == "current_slide" {
                    crate::tap::on_slide(app, &value).await;
                } else if name == "active_presentation" {
                    crate::tap::on_active_presentation(app, &value).await;
                } else if name == "active_announcement" {
                    crate::tap::on_active_announcement(app, &value).await;
                } else if name == "announcement_slide_index" {
                    crate::tap::on_announcement_index(app, &value).await;
                }
                app.emit(
                    "pp:status",
                    serde_json::json!({ "stream": name, "data": value }),
                )
                .ok();
            }
        }
    }
    Ok(())
}

/// Splits a byte stream of concatenated JSON values into individual values by
/// tracking brace/bracket depth while respecting string literals.
#[derive(Default)]
struct JsonChunker {
    buf: String,
    depth: i32,
    in_str: bool,
    escape: bool,
    started: bool,
}

impl JsonChunker {
    fn push(&mut self, s: &str, out: &mut Vec<String>) {
        for c in s.chars() {
            self.buf.push(c);
            if self.in_str {
                if self.escape {
                    self.escape = false;
                } else if c == '\\' {
                    self.escape = true;
                } else if c == '"' {
                    self.in_str = false;
                }
                continue;
            }
            match c {
                '"' => self.in_str = true,
                '{' | '[' => {
                    self.depth += 1;
                    self.started = true;
                }
                '}' | ']' => {
                    self.depth -= 1;
                    if self.depth <= 0 && self.started {
                        out.push(self.buf.trim().to_string());
                        self.buf.clear();
                        self.started = false;
                        self.depth = 0;
                    }
                }
                _ => {
                    if !self.started {
                        // Drop stray whitespace between values.
                        self.buf.clear();
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Lobby TVs auto-restore. ProPresenter boots with the announcements layer
// DARK, which used to mean a human re-triggering the lobby loop after every
// Pro restart. This watchdog re-triggers the designated playlist item
// whenever the layer is empty, so lobby TVs converge back to slides no
// matter which box rebooted. Runs on the booth only (it's spawned in setup —
// web clients never execute this file).
// ---------------------------------------------------------------------------

pub fn spawn_lobby_auto(app: tauri::AppHandle) {
    use tauri::Manager;
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            let (playlist, index) = {
                let st = app.state::<crate::settings::SettingsState>();
                let s = st.lock().unwrap_or_else(|p| p.into_inner());
                (s.lobby_auto_playlist.clone(), s.lobby_auto_index)
            };
            if playlist.is_empty() {
                continue;
            }
            let state = app.state::<ProPresenterState>().inner().clone();
            let Ok((client, base)) = current_config(&state).await else {
                continue; // Pro link down — nothing to restore onto yet
            };
            // Only act on a confirmed-empty layer: an unreachable Pro or a
            // malformed reply must not fire a trigger.
            let active = client
                .get(format!("{}/v1/announcement/active", base))
                .send()
                .await;
            let Ok(resp) = active else { continue };
            let Ok(v) = resp.json::<serde_json::Value>().await else { continue };
            let is_dark = v.get("announcement").map(|a| a.is_null()).unwrap_or(false);
            if !is_dark {
                continue;
            }
            let _ = client
                .get(format!("{}/v1/playlist/{}/{}/trigger", base, playlist, index))
                .send()
                .await;
        }
    });
}

// ProPresenter's status stream does NOT emit announcement/slide_index when a
// slide auto-advances on a timer (manual triggers stream fine) — so a lobby
// loop's tap:<keyword> notes went stale ten seconds in. Poll the index and
// feed the same handler; it dedupes, so re-asserting an unchanged slide is
// free.
pub fn spawn_announcement_poll(app: tauri::AppHandle) {
    use tauri::Manager;
    tauri::async_runtime::spawn(async move {
        let mut n: u32 = 0;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            n = n.wrapping_add(1);
            let state = app.state::<ProPresenterState>().inner().clone();
            let Ok((client, base)) = current_config(&state).await else { continue };
            // The DECK BODY (slide notes → keywords) also needs polling: the
            // stream only sends announcement/active on a trigger, so a loop
            // already running when ProDeck starts leaves the keyword table
            // empty and the index poll computes against nothing. Every 10 s
            // is plenty — decks change rarely, positions constantly.
            if n % 5 == 1 {
                if let Ok(resp) = client
                    .get(format!("{}/v1/announcement/active", base))
                    .send()
                    .await
                {
                    if let Ok(v) = resp.json::<serde_json::Value>().await {
                        crate::tap::on_active_announcement(&app, &v).await;
                    }
                }
            }
            let Ok(resp) = client
                .get(format!("{}/v1/announcement/slide_index", base))
                .send()
                .await
            else {
                continue;
            };
            let Ok(v) = resp.json::<serde_json::Value>().await else { continue };
            crate::tap::on_announcement_index(&app, &v).await;

            // The PRESENTATION layer's live slide, for the same reason: the
            // stream can miss a transition, leaving a stale live keyword that
            // outranks the announcements loop forever (observed: "notes"
            // stuck from editor clicking while 14DaysPrayer sat live with
            // empty notes). status/slide returns the current notes directly.
            if let Ok(resp) = client.get(format!("{}/v1/status/slide", base)).send().await {
                if let Ok(v) = resp.json::<serde_json::Value>().await {
                    crate::tap::on_slide(&app, &v).await;
                }
            }
        }
    });
}
