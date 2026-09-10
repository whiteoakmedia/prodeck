// LAN web gateway. The desktop app stays the engine (ProPresenter streams, NDI,
// audio); browsers are thin clients. This module serves the compiled dashboard
// UI over HTTP, streams app events to browsers via Server-Sent Events, and
// proxies a password-gated whitelist of control commands via POST /api/cmd.

use crate::pco;
use crate::propresenter::{current_config, ProPresenterState};
use crate::settings::{Settings, SettingsState};
use base64::Engine;
use include_dir::{include_dir, Dir};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Listener, Manager, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::broadcast;

// The Vite build output, embedded into the binary at compile time.
static DIST: Dir = include_dir!("$CARGO_MANIFEST_DIR/../dist");

// App events mirrored to browsers (so every frontend store updates as on desktop).
const FORWARD_EVENTS: &[&str] = &[
    "avantis:state",
    "avantis:status",
    "avantis:midi",
    "pp:connected",
    "pp:disconnected",
    "pp:status",
    "pp:stream_error",
    "caption:line",
    "caption:status",
    "audio:started",
    "audio:stopped",
    "audio:level",
    "audio:rta",
    "audio:lufs",
    "audio:channels",
    "pco:items",
    "pco:team",
    "pco:times",
    "pco:attachments",
    "pco:live",
    "pco:sync_started",
    "pco:sync_stopped",
    "ndi:stream_started",
    "ndi:status",
    "chat:message",
    // Pages must reach phones or the whole feature is booth-only.
    "page:new",
    "page:receipt",
    "checkin:changed",
    "posfiles:changed",
    // Without these the OBS tile froze at whatever it read on page load, and a
    // TapLink push failure was invisible on every phone and kiosk.
    "obs:state",
    "obs:status",
    "tap:pushed",
    "tap:error",
    "checklist:changed",
    "chat:confidence_clear",
    "identity:changed",
];

pub struct WebInner {
    pub running: AtomicBool,
    pub port: AtomicU16,
    pub tx: broadcast::Sender<String>,
    // Last frame per event (pp:status keyed by stream) so a browser that connects
    // after the host is already live receives the current state immediately.
    snapshot: Mutex<HashMap<String, String>>,
    listeners_ready: AtomicBool,
}

impl WebInner {
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(1024);
        Self {
            running: AtomicBool::new(false),
            port: AtomicU16::new(0),
            tx,
            snapshot: Mutex::new(HashMap::new()),
            listeners_ready: AtomicBool::new(false),
        }
    }
}

pub type WebState = Arc<WebInner>;

fn web_password(app: &AppHandle) -> String {
    app.state::<SettingsState>().lock().unwrap_or_else(|p| p.into_inner()).web_password.clone()
}

/// Access tier of a presented token. Admin = the original web password (full
/// control, unchanged behavior). Member = the second password: dashboards,
/// streams, and TEAM chat only — enforced in dispatch(), not in the UI.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Tier {
    Admin,
    Member,
}

/// Events that describe a MOMENT, not a state.
///
/// Every other forwarded event is snapshotted so a newly-connected browser sees
/// current state immediately. Replaying these instead re-delivers something
/// that already happened: a phone's EventSource reconnects every time it wakes
/// or is backgrounded, and each reconnect re-fired the last page as a
/// full-screen siren takeover the volunteer had already confirmed — the stored
/// frame carries the receipts as they were at emit time, i.e. empty. It rang
/// again on every reconnect for the rest of the day. Chat did the same, minus
/// the takeover: re-chimed, re-buzzed and re-badged.
const ONE_SHOT: &[&str] = &[
    "page:new",
    "page:receipt",
    "chat:message",
    "tap:pushed",
    "tap:error",
    "pco:sync_started",
    "pco:sync_stopped",
];

/// Failed gateway auths per peer: (count, first_failure_ms).
static AUTH_FAILS: std::sync::LazyLock<Mutex<HashMap<String, (u32, u64)>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));
const AUTH_FREE_TRIES: u32 = 8;
const AUTH_WINDOW_MS: u64 = 300_000;

/// How long this peer must wait, if it is being throttled.
fn auth_backoff(peer: &str) -> Option<u64> {
    if peer.is_empty() {
        return None;
    }
    let mut m = AUTH_FAILS.lock().unwrap_or_else(|p| p.into_inner());
    let now = crate::identity::now_ms();
    let (n, since) = *m.get(peer)?;
    if now.saturating_sub(since) > AUTH_WINDOW_MS {
        m.remove(peer);
        return None;
    }
    if n <= AUTH_FREE_TRIES {
        return None;
    }
    // Doubling, capped: a person who fat-fingered the password twice is barely
    // inconvenienced; a script is stopped dead.
    let wait_ms = (1_000u64 << (n - AUTH_FREE_TRIES).min(6)).min(60_000);
    let ready_at = since + wait_ms;
    (now < ready_at).then(|| (ready_at - now).div_ceil(1000))
}

fn note_auth_failure(peer: &str) {
    if peer.is_empty() {
        return;
    }
    let mut m = AUTH_FAILS.lock().unwrap_or_else(|p| p.into_inner());
    // Cap the table so a spoofed-source flood can't grow it without bound.
    if m.len() > 2_000 {
        m.clear();
    }
    let now = crate::identity::now_ms();
    let e = m.entry(peer.to_string()).or_insert((0, now));
    e.0 += 1;
    e.1 = now;
}

fn clear_auth_failures(peer: &str) {
    if !peer.is_empty() {
        AUTH_FAILS
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(peer);
    }
}

fn token_tier(app: &AppHandle, token: &str) -> Option<Tier> {
    let (admin, member, invite) = {
        let state = app.state::<SettingsState>();
        let s = state.lock().unwrap_or_else(|p| p.into_inner());
        (
            s.web_password.clone(),
            s.web_member_password.clone(),
            s.web_invite_token.clone(),
        )
    };
    if !admin.is_empty() && token == admin {
        return Some(Tier::Admin);
    }
    if !member.is_empty() && token == member {
        return Some(Tier::Member);
    }
    // The rotatable crew-invite token (?join= links) is a member credential.
    if !invite.is_empty() && token == invite {
        return Some(Tier::Member);
    }
    // Unclaimed personal invites (?invite= links) get member access so the
    // volunteer can reach the claim screen; the claim swaps them onto the
    // durable token and consumes this one.
    let identity = app.state::<crate::identity::IdentityState>().inner().clone();
    if crate::identity::invite_grants_gateway(&identity, token) {
        return Some(Tier::Member);
    }
    None
}

pub(crate) fn token_ok(app: &AppHandle, token: &str) -> bool {
    token_tier(app, token).is_some()
}

/// Register one-time global listeners that fan app events into the SSE channel.
fn ensure_listeners(app: &AppHandle, web: &WebState) {
    if web.listeners_ready.swap(true, Ordering::AcqRel) {
        return;
    }
    for &name in FORWARD_EVENTS {
        let web = web.clone();
        let nm = name.to_string();
        // Meter streams fire ~12×/s all day — relaying every frame to every
        // phone burns their battery for no visible gain. Forward at most ~5/s
        // (snapshot still updates each frame so late joiners get fresh state).
        let throttled = name == "audio:level" || name == "audio:rta";
        let last_sent = std::sync::atomic::AtomicU64::new(0);
        app.listen(name, move |ev| {
            // ev.payload() is already a JSON string ("null" for unit payloads).
            let payload = ev.payload();
            let frame = format!("{{\"event\":\"{}\",\"payload\":{}}}", nm, payload);
            let drop_frame = if throttled {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                let last = last_sent.load(Ordering::Acquire);
                if now.saturating_sub(last) < 200 {
                    true
                } else {
                    last_sent.store(now, Ordering::Release);
                    false
                }
            } else {
                false
            };
            if !ONE_SHOT.contains(&nm.as_str()) {
                let mut snap = web.snapshot.lock().unwrap_or_else(|p| p.into_inner());
                // ProPresenter dropped — forget its stale connected/status snapshot.
                if nm == "pp:disconnected" {
                    snap.retain(|k, _| !k.starts_with("pp:"));
                }
                // pp:status carries several distinct streams under one event name.
                let key = if nm == "pp:status" {
                    serde_json::from_str::<Value>(payload)
                        .ok()
                        .and_then(|v| {
                            v.get("stream")
                                .and_then(|s| s.as_str())
                                .map(|s| format!("pp:status::{s}"))
                        })
                        .unwrap_or_else(|| "pp:status".to_string())
                } else {
                    nm.clone()
                };
                snap.insert(key, frame.clone());
            }
            if !drop_frame {
                let _ = web.tx.send(frame);
            }
        });
    }
}

pub fn start(app: AppHandle, web: WebState, port: u16) {
    if web.running.swap(true, Ordering::AcqRel) {
        return; // already running
    }
    ensure_listeners(&app, &web);
    web.port.store(port, Ordering::Release);

    tauri::async_runtime::spawn(async move {
        // The previous server (after a port change) may hold the socket briefly.
        let mut listener = None;
        for _ in 0..6 {
            match TcpListener::bind(("0.0.0.0", port)).await {
                Ok(l) => {
                    listener = Some(l);
                    break;
                }
                Err(_) => tokio::time::sleep(Duration::from_millis(500)).await,
            }
        }
        let listener = match listener {
            Some(l) => l,
            None => {
                web.running.store(false, Ordering::Release);
                crate::diag::log(format!("web gateway: could not bind port {port}"));
                return;
            }
        };

        while web.running.load(Ordering::Acquire) {
            // Time-boxed accept so toggling off releases the port within ~1s.
            match tokio::time::timeout(Duration::from_secs(1), listener.accept()).await {
                Ok(Ok((stream, _addr))) => {
                    let app2 = app.clone();
                    let web2 = web.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = handle_conn(stream, app2, web2).await;
                    });
                }
                _ => continue,
            }
        }
    });
}

pub fn stop(web: &WebState) {
    web.running.store(false, Ordering::Release);
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

async fn handle_conn(
    mut stream: tokio::net::TcpStream,
    app: AppHandle,
    web: WebState,
) -> std::io::Result<()> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    let header_end;
    // Every read is time-boxed: a half-open or slow-trickle connection (phone
    // wifi drop mid-request, or a deliberate slowloris) otherwise parks this
    // spawned task forever — tokio never enables TCP keepalive, so a vanished
    // peer with no FIN/RST would hold the read for good (audit finding).
    const READ_TIMEOUT: Duration = Duration::from_secs(20);
    loop {
        let n = match tokio::time::timeout(READ_TIMEOUT, stream.read(&mut tmp)).await {
            Ok(r) => r?,
            Err(_) => return Ok(()), // stalled — drop the connection
        };
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = find(&buf, b"\r\n\r\n") {
            header_end = pos + 4;
            break;
        }
        if buf.len() > 65536 {
            return Ok(());
        }
    }

    let header_str = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = header_str.lines();
    let req_line = lines.next().unwrap_or("");
    let mut parts = req_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("/");

    let content_length = header_str
        .lines()
        .find_map(|l| {
            let l = l.to_ascii_lowercase();
            l.strip_prefix("content-length:")
                .map(|v| v.trim().parse::<usize>().unwrap_or(0))
        })
        .unwrap_or(0);

    let content_type = header_str
        .lines()
        .find_map(|l| {
            let l = l.to_ascii_lowercase();
            l.strip_prefix("content-type:").map(|v| v.trim().to_string())
        })
        .unwrap_or_default();

    if method == "OPTIONS" {
        return write_bytes(&mut stream, 204, "text/plain", b"").await;
    }

    // SSE event stream.
    if method == "GET" && path.starts_with("/api/events") {
        let token = path
            .split_once("token=")
            .map(|(_, t)| t.split('&').next().unwrap_or(""))
            .map(|t| urlencoding::decode(t).map(|c| c.into_owned()).unwrap_or_default())
            .unwrap_or_default();
        if !token_ok(&app, &token) {
            return write_bytes(&mut stream, 401, "text/plain", b"unauthorized").await;
        }
        return serve_sse(stream, app, web).await;
    }

    // Overflow audio as a live MP3 stream (plays in a plain <audio> element, so
    // iOS routes it through the media channel — ignores the ring/silent switch).
    if method == "GET" && path.starts_with("/api/listen.mp3") {
        let token = path
            .split_once("token=")
            .map(|(_, t)| t.split('&').next().unwrap_or(""))
            .map(|t| urlencoding::decode(t).map(|c| c.into_owned()).unwrap_or_default())
            .unwrap_or_default();
        if !token_ok(&app, &token) {
            return write_bytes(&mut stream, 401, "text/plain", b"unauthorized").await;
        }
        return serve_audio_mp3(stream, app).await;
    }

    // Position files. Token-gated like every other read: the id comes straight
    // off the URL, so posfiles only serves ids that are actually in its index.
    if method == "GET" && path.starts_with("/api/file/") {
        let token = path
            .split_once("token=")
            .map(|(_, t)| t.split('&').next().unwrap_or(""))
            .map(|t| urlencoding::decode(t).map(|c| c.into_owned()).unwrap_or_default())
            .unwrap_or_default();
        if !token_ok(&app, &token) {
            return write_bytes(&mut stream, 401, "text/plain", b"unauthorized").await;
        }
        let id = path
            .trim_start_matches("/api/file/")
            .split('?')
            .next()
            .unwrap_or("")
            .to_string();
        let st = app.state::<crate::posfiles::PosFilesState>().inner().clone();
        return match crate::posfiles::read_blob(&st, &id) {
            Some((mime, _name, bytes)) => {
                let ct = if mime.is_empty() { "application/octet-stream".to_string() } else { mime };
                write_bytes(&mut stream, 200, &ct, &bytes).await
            }
            None => write_bytes(&mut stream, 404, "text/plain", b"not found").await,
        };
    }

    // Overflow audio ("Listen") — raw i16 LE mono PCM, token-gated.
    if method == "GET" && path.starts_with("/api/listen") {
        let token = path
            .split_once("token=")
            .map(|(_, t)| t.split('&').next().unwrap_or(""))
            .map(|t| urlencoding::decode(t).map(|c| c.into_owned()).unwrap_or_default())
            .unwrap_or_default();
        if !token_ok(&app, &token) {
            return write_bytes(&mut stream, 401, "text/plain", b"unauthorized").await;
        }
        return serve_audio(stream, app).await;
    }

    // Control / data command.
    if method == "POST" && path.starts_with("/api/cmd") {
        // Cap the body BEFORE buffering it — the token check can only run after
        // the body is read, so without a cap any unauthenticated LAN client
        // could declare a huge Content-Length and balloon memory.
        if content_length > 2_000_000 {
            return write_bytes(&mut stream, 413, "text/plain", b"payload too large").await;
        }
        let mut body = buf[header_end..].to_vec();
        while body.len() < content_length {
            // Same stall guard as the header loop — this runs before auth, so
            // it must never wait on a peer that stopped sending.
            let n = match tokio::time::timeout(READ_TIMEOUT, stream.read(&mut tmp)).await {
                Ok(r) => r?,
                Err(_) => return Ok(()),
            };
            if n == 0 {
                break;
            }
            body.extend_from_slice(&tmp[..n]);
        }
        let v: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        let token = v.get("token").and_then(|x| x.as_str()).unwrap_or("");
        let cmd = v.get("cmd").and_then(|x| x.as_str()).unwrap_or("");
        let args = v.get("args").cloned().unwrap_or_else(|| json!({}));
        // The crew session rides at the top level of every request. It is what
        // turns "a phone with the crew password" into "Devon's phone", and
        // Devon's grants are what decide whether a member-tier request may do
        // more than look.
        let session = v.get("session").and_then(|x| x.as_str()).unwrap_or("").to_string();
        // Force a CORS preflight. Without this a POST carrying
        // `content-type: text/plain` is a CORS *simple* request — no preflight
        // — and because every response carries `Access-Control-Allow-Origin: *`
        // any web page a crew phone visited on the church LAN could drive this
        // endpoint AND read the answers, including guessing the password at
        // full speed. The OPTIONS handler deliberately advertises no custom
        // headers, so requiring JSON is enough to stop it.
        if !content_type.contains("application/json") {
            return write_bytes(
                &mut stream,
                415,
                "application/json",
                b"{\"error\":\"send application/json\"}",
            )
            .await;
        }
        let peer_ip = stream
            .peer_addr()
            .map(|a| a.ip().to_string())
            .unwrap_or_default();
        // Slow down guessing. Unlike the PIN path (identity::login_core) the
        // gateway passwords had no attempt counter, no backoff and no lockout
        // at all, so they could be enumerated as fast as the LAN allows.
        if let Some(wait) = auth_backoff(&peer_ip) {
            return write_bytes(
                &mut stream,
                429,
                "application/json",
                format!("{{\"error\":\"too many attempts — wait {wait}s\"}}").as_bytes(),
            )
            .await;
        }
        let Some(tier) = token_tier(&app, token) else {
            note_auth_failure(&peer_ip);
            return write_bytes(&mut stream, 401, "application/json", b"{\"error\":\"unauthorized\"}")
                .await;
        };
        clear_auth_failures(&peer_ip);
        // Auto check-in lives HERE, not in dispatch: it needs the connection's
        // presence evidence (TCP peer + Cloudflare's CF-Connecting-IP), which
        // only this layer can see. Any signed-in tier may use it.
        if cmd == "checkin_auto" || cmd == "checkin_geo" {
            let s = |k: &str| args.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            let st = app.state::<crate::checkin::CheckinState>().inner().clone();
            let church = {
                let cfg = app.state::<SettingsState>();
                let g = cfg.lock().unwrap_or_else(|p| p.into_inner());
                match (g.church_lat.trim().parse::<f64>(), g.church_lng.trim().parse::<f64>()) {
                    (Ok(la), Ok(ln)) => Some((la, ln, g.checkin_radius_m.max(25) as f64)),
                    _ => None,
                }
            };
            let result: Result<Value, String> = if cmd == "checkin_geo" {
                let f = |k: &str| args.get(k).and_then(|x| x.as_f64());
                match (f("lat"), f("lng")) {
                    (Some(lat), Some(lng)) => crate::checkin::geo_check_in(
                        &app, &st, &identity, &s("session"), &s("serviceKey"), lat, lng, church,
                    ),
                    _ => Err("lat and lng are required".into()),
                }
            } else {
                let net = crate::checkin::ClientNet {
                    peer_private: stream
                        .peer_addr()
                        .map(|a| match a.ip() {
                            std::net::IpAddr::V4(v4) => v4.is_private(),
                            std::net::IpAddr::V6(_) => false,
                        })
                        .unwrap_or(false),
                    cf_ip: header_str.lines().find_map(|l| {
                        let l = l.trim();
                        l.to_ascii_lowercase()
                            .strip_prefix("cf-connecting-ip:")
                            .map(|_| l.splitn(2, ':').nth(1).unwrap_or("").trim().to_string())
                    }),
                };
                if crate::checkin::on_site(&net).await {
                    crate::checkin::check_in(&app, &st, &identity, &s("session"), &s("serviceKey"))
                        .map(|ts| json!({ "checkedIn": true, "at": ts, "geo": church.is_some() }))
                } else {
                    Ok(json!({ "checkedIn": false, "geo": church.is_some() }))
                }
            };
            let out = match result {
                Ok(val) => json!({ "result": val }),
                Err(e) => json!({ "error": e }),
            };
            let bytes = serde_json::to_vec(&out).unwrap_or_default();
            return write_bytes(&mut stream, 200, "application/json", &bytes).await;
        }
        let caller = {
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            crate::identity::session_caller(&identity, &session)
        };
        let out = match dispatch(&app, cmd, &args, tier, caller).await {
            Ok(val) => json!({ "result": val }),
            Err(e) => json!({ "error": e }),
        };
        let bytes = serde_json::to_vec(&out).unwrap_or_default();
        return write_bytes(&mut stream, 200, "application/json", &bytes).await;
    }

    // ------------------------------------------------------------ Stream Deck
    // One URL per physical button: GET /api/deck/<action>?token=<admin>
    // (&text=... where noted). Admin-only, same dispatch as the UI — a key on
    // the desk is just a very fast admin. Designed for silent-HTTP plugins
    // (API Ninja etc.); responses are tiny JSON.
    if method == "GET" && path.starts_with("/api/deck/") {
        let (route, query) = path.split_once('?').unwrap_or((path, ""));
        let qp = |k: &str| -> Option<String> {
            query.split('&').find_map(|pair| {
                let (a, b) = pair.split_once('=')?;
                if a != k {
                    return None;
                }
                Some(urlencoding::decode(b).map(|c| c.into_owned()).unwrap_or_default())
            })
        };
        let token = qp("token").unwrap_or_default();
        if token_tier(&app, &token) != Some(Tier::Admin) {
            return write_bytes(&mut stream, 401, "application/json", b"{\"error\":\"admin token required\"}").await;
        }
        let action = route.trim_start_matches("/api/deck/").trim_end_matches('/');
        let text = qp("text").unwrap_or_default();
        let n = qp("n").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
        let pco_selected = || -> Option<(String, String)> {
            let mut f = dirs::config_dir()?;
            f.push("ProDeck");
            f.push("pco.json");
            let v: Value = serde_json::from_str(&std::fs::read_to_string(f).ok()?).ok()?;
            Some((
                v.get("selectedServiceTypeId")?.as_str()?.to_string(),
                v.get("selectedPlanId")?.as_str()?.to_string(),
            ))
        };
        let result: Result<Value, String> = match action {
            "pp-next" => dispatch(&app, "pp_trigger_next", &json!({}), Tier::Admin, None).await,
            "pp-prev" => dispatch(&app, "pp_trigger_previous", &json!({}), Tier::Admin, None).await,
            "pp-clear-slide" => dispatch(&app, "pp_clear_layer", &json!({"layer":"slide"}), Tier::Admin, None).await,
            "pp-clear-media" => dispatch(&app, "pp_clear_layer", &json!({"layer":"media"}), Tier::Admin, None).await,
            "pp-clear-props" => dispatch(&app, "pp_clear_layer", &json!({"layer":"props"}), Tier::Admin, None).await,
            "announce-clear" => dispatch(&app, "pp_clear_layer", &json!({"layer":"announcements"}), Tier::Admin, None).await,
            // Re-light the standing lobby loop (whatever Auto-restore is set to).
            "announce-play" => {
                let (pl, idx) = {
                    let st = app.state::<SettingsState>();
                    let g = st.lock().unwrap_or_else(|p| p.into_inner());
                    (g.lobby_auto_playlist.clone(), g.lobby_auto_index)
                };
                if pl.is_empty() {
                    Err("no standing loop — set Auto-restore in the Lobby TVs widget first".into())
                } else {
                    // pp_action, not pp_get: pp_get discards the HTTP status,
                    // so a trigger against a stale playlist id reported success
                    // while the lobby TVs stayed dark. pp_action exists exactly
                    // to surface that.
                    dispatch(&app, "pp_action", &json!({"path": format!("playlist/{}/{}/trigger", pl, idx)}), Tier::Admin, None).await
                }
            }
            "macro" => {
                if text.is_empty() { Err("add &text=<macro name>".into()) }
                else { dispatch(&app, "pp_trigger_macro", &json!({"id": text}), Tier::Admin, None).await }
            }
            // Crew page to everyone (full takeover + receipts + push).
            "page" => {
                let body = if text.is_empty() { "Check ProDeck".to_string() } else { text.clone() };
                dispatch(&app, "page_send", &json!({"body": body, "recipients": [], "buzz": true, "session": ""}), Tier::Admin, None).await
            }
            // Confidence-monitor banner; label model, admin-gated.
            "confidence" => {
                if text.is_empty() { Err("add &text=<banner text>".into()) }
                else {
                    let chat = app.state::<crate::chat::ChatState>().inner().clone();
                    crate::chat::send_core(&app, &chat, "Stream Deck".into(), text.clone(), "confidence".into(), "team".into())
                        .map(|m| serde_json::to_value(m).unwrap_or(Value::Null))
                }
            }
            "confidence-clear" => dispatch(&app, "chat_clear_confidence", &json!({}), Tier::Admin, None).await,
            "avantis-scene" => {
                if n == 0 { Err("add &n=<scene number>".into()) }
                else { dispatch(&app, "avantis_recall_scene", &json!({"scene": n}), Tier::Admin, None).await }
            }
            // Tap disc: force a keyword (holds 10 min or until tap-auto),
            // release back to slide-following, or read state for Companion
            // button feedback (poll this URL into a variable).
            "tap" => {
                if text.is_empty() { Err("add &text=<keyword or default>".into()) }
                else { crate::tap::override_core(&app, Some(text.clone())).await.map(|_| json!({"held": text})) }
            }
            "tap-auto" => crate::tap::resume_core(&app).await.map(|_| json!({"resumed": true})),
            "tap-state" => crate::tap::edge_state_core(&app).await,
            // ---- readouts for Stream Deck display keys (poll into variables)
            "spl-state" => {
                let cal = {
                    let st = app.state::<SettingsState>();
                    let s = st.lock().unwrap_or_else(|p| p.into_inner());
                    s.spl_calibration
                };
                Ok(match crate::audio::last_dbfs() {
                    Some(db) => json!({
                        "running": true,
                        "dbfs": (db * 10.0).round() / 10.0,
                        "spl": ((db + cal) * 10.0).round() / 10.0,
                    }),
                    None => json!({ "running": false, "spl": Value::Null }),
                })
            }
            "checkin-state" => {
                let st = app.state::<crate::checkin::CheckinState>().inner().clone();
                let identity = app.state::<crate::identity::IdentityState>().inner().clone();
                let v = crate::checkin::list(&app, &st, &identity, "");
                let users = crate::identity::approved_users(&identity);
                let names: Vec<String> = v
                    .get("at")
                    .and_then(|a| a.as_object())
                    .map(|m| {
                        m.keys()
                            .filter_map(|uid| {
                                users.iter().find(|(id, _)| id == uid).map(|(_, n)| n.clone())
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                // Comma-joined so a Companion feedback can `includes(...)` a
                // person's name to light their crew-board key green.
                Ok(json!({ "count": names.len(), "names": names.join(", ") }))
            }
            "pp-state" => {
                match current_config(&pp_handle(&app)).await {
                    Err(_) => Ok(json!({ "connected": false, "presentation": "", "slide": "" })),
                    Ok((client, base)) => {
                        let get_json = |path: &str| {
                            let url = format!("{}/v1/{}", base, path);
                            let c = client.clone();
                            async move {
                                c.get(&url).send().await.ok()?.json::<Value>().await.ok()
                            }
                        };
                        let pres = get_json("presentation/active").await;
                        let slide = get_json("status/slide").await;
                        let pname = pres
                            .as_ref()
                            .and_then(|v| v.pointer("/presentation/id/name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let stext: String = slide
                            .as_ref()
                            .and_then(|v| v.pointer("/current/text"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .chars()
                            .take(40)
                            .collect();
                        Ok(json!({ "connected": true, "presentation": pname, "slide": stext }))
                    }
                }
            }
            // Last page sent + who's still unread — the receipts board on a key.
            "page-state" => {
                let pages = app.state::<crate::pages::PagesState>().inner().clone();
                let list = crate::pages::list_core(&pages);
                Ok(match list.iter().max_by_key(|p| p.sent_ms) {
                    None => json!({ "any": false }),
                    Some(p) => {
                        let waiting: Vec<&str> = p
                            .recipients
                            .iter()
                            .filter(|r| !p.receipts.iter().any(|x| x.user_id == r.id))
                            .map(|r| r.name.as_str())
                            .collect();
                        json!({
                            "any": true,
                            "body": p.body.chars().take(30).collect::<String>(),
                            "acked": p.receipts.len(),
                            "total": p.recipients.len(),
                            "waiting": waiting.join(", "),
                        })
                    }
                })
            }
            "page-rebuzz" => {
                let pages = app.state::<crate::pages::PagesState>().inner().clone();
                let last = crate::pages::list_core(&pages).iter().max_by_key(|p| p.sent_ms).map(|p| p.id);
                match last {
                    None => Err("no page to re-buzz".into()),
                    Some(id) => crate::pages::rebuzz_core(&app, &pages, id)
                        .map(|n| json!({ "rebuzzed": n })),
                }
            }
            // Everything the deck's display keys need, in ONE poll: Companion
            // stores this into a single custom variable and derives per-key
            // expression variables from it (tap disc, SPL, arrivals, now
            // playing, last-page receipts).
            "deck-state" => {
                let tap = crate::tap::edge_state_core(&app).await.unwrap_or(Value::Null);
                let cal = {
                    let st = app.state::<SettingsState>();
                    let s = st.lock().unwrap_or_else(|p| p.into_inner());
                    s.spl_calibration
                };
                let spl = crate::audio::last_dbfs()
                    .map(|db| json!(((db + cal) * 10.0).round() / 10.0))
                    .unwrap_or(Value::Null);
                let (count, names) = {
                    let st = app.state::<crate::checkin::CheckinState>().inner().clone();
                    let identity = app.state::<crate::identity::IdentityState>().inner().clone();
                    let v = crate::checkin::list(&app, &st, &identity, "");
                    let users = crate::identity::approved_users(&identity);
                    let names: Vec<String> = v
                        .get("at")
                        .and_then(|a| a.as_object())
                        .map(|m| {
                            m.keys()
                                .filter_map(|uid| {
                                    users.iter().find(|(id, _)| id == uid).map(|(_, n)| n.clone())
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    (names.len(), names.join(", "))
                };
                let pp = match current_config(&pp_handle(&app)).await {
                    Err(_) => json!({ "connected": false, "presentation": "", "slide": "" }),
                    Ok((client, base)) => {
                        let fetch = |path: String| {
                            let c = client.clone();
                            let b = base.clone();
                            async move {
                                c.get(format!("{}/v1/{}", b, path)).send().await.ok()?
                                    .json::<Value>().await.ok()
                            }
                        };
                        let pres = fetch("presentation/active".into()).await;
                        let pname = pres
                            .as_ref()
                            .and_then(|v| v.pointer("/presentation/id/name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        json!({ "connected": true, "presentation": pname })
                    }
                };
                let page = {
                    let pages = app.state::<crate::pages::PagesState>().inner().clone();
                    let list = crate::pages::list_core(&pages);
                    match list.iter().max_by_key(|p| p.sent_ms) {
                        None => json!({ "any": false, "acked": 0, "total": 0 }),
                        Some(p) => json!({
                            "any": true,
                            "acked": p.receipts.len(),
                            "total": p.recipients.len(),
                        }),
                    }
                };
                // This week's crew from the PCO plan, in deck-slot order (see
                // pco::deck_roster). Padded to a fixed 12 slots so a key bound
                // to slot N always resolves. `keys` = whoever is scheduled on
                // keys/keyboard/piano, for the "come play keys" page key.
                let (crew, keys) = {
                    let pco_state = app.state::<crate::pco::PcoState>().inner().clone();
                    let identity = app.state::<crate::identity::IdentityState>().inner().clone();
                    let ck = app.state::<crate::checkin::CheckinState>().inner().clone();
                    let arrived = crate::checkin::arrived_ids(&app, &ck);
                    let roster = crate::pco::deck_roster(&pco_state);
                    let row = |m: &crate::pco::TeamRow| {
                        let acct = crate::identity::find_approved_by_name(&identity, &m.name);
                        json!({
                            "name": m.name,
                            "short": crate::pco::short_name(&m.name),
                            "position": m.position,
                            "app": acct.is_some(),
                            "here": acct.as_ref().map(|(id, _)| arrived.contains(id)).unwrap_or(false),
                        })
                    };
                    let empty = json!({ "name": "", "short": "", "position": "", "app": false, "here": false });
                    let mut crew: Vec<Value> = roster.iter().map(row).collect();
                    // Two "Zachary A"s on one plan: fall back to the surname
                    // ("Affhauser" / "Avigne") for anyone whose short collides.
                    let shorts: Vec<String> =
                        crew.iter().map(|c| c["short"].as_str().unwrap_or("").to_string()).collect();
                    for (i, c) in crew.iter_mut().enumerate() {
                        let mine = &shorts[i];
                        if !mine.is_empty() && shorts.iter().filter(|s| *s == mine).count() > 1 {
                            let parts: Vec<&str> = c["name"].as_str().unwrap_or("").split_whitespace().collect();
                            if parts.len() >= 2 {
                                let last: String = parts[parts.len() - 1].chars().take(9).collect();
                                c["short"] = json!(last);
                            }
                        }
                    }
                    crew.truncate(12);
                    while crew.len() < 12 {
                        crew.push(empty.clone());
                    }
                    let keys = roster
                        .iter()
                        .find(|m| {
                            let p = m.position.to_lowercase();
                            p.contains("keys") || p.contains("keyboard") || p.contains("piano")
                        })
                        .map(row)
                        .unwrap_or(empty);
                    (crew, keys)
                };
                Ok(json!({
                    "tap": tap.get("state").cloned().unwrap_or(Value::Null),
                    "spl": spl,
                    "arrived": count,
                    "arrivedNames": names,
                    "pp": pp,
                    "page": page,
                    "crew": crew,
                    "keys": keys,
                }))
            }
            // Crew-board key press: page exactly one person. Address them by
            // name (&text=), by this week's deck slot (&crew=N, same order as
            // deck-state.crew), or by PCO position (&position=keys). &body=
            // replaces the default "the booth is looking for you" message.
            "nudge" => {
                let identity = app.state::<crate::identity::IdentityState>().inner().clone();
                let pco_state = app.state::<crate::pco::PcoState>().inner().clone();
                let roster = crate::pco::deck_roster(&pco_state);
                let target: Result<String, String> = if let Some(slot) = qp("crew") {
                    match slot.parse::<usize>() {
                        Ok(n) if n >= 1 => roster
                            .get(n - 1)
                            .map(|m| m.name.clone())
                            .ok_or_else(|| format!("crew slot {n} is empty this week")),
                        _ => Err("&crew= must be a slot number from 1".into()),
                    }
                } else if let Some(pos) = qp("position") {
                    let want = pos.trim().to_lowercase();
                    if want.is_empty() {
                        Err("add &position=<PCO position>".into())
                    } else if roster.is_empty() {
                        Err("no PCO plan team loaded yet".into())
                    } else {
                        roster
                            .iter()
                            .find(|m| m.position.to_lowercase().contains(&want))
                            .map(|m| m.name.clone())
                            .ok_or_else(|| format!("nobody is scheduled on \"{pos}\" this week"))
                    }
                } else if !text.is_empty() {
                    Ok(text.clone())
                } else {
                    Err("add &text=<crew member name>, &crew=<slot>, or &position=<PCO position>".into())
                };
                match target {
                    Err(e) => Err(e),
                    Ok(who) => match crate::identity::find_approved_by_name(&identity, &who) {
                        None => Err(format!("{who} hasn't joined ProDeck on their phone yet")),
                        Some((id, name)) => {
                            let custom = qp("body").unwrap_or_default();
                            let body = if custom.trim().is_empty() {
                                format!("{name} — the booth is looking for you. Please check in.")
                            } else {
                                format!("{name} — {}", custom.trim())
                            };
                            dispatch(
                                &app,
                                "page_send",
                                &json!({ "body": body, "recipients": [id], "buzz": true, "session": "" }),
                                Tier::Admin,
                                None,
                            )
                            .await
                        }
                    },
                }
            }
            "pco-next" | "pco-prev" => match pco_selected() {
                Some((st_id, plan)) => {
                    let act = if action == "pco-next" { "go_to_next_item" } else { "go_to_previous_item" };
                    dispatch(&app, "pco_live_action", &json!({"serviceTypeId": st_id, "planId": plan, "action": act}), Tier::Admin, None).await
                }
                None => Err("no plan selected in ProDeck".into()),
            },
            _ => Err(format!(
                "unknown action \"{action}\" — try pp-next, pp-prev, pp-clear-slide, pp-clear-media, pp-clear-props, announce-play, announce-clear, macro, page, confidence, confidence-clear, avantis-scene, pco-next, pco-prev, tap, tap-auto, tap-state, spl-state, checkin-state, pp-state, page-state, page-rebuzz, nudge"
            )),
        };
        let (code, body) = match result {
            Ok(v) => (200, json!({"ok": true, "result": v})),
            Err(e) => (422, json!({"ok": false, "error": e})),
        };
        let bytes = serde_json::to_vec(&body).unwrap_or_default();
        return write_bytes(&mut stream, code, "application/json", &bytes).await;
    }

    // Permanent invite QR: the green-room poster encodes /join with no token,
    // so rotating the crew link never kills the printed code. The 302 hands
    // the browser whatever token is current; texted ?join= copies still die
    // on rotate. No-store because the target embeds a live credential.
    if method == "GET" && (path == "/join" || path.starts_with("/join?")) {
        let (invite, open_until) = {
            let state = app.state::<SettingsState>();
            let s = state.lock().unwrap_or_else(|p| p.into_inner());
            (s.web_invite_token.clone(), s.crew_join_until_ms)
        };
        // This endpoint hands out a real member credential and cannot ask for
        // one first — that is the point of a printed poster. But the Cloudflare
        // worker fronts the whole zone, so it was answering the open internet:
        // anyone could request it and read the token straight out of the
        // redirect. It now only answers while the booth has deliberately opened
        // a joining window, which is how crew are actually onboarded — you open
        // it at the volunteer meeting and it closes itself.
        let open = open_until > 0 && crate::identity::now_ms() < open_until;
        let target = if invite.is_empty() {
            "/".to_string()
        } else if !open {
            crate::diag::log(format!(
                "[join] refused — joining is closed (peer {})",
                stream.peer_addr().map(|a| a.ip().to_string()).unwrap_or_default()
            ));
            "/?joinclosed=1".to_string()
        } else {
            format!("/?join={invite}")
        };
        let head = format!(
            "HTTP/1.1 302 Found\r\nLocation: {target}\r\nContent-Length: 0\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        );
        stream.write_all(head.as_bytes()).await?;
        return stream.flush().await;
    }

    // Static SPA assets (public — they carry no booth data).
    let (status, ctype, bytes) = serve_static(path);
    write_bytes(&mut stream, status, ctype, &bytes).await
}

async fn serve_sse(
    mut stream: tokio::net::TcpStream,
    app: AppHandle,
    web: WebState,
) -> std::io::Result<()> {
    let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\n\r\n";
    stream.write_all(head.as_bytes()).await?;
    // Subscribe BEFORE snapshotting so no event slips through the gap.
    let mut rx = web.tx.subscribe();
    stream.write_all(b": connected\n\n").await?;
    // Replay current state (connection + last status per stream, PCO, NDI, …) so
    // a browser joining mid-service is immediately in sync rather than blank.
    let mut snapshot: Vec<String> = {
        web.snapshot.lock().unwrap_or_else(|p| p.into_inner()).values().cloned().collect()
    };
    // Belt-and-suspenders: if ProPresenter is connected right now, make sure the
    // client knows even if it missed (or predates) the one-shot pp:connected.
    let pp_live = {
        let pp = app.state::<ProPresenterState>().inner().clone();
        let live = pp.lock().await.is_some();
        live
    };
    if pp_live && !snapshot.iter().any(|f| f.contains("\"pp:connected\"")) {
        snapshot.push("{\"event\":\"pp:connected\",\"payload\":null}".to_string());
    }
    for frame in snapshot {
        let msg = format!("data: {}\n\n", frame);
        if stream.write_all(msg.as_bytes()).await.is_err() {
            return Ok(());
        }
    }
    loop {
        match tokio::time::timeout(Duration::from_secs(15), rx.recv()).await {
            Ok(Ok(frame)) => {
                let msg = format!("data: {}\n\n", frame);
                if stream.write_all(msg.as_bytes()).await.is_err() {
                    break;
                }
            }
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(_)) => break,
            Err(_) => {
                // Heartbeat keeps proxies / the EventSource alive.
                if stream.write_all(b": ping\n\n").await.is_err() {
                    break;
                }
            }
        }
        if !web.running.load(Ordering::Acquire) {
            break;
        }
    }
    Ok(())
}

// Stream the overflow audio mix as raw little-endian i16 mono PCM. The browser
// reads it with fetch() and plays via Web Audio at the X-Sample-Rate rate.
async fn serve_audio(mut stream: tokio::net::TcpStream, app: AppHandle) -> std::io::Result<()> {
    let audio = app.state::<crate::audio::AudioState>().inner().clone();
    let rate = audio.sample_rate.load(Ordering::Relaxed).max(1);
    let mut rx = audio.overflow_tx.subscribe();
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Expose-Headers: X-Sample-Rate\r\nX-Sample-Rate: {}\r\n\r\n",
        rate
    );
    stream.write_all(head.as_bytes()).await?;
    loop {
        match tokio::time::timeout(Duration::from_secs(20), rx.recv()).await {
            Ok(Ok(chunk)) => {
                let mut bytes = Vec::with_capacity(chunk.len() * 2);
                for s in chunk {
                    bytes.extend_from_slice(&s.to_le_bytes());
                }
                if stream.write_all(&bytes).await.is_err() {
                    break;
                }
            }
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(_)) => break, // sender gone (capture stopped)
            Err(_) => continue,  // no audio this window — keep the socket open
        }
    }
    Ok(())
}

// Same overflow audio, but encoded as a continuous MP3 stream for a plain
// <audio> element (the robust path on iOS — media channel, not Web Audio).
// Build the LAME encoder synchronously — the Builder isn't Send, so it must not
// live across an await; the returned Encoder IS Send.
fn build_mp3_encoder(rate: u32) -> Option<mp3lame_encoder::Encoder> {
    use mp3lame_encoder::{Bitrate, Builder, Quality};
    let mut b = Builder::new()?;
    b.set_num_channels(1).ok()?;
    b.set_sample_rate(rate).ok()?;
    b.set_brate(Bitrate::Kbps96).ok()?;
    b.set_quality(Quality::Good).ok()?;
    b.build().ok()
}

async fn serve_audio_mp3(mut stream: tokio::net::TcpStream, app: AppHandle) -> std::io::Result<()> {
    use mp3lame_encoder::MonoPcm;
    let audio = app.state::<crate::audio::AudioState>().inner().clone();
    let rate = audio.sample_rate.load(Ordering::Relaxed);
    // LAME accepts 8k–48k; fall back to 48k for anything outside that.
    let enc_rate = if (8000..=48000).contains(&rate) { rate } else { 48000 };
    let mut rx = audio.overflow_tx.subscribe();

    let mut enc = match build_mp3_encoder(enc_rate) {
        Some(e) => e,
        None => return write_bytes(&mut stream, 500, "text/plain", b"encoder").await,
    };

    let head = "HTTP/1.1 200 OK\r\nContent-Type: audio/mpeg\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\n\r\n";
    stream.write_all(head.as_bytes()).await?;

    let mut mp3: Vec<u8> = Vec::new();
    loop {
        match tokio::time::timeout(Duration::from_secs(20), rx.recv()).await {
            Ok(Ok(chunk)) => {
                mp3.clear();
                mp3.reserve(mp3lame_encoder::max_required_buffer_size(chunk.len()));
                match enc.encode(MonoPcm(&chunk), mp3.spare_capacity_mut()) {
                    Ok(n) => unsafe { mp3.set_len(n) },
                    Err(_) => break,
                }
                if !mp3.is_empty() && stream.write_all(&mp3).await.is_err() {
                    break;
                }
            }
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(_)) => break,
            Err(_) => continue,
        }
    }
    Ok(())
}

fn content_type(path: &str) -> &'static str {
    let p = path.to_ascii_lowercase();
    if p.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if p.ends_with(".js") || p.ends_with(".mjs") {
        "text/javascript; charset=utf-8"
    } else if p.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if p.ends_with(".json") {
        "application/json"
    } else if p.ends_with(".svg") {
        "image/svg+xml"
    } else if p.ends_with(".png") {
        "image/png"
    } else if p.ends_with(".ico") {
        "image/x-icon"
    } else if p.ends_with(".woff2") {
        "font/woff2"
    } else {
        "application/octet-stream"
    }
}

fn serve_static(path: &str) -> (u16, &'static str, Vec<u8>) {
    let clean = path.split('?').next().unwrap_or("/").trim_start_matches('/');
    let lookup = if clean.is_empty() { "index.html" } else { clean };
    if let Some(f) = DIST.get_file(lookup) {
        return (200, content_type(lookup), f.contents().to_vec());
    }
    // SPA fallback: serve index.html for client-side routes.
    match DIST.get_file("index.html") {
        Some(f) => (200, "text/html; charset=utf-8", f.contents().to_vec()),
        None => (404, "text/plain", b"not found".to_vec()),
    }
}

async fn write_bytes(
    stream: &mut tokio::net::TcpStream,
    status: u16,
    ctype: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        401 => "Unauthorized",
        404 => "Not Found",
        _ => "OK",
    };
    // HTML must revalidate every load: TV browsers (Samsung especially)
    // heuristically cache pages served without Cache-Control and then run
    // STALE builds for days. Hashed assets stay cacheable — only the shell
    // needs freshness.
    let cache = if ctype.starts_with("text/html") {
        "Cache-Control: no-cache\r\n"
    } else {
        ""
    };
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\n{cache}Access-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
        status,
        reason,
        ctype,
        body.len()
    );
    stream.write_all(head.as_bytes()).await?;
    if !body.is_empty() {
        stream.write_all(body).await?;
    }
    stream.flush().await
}

// ---------------------------------------------------------------------------
// Command proxy — only what a browser needs for view + control.
// ---------------------------------------------------------------------------

fn pp_handle(app: &AppHandle) -> ProPresenterState {
    app.state::<ProPresenterState>().inner().clone()
}

fn pco_creds(app: &AppHandle) -> Result<(String, String), String> {
    let st = app.state::<SettingsState>();
    pco::creds(st.inner())
}

// ProPresenter trigger/clear endpoints are GET (a PUT 404s).
async fn pp_action_raw(app: &AppHandle, full_path: &str) -> Result<Value, String> {
    let (client, base) = current_config(&pp_handle(app)).await?;
    client
        .get(format!("{}{}", base, full_path))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

/// ProPresenter's control endpoints (trigger, clear, timer start, transport
/// play…) are plain GETs, so `pp_get` is only a read for paths that are
/// actually reads. Members get a positive allowlist of read prefixes AND a
/// deny on any verb segment, so `presentation/<id>/3/trigger` is refused even
/// though `presentation/` is readable.
fn member_pp_read_ok(path: &str) -> bool {
    let p = path.trim_start_matches('/').to_ascii_lowercase();
    let p = p.split('?').next().unwrap_or("");
    const READ_PREFIXES: &[&str] = &[
        "version", "status/", "presentation/", "playlists", "playlist/", "announcement/",
        "stage/message", "stage/layout_map", "stage/layouts", "stage/screens", "looks",
        "look/current", "macros", "props", "timers", "timer/", "messages", "clear/groups",
        "media/playlists", "media/playlist/", "audio/playlists", "audio/playlist/",
        "video_inputs", "libraries", "library/", "transport/", "groups", "masks", "themes",
        "theme/", "capture/status", "capture/settings",
    ];
    const VERBS: &[&str] = &[
        "trigger", "focus", "start", "stop", "reset", "pause", "play", "next", "previous",
        "toggle", "show", "hide", "activate", "deactivate", "go_to_end", "skip_backward",
        "skip_forward", "auto_advance", "set", "timeline", "find_my_mouse",
    ];
    if !READ_PREFIXES.iter().any(|pre| p == pre.trim_end_matches('/') || p.starts_with(pre)) {
        return false;
    }
    !p.split('/').any(|seg| VERBS.contains(&seg))
}

/// May a member-tier token run this command?
///
/// Lifted out of `dispatch` so it can be tested. It has now twice silently
/// omitted something a viewer screen needs — first the console mirror and the
/// OBS state, then the three NDI calls — and the symptom each time was a tile
/// that sat blank on every kiosk and phone with no error anywhere, while the
/// booth's own copy of the same dashboard worked perfectly. That is a very
/// expensive thing to notice by eye.
///
/// `chat_send` is deliberately absent: it is allowed, but only to the team
/// channel, so `dispatch` handles it separately.
pub(crate) fn member_cmd_ok(cmd: &str) -> bool {
    matches!(
        cmd,
        "get_settings" | "load_dashboards" | "load_pco_data" | "load_tracking"
            | "load_checklists" | "load_routing" | "chat_history" | "web_whoami" | "pp_get"
            | "tap_edge_state" | "tap_stats" | "tap_stats_range"
            // Role channels: members must see which channels exist. Roles
            // only — the roster (names, ids) stays admin-tier.
            | "identity_register" | "identity_login" | "identity_whoami" | "identity_roles"
            // Claiming a personal invite happens before any account exists.
            | "invite_info"
            // Worship phones open their own chord charts.
            | "pco_attachment_open" | "pco_chord_chart"
            // Confirming a page is exactly what a member is for; page_list is
            // read-only and lets a phone recover a page it missed while asleep.
            | "page_ack" | "page_list" | "posfile_list"
            // Every crew phone must be able to register for push — that is the
            // whole point of a member device.
            | "push_public_key" | "push_subscribe" | "push_unsubscribe"
            // Checking in is a member action by definition.
            | "checkin_set" | "checkin_list"
            // Ticking your own checklist item is a member action.
            | "checklist_toggle"
            // Live viewer count is a read-only number every kiosk shows — the
            // switcher PC and office mini run on the member token.
            | "ga4_state"
            // "Are we live?" is a read every kiosk and phone should have.
            // Changing the scene is admin-only and absent from this list.
            | "obs_state"
            // The console mirror is read-only and on the same kiosk tiles as
            // obs_state; without it the desk widget reported "unreachable" on
            // every browser even while the booth was mirroring fine.
            | "avantis_state"
            // Cameras. A kiosk and a crew phone are viewers by definition, and
            // the Stage Feed widget cannot show anything without these three:
            // discovering a source, starting a receiver, and releasing it
            // again. They were absent, so every member-tier screen — the office
            // mini, the switcher PC, every phone — showed an empty camera tile
            // and no reason why. Starting is refcounted, so one viewer letting
            // go never takes the feed away from another.
            | "ndi_discover_sources"
            | "ndi_start_receiver"
            | "ndi_stop_receiver"
    )
}

/// Which grant unlocks a command for a member-tier phone. `None` = admin only,
/// no grant will do. Everything a viewer may always do is in `member_cmd_ok`
/// and never reaches this table.
pub(crate) fn perm_for_cmd(cmd: &str) -> Option<&'static str> {
    match cmd {
        "page_send" | "page_rebuzz" => Some("page"),
        "pp_set_stage_message" | "pp_clear_stage_message" | "chat_clear_confidence" => Some("stage"),
        "pp_action" | "pp_clear_layer" | "pp_put" | "pp_delete" | "pp_timer_op"
        | "pp_trigger_look" | "pp_trigger_macro" | "pp_trigger_next" | "pp_trigger_previous"
        | "avantis_set_mute" | "avantis_set_fader" | "avantis_set_name" | "avantis_recall_scene"
        | "obs_set_scene" | "pco_live_action" | "midi_send_key" | "osc_send_key" => Some("control"),
        "tap_override" => Some("tap"),
        "identity_list" | "identity_approve" | "identity_remove" | "identity_set_role"
        | "identity_update_profile" | "invite_create" | "invite_list" | "invite_revoke"
        | "crew_join_open" => Some("manage"),
        // Deliberately absent, so they stay admin-only: identity_set_perms
        // (granting), update_settings, save_*, help_ask, gemini_*, backups.
        _ => None,
    }
}

/// May a member-tier phone with these grants run this command?
pub(crate) fn member_gate(cmd: &str, args: &Value, perms: &[String]) -> Result<(), String> {
    let has = |p: &str| perms.iter().any(|x| x == p);
    if member_cmd_ok(cmd) {
        return Ok(());
    }
    if cmd == "chat_send" {
        let target = args.get("target").and_then(|v| v.as_str()).unwrap_or("");
        if target == "team" || has("stage") {
            return Ok(());
        }
        return Err("team messages only — sending to stage or confidence needs the \"stage\" permission".into());
    }
    match perm_for_cmd(cmd) {
        Some(p) if has(p) => Ok(()),
        Some(p) => Err(format!("'{cmd}' needs the \"{p}\" permission — ask whoever runs the booth to grant it")),
        None => Err(format!("'{cmd}' needs admin access")),
    }
}

async fn dispatch(
    app: &AppHandle,
    cmd: &str,
    args: &Value,
    tier: Tier,
    caller: Option<crate::identity::Caller>,
) -> Result<Value, String> {
    // Member tier: viewers with a voice. Reads + streams + TEAM chat; every
    // control surface (ProPresenter, stage/confidence sends, TapLink override,
    // PCO Live, settings) requires the admin password. Enforced here so a
    // modified client can't bypass the UI.
    let perms: Vec<String> = caller.as_ref().map(|c| c.perms.clone()).unwrap_or_default();
    if tier == Tier::Member {
        member_gate(cmd, args, &perms)?;
    }
    if cmd == "web_whoami" {
        // Admin means everything; a member's power is exactly their grants.
        let all: Vec<String> = crate::identity::PERMS.iter().map(|p| p.to_string()).collect();
        return Ok(json!({
            "tier": if tier == Tier::Admin { "admin" } else { "member" },
            "perms": if tier == Tier::Admin { all } else { perms.clone() },
            "name": caller.as_ref().map(|c| c.name.clone()),
        }));
    }
    let s = |k: &str| args.get(k).and_then(|x| x.as_str()).map(|x| x.to_string());
    match cmd {
        // ---- reads
        "get_settings" => {
            let mut set = app.state::<SettingsState>().lock().unwrap_or_else(|p| p.into_inner()).clone();
            // Browser clients never receive secrets — only the host holds them.
            set.pco_secret = None;
            set.gemini_api_key = None;
            set.web_password = String::new();
            set.web_member_password = String::new();
            set.web_invite_token = String::new();
            set.edge_admin_token = String::new();
            set.tap_token = String::new();
            // The OBS WebSocket password is a real credential on the booth's
            // network and was the one secret still going out in the clear —
            // any member-tier phone could read it straight out of get_settings.
            set.obs_password = String::new();
            // NOTE: pco_app_id is deliberately NOT redacted here. It is the
            // username half of the pair (the secret is what protects it), and
            // the Planning Center page uses its presence to decide whether
            // credentials are configured — blanking it makes an admin browser
            // report "not connected" and refuse to load. It IS stripped from
            // the diagnostics bundle, which is the path that leaves the
            // building.
            // Not a secret itself, but it points straight at the private key —
            // browsers have no use for a booth-local filesystem path.
            set.ga4_key_path = String::new();
            Ok(serde_json::to_value(set).unwrap_or(Value::Null))
        }
        // Team messaging — browsers are full chat participants (send + read),
        // through the same validation as the booth.
        "ga4_state" => Ok(crate::ga4::snapshot(&app.state::<crate::ga4::Ga4State>())),
        "chat_history" => {
            let chat = app.state::<crate::chat::ChatState>();
            Ok(serde_json::to_value(crate::chat::chat_history(chat)).unwrap_or(Value::Null))
        }
        "chat_send" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            // Browser senders are identified by their crew session — the name
            // on a message is server-verified, never client-supplied.
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            let from = crate::identity::session_name(&identity, &s("session"))
                .ok_or("sign in first — your crew session is missing or was revoked")?;
            let chat = app.state::<crate::chat::ChatState>().inner().clone();
            let msg = crate::chat::send_core(app, &chat, from, s("text"), s("target"), s("channel"))?;
            Ok(serde_json::to_value(msg).unwrap_or(Value::Null))
        }
        // Pages. Sending is admin-only (the member allowlist above blocks it);
        // acking is server-authenticated by crew session, so a phone can only
        // ever confirm as itself.
        "page_send" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            // Admin phones still send under their verified crew name, not a
            // client-supplied one; fall back to the booth's device name when an
            // admin browser has no crew session.
            let from = crate::identity::session_name(&identity, &s("session"))
                .unwrap_or_else(|| "Booth".to_string());
            let recipients: Vec<String> = args
                .get("recipients")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let buzz = args.get("buzz").and_then(|v| v.as_bool()).unwrap_or(true);
            let pages = app.state::<crate::pages::PagesState>().inner().clone();
            let page = crate::pages::send_core(
                app, &pages, &identity, from, s("body"), recipients, buzz,
            )?;
            Ok(serde_json::to_value(page).unwrap_or(Value::Null))
        }
        "page_ack" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let page_id = args.get("pageId").and_then(|v| v.as_u64()).unwrap_or(0);
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            let pages = app.state::<crate::pages::PagesState>().inner().clone();
            let r = crate::pages::ack_core(app, &pages, &identity, page_id, &s("session"))?;
            Ok(serde_json::to_value(r).unwrap_or(Value::Null))
        }
        "page_rebuzz" => {
            let page_id = args.get("pageId").and_then(|v| v.as_u64()).unwrap_or(0);
            let pages = app.state::<crate::pages::PagesState>().inner().clone();
            Ok(json!({ "buzzed": crate::pages::rebuzz_core(app, &pages, page_id)? }))
        }
        "posfile_list" => {
            let st = app.state::<crate::posfiles::PosFilesState>().inner().clone();
            Ok(serde_json::to_value(crate::posfiles::list_core(&st)).unwrap_or(Value::Null))
        }
        "page_list" => {
            let pages = app.state::<crate::pages::PagesState>().inner().clone();
            Ok(serde_json::to_value(crate::pages::list_core(&pages)).unwrap_or(Value::Null))
        }
        // Push registration. The subscription is bound to the crew user behind
        // the session, never to a client-supplied id, so a phone can only ever
        // register itself.
        "push_public_key" => {
            let push = app.state::<crate::push::PushState>().inner().clone();
            Ok(json!({ "key": crate::push::public_key(&push) }))
        }
        "push_subscribe" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            let (user_id, _) = crate::identity::session_user(&identity, &s("session"))
                .ok_or("sign in first — push is registered against your crew identity")?;
            let push = app.state::<crate::push::PushState>().inner().clone();
            crate::push::subscribe(&push, user_id, s("endpoint"), s("p256dh"), s("auth"))?;
            Ok(json!({ "ok": true }))
        }
        "push_unsubscribe" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            if let Some((user_id, _)) = crate::identity::session_user(&identity, &s("session")) {
                let push = app.state::<crate::push::PushState>().inner().clone();
                crate::push::unsubscribe(&push, &user_id);
            }
            Ok(json!({ "ok": true }))
        }
        "checkin_set" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            let st = app.state::<crate::checkin::CheckinState>().inner().clone();
            let ts = crate::checkin::check_in(app, &st, &identity, &s("session"), &s("serviceKey"))?;
            Ok(json!({ "at": ts }))
        }
        // A phone may flip ONE item; it may still never write the whole file.
        "checklist_toggle" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let now = crate::settings::checklist_toggle(s("listId"), s("itemId"))?;
            app.emit("checklist:changed", json!({})).ok();
            Ok(json!({ "done": now }))
        }
        "checkin_list" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let st = app.state::<crate::checkin::CheckinState>().inner().clone();
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            Ok(crate::checkin::list(app, &st, &identity, &s("session")))
        }
        "identity_register" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            let invite = Some(s("invite")).filter(|t| !t.is_empty());
            let via_invite = invite.is_some();
            let mut out =
                crate::identity::register_core(app, &identity, s("name"), s("pin"), s("role"), invite)?;
            // An invite claim arrived on a one-time token — hand the phone the
            // durable member credential so it stays signed in after the invite
            // is consumed.
            if via_invite && out.get("status").and_then(|v| v.as_str()) == Some("ok") {
                let durable = {
                    let st = app.state::<SettingsState>();
                    let cfg = st.lock().unwrap_or_else(|p| p.into_inner());
                    if !cfg.web_member_password.is_empty() {
                        cfg.web_member_password.clone()
                    } else {
                        cfg.web_invite_token.clone()
                    }
                };
                if !durable.is_empty() {
                    out["web_token"] = serde_json::Value::String(durable);
                }
            }
            Ok(out)
        }
        "invite_info" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            crate::identity::invite_info_core(&identity, &s("token"))
                .ok_or("this invite link was already used or has expired".to_string())
        }
        // Admin-tier (blocked for members by the allowlist above): manage
        // personal invites from an admin phone or the booth.
        "invite_create" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            let inv = crate::identity::invite_create_core(&identity, s("name"), s("role"))?;
            Ok(serde_json::to_value(inv).unwrap_or(Value::Null))
        }
        "invite_list" => {
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            Ok(crate::identity::invite_list_core(&identity))
        }
        "invite_revoke" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            crate::identity::invite_revoke_core(&identity, s("token"));
            Ok(json!({ "ok": true }))
        }
        "identity_login" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            crate::identity::login_core(&identity, s("name"), s("pin"))
        }
        "identity_whoami" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            crate::identity::whoami_core(&identity, &s("session"))
                .ok_or("sign in first — session is missing or was revoked".to_string())
        }
        // Admin phones can manage the crew roster remotely.
        "identity_list" => {
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            Ok(crate::identity::list_core(&identity))
        }
        "identity_roles" => {
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            Ok(crate::identity::roles_core(&identity))
        }
        // Console mirror snapshot (read-only; live updates ride the event stream).
        "avantis_state" => {
            let state = app.state::<crate::avantis::AvantisState>().inner().clone();
            Ok(crate::avantis::snapshot(&state))
        }
        "obs_state" => {
            let state = app.state::<crate::obs::ObsState>().inner().clone();
            Ok(crate::obs::snapshot(&state))
        }
        // Scene changes reach here only on the admin tier — this changes what
        // the world sees, same policy as ProPresenter control.
        "obs_set_scene" => {
            let scene = args.get("scene").and_then(|v| v.as_str()).unwrap_or("").to_string();
            crate::obs::obs_set_scene(scene, app.clone()).await?;
            Ok(Value::Null)
        }
        // Desk CONTROL — reaches here only on the admin tier (the member
        // allowlist above rejects unknown commands), same policy as PP control.
        "avantis_set_mute" => {
            let id = s("id").ok_or("missing id")?;
            let muted = args.get("muted").and_then(|v| v.as_bool()).unwrap_or(false);
            let state = app.state::<crate::avantis::AvantisState>();
            crate::avantis::avantis_set_mute(id, muted, state, app.clone()).await?;
            Ok(json!({ "ok": true }))
        }
        "avantis_recall_scene" => {
            let scene = args.get("scene").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let state = app.state::<crate::avantis::AvantisState>();
            crate::avantis::avantis_recall_scene(scene, state, app.clone()).await?;
            Ok(json!({ "ok": true }))
        }
        "avantis_set_fader" => {
            let id = s("id").ok_or("missing id")?;
            let value = args.get("value").and_then(|v| v.as_u64()).unwrap_or(0) as u8;
            let state = app.state::<crate::avantis::AvantisState>();
            crate::avantis::avantis_set_fader(id, value, state, app.clone()).await?;
            Ok(json!({ "ok": true }))
        }
        "avantis_set_name" => {
            let id = s("id").ok_or("missing id")?;
            let name = s("name").unwrap_or_default();
            let state = app.state::<crate::avantis::AvantisState>();
            crate::avantis::avantis_set_name(id, name, state, app.clone()).await?;
            Ok(json!({ "ok": true }))
        }
        "identity_set_perms" => {
            let id = s("id").ok_or("missing id")?;
            let perms: Vec<String> = args
                .get("perms")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            crate::identity::set_perms_core(app, &identity, id, perms).map(|_| Value::Null)
        }
        "identity_set_role" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            crate::identity::set_role_core(app, &identity, s("id"), s("role"))?;
            Ok(json!({ "ok": true }))
        }
        "identity_approve" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let approved = args.get("approved").and_then(|v| v.as_bool()).unwrap_or(false);
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            crate::identity::approve_core(app, &identity, s("id"), approved)?;
            Ok(Value::Null)
        }
        "identity_remove" => {
            let s = |k: &str| args.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            crate::identity::remove_core(app, &identity, s("id"))?;
            Ok(Value::Null)
        }
        "identity_update_profile" => {
            let opt = |k: &str| args.get(k).and_then(|v| v.as_str()).map(|v| v.to_string());
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            crate::identity::update_profile_core(
                app,
                &identity,
                opt("id").ok_or("missing id")?,
                opt("name"),
                opt("nickname"),
                opt("pco_name"),
            )
        }
        "chat_clear_confidence" => {
            crate::chat::clear_confidence_core(app);
            Ok(Value::Null)
        }
        // Admin-only by default: neither name is in the member allowlist, so a
        // crew phone cannot open its own joining window.
        "crew_join_state" => {
            let until = app
                .state::<SettingsState>()
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .crew_join_until_ms;
            let now = crate::identity::now_ms();
            Ok(json!({
                "open": until > now,
                "until": until,
                "secondsLeft": if until > now { (until - now) / 1000 } else { 0 },
            }))
        }
        "crew_join_open" => {
            let minutes = args.get("minutes").and_then(|v| v.as_u64()).unwrap_or(0);
            let until = if minutes == 0 {
                0
            } else {
                crate::identity::now_ms() + minutes.min(240) * 60_000
            };
            let to_save = {
                let st = app.state::<SettingsState>();
                let mut g = st.lock().unwrap_or_else(|p| p.into_inner());
                g.crew_join_until_ms = until;
                g.clone()
            };
            crate::settings::save(&to_save)?;
            Ok(json!({ "until": until }))
        }
        // Admin-only by default (spends the church's Gemini quota).
        "help_ask" => {
            let q = s("question").unwrap_or_default();
            let ctx = s("context").unwrap_or_default();
            let st = app.state::<SettingsState>();
            crate::gemini::help_ask_core(st.inner(), q, ctx).await.map(Value::String)
        }
        "load_dashboards" => crate::settings::load_dashboards(),
        "load_pco_data" => crate::settings::load_pco_data(),
        "load_tracking" => crate::settings::load_tracking(),
        "load_reports" => crate::settings::load_reports(),
        "load_schedules" => crate::settings::load_schedules(),
        "load_checklists" => crate::settings::load_checklists(),
        "load_routing" => crate::settings::load_routing(),
        // ---- writes
        // The booth app is the ONLY writer of the shared data files. Each
        // browser client keeps its own independent in-memory copy, so accepting
        // these here made every open phone a competing whole-file writer —
        // last-writer-wins clobbered the booth's real analytics/config every
        // few seconds. Browsers are viewers/controllers, not data owners.
        "save_checklists" | "save_pco_data" | "save_tracking"
        | "save_reports" | "save_schedules" | "save_routing" => {
            Err("read-only over the web gateway (the booth app owns this data)".into())
        }
        // Dashboards are the exception to the rule above, because they are the
        // one file here that ONLY changes when a person deliberately edits it —
        // the others the booth rewrites continuously on its own, which is what
        // made every open browser a competing whole-file writer.
        //
        // Refusing this made adding a widget from a phone or a laptop look like
        // it worked and then silently discard it on the next load, with no
        // error anywhere. Admin tier only: this arm is unreachable for members,
        // who are stopped by the allowlist above.
        "save_dashboards" => {
            let data = args.get("data").cloned().unwrap_or(Value::Null);
            if !data.is_array() {
                return Err("save_dashboards: expected an array".into());
            }
            crate::settings::save_dashboards(data).map(|_| Value::Null)
        }
        "update_settings" => {
            let mut new: Settings =
                serde_json::from_value(args.get("settings").cloned().unwrap_or(Value::Null))
                    .map_err(|e| e.to_string())?;
            let st = app.state::<SettingsState>();
            let to_save = {
                let mut g = st.lock().unwrap_or_else(|p| p.into_inner());
                // Browser clients can never change the host's secrets or the
                // gateway password — not even to a new non-blank value. (They
                // receive these redacted, and letting a token-holder rewrite
                // web_password would lock the booth and every other client out.)
                // The secret is redacted to null on read, so a browser's
                // settings round-trip sends null back — pin it then. But a
                // deliberately TYPED secret must be allowed through: pinning
                // unconditionally meant entering Planning Center credentials
                // from a phone or laptop silently saved the app id and threw
                // the secret away, leaving a permanent 401 with no clue why.
                if new.pco_secret.as_deref().unwrap_or("").trim().is_empty() {
                    new.pco_secret = g.pco_secret.clone();
                }
                // Same rule as pco_secret: redacted on read, so a browser's
                // round-trip sends it back empty — pin it then, but let a
                // deliberately typed one through so OBS can be set up remotely.
                if new.obs_password.trim().is_empty() {
                    new.obs_password = g.obs_password.clone();
                }

                new.gemini_api_key = g.gemini_api_key.clone();
                // Redacted in get_settings, so a browser round-trip would send it
                // back empty and silently unconfigure the viewer count.
                new.ga4_key_path = g.ga4_key_path.clone();
                new.web_password = g.web_password.clone();
                new.web_member_password = g.web_member_password.clone();
                new.web_invite_token = g.web_invite_token.clone();
                new.edge_admin_token = g.edge_admin_token.clone();
                // Same wipe-guard for the crew join token: a browser's
                // settings round-trip carries the redacted (empty) value, and
                // saving that back silently killed every ?join= link.
                if new.web_invite_token.is_empty() {
                    new.web_invite_token = g.web_invite_token.clone();
                }
                new.web_enabled = g.web_enabled;
                new.web_port = g.web_port;
                // TapLink is booth-owned: browsers can't rewrite the token
                // (they receive it redacted) or flip the watcher on/off.
                new.tap_token = g.tap_token.clone();
                new.tap_enabled = g.tap_enabled;
                new.tap_edge_url = g.tap_edge_url.clone();
                // Booth-only too: the edge heartbeat POSTs the edge admin
                // token and password hashes to public_url, and whisper_bin is
                // a binary the booth executes. A browser admin must not be
                // able to point either somewhere else.
                new.public_url = g.public_url.clone();
                new.whisper_bin = g.whisper_bin.clone();
                new.whisper_model = g.whisper_model.clone();
                *g = new;
                g.clone()
            };
            crate::settings::save(&to_save)?;
            Ok(Value::Null)
        }
        // ---- ProPresenter
        "pp_get" => {
            let path = s("path").ok_or("missing path")?;
            if tier == Tier::Member && !member_pp_read_ok(&path) && !perms.iter().any(|p| p == "control") {
                return Err("that ProPresenter path needs admin access".into());
            }
            let (client, base) = current_config(&pp_handle(app)).await?;
            let url = format!("{}/v1/{}", base, path.trim_start_matches('/'));
            let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
            if resp.status().as_u16() == 204 {
                return Ok(Value::Null);
            }
            Ok(resp.json::<Value>().await.unwrap_or(Value::Null))
        }
        "pp_put" => {
            let path = s("path").ok_or("missing path")?;
            let (client, base) = current_config(&pp_handle(app)).await?;
            let url = format!("{}/v1/{}", base, path.trim_start_matches('/'));
            let mut req = client.put(&url);
            if let Some(b) = args.get("body") {
                if !b.is_null() {
                    req = req.json(b);
                }
            }
            let resp = req.send().await.map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Err(format!("ProPresenter returned {}", resp.status()));
            }
            Ok(Value::Null)
        }
        "pp_delete" => {
            let path = s("path").ok_or("missing path")?;
            let (client, base) = current_config(&pp_handle(app)).await?;
            let url = format!("{}/v1/{}", base, path.trim_start_matches('/'));
            client.delete(&url).send().await.map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "pp_action" => {
            let path = s("path").ok_or("missing path")?;
            pp_action_raw(app, &format!("/v1/{}", path.trim_start_matches('/'))).await
        }
        "pp_trigger_next" => pp_action_raw(app, "/v1/trigger/next").await,
        "pp_trigger_previous" => pp_action_raw(app, "/v1/trigger/previous").await,
        "pp_clear_layer" => {
            let l = s("layer").ok_or("missing layer")?;
            pp_action_raw(app, &format!("/v1/clear/layer/{}", l)).await
        }
        "pp_trigger_macro" => {
            let id = s("id").ok_or("missing id")?;
            pp_action_raw(app, &format!("/v1/macro/{}/trigger", urlencoding::encode(&id))).await
        }
        "pp_trigger_look" => {
            let id = s("id").ok_or("missing id")?;
            pp_action_raw(app, &format!("/v1/look/{}/trigger", urlencoding::encode(&id))).await
        }
        "pp_timer_op" => {
            let id = s("id").ok_or("missing id")?;
            let op = s("op").unwrap_or_default();
            pp_action_raw(app, &format!("/v1/timer/{}/{}", urlencoding::encode(&id), op)).await
        }
        "pp_set_stage_message" => {
            let msg = s("message").unwrap_or_default();
            let (client, base) = current_config(&pp_handle(app)).await?;
            client
                .put(format!("{}/v1/stage/message", base))
                .json(&msg)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "pp_clear_stage_message" => {
            let (client, base) = current_config(&pp_handle(app)).await?;
            client
                .delete(format!("{}/v1/stage/message", base))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "pp_thumbnail" => {
            let uuid = s("uuid").ok_or("missing uuid")?;
            let index = args.get("index").and_then(|x| x.as_u64()).unwrap_or(0);
            let quality = args.get("quality").and_then(|x| x.as_u64()).unwrap_or(640);
            let (client, base) = current_config(&pp_handle(app)).await?;
            let url = format!(
                "{}/v1/presentation/{}/thumbnail/{}?quality={}",
                base,
                urlencoding::encode(&uuid),
                index,
                quality
            );
            let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Err(format!("thumbnail status {}", resp.status()));
            }
            let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            Ok(Value::String(format!("data:image/jpeg;base64,{}", b64)))
        }
        "pp_playlist_thumbnail" => {
            let playlist_id = s("playlistId").ok_or("missing playlistId")?;
            let item_index = args.get("itemIndex").and_then(|x| x.as_u64()).unwrap_or(0);
            let cue_index = args.get("cueIndex").and_then(|x| x.as_u64()).unwrap_or(0);
            let quality = args.get("quality").and_then(|x| x.as_u64()).unwrap_or(640);
            let (client, base) = current_config(&pp_handle(app)).await?;
            let url = format!(
                "{}/v1/playlist/{}/{}/thumbnail/{}?quality={}",
                base,
                urlencoding::encode(&playlist_id),
                item_index,
                cue_index,
                quality
            );
            let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Err(format!("thumbnail status {}", resp.status()));
            }
            let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            Ok(Value::String(format!("data:image/jpeg;base64,{}", b64)))
        }
        "osc_send_key" => {
            let host = s("host").ok_or("missing host")?;
            let port = args.get("port").and_then(|x| x.as_u64()).unwrap_or(0) as u16;
            let name = s("name").unwrap_or_default();
            let pc = args.get("pc").and_then(|x| x.as_i64()).unwrap_or(0) as i32;
            crate::osc::osc_send_key(host, port, name, pc)
                .await
                .map(|_| Value::Null)
        }
        // Manual key send from a phone (Key Change widget) — goes out the HOST's
        // already-connected MIDI output, so the booth rig hears it.
        "midi_send_key" => {
            let channel = args.get("channel").and_then(|x| x.as_u64()).unwrap_or(1) as u8;
            let value = args.get("value").and_then(|x| x.as_u64()).unwrap_or(0) as u8;
            let cc_num = args.get("ccNum").and_then(|x| x.as_i64()).unwrap_or(-1) as i32;
            let st = app.state::<crate::midi::MidiOutState>();
            crate::midi::midi_send_key(channel, value, cc_num, st).map(|_| Value::Null)
        }
        // ---- Planning Center
        "pco_chord_chart" => {
            let song = s("songId").ok_or("missing songId")?;
            let arr = s("arrangementId").ok_or("missing arrangementId")?;
            if !song.chars().all(|c| c.is_ascii_digit()) || !arr.chars().all(|c| c.is_ascii_digit()) {
                return Err("bad ids".into());
            }
            let (a, b) = {
                let st = app.state::<SettingsState>();
                let g = st.lock().unwrap_or_else(|p| p.into_inner());
                (g.pco_app_id.clone().unwrap_or_default(), g.pco_secret.clone().unwrap_or_default())
            };
            if a.is_empty() || b.is_empty() {
                return Err("Planning Center isn't connected at the booth".into());
            }
            let v = crate::pco::pco_request(&a, &b, &format!("services/v2/songs/{song}/arrangements/{arr}")).await?;
            let attrs = v.get("data").and_then(|d| d.get("attributes")).cloned().unwrap_or_default();
            Ok(json!({
                "chordChart": attrs.get("chord_chart").cloned().unwrap_or(Value::Null),
                "chartKey": attrs.get("chord_chart_key").cloned().unwrap_or(Value::Null),
                "lyrics": attrs.get("lyrics").cloned().unwrap_or(Value::Null),
                "name": attrs.get("name").cloned().unwrap_or(Value::Null),
            }))
        }
        "pco_attachment_open" => {
            let id = s("id").ok_or("missing id")?;
            // Attachment ids are numeric in PCO — reject anything that could
            // smuggle path segments onto the credentialed request.
            if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
                return Err("bad attachment id".into());
            }
            let (a, b) = {
                let st = app.state::<SettingsState>();
                let g = st.lock().unwrap_or_else(|p| p.into_inner());
                (
                    g.pco_app_id.clone().unwrap_or_default(),
                    g.pco_secret.clone().unwrap_or_default(),
                )
            };
            if a.is_empty() || b.is_empty() {
                return Err("Planning Center isn't connected at the booth".into());
            }
            crate::pco::pco_post(&a, &b, &format!("services/v2/attachments/{id}/open")).await
        }
        "pco_get" => {
            let path = s("path").ok_or("missing path")?;
            // Don't let a browser client steer the host's PCO credentials at an
            // arbitrary URL. Allow relative PCO API paths, or absolute URLs only
            // when they point at the Planning Center host (for pagination links).
            let p = path.trim_start_matches('/');
            let ok = if path.contains("://") {
                path.starts_with("https://api.planningcenteronline.com/")
            } else {
                ["services/v2", "people/v2"].iter().any(|a| p.starts_with(a))
            };
            if !ok {
                return Err("pco_get: path not allowed".into());
            }
            let (a, b) = pco_creds(app)?;
            pco::pco_get_for_ui(&a, &b, &path).await
        }
        "pco_test" => {
            let (a, b) = pco_creds(app)?;
            pco::pco_request(&a, &b, "people/v2/me").await
        }
        "pco_live_action" => {
            let st = s("serviceTypeId").ok_or("missing serviceTypeId")?;
            let plan = s("planId").ok_or("missing planId")?;
            let action = s("action").ok_or("missing action")?;
            let allowed = ["go_to_next_item", "go_to_previous_item", "toggle_control"];
            if !allowed.contains(&action.as_str()) {
                return Err(format!("unsupported live action: {action}"));
            }
            let (a, b) = pco_creds(app)?;
            let path = format!(
                "services/v2/service_types/{}/plans/{}/live/{}",
                st, plan, action
            );
            pco::pco_post(&a, &b, &path).await
        }
        // ---- NDI (so browser dashboards can pull camera/video feeds over the LAN)
        "ndi_discover_sources" => {
            let v = crate::ndi::ndi_discover_sources(app.clone()).await?;
            Ok(serde_json::to_value(v).unwrap_or(Value::Null))
        }
        "ndi_start_receiver" => {
            let name = s("sourceName").ok_or("missing sourceName")?;
            let ndi_arc = app.state::<crate::ndi::NdiState>().inner().clone();
            let port = crate::ndi::start_receiver(name, &ndi_arc, app).await?;
            Ok(Value::from(port))
        }
        "ndi_stop_receiver" => {
            let name = args
                .get("sourceName")
                .and_then(|x| x.as_str())
                .map(|x| x.to_string());
            let ndi_arc = app.state::<crate::ndi::NdiState>().inner().clone();
            crate::ndi::stop_receiver(name, &ndi_arc).await?;
            Ok(Value::Null)
        }
        // ---- Gemini smart matching (key stays on the host; never sent to browsers)
        "gemini_pick_slide" => {
            let transcript = s("transcript").unwrap_or_default();
            let candidates: Vec<crate::gemini::GCandidate> = serde_json::from_value(
                args.get("candidates").cloned().unwrap_or_else(|| json!([])),
            )
            .map_err(|e| e.to_string())?;
            let st = app.state::<SettingsState>();
            let m = crate::gemini::pick_slide_core(st.inner(), transcript, candidates).await?;
            Ok(serde_json::to_value(m).unwrap_or(Value::Null))
        }
        "gemini_test" => {
            let st = app.state::<SettingsState>();
            Ok(Value::String(crate::gemini::test_core(st.inner()).await?))
        }
        // ---- TapLink (NFC destination). Control, not data: the host still owns
        // the edge token and the watcher on/off switch (both redacted/pinned in
        // settings above), so a phone can only pick from the edge's own keyword
        // list — same bar as the pp_* controls the gateway already allows.
        "tap_edge_state" => crate::tap::edge_state_core(app).await,
        // Read-only usage counts — safe to show on a phone.
        "tap_stats" => crate::tap::stats_core(app).await,
        "tap_stats_range" => {
            let n = |k: &str| args.get(k).and_then(|v| v.as_i64()).unwrap_or(0);
            crate::tap::stats_range_core(app, n("from"), n("to")).await
        }
        "tap_override" => {
            crate::tap::override_core(app, s("state")).await?;
            Ok(Value::Null)
        }
        // Anything not whitelisted above is host-only (native I/O, process
        // control, PCO sync…). This must REJECT, not resolve null: resolving
        // made phone taps look like successes — Captions/Settings silently did
        // nothing, `null` device lists crashed pages, and a phone "Connect"
        // rewrote the booth's saved ProPresenter host.
        _ => Err(format!("'{cmd}' is not available from a browser client")),
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Open (or close) the window during which /join hands out the crew token.
///
/// /join cannot authenticate its caller — a poster on the green-room wall has
/// no password — so the only honest control is *when* it answers. `minutes` of
/// 0 closes it immediately.
#[tauri::command]
pub fn crew_join_open(
    minutes: u32,
    settings: tauri::State<'_, SettingsState>,
) -> Result<Value, String> {
    let until = if minutes == 0 {
        0
    } else {
        crate::identity::now_ms() + u64::from(minutes.min(240)) * 60_000
    };
    let to_save = {
        let mut s = settings.lock().unwrap_or_else(|p| p.into_inner());
        s.crew_join_until_ms = until;
        s.clone()
    };
    crate::settings::save(&to_save)?;
    crate::diag::log(if until == 0 {
        "[join] joining closed".to_string()
    } else {
        format!("[join] joining open for {minutes} min")
    });
    Ok(json!({ "until": until }))
}

/// Is the joining window open, and for how much longer?
#[tauri::command]
pub fn crew_join_state(settings: tauri::State<'_, SettingsState>) -> Value {
    let until = settings.lock().unwrap_or_else(|p| p.into_inner()).crew_join_until_ms;
    let now = crate::identity::now_ms();
    json!({
        "open": until > now,
        "until": until,
        "secondsLeft": if until > now { (until - now) / 1000 } else { 0 },
    })
}

#[tauri::command]
pub fn web_status(state: tauri::State<'_, WebState>) -> Value {
    json!({
        "running": state.running.load(Ordering::Acquire),
        "port": state.port.load(Ordering::Acquire),
    })
}

#[tauri::command]
pub fn web_start(port: u16, app: AppHandle, state: tauri::State<'_, WebState>) {
    if state.running.load(Ordering::Acquire) {
        stop(&state);
    }
    start(app, state.inner().clone(), port);
}

#[tauri::command]
pub fn web_stop(state: tauri::State<'_, WebState>) {
    stop(&state);
}

#[cfg(test)]
mod member_pp_tests {
    use super::{
        auth_backoff, clear_auth_failures, member_pp_read_ok, note_auth_failure, AUTH_FREE_TRIES,
    };

    #[test]
    fn member_tier_can_run_every_command_a_viewer_screen_needs() {
        use super::member_cmd_ok;
        // Each of these backs a tile on the office kiosk, the switcher PC or a
        // crew phone. Missing one shows as a permanently blank widget with no
        // error on screen — it has happened twice.
        for cmd in [
            "get_settings", "load_dashboards", "load_pco_data", "load_checklists",
            "load_routing", "load_tracking", "chat_history", "web_whoami", "pp_get",
            "page_ack", "page_list", "posfile_list", "checkin_set", "checkin_list",
            "checklist_toggle", "ga4_state",
            // The three tiles that were silently broken on every kiosk.
            "obs_state", "avantis_state",
            // Cameras.
            "ndi_discover_sources", "ndi_start_receiver", "ndi_stop_receiver",
        ] {
            assert!(member_cmd_ok(cmd), "a member screen needs {cmd}");
        }
    }

    #[test]
    fn grants_unlock_exactly_their_commands() {
        use super::{member_gate, perm_for_cmd};
        use serde_json::json;
        let none: Vec<String> = vec![];
        let page = vec!["page".to_string()];
        let control = vec!["control".to_string()];
        let manage = vec!["manage".to_string()];
        let team = json!({ "target": "team" });
        let stage = json!({ "target": "stage" });

        // A viewer can still do everything a viewer could.
        assert!(member_gate("get_settings", &json!({}), &none).is_ok());
        assert!(member_gate("chat_send", &team, &none).is_ok());
        // …and nothing more.
        assert!(member_gate("page_send", &json!({}), &none).is_err());
        assert!(member_gate("chat_send", &stage, &none).is_err());
        // The right grant opens the right door and no other.
        assert!(member_gate("page_send", &json!({}), &page).is_ok());
        assert!(member_gate("pp_action", &json!({}), &page).is_err());
        assert!(member_gate("pp_action", &json!({}), &control).is_ok());
        assert!(member_gate("chat_send", &stage, &vec!["stage".to_string()]).is_ok());
        // Managing crew must never include granting: that would be an admin
        // with extra steps.
        assert!(member_gate("identity_approve", &json!({}), &manage).is_ok());
        assert!(member_gate("identity_set_perms", &json!({}), &manage).is_err());
        assert_eq!(perm_for_cmd("identity_set_perms"), None);
        // No grant reaches the booth's configuration.
        for cmd in ["update_settings", "save_dashboards", "help_ask", "backup_import", "web_start"] {
            let all: Vec<String> = super::super::identity::PERMS.iter().map(|p| p.to_string()).collect();
            assert!(member_gate(cmd, &json!({}), &all).is_err(), "{cmd} must stay admin-only");
        }
    }

    #[test]
    fn member_tier_cannot_control_anything() {
        use super::member_cmd_ok;
        // Every one of these changes what a room sees, what the desk does, or
        // how the booth is configured.
        for cmd in [
            "update_settings", "pp_action", "pp_set_stage_message", "pp_clear_stage_message",
            "avantis_set_mute", "avantis_set_fader", "avantis_recall_scene",
            "obs_set_scene", "pco_live_action", "tap_override", "crew_join_open",
            "save_dashboards", "identity_approve", "identity_remove", "web_start",
            "backup_export", "backup_import", "diag_bundle", "page_send",
        ] {
            assert!(!member_cmd_ok(cmd), "{cmd} must require admin");
        }
        // chat_send is handled separately (team channel only), so it must not
        // pass this predicate.
        assert!(!member_cmd_ok("chat_send"));
    }

    #[test]
    fn auth_backoff_is_free_at_first_then_throttles() {
        let peer = "203.0.113.99:1";
        clear_auth_failures(peer);
        // A person mistyping the password a couple of times is not slowed down.
        for _ in 0..AUTH_FREE_TRIES {
            note_auth_failure(peer);
            assert!(auth_backoff(peer).is_none(), "should still be free");
        }
        // Past the allowance, a script gets told to wait.
        note_auth_failure(peer);
        note_auth_failure(peer);
        assert!(auth_backoff(peer).is_some(), "should be throttled");
        // Getting it right clears the record.
        clear_auth_failures(peer);
        assert!(auth_backoff(peer).is_none());
    }

    #[test]
    fn member_pp_read_ok_allows_reads_and_refuses_controls() {
        // Reads the web dashboards actually make.
        for ok in [
            "status/screens", "presentation/ABC-123", "presentation/active", "playlists",
            "playlist/xyz", "announcement/active", "look/current", "looks", "macros",
            "messages", "props", "timers", "libraries", "library/abc", "version",
            "/status/slide", "clear/groups", "transport/presentation/current",
        ] {
            assert!(member_pp_read_ok(ok), "should allow read: {ok}");
        }
        // Every GET that changes what's on the screens.
        for bad in [
            "trigger/next", "trigger/previous", "presentation/ABC/3/trigger",
            "playlist/xyz/2/trigger", "clear/layer/slide", "clear/layer/media",
            "macro/abc/trigger", "look/abc/trigger", "timer/1/start", "timer/1/reset",
            "transport/presentation/play", "message/abc/trigger", "presentation/active/focus",
            "prop/abc/trigger", "find_my_mouse", "stage/layout_map/set",
            "presentation/focused/trigger", "Trigger/Next", "trigger/next?x=1",
        ] {
            assert!(!member_pp_read_ok(bad), "should refuse control: {bad}");
        }
    }
}
