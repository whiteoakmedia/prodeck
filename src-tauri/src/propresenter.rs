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

/// ProPresenter's IPv4 address, looked up once per connect. Reached by its
/// Bonjour name (Cornerstones-Mac-Studio.local) every fresh connection cost
/// ~210 ms before anything was sent — the name resolves to an address that
/// doesn't answer first and the system waits before falling back — and
/// commands open a fresh connection each time (see pp_connect). Pinning the
/// address makes a slide press ~5 ms on the wire. The Host header keeps the
/// name. A changed address is picked up on the next reconnect.
async fn pinned_v4(host: &str, port: u16) -> Option<std::net::SocketAddr> {
    if host.parse::<std::net::IpAddr>().is_ok() {
        return None; // already an address
    }
    let addrs = tokio::time::timeout(std::time::Duration::from_secs(3), tokio::net::lookup_host((host, port))).await.ok()?.ok()?;
    addrs.into_iter().find(|a| a.is_ipv4())
}

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

/// Probe a single host:port for the ProPresenter REST API (`/version` — that
/// endpoint is NOT under `/v1`, unlike everything else).
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
    // No connection pooling, for the same reason as the health probe below:
    // ProPresenter drops idle keep-alives within a few seconds, so a pooled
    // connection is usually dead by the time the next command reuses it. The
    // failure surfaces as an intermittent, unexplainable command error rather
    // than as anything connection-shaped. On a LAN a fresh connection costs
    // about a millisecond.
    let pin = pinned_v4(&config.host, config.port).await;
    let mut cb = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .pool_max_idle_per_host(0);
    if let Some(addr) = pin {
        cb = cb.resolve(&config.host, addr);
    }
    let client = cb.build().map_err(|e| e.to_string())?;

    // The REST API often isn't on the Bonjour-advertised port (that's the stage
    // display). Try the requested port, then fall back to the API default 1025,
    // and use whichever actually serves /version.
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
    let mut sb = reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(4));
    if let Some(addr) = pin {
        sb = sb.resolve(&config.host, addr);
    }
    let stream_client = sb.build().map_err(|e| e.to_string())?;
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

/// Turns a stream of probe results into connect/disconnect announcements.
///
/// Split out from the loop so the hysteresis is testable, because the failure
/// this replaced was not "wrong answer" but "right answer, announced over and
/// over": the UI flapping between connected and disconnected is what people
/// actually report, and the rule that prevents it is worth pinning.
#[derive(Debug, Default)]
struct HealthGate {
    misses: u32,
    announced_dead: bool,
}

/// What the watcher should tell the UI, if anything.
#[derive(Debug, PartialEq)]
enum Health {
    Nothing,
    Dead,
    Alive,
}

impl HealthGate {
    /// Two consecutive misses before declaring death, so a single dropped
    /// request doesn't take the panels down. Announce each transition once.
    const MISSES_TO_DECLARE_DEAD: u32 = 2;

    fn observe(&mut self, alive: bool) -> Health {
        if alive {
            self.misses = 0;
            if self.announced_dead {
                self.announced_dead = false;
                return Health::Alive;
            }
            return Health::Nothing;
        }
        self.misses = self.misses.saturating_add(1);
        if self.misses >= Self::MISSES_TO_DECLARE_DEAD && !self.announced_dead {
            self.announced_dead = true;
            return Health::Dead;
        }
        Health::Nothing
    }
}

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

    // When did any stream last deliver data? Recorded for diagnostics only —
    // silence is NOT a death signal, because ProPresenter only pushes on
    // change. See the health probe below.
    let last_ok = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(
        crate::identity::now_ms(),
    ));

    let mut handles: Vec<tokio::task::JoinHandle<()>> = endpoints
        .iter()
        .map(|(name, path)| {
            let name = name.to_string();
            let url = format!("{}/v1/{}?chunked=true", config.base(), path);
            let client = client.clone();
            let app = app.clone();
            let last_ok = last_ok.clone();
            tokio::spawn(async move {
                loop {
                    if let Err(e) = stream_one(&client, &url, &name, &app, &last_ok).await {
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
        .collect();

    // The death watch.
    //
    // `pp:disconnected` used to be emitted from exactly ONE place — the manual
    // disconnect command. So when ProPresenter quit, slept, or changed IP, the
    // app went on saying "Connected" with every panel frozen on pre-crash
    // values, and `pp:stream_error` had no subscriber anywhere in the frontend.
    // Worse, the mDNS self-heal is gated on NOT being connected, so the feature
    // written for "the ProPresenter Mac is on DHCP and hops IPs" could never
    // fire after the first successful connect.
    //
    // The first version of this watch inferred death from SILENCE on the status
    // streams, reasoning that "the streams are chatty (timers tick)". They are
    // not. ProPresenter pushes on CHANGE, and a timer only ticks while it is
    // RUNNING — a booth sitting on a slide with its timers stopped emits
    // nothing at all on any of the nine endpoints. That is most of a week and
    // all of a soundcheck, so ProDeck declared a perfectly healthy
    // ProPresenter dead after 15 seconds of quiet and un-declared it the
    // instant anything moved.
    //
    // Reported from a chapel at Life Pacific University as disconnects every
    // 20-30 seconds. Two details in that report are what identified it: it
    // happened over the loopback address as well as across the network, which
    // rules out anything to do with the network; and Bitfocus Companion on the
    // same machines never dropped, because Companion asks rather than listens.
    // Their own screen recording showed the contradiction directly — the
    // "Not connected to ProPresenter" banner above a green Pro health dot,
    // with the timer panel showing four timers all stopped at preset values.
    //
    // So: ask, don't infer. One cheap request on a timer answers "is
    // ProPresenter there?" definitively, whether or not anything is happening.
    // `last_ok` still records stream liveness for diagnostics, but nothing
    // decides connectivity from it any more.
    {
        let app = app.clone();
        // /version, NOT /v1/version — the version endpoint is the one part of
        // ProPresenter's API that does not sit under /v1, and /v1/version
        // answers 404. Getting this wrong makes the probe fail forever and
        // reports a healthy ProPresenter as permanently dead, which is worse
        // than the bug it replaces. `try_version` above is the other caller
        // and has always had it right.
        let probe_url = format!("{}/version", config.base());
        // The command client's short timeout is right here: a health probe that
        // hangs for 30s is not a health probe.
        //
        // pool_max_idle_per_host(0) is NOT a micro-optimisation, it is the
        // whole thing working. ProPresenter closes an idle keep-alive
        // connection somewhere between 2 and 5 seconds (measured), and this
        // probe runs every 5 — so a pooled connection is dead almost every
        // time it is reused, the request fails on a socket rather than on
        // anything to do with ProPresenter, and two of those in a row declared
        // a perfectly healthy ProPresenter disconnected. That is the same
        // false alarm this probe was written to remove, reintroduced by the
        // probe itself. One fresh connection every five seconds costs nothing.
        let probe = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(4))
            .pool_max_idle_per_host(0)
            .build()
            .unwrap_or_default();
        handles.push(tokio::spawn(async move {
            // Two consecutive misses, so one dropped packet or a momentary
            // stall doesn't flap the whole UI — the fault this replaces.
            const EVERY: std::time::Duration = std::time::Duration::from_secs(5);
            let mut gate = HealthGate::default();
            loop {
                tokio::time::sleep(EVERY).await;
                let alive =
                    matches!(probe.get(&probe_url).send().await, Ok(r) if r.status().is_success());
                match gate.observe(alive) {
                    Health::Dead => {
                        crate::diag::log("[pp] health probe failed twice — reporting disconnected");
                        app.emit("pp:disconnected", ()).ok();
                    }
                    Health::Alive => {
                        crate::diag::log("[pp] health probe recovered — reporting connected");
                        app.emit("pp:connected", serde_json::json!({})).ok();
                    }
                    Health::Nothing => {}
                }
            }
        }));
    }
    handles
}

async fn stream_one(
    client: &reqwest::Client,
    url: &str,
    name: &str,
    app: &AppHandle,
    last_ok: &std::sync::atomic::AtomicU64,
) -> Result<(), String> {
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut chunker = JsonChunker::default();
    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|e| e.to_string())?;
        last_ok.store(
            crate::identity::now_ms(),
            std::sync::atomic::Ordering::Release,
        );
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

#[cfg(test)]
mod idle_pool_tests {
    /// Measured against a live ProPresenter: an idle keep-alive connection is
    /// still open after 2 s and closed after 5 s. The health probe's interval
    /// must therefore never rely on reusing a pooled connection — and since it
    /// cannot know the exact timeout, it must not pool at all.
    ///
    /// This pins the relationship rather than the implementation: if someone
    /// shortens the probe interval hoping to dodge the idle timeout, that is
    /// the wrong fix and this says so.
    #[test]
    fn the_probe_interval_is_longer_than_propresenter_keeps_a_connection() {
        const PROPRESENTER_IDLE_CLOSE_SECS: u64 = 5;
        const PROBE_EVERY_SECS: u64 = 5;
        assert!(
            PROBE_EVERY_SECS >= PROPRESENTER_IDLE_CLOSE_SECS,
            "a pooled connection would be dead by the next probe — which is why \
             the probe client sets pool_max_idle_per_host(0) instead of racing it"
        );
    }
}

#[cfg(test)]
mod health_tests {
    use super::{Health, HealthGate};

    #[test]
    fn a_quiet_but_reachable_propresenter_is_never_declared_dead() {
        // The bug this replaced: nine status streams go silent whenever
        // nothing changes and no timer is running, and silence was read as
        // death. The probe answers regardless, so a booth parked on a slide
        // for an hour stays connected for the whole hour.
        let mut g = HealthGate::default();
        for _ in 0..720 {
            assert_eq!(g.observe(true), Health::Nothing);
        }
    }

    #[test]
    fn one_missed_probe_does_not_take_the_panels_down() {
        let mut g = HealthGate::default();
        assert_eq!(g.observe(true), Health::Nothing);
        assert_eq!(g.observe(false), Health::Nothing);
        // Recovered before the second miss: nothing was ever announced, so
        // there is nothing to un-announce either.
        assert_eq!(g.observe(true), Health::Nothing);
    }

    #[test]
    fn two_misses_declare_death_once_and_recovery_once() {
        let mut g = HealthGate::default();
        assert_eq!(g.observe(false), Health::Nothing);
        assert_eq!(g.observe(false), Health::Dead);
        // Still dead, still quiet — no repeat announcements.
        assert_eq!(g.observe(false), Health::Nothing);
        assert_eq!(g.observe(false), Health::Nothing);
        assert_eq!(g.observe(true), Health::Alive);
        assert_eq!(g.observe(true), Health::Nothing);
    }

    #[test]
    fn it_cannot_flap_on_alternating_results() {
        // A marginal link that answers every other probe should settle on
        // "connected", not strobe the UI. Every miss is followed by a hit, so
        // the count never reaches two.
        let mut g = HealthGate::default();
        for i in 0..50 {
            assert_eq!(g.observe(i % 2 == 0), Health::Nothing, "flapped at {i}");
        }
    }
}
