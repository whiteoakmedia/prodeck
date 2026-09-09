//! OBS Studio, over obs-websocket 5.
//!
//! Answers the question a booth actually asks all morning: *are we live, and
//! is the stream healthy?* ProPresenter tells us what's on the screens; OBS
//! tells us what's going out of the building. Scene, streaming/recording
//! state, uptime and dropped frames land on the dashboards next to everything
//! else.
//!
//! Protocol (obs-websocket 5.x, default port 4455):
//!   Hello(op 0) → Identify(op 1) → Identified(op 2), then Event(5),
//!   Request(6) and RequestResponse(7).
//! Auth, when OBS has a password set:
//!   base64(sha256(password + salt)) then base64(sha256(that + challenge)).

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const B64: base64::engine::general_purpose::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// General | Scenes | Outputs — everything the dashboards read, and nothing
/// noisy (OBS will happily firehose input-level events we'd only throw away).
const EVENT_SUBS: u32 = (1 << 0) | (1 << 2) | (1 << 6);

#[derive(Default)]
pub struct ObsInner {
    pub connected: bool,
    /// OBS Studio version string, for the diagnostics bundle.
    pub version: String,
    pub scene: String,
    pub scenes: Vec<String>,
    pub streaming: bool,
    pub recording: bool,
    /// Milliseconds the current stream/record has been running.
    pub stream_ms: u64,
    pub record_ms: u64,
    /// 0.0–1.0 from OBS; None when OBS can't reach the streaming service at
    /// all (the protocol sends null there — a naive parse would read 0.0 and
    /// call a dead stream perfectly healthy).
    pub congestion: Option<f64>,
    pub skipped_frames: u64,
    pub total_frames: u64,
    /// Last error worth showing the operator, in plain English.
    pub error: Option<String>,
}

pub type ObsState = Arc<Mutex<ObsInner>>;

pub fn new_state() -> ObsState {
    Arc::new(Mutex::new(ObsInner::default()))
}

pub fn snapshot(state: &ObsState) -> Value {
    let s = state.lock().unwrap_or_else(|p| p.into_inner());
    json!({
        "connected": s.connected,
        "version": s.version,
        "scene": s.scene,
        "scenes": s.scenes,
        "streaming": s.streaming,
        "recording": s.recording,
        "streamMs": s.stream_ms,
        "recordMs": s.record_ms,
        "congestion": s.congestion,
        "skippedFrames": s.skipped_frames,
        "totalFrames": s.total_frames,
        "droppedPct": dropped_pct(s.skipped_frames, s.total_frames),
        "error": s.error,
    })
}

/// Percentage of frames OBS gave up on. The number an operator actually reads:
/// anything above ~1% means the stream is struggling.
pub fn dropped_pct(skipped: u64, total: u64) -> f64 {
    if total == 0 {
        return 0.0;
    }
    (skipped as f64 / total as f64) * 100.0
}

#[tauri::command]
pub fn obs_state(state: tauri::State<'_, ObsState>) -> Value {
    snapshot(state.inner())
}

/// The auth string obs-websocket expects. Split out so it can be tested
/// against the values published in the protocol docs.
pub fn auth_string(password: &str, salt: &str, challenge: &str) -> String {
    let mut h = Sha256::new();
    h.update(password.as_bytes());
    h.update(salt.as_bytes());
    let secret = B64.encode(h.finalize());

    let mut h2 = Sha256::new();
    h2.update(secret.as_bytes());
    h2.update(challenge.as_bytes());
    B64.encode(h2.finalize())
}

fn settings(app: &AppHandle) -> (bool, String, u16, String) {
    let st = app.state::<crate::settings::SettingsState>();
    let s = st.lock().unwrap_or_else(|p| p.into_inner());
    (
        s.obs_enabled,
        s.obs_host.clone(),
        if s.obs_port == 0 { 4455 } else { s.obs_port },
        s.obs_password.clone(),
    )
}

fn set_connected(app: &AppHandle, state: &ObsState, up: bool, err: Option<String>) {
    let changed = {
        let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
        let was = s.connected;
        s.connected = up;
        s.error = err;
        if !up {
            // Don't leave a stale "LIVE" on every dashboard when the link
            // drops — we no longer know, and claiming live is the dangerous
            // direction to be wrong in.
            s.streaming = false;
            s.recording = false;
            s.congestion = None;
        }
        was != up
    };
    if changed {
        app.emit("obs:status", json!({ "connected": up })).ok();
    }
    app.emit("obs:state", snapshot(state)).ok();
}

/// Apply a GetStreamStatus / GetRecordStatus / event payload.
fn apply_stream(s: &mut ObsInner, d: &Value) {
    if let Some(v) = d.get("outputActive").and_then(|v| v.as_bool()) {
        s.streaming = v;
    }
    if let Some(v) = d.get("outputDuration").and_then(|v| v.as_u64()) {
        s.stream_ms = v;
    }
    // Explicitly null when OBS cannot reach the ingest server — but ONLY a
    // GetStreamStatus response actually carries the field. The StreamStateChanged
    // EVENT carries just outputActive/outputState, so clearing it there set
    // streaming=true and congestion=None in the same breath and the widget
    // rendered a red "no connection to the stream service" at the exact moment
    // you went live, until the 2s poll refilled it.
    if d.get("outputCongestion").is_some() || d.get("outputTotalFrames").is_some() {
        s.congestion = d.get("outputCongestion").and_then(|v| v.as_f64());
    }
    if let Some(v) = d.get("outputSkippedFrames").and_then(|v| v.as_u64()) {
        s.skipped_frames = v;
    }
    if let Some(v) = d.get("outputTotalFrames").and_then(|v| v.as_u64()) {
        s.total_frames = v;
    }
}

fn apply_record(s: &mut ObsInner, d: &Value) {
    if let Some(v) = d.get("outputActive").and_then(|v| v.as_bool()) {
        s.recording = v;
    }
    if let Some(v) = d.get("outputDuration").and_then(|v| v.as_u64()) {
        s.record_ms = v;
    }
}

/// Turn an obs-websocket close/handshake failure into something an operator
/// can act on, rather than a Rust error string.
fn friendly(e: &str) -> String {
    let low = e.to_lowercase();
    if low.contains("401") || low.contains("unauthor") {
        "OBS refused the password — check Tools → WebSocket Server Settings.".into()
    } else if low.contains("connection refused") || low.contains("refused") {
        "OBS isn't accepting connections — is OBS open, and is its WebSocket server enabled?".into()
    } else if low.contains("timed out") || low.contains("timeout") {
        "No answer from OBS — check the address and that both machines are on the same network.".into()
    } else {
        format!("Can't reach OBS: {e}")
    }
}

pub fn spawn_client(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state: ObsState = app.state::<ObsState>().inner().clone();
        loop {
            let (enabled, host, port, password) = settings(&app);
            if !enabled || host.trim().is_empty() {
                set_connected(&app, &state, false, None);
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
            let url = format!("ws://{}:{}", host.trim(), port);
            match run_session(&app, &state, &url, &password, (enabled, host, port)).await {
                Ok(()) => {}
                Err(e) => {
                    crate::diag::log(format!("[obs] {e}"));
                    set_connected(&app, &state, false, Some(friendly(&e)));
                }
            }
            tokio::time::sleep(Duration::from_secs(4)).await;
        }
    });
}

async fn run_session(
    app: &AppHandle,
    state: &ObsState,
    url: &str,
    password: &str,
    cfg: (bool, String, u16),
) -> Result<(), String> {
    let (mut ws, _) = tokio::time::timeout(Duration::from_secs(6), tokio_tungstenite::connect_async(url))
        .await
        .map_err(|_| "timed out".to_string())?
        .map_err(|e| e.to_string())?;

    let hello = handshake(&mut ws, password, EVENT_SUBS).await?;
    if let Some(v) = hello.get("obsStudioVersion").and_then(|x| x.as_str()) {
        state.lock().unwrap_or_else(|p| p.into_inner()).version = v.to_string();
    }
    set_connected(app, state, true, None);

    // ---- Prime: OBS only pushes CHANGES, so ask for the current picture.
    for (id, rt) in [
        ("scenes", "GetSceneList"),
        ("stream", "GetStreamStatus"),
        ("record", "GetRecordStatus"),
    ] {
        send(&mut ws, &json!({ "op": 6, "d": { "requestType": rt, "requestId": id } })).await?;
    }

    // ---- Pump: events + periodic status (duration/frames only arrive on ask)
    let mut poll = tokio::time::interval(Duration::from_secs(2));
    poll.tick().await;
    let mut cfg_check = tokio::time::interval(Duration::from_secs(2));
    cfg_check.tick().await;

    loop {
        tokio::select! {
            msg = ws.next() => {
                let Some(msg) = msg else { return Err("OBS closed the connection".into()) };
                let msg = msg.map_err(|e| e.to_string())?;
                if msg.is_close() {
                    return Err("OBS closed the connection".into());
                }
                let Ok(txt) = msg.into_text() else { continue };
                let Ok(v) = serde_json::from_str::<Value>(&txt) else { continue };
                handle(app, state, &v);
            }
            _ = poll.tick() => {
                for (id, rt) in [("stream", "GetStreamStatus"), ("record", "GetRecordStatus")] {
                    send(&mut ws, &json!({ "op": 6, "d": { "requestType": rt, "requestId": id } })).await?;
                }
            }
            _ = cfg_check.tick() => {
                let now = settings(app);
                if (now.0, now.1, now.2) != cfg {
                    return Ok(()); // settings changed — reconnect with them
                }
            }
        }
    }
}

fn handle(app: &AppHandle, state: &ObsState, v: &Value) {
    let op = v.get("op").and_then(|x| x.as_u64()).unwrap_or(99);
    let d = v.get("d").cloned().unwrap_or(Value::Null);
    let mut dirty = false;
    {
        let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
        match op {
            // ---- Event
            5 => {
                let name = d.get("eventType").and_then(|x| x.as_str()).unwrap_or("");
                let data = d.get("eventData").cloned().unwrap_or(Value::Null);
                match name {
                    "CurrentProgramSceneChanged" => {
                        if let Some(n) = data.get("sceneName").and_then(|x| x.as_str()) {
                            s.scene = n.to_string();
                            dirty = true;
                        }
                    }
                    "StreamStateChanged" => {
                        apply_stream(&mut s, &data);
                        dirty = true;
                    }
                    "RecordStateChanged" => {
                        apply_record(&mut s, &data);
                        dirty = true;
                    }
                    "SceneListChanged" => {
                        if let Some(list) = data.get("scenes").and_then(|x| x.as_array()) {
                            s.scenes = scene_names(list);
                            dirty = true;
                        }
                    }
                    _ => {}
                }
            }
            // ---- RequestResponse
            7 => {
                let id = d.get("requestId").and_then(|x| x.as_str()).unwrap_or("");
                let data = d.get("responseData").cloned().unwrap_or(Value::Null);
                match id {
                    "scenes" => {
                        if let Some(list) = data.get("scenes").and_then(|x| x.as_array()) {
                            s.scenes = scene_names(list);
                        }
                        if let Some(n) = data.get("currentProgramSceneName").and_then(|x| x.as_str()) {
                            s.scene = n.to_string();
                        }
                        dirty = true;
                    }
                    "stream" => {
                        apply_stream(&mut s, &data);
                        dirty = true;
                    }
                    "record" => {
                        apply_record(&mut s, &data);
                        dirty = true;
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    if dirty {
        app.emit("obs:state", snapshot(state)).ok();
    }
}

/// OBS lists scenes newest-first; dashboards read better in OBS's own UI order.
fn scene_names(list: &[Value]) -> Vec<String> {
    let mut v: Vec<String> = list
        .iter()
        .filter_map(|s| s.get("sceneName").and_then(|n| n.as_str()).map(String::from))
        .collect();
    v.reverse();
    v
}

type Ws = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;

/// Hello(0) → Identify(1) → Identified(2). Returns Hello's `d` payload so the
/// caller can read the OBS version. Kept free of AppHandle so it can be tested
/// against a mock obs-websocket server — the handshake and the auth string are
/// the parts that silently fail as "OBS just won't connect".
async fn handshake(ws: &mut Ws, password: &str, subs: u32) -> Result<Value, String> {
    let hello = next_json(ws).await?;
    if hello.get("op").and_then(|v| v.as_u64()) != Some(0) {
        return Err("OBS didn't send the expected greeting".into());
    }
    let d = hello.get("d").cloned().unwrap_or(Value::Null);
    let rpc = d.get("rpcVersion").and_then(|v| v.as_u64()).unwrap_or(1);
    let mut ident = json!({ "rpcVersion": rpc, "eventSubscriptions": subs });
    if let Some(a) = d.get("authentication") {
        let salt = a.get("salt").and_then(|v| v.as_str()).unwrap_or("");
        let challenge = a.get("challenge").and_then(|v| v.as_str()).unwrap_or("");
        if password.is_empty() {
            return Err("OBS has a WebSocket password set — enter it in ProDeck's OBS settings.".into());
        }
        ident["authentication"] = json!(auth_string(password, salt, challenge));
    }
    send(ws, &json!({ "op": 1, "d": ident })).await?;

    let ok = next_json(ws).await?;
    if ok.get("op").and_then(|v| v.as_u64()) != Some(2) {
        // OBS closes with 4009 on a bad password; surface that plainly.
        return Err("unauthorized".into());
    }
    Ok(d)
}

async fn send(ws: &mut Ws, v: &Value) -> Result<(), String> {
    ws.send(tokio_tungstenite::tungstenite::Message::Text(v.to_string()))
        .await
        .map_err(|e| e.to_string())
}

async fn next_json(ws: &mut Ws) -> Result<Value, String> {
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(8), ws.next())
            .await
            .map_err(|_| "timed out waiting for OBS".to_string())?
            .ok_or("OBS closed the connection")?
            .map_err(|e| e.to_string())?;
        if msg.is_close() {
            return Err("unauthorized".into());
        }
        if let Ok(t) = msg.into_text() {
            if let Ok(v) = serde_json::from_str::<Value>(&t) {
                return Ok(v);
            }
        }
    }
}

/// Switch scenes. Admin-tier only (enforced in web.rs) — this changes what the
/// world sees.
#[tauri::command]
pub async fn obs_set_scene(scene: String, app: AppHandle) -> Result<(), String> {
    let (enabled, host, port, password) = settings(&app);
    if !enabled || host.trim().is_empty() {
        return Err("OBS isn't set up".into());
    }
    let url = format!("ws://{}:{}", host.trim(), port);
    let (mut ws, _) = tokio::time::timeout(Duration::from_secs(6), tokio_tungstenite::connect_async(&url))
        .await
        .map_err(|_| "timed out".to_string())?
        .map_err(|e| friendly(&e.to_string()))?;
    handshake(&mut ws, &password, 0).await?;
    send(
        &mut ws,
        &json!({ "op": 6, "d": {
            "requestType": "SetCurrentProgramScene",
            "requestId": "set",
            "requestData": { "sceneName": scene },
        }}),
    )
    .await?;
    let reply = next_json(&mut ws).await?;
    let okd = reply.get("d").cloned().unwrap_or(Value::Null);
    if okd
        .get("requestStatus")
        .and_then(|s| s.get("result"))
        .and_then(|b| b.as_bool())
        == Some(false)
    {
        let why = okd
            .get("requestStatus")
            .and_then(|s| s.get("comment"))
            .and_then(|c| c.as_str())
            .unwrap_or("OBS refused the scene change");
        return Err(why.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_matches_known_vectors() {
        // Fixed vectors, computed with a DIFFERENT implementation (Python's
        // hashlib) from the values in the obs-websocket docs. Recomputing the
        // hash here with the same crate would only prove it agrees with
        // itself; these catch a wrong hash, wrong base64 alphabet, or a
        // swapped concatenation order — the failures that look like "OBS just
        // refuses my password".
        assert_eq!(
            auth_string("supersecretpassword", "PZVbYpvAnZut2SS6JNJytDm9", "ztTBnnuqrqaKDzRM3xcVdbYm"),
            "zZgWipvwSGrw748kHN4gNpBC1IaeiiWX3Hjkrm849Sc=",
        );
        assert_eq!(
            auth_string("supersecretpassword", "82VdVAdMSBLNmJIYQNPYcA==", "+IxH4CnCiqpX1w1EBiOZBw=="),
            "sU34Q+UpX6g68QK1EdSioqUP6/NELBP0tBNutgpdwFY=",
        );
        // OBS can have authentication enabled with an empty password.
        assert_eq!(auth_string("", "abc", "def"), "Bgd1skVrUD3eg/l0wQM6+i829tg60hPywyKoDpgGQ4Y=");
        // Standard base64, padded — the URL-safe alphabet is silently rejected
        // by OBS, and '+' vs '-' is exactly the kind of thing that slips by.
        let v = auth_string("supersecretpassword", "82VdVAdMSBLNmJIYQNPYcA==", "+IxH4CnCiqpX1w1EBiOZBw==");
        assert!(v.contains('+') && v.ends_with('='), "must be padded standard base64");
        // Concatenation order is load-bearing.
        assert_ne!(
            auth_string("PZVbYpvAnZut2SS6JNJytDm9", "supersecretpassword", "ztTBnnuqrqaKDzRM3xcVdbYm"),
            "zZgWipvwSGrw748kHN4gNpBC1IaeiiWX3Hjkrm849Sc=",
        );
    }

    #[test]
    fn dropped_percentage_is_safe_and_readable() {
        assert_eq!(dropped_pct(0, 0), 0.0, "no frames yet must not divide by zero");
        assert_eq!(dropped_pct(0, 1000), 0.0);
        assert!((dropped_pct(15, 1000) - 1.5).abs() < 0.001);
        assert!((dropped_pct(1000, 1000) - 100.0).abs() < 0.001);
    }

    #[test]
    fn a_dead_stream_never_reads_as_healthy() {
        let mut s = ObsInner::default();
        // OBS sends congestion: null when it cannot reach the ingest server.
        apply_stream(&mut s, &json!({ "outputActive": true, "outputCongestion": null }));
        assert_eq!(s.congestion, None, "null congestion must not become 0.0");
        apply_stream(&mut s, &json!({ "outputCongestion": 0.42 }));
        assert_eq!(s.congestion, Some(0.42));
        // A STATUS payload without the field clears it rather than going stale
        // (outputTotalFrames marks it as a status response).
        apply_stream(&mut s, &json!({ "outputActive": true, "outputTotalFrames": 100 }));
        assert_eq!(s.congestion, None);
        // But a bare StreamStateChanged EVENT must leave it alone. This test
        // used to pin the opposite, which is how the false "no connection to
        // the stream service" at go-live survived.
        apply_stream(&mut s, &json!({ "outputCongestion": 0.5, "outputTotalFrames": 1 }));
        apply_stream(&mut s, &json!({ "outputActive": true, "outputState": "OBS_WEBSOCKET_OUTPUT_STARTED" }));
        assert_eq!(s.congestion, Some(0.5), "an event must not clear congestion");
    }

    #[test]
    fn stream_and_record_state_track_events() {
        let mut s = ObsInner::default();
        apply_stream(
            &mut s,
            &json!({ "outputActive": true, "outputDuration": 61_000u64,
                     "outputSkippedFrames": 12u64, "outputTotalFrames": 1200u64 }),
        );
        assert!(s.streaming);
        assert_eq!(s.stream_ms, 61_000);
        assert!((dropped_pct(s.skipped_frames, s.total_frames) - 1.0).abs() < 0.001);
        apply_record(&mut s, &json!({ "outputActive": true, "outputDuration": 500u64 }));
        assert!(s.recording);
        assert_eq!(s.record_ms, 500);
        // Recording state must never be confused with streaming state.
        apply_stream(&mut s, &json!({ "outputActive": false }));
        assert!(!s.streaming);
        assert!(s.recording, "stopping the stream must not stop the recording");
    }

    #[test]
    fn scene_list_is_in_obs_ui_order() {
        let list = vec![
            json!({ "sceneName": "Outro", "sceneIndex": 2 }),
            json!({ "sceneName": "Sermon", "sceneIndex": 1 }),
            json!({ "sceneName": "Worship", "sceneIndex": 0 }),
        ];
        assert_eq!(scene_names(&list), vec!["Worship", "Sermon", "Outro"]);
    }

    // ---- Handshake against a mock obs-websocket server -------------------
    // No OBS on this machine, so the next best proof: a server that speaks the
    // real protocol. This exercises the part that actually breaks in the field
    // — Hello parsing, the auth string on the wire, and the failure paths —
    // rather than trusting that the client "looks right".

    use futures_util::{SinkExt as _, StreamExt as _};
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::Message;

    /// Spawn a fake OBS. `auth` = Some((salt, challenge)) to demand a password.
    /// Returns the port and a receiver for the Identify payload it saw.
    async fn mock_obs(
        auth: Option<(&'static str, &'static str)>,
        accept: bool,
    ) -> (u16, tokio::sync::oneshot::Receiver<Value>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            let mut hello = json!({
                "op": 0,
                "d": { "obsWebSocketVersion": "5.5.2", "rpcVersion": 1, "obsStudioVersion": "30.2.3" }
            });
            if let Some((salt, challenge)) = auth {
                hello["d"]["authentication"] = json!({ "salt": salt, "challenge": challenge });
            }
            ws.send(Message::Text(hello.to_string())).await.unwrap();

            let ident = loop {
                match ws.next().await {
                    Some(Ok(Message::Text(t))) => break serde_json::from_str::<Value>(&t).unwrap(),
                    Some(Ok(_)) => continue,
                    _ => return,
                }
            };
            let _ = tx.send(ident.clone());
            if accept {
                ws.send(Message::Text(json!({ "op": 2, "d": { "negotiatedRpcVersion": 1 } }).to_string()))
                    .await
                    .unwrap();
                // Behave like OBS: answer the priming requests.
                tokio::time::sleep(Duration::from_millis(50)).await;
            } else {
                // OBS closes the socket on a bad password (code 4009).
                let _ = ws.close(None).await;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        });
        (port, rx)
    }

    async fn client(port: u16) -> Ws {
        let (ws, _) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}"))
            .await
            .unwrap();
        ws
    }

    #[tokio::test]
    async fn handshake_sends_the_right_auth_to_a_password_protected_obs() {
        const SALT: &str = "PZVbYpvAnZut2SS6JNJytDm9";
        const CHALLENGE: &str = "ztTBnnuqrqaKDzRM3xcVdbYm";
        let (port, rx) = mock_obs(Some((SALT, CHALLENGE)), true).await;
        let mut ws = client(port).await;

        let hello = handshake(&mut ws, "supersecretpassword", EVENT_SUBS).await.unwrap();
        assert_eq!(hello.get("obsStudioVersion").unwrap(), "30.2.3");

        let ident = rx.await.unwrap();
        assert_eq!(ident["op"], 1);
        assert_eq!(ident["d"]["rpcVersion"], 1);
        // The exact string OBS will recompute and compare against.
        assert_eq!(ident["d"]["authentication"], "zZgWipvwSGrw748kHN4gNpBC1IaeiiWX3Hjkrm849Sc=");
        // Subscribed to General|Scenes|Outputs and nothing noisier.
        assert_eq!(ident["d"]["eventSubscriptions"], EVENT_SUBS);
    }

    #[tokio::test]
    async fn handshake_works_when_obs_has_no_password() {
        let (port, rx) = mock_obs(None, true).await;
        let mut ws = client(port).await;
        handshake(&mut ws, "", EVENT_SUBS).await.unwrap();
        let ident = rx.await.unwrap();
        assert!(
            ident["d"].get("authentication").is_none(),
            "must not send an auth field OBS didn't ask for"
        );
    }

    #[tokio::test]
    async fn a_rejected_password_reads_as_unauthorized() {
        let (port, _rx) = mock_obs(Some(("s", "c")), false).await;
        let mut ws = client(port).await;
        let err = handshake(&mut ws, "wrong", EVENT_SUBS).await.unwrap_err();
        assert_eq!(err, "unauthorized");
        // …and the operator is told what to actually do about it.
        assert!(friendly(&err).contains("password"));
    }

    #[tokio::test]
    async fn a_missing_password_is_explained_before_we_even_try() {
        let (port, _rx) = mock_obs(Some(("s", "c")), true).await;
        let mut ws = client(port).await;
        let err = handshake(&mut ws, "", EVENT_SUBS).await.unwrap_err();
        assert!(err.contains("password set"), "got: {err}");
    }

    #[test]
    fn errors_are_written_for_a_volunteer() {
        assert!(friendly("Connection refused (os error 61)").contains("is OBS open"));
        assert!(friendly("HTTP error: 401 Unauthorized").contains("password"));
        assert!(friendly("timed out").contains("same network"));
    }
}
