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
    let token = member_password(settings.inner())?;
    approve(&code, kiosk_path(&target, &token, safe.unwrap_or(false)))
}

#[tauri::command]
pub fn tv_dismiss(code: String) {
    dismiss(&code)
}

// ---------------------------------------------------------------- screens
//
// A paired TV checks in about once a minute with the crew password it was
// given (`tv_checkin` through the gateway). That's how the booth knows which
// TVs exist, what each shows and which app version it runs, and how it hands
// a TV an instruction: update the app, or show something else. Instructions
// are handed out once, at the next check-in.

/** The ProDeck Display app this booth expects (tv/android/VERSION, the
 *  Android versionCode). A TV below it is offered the update. */
pub fn app_version() -> u32 {
    include_str!("../../tv/android/VERSION").trim().parse().unwrap_or(0)
}

/** Where this booth's ProDeck Display lives: the APK attached to the release
 *  this booth runs, so a TV always matches its booth. */
pub fn apk_url() -> String {
    format!("https://github.com/whiteoakmedia/prodeck/releases/download/v{}/ProDeckDisplay.apk", env!("CARGO_PKG_VERSION"))
}

/** A TV counts as on if it checked in this recently. */
const ONLINE_FOR: Duration = Duration::from_secs(3 * 60);
const MAX_SCREENS: usize = 50;

struct Screen {
    name: String,
    ip: String,
    app: u32,
    showing: String,
    can_install: bool,
    /// What the TV says about an update in progress ("Downloading…"), or "".
    note: String,
    seen: Instant,
    update: bool,
    show: Option<String>,
}

static SCREENS: Mutex<Option<HashMap<String, Screen>>> = Mutex::new(None);

fn screens<T>(f: impl FnOnce(&mut HashMap<String, Screen>) -> T) -> T {
    let mut g = SCREENS.lock().unwrap_or_else(|p| p.into_inner());
    let m = g.get_or_insert_with(HashMap::new);
    // A TV gone for a day is forgotten; it reappears at its next check-in.
    m.retain(|_, s| s.seen.elapsed() < Duration::from_secs(24 * 3600));
    f(m)
}

/// A TV checking in. Returns what it should know and do.
pub fn checkin(id: &str, name: &str, app: u32, showing: &str, can_install: bool, note: &str, ip: &str) -> Value {
    let id: String = id.chars().filter(|c| c.is_ascii_alphanumeric()).take(32).collect();
    if id.len() < 8 {
        return json!({ "error": "bad id" });
    }
    let (update, show) = screens(|m| {
        if !m.contains_key(&id) && m.len() >= MAX_SCREENS {
            return (false, None);
        }
        let s = m.entry(id.clone()).or_insert(Screen {
            name: String::new(), ip: String::new(), app: 0, showing: String::new(),
            can_install: false, note: String::new(), seen: Instant::now(), update: false, show: None,
        });
        s.name = clean_name(name);
        s.ip = ip.to_string();
        s.app = app;
        s.showing = showing.chars().take(80).collect();
        s.can_install = can_install;
        s.note = note.chars().filter(|c| !c.is_control()).take(120).collect();
        s.seen = Instant::now();
        // Asked to update but already current: nothing to do.
        let update = std::mem::take(&mut s.update) && app < app_version();
        (update, s.show.take())
    });
    let mut out = json!({ "latest": app_version(), "apk": apk_url(), "update": update });
    if let Some(path) = show {
        out["show"] = json!(path);
    }
    out
}

/// Every TV that has checked in, for Settings.
pub fn screen_list() -> Vec<Value> {
    let latest = app_version();
    let mut v: Vec<Value> = screens(|m| {
        m.iter()
            .map(|(id, s)| json!({
                "id": id, "name": s.name, "ip": s.ip, "app": s.app, "showing": s.showing,
                "online": s.seen.elapsed() < ONLINE_FOR, "seenSecs": s.seen.elapsed().as_secs(),
                "outdated": s.app < latest, "canInstall": s.can_install, "updateAsked": s.update, "note": s.note,
            }))
            .collect()
    });
    v.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    v
}

/// Ask one TV, or every TV that needs it (`id` = "all"), to update at its next check-in.
pub fn ask_update(id: &str) -> usize {
    let latest = app_version();
    screens(|m| {
        let mut n = 0;
        for (k, s) in m.iter_mut() {
            if (id == "all" || k == id) && s.app < latest {
                s.update = true;
                n += 1;
            }
        }
        n
    })
}

fn ask_show(id: &str, path: String) -> Result<(), String> {
    screens(|m| match m.get_mut(id) {
        Some(s) => {
            s.show = Some(path);
            Ok(())
        }
        None => Err("That TV hasn't checked in. Check it's on.".into()),
    })
}

/// The kiosk path for a dashboard name or "tally:<camera>", like a kiosk link made in Settings.
fn kiosk_path(target: &str, token: &str, safe: bool) -> String {
    let enc = |s: &str| urlencoding::encode(s).into_owned();
    let mut path = match target.strip_prefix("tally:") {
        Some(t) => format!("/?tally={}&token={}", enc(t), enc(token)),
        None => format!("/?kiosk={}&token={}", enc(target), enc(token)),
    };
    if safe {
        path.push_str("&safe=1");
    }
    path
}

fn member_password(settings: &crate::settings::SettingsState) -> Result<String, String> {
    let token = settings.lock().unwrap_or_else(|p| p.into_inner()).web_member_password.clone();
    if token.trim().is_empty() {
        return Err("Set a member password in Browser Access first. TV screens use it, like kiosk links.".into());
    }
    Ok(token)
}

#[tauri::command]
pub fn tv_screens() -> Vec<Value> {
    screen_list()
}

/// `id`: one TV, or "all" for every TV on an older app.
#[tauri::command]
pub fn tv_update(id: String) -> usize {
    ask_update(&id)
}

/// Change what a TV shows, from the booth.
#[tauri::command]
pub fn tv_show(id: String, target: String, safe: Option<bool>, settings: tauri::State<'_, crate::settings::SettingsState>) -> Result<(), String> {
    let token = member_password(settings.inner())?;
    ask_show(&id, kiosk_path(&target, &token, safe.unwrap_or(false)))
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
    fn a_tv_is_told_to_update_once_and_only_when_it_needs_to() {
        let latest = app_version();
        assert!(latest >= 2, "tv/android/VERSION is read");
        let r = checkin("tvupdate0001", "Green Room TV", latest - 1, "Green Room", true, "", "10.0.0.5");
        assert_eq!((r["latest"].as_u64(), r["update"].as_bool()), (Some(latest as u64), Some(false)));
        assert!(r["apk"].as_str().unwrap().ends_with(&format!("v{}/ProDeckDisplay.apk", env!("CARGO_PKG_VERSION"))));
        let me = screen_list().into_iter().find(|s| s["id"] == "tvupdate0001").unwrap();
        assert_eq!((me["outdated"].as_bool(), me["online"].as_bool()), (Some(true), Some(true)));
        assert!(ask_update("all") >= 1);
        assert_eq!(checkin("tvupdate0001", "Green Room TV", latest - 1, "Green Room", true, "", "10.0.0.5")["update"], true);
        // Handed out once.
        assert_eq!(checkin("tvupdate0001", "Green Room TV", latest - 1, "Green Room", true, "", "10.0.0.5")["update"], false);
        // A current TV is never asked.
        checkin("tvupdate0002", "Lobby", latest, "Lobby", true, "", "10.0.0.6");
        ask_update("tvupdate0002");
        assert_eq!(checkin("tvupdate0002", "Lobby", latest, "Lobby", true, "", "10.0.0.6")["update"], false);
        assert!(checkin("x", "bad", 1, "", false, "", "")["error"].is_string());
    }

    #[test]
    fn the_booth_can_change_what_a_tv_shows() {
        checkin("tvshow00001", "Office TV", 2, "Office", true, "", "10.0.0.7");
        ask_show("tvshow00001", kiosk_path("Green Room", "pw", true)).unwrap();
        let r = checkin("tvshow00001", "Office TV", 2, "Office", true, "", "10.0.0.7");
        assert_eq!(r["show"], "/?kiosk=Green%20Room&token=pw&safe=1");
        assert!(checkin("tvshow00001", "Office TV", 2, "Green Room", true, "", "10.0.0.7").get("show").is_none());
        assert!(ask_show("nobody00000", "/".into()).is_err());
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
