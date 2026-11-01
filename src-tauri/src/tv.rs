//! TV screens: Fire TV / Android TV sticks running the ProDeck Display app
//! (tv/android). Typing a kiosk link with a TV remote is miserable, so a TV
//! pairs instead:
//!
//! 1. The booth announces itself on the network (`_prodeck._tcp`), so the TV
//!    finds it without anyone typing an address.
//! 2. The TV shows a six-character code and says hello (`POST /api/tv/hello`).
//! 3. Someone at the booth sees the code in Settings → TV screens, picks a
//!    dashboard, and approves it.
//! 4. The TV, polling `GET /api/tv/poll?code=`, gets its kiosk link once, and
//!    from then on is just a kiosk.
//!
//! The link carries the member password, exactly like a kiosk link made in
//! Settings; it only goes to the code a person at the booth approved while
//! looking at it on the TV. Pending codes live in memory, expire, and are
//! capped, so a flood of hellos can't grow anything.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long a TV may wait for approval before it has to ask again.
const PENDING_FOR: Duration = Duration::from_secs(15 * 60);
const MAX_PENDING: usize = 20;
const MAX_PER_IP: usize = 3;

struct Pending {
    name: String,
    ip: String,
    at: Instant,
    /// The kiosk path once approved ("/?kiosk=…&token=…"); handed out once.
    approved: Option<String>,
}

static PENDING: Mutex<Option<HashMap<String, Pending>>> = Mutex::new(None);

fn with<T>(f: impl FnOnce(&mut HashMap<String, Pending>) -> T) -> T {
    let mut g = PENDING.lock().unwrap_or_else(|p| p.into_inner());
    let m = g.get_or_insert_with(HashMap::new);
    m.retain(|_, p| p.at.elapsed() < PENDING_FOR);
    f(m)
}

/// Six characters a person can read off a TV across a room: no 0/O, 1/I.
pub fn valid_code(c: &str) -> bool {
    c.len() == 6 && c.chars().all(|ch| "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(ch))
}

fn clean_name(n: &str) -> String {
    let n: String = n.chars().filter(|c| !c.is_control()).take(40).collect();
    let n = n.trim().to_string();
    if n.is_empty() { "TV".into() } else { n }
}

/// A TV says hello with the code it's showing. Err = refused (bad code, too many).
pub fn hello(code: &str, name: &str, ip: &str) -> Result<(), &'static str> {
    if !valid_code(code) {
        return Err("bad code");
    }
    with(|m| {
        if let Some(p) = m.get_mut(code) {
            // The same TV asking again keeps its place.
            if p.ip == ip {
                p.at = Instant::now();
                return Ok(());
            }
            return Err("code in use");
        }
        // A TV showing a new code (it was re-paired, or restarted) replaces
        // its own earlier one, so the booth's list shows each TV once and a
        // TV that re-pairs a few times isn't locked out.
        m.retain(|_, p| p.ip != ip || p.approved.is_some());
        if m.len() >= MAX_PENDING || m.values().filter(|p| p.ip == ip).count() >= MAX_PER_IP {
            return Err("too many waiting");
        }
        m.insert(code.to_string(), Pending { name: clean_name(name), ip: ip.to_string(), at: Instant::now(), approved: None });
        Ok(())
    })
}

/// The TV asks whether it's been approved. Only the TV that said hello (same
/// address) gets the link, and only once.
pub fn poll(code: &str, ip: &str) -> Value {
    with(|m| match m.get(code) {
        None => json!({ "status": "unknown" }),
        Some(p) if p.ip != ip => json!({ "status": "unknown" }),
        Some(p) => match &p.approved {
            None => json!({ "status": "waiting" }),
            Some(path) => {
                let path = path.clone();
                m.remove(code);
                json!({ "status": "ok", "path": path })
            }
        },
    })
}

/// TVs waiting at the booth, newest first, for Settings.
pub fn pending_list() -> Vec<Value> {
    let mut v: Vec<(Instant, Value)> = with(|m| {
        m.iter()
            .filter(|(_, p)| p.approved.is_none())
            .map(|(code, p)| (p.at, json!({ "code": code, "name": p.name, "ip": p.ip, "waitingSecs": p.at.elapsed().as_secs() })))
            .collect()
    });
    v.sort_by(|a, b| b.0.cmp(&a.0));
    v.into_iter().map(|(_, j)| j).collect()
}

/// Approve a waiting TV with the kiosk path it should open.
pub fn approve(code: &str, path: String) -> Result<(), String> {
    with(|m| match m.get_mut(code) {
        Some(p) => {
            p.approved = Some(path);
            p.at = Instant::now();
            Ok(())
        }
        None => Err("That TV isn't waiting any more. Have it show a new code.".into()),
    })
}

pub fn dismiss(code: &str) {
    with(|m| {
        m.remove(code);
    });
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn tv_pending() -> Vec<Value> {
    pending_list()
}

/// `target`: a dashboard name, or "tally:all" for the camera tally board.
/// `safe`: keep clear of the edges a TV crops (overscan).
#[tauri::command]
pub fn tv_approve(code: String, target: String, safe: Option<bool>, settings: tauri::State<'_, crate::settings::SettingsState>) -> Result<(), String> {
    let token = settings.lock().unwrap_or_else(|p| p.into_inner()).web_member_password.clone();
    if token.trim().is_empty() {
        return Err("Set a member password in Browser Access first. TV screens use it, like kiosk links.".into());
    }
    let enc = |s: &str| urlencoding::encode(s).into_owned();
    let mut path = match target.strip_prefix("tally:") {
        Some(t) => format!("/?tally={}&token={}", enc(t), enc(&token)),
        None => format!("/?kiosk={}&token={}", enc(&target), enc(&token)),
    };
    if safe.unwrap_or(false) {
        path.push_str("&safe=1");
    }
    approve(&code, path)
}

#[tauri::command]
pub fn tv_dismiss(code: String) {
    dismiss(&code)
}

// ---------------------------------------------------------------- announce

static ANNOUNCER: Mutex<Option<mdns_sd::ServiceDaemon>> = Mutex::new(None);

/// Announce the browser gateway as `_prodeck._tcp` so TV screens (and
/// anything else) can find the booth by name. Replaces any earlier
/// announcement (a port change). Failure only means TVs ask for the address.
pub fn announce(port: u16, device_name: &str) {
    let mut g = ANNOUNCER.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(d) = g.take() {
        let _ = d.shutdown();
    }
    let ips = crate::dante::local_ips();
    if ips.is_empty() {
        return;
    }
    let Ok(daemon) = mdns_sd::ServiceDaemon::new() else { return };
    let named = device_name.trim().trim_end_matches(".local");
    let instance = clean_name(if named.is_empty() { "ProDeck" } else { named });
    let host = format!("{}.local.", instance.replace(|c: char| !c.is_ascii_alphanumeric(), "-"));
    let props = [("path", "/"), ("v", env!("CARGO_PKG_VERSION"))];
    match mdns_sd::ServiceInfo::new("_prodeck._tcp.local.", &instance, &host, &ips[..], port, &props[..]) {
        Ok(info) => {
            if daemon.register(info).is_ok() {
                *g = Some(daemon);
            } else {
                let _ = daemon.shutdown();
            }
        }
        Err(_) => {
            let _ = daemon.shutdown();
        }
    }
}

pub fn stop_announcing() {
    if let Some(d) = ANNOUNCER.lock().unwrap_or_else(|p| p.into_inner()).take() {
        let _ = d.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tv_pairs_once_and_only_from_where_it_said_hello() {
        let code = "TVA234";
        assert!(valid_code(code));
        assert!(!valid_code("tva234") && !valid_code("TV0234") && !valid_code("TVA23"));
        hello(code, "Lobby TV\u{7}", "10.0.0.9").unwrap();
        assert_eq!(poll(code, "10.0.0.9")["status"], "waiting");
        assert!(pending_list().iter().any(|p| p["code"] == code && p["name"] == "Lobby TV"));
        // Someone else can't take its code or read its answer.
        assert_eq!(hello(code, "x", "10.0.0.66"), Err("code in use"));
        approve(code, "/?kiosk=Lobby&token=pw".into()).unwrap();
        assert_eq!(poll(code, "10.0.0.66")["status"], "unknown");
        let ok = poll(code, "10.0.0.9");
        assert_eq!((ok["status"].as_str(), ok["path"].as_str()), (Some("ok"), Some("/?kiosk=Lobby&token=pw")));
        // Handed out once.
        assert_eq!(poll(code, "10.0.0.9")["status"], "unknown");
        assert!(approve(code, "/".into()).is_err());
    }

    #[test]
    fn a_tv_asking_again_replaces_its_old_code() {
        for c in ["FLDAA2", "FLDAB2", "FLDAC2", "FLDAD2"] {
            hello(c, "tv", "10.0.0.77").unwrap();
        }
        let mine: Vec<_> = pending_list().into_iter().filter(|p| p["ip"] == "10.0.0.77").collect();
        assert_eq!(mine.len(), 1, "one entry per TV");
        assert_eq!(mine[0]["code"], "FLDAD2");
        assert_eq!(poll("FLDAA2", "10.0.0.77")["status"], "unknown");
        dismiss("FLDAD2");
    }
}
