//! Walk-in music: Spotify or Apple's Music app on this computer.
//!
//! Driven through the apps' own AppleScript, so there is no Spotify developer
//! account, no API quota and no sign-in: ProDeck asks the app that is already
//! playing. macOS asks once, the first time, whether ProDeck may control it
//! (Info.plist NSAppleEventsUsageDescription). Windows has nothing like it,
//! so there the tile says it needs a Mac.
//!
//! The state is read every two seconds while an app is chosen in Settings and
//! announced as `music:state` (passed to phones by the web gateway). Fades run
//! here, not in a window, so a phone that locks mid-fade doesn't leave the
//! music at half volume. A new command cancels a fade in progress.

use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct MusicState {
    /// "spotify" | "music" | "" (off in Settings).
    pub app: String,
    /// "playing" | "paused" | "stopped" | "not_running" | "unavailable" | "off".
    pub state: String,
    pub volume: u32,
    pub track: String,
    pub artist: String,
    pub album: String,
    /// Milliseconds.
    pub duration_ms: u64,
    pub position_ms: u64,
    pub artwork: String,
    /// True while ProDeck is fading.
    pub fading: bool,
    /// Why it can't be read, in words for the booth.
    pub error: String,
}

#[derive(Default)]
pub struct MusicInner {
    pub last: Mutex<MusicState>,
    /// Bumped by every command; a fade stops when it no longer matches.
    gen: AtomicU64,
}
pub type MusicHub = Arc<MusicInner>;

fn bundle(app: &str) -> Option<&'static str> {
    match app {
        "spotify" => Some("com.spotify.client"),
        "music" => Some("com.apple.Music"),
        _ => None,
    }
}

/// AppleScript string literal.
fn quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

#[cfg(target_os = "macos")]
fn osascript(script: &str) -> Result<String, String> {
    let out = crate::diag::command("/usr/bin/osascript")
        .args(["-e", script])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim_end_matches('\n').to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn osascript(_script: &str) -> Result<String, String> {
    Err("Walk-in music works on a Mac for now.".into())
}

/// Turn osascript's complaints into something the booth can act on.
fn explain(err: &str, app: &str) -> String {
    let name = if app == "spotify" { "Spotify" } else { "Music" };
    if err.contains("-1743") || err.contains("Not authorized") {
        format!("macOS hasn't let ProDeck control {name}. In System Settings, Privacy & Security, Automation, switch on {name} under ProDeck.")
    } else if err.contains("-1728") || err.contains("Can’t get application") || err.contains("Can't get application") {
        format!("{name} isn't installed on this computer.")
    } else if err.contains("Mac") {
        err.to_string()
    } else {
        format!("{name} didn't answer: {err}")
    }
}

/// Read the player. The app is never launched just to be looked at.
fn read(app: &str) -> MusicState {
    let mut st = MusicState { app: app.to_string(), ..Default::default() };
    let Some(id) = bundle(app) else {
        st.state = "off".into();
        return st;
    };
    // Spotify reports duration in ms; Music in seconds. Both position in s.
    let (dur, art) = if app == "spotify" {
        ("(duration of t)", "(artwork url of t)")
    } else {
        ("((duration of t) * 1000)", "\"\"")
    };
    let script = format!(
        "if application id \"{id}\" is running then\n\
         tell application id \"{id}\"\n\
         set s to player state as string\n\
         set v to sound volume\n\
         if s is \"stopped\" then return s & tab & v\n\
         set t to current track\n\
         return s & tab & v & tab & (name of t) & tab & (artist of t) & tab & (album of t) & tab & {dur} & tab & (player position) & tab & {art}\n\
         end tell\n\
         else\n\
         return \"not_running\"\n\
         end if"
    );
    match osascript(&script) {
        Ok(out) => parse(&out, &mut st),
        Err(e) => {
            st.state = "unavailable".into();
            st.error = explain(&e, app);
        }
    }
    st
}

/// AppleScript prints reals in the Mac's locale ("12,5" in much of Europe).
fn num(s: &str) -> f64 {
    s.trim().replace(',', ".").parse::<f64>().unwrap_or(0.0)
}

fn parse(out: &str, st: &mut MusicState) {
    let f: Vec<&str> = out.split('\t').collect();
    st.state = match f.first().map(|s| s.trim()) {
        Some("playing") | Some("kPSP") => "playing",
        Some("paused") | Some("kPSp") => "paused",
        Some("stopped") | Some("kPSS") => "stopped",
        Some("not_running") => "not_running",
        _ => "unavailable",
    }
    .into();
    st.volume = f.get(1).map(|v| num(v).round().clamp(0.0, 100.0) as u32).unwrap_or(0);
    st.track = f.get(2).unwrap_or(&"").to_string();
    st.artist = f.get(3).unwrap_or(&"").to_string();
    st.album = f.get(4).unwrap_or(&"").to_string();
    st.duration_ms = f.get(5).map(|v| num(v).max(0.0) as u64).unwrap_or(0);
    st.position_ms = f.get(6).map(|v| (num(v) * 1000.0).max(0.0) as u64).unwrap_or(0);
    st.artwork = f.get(7).map(|s| s.trim()).filter(|s| s.starts_with("https://")).unwrap_or("").to_string();
}

fn tell(app: &str, body: &str) -> Result<String, String> {
    let id = bundle(app).ok_or("Choose Spotify or Music in Settings, Walk-in music.")?;
    osascript(&format!("tell application id \"{id}\" to {body}")).map_err(|e| explain(&e, app))
}

fn set_volume(app: &str, v: u32) -> Result<(), String> {
    tell(app, &format!("set sound volume to {}", v.min(100))).map(|_| ())
}

/// A Spotify link or URI → "spotify:playlist:ID" (or album/track), else None.
pub fn spotify_uri(s: &str) -> Option<String> {
    let s = s.trim();
    if let Some(rest) = s.strip_prefix("spotify:") {
        let ok = rest.chars().all(|c| c.is_ascii_alphanumeric() || c == ':');
        return ok.then(|| s.to_string());
    }
    let path = s.split("open.spotify.com/").nth(1)?;
    let path = path.split(['?', '#']).next()?;
    let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty() && !p.starts_with("intl-")).collect();
    match parts.as_slice() {
        [kind @ ("playlist" | "album" | "track" | "artist"), id] if id.chars().all(|c| c.is_ascii_alphanumeric()) => {
            Some(format!("spotify:{kind}:{id}"))
        }
        _ => None,
    }
}

fn settings_app(app: &AppHandle) -> (String, String, u32) {
    let s = app.state::<crate::settings::SettingsState>();
    let s = s.lock().unwrap_or_else(|p| p.into_inner());
    (s.music_app.clone(), s.music_playlist.clone(), s.music_volume)
}

fn publish(app: &AppHandle, hub: &MusicHub, st: MusicState) {
    let changed = {
        let mut last = hub.last.lock().unwrap_or_else(|p| p.into_inner());
        let changed = *last != st;
        *last = st.clone();
        changed
    };
    if changed {
        app.emit("music:state", &st).ok();
    }
}

/// Poll every two seconds while an app is chosen. Started once at launch.
pub fn start(app: AppHandle, hub: MusicHub) {
    tauri::async_runtime::spawn(async move {
        loop {
            let (which, _, _) = settings_app(&app);
            let mut st = if which.is_empty() {
                MusicState { state: "off".into(), ..Default::default() }
            } else {
                let w = which.clone();
                tauri::async_runtime::spawn_blocking(move || read(&w)).await.unwrap_or_default()
            };
            st.fading = hub.last.lock().unwrap_or_else(|p| p.into_inner()).fading;
            publish(&app, &hub, st);
            tokio::time::sleep(Duration::from_secs(if which.is_empty() { 5 } else { 2 })).await;
        }
    });
}

fn set_fading(app: &AppHandle, hub: &MusicHub, on: bool) {
    let mut st = hub.last.lock().unwrap_or_else(|p| p.into_inner()).clone();
    st.fading = on;
    publish(app, hub, st);
}

/// Ramp the volume from `from` to `to` over `secs`, four steps a second.
/// Returns false if another command took over.
fn ramp(app: &str, hub: &MusicHub, gen: u64, from: u32, to: u32, secs: f64) -> bool {
    let steps = ((secs * 4.0).round() as u32).max(1);
    for i in 1..=steps {
        if hub.gen.load(Ordering::Acquire) != gen {
            return false;
        }
        let v = from as f64 + (to as f64 - from as f64) * (i as f64 / steps as f64);
        if set_volume(app, v.round() as u32).is_err() {
            return false;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    true
}

#[tauri::command]
pub fn music_state(hub: tauri::State<'_, MusicHub>) -> MusicState {
    hub.last.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

/// play | pause | toggle | next | previous | volume (value 0-100) |
/// fade_out (value = seconds; pauses at the bottom, then puts the volume back) |
/// start (value = seconds; plays the walk-in playlist from silence up to the
/// walk-in volume).
#[tauri::command]
pub async fn music_control(action: String, value: Option<f64>, app: AppHandle, hub: tauri::State<'_, MusicHub>) -> Result<Value, String> {
    let hub = hub.inner().clone();
    let (which, playlist, walk_in_volume) = settings_app(&app);
    if bundle(&which).is_none() {
        return Err("Choose Spotify or Music in Settings, Walk-in music.".into());
    }
    let gen = hub.gen.fetch_add(1, Ordering::AcqRel) + 1;
    let app2 = app.clone();
    let hub2 = hub.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let (app, hub) = (app2, hub2);
        match action.as_str() {
            "play" => tell(&which, "play").map(|_| ()),
            "pause" => tell(&which, "pause").map(|_| ()),
            "toggle" => tell(&which, "playpause").map(|_| ()),
            "next" => tell(&which, "next track").map(|_| ()),
            "previous" => tell(&which, "previous track").map(|_| ()),
            "volume" => set_volume(&which, value.unwrap_or(50.0).clamp(0.0, 100.0) as u32),
            "fade_out" => {
                let from = read(&which).volume;
                set_fading(&app, &hub, true);
                let done = ramp(&which, &hub, gen, from, 0, value.unwrap_or(15.0).clamp(1.0, 120.0));
                if done {
                    tell(&which, "pause").ok();
                }
                // Put the level back, so the next Play isn't silent.
                set_volume(&which, from).ok();
                set_fading(&app, &hub, false);
                Ok(())
            }
            "start" => {
                let target = if walk_in_volume == 0 { 60 } else { walk_in_volume.min(100) };
                set_volume(&which, 0)?;
                let pl = playlist.trim();
                if pl.is_empty() {
                    tell(&which, "play")?;
                } else if which == "spotify" {
                    let uri = spotify_uri(pl).ok_or("The walk-in playlist isn't a Spotify link. Paste it from Spotify's Share, Copy link.")?;
                    tell(&which, &format!("play track {}", quote(&uri)))?;
                } else {
                    tell(&which, &format!("play playlist {}", quote(pl)))?;
                }
                set_fading(&app, &hub, true);
                ramp(&which, &hub, gen, 0, target, value.unwrap_or(5.0).clamp(1.0, 60.0));
                set_fading(&app, &hub, false);
                Ok(())
            }
            other => Err(format!("unknown music action {other}")),
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    // Show the result straight away rather than at the next poll.
    let w = which_now(&app);
    let st = tauri::async_runtime::spawn_blocking(move || read(&w)).await.unwrap_or_default();
    publish(&app, &hub, MusicState { fading: false, ..st });
    result.map(|_| json!({ "ok": true }))
}

fn which_now(app: &AppHandle) -> String {
    settings_app(app).0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_both_apps_output_and_european_decimals() {
        let mut st = MusicState::default();
        parse("playing\t62\tGoodness of God\tCeCe Winans\tBelieve For It\t292000\t83,5\thttps://i.scdn.co/image/x", &mut st);
        assert_eq!(st.state, "playing");
        assert_eq!(st.volume, 62);
        assert_eq!(st.track, "Goodness of God");
        assert_eq!(st.duration_ms, 292000);
        assert_eq!(st.position_ms, 83500);
        assert_eq!(st.artwork, "https://i.scdn.co/image/x");

        let mut st = MusicState::default();
        parse("stopped\t40", &mut st);
        assert_eq!((st.state.as_str(), st.volume, st.track.as_str()), ("stopped", 40, ""));

        let mut st = MusicState::default();
        parse("not_running", &mut st);
        assert_eq!(st.state, "not_running");
    }

    #[test]
    fn turns_spotify_links_into_uris_and_refuses_anything_else() {
        assert_eq!(spotify_uri("https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd?si=abc").as_deref(), Some("spotify:playlist:37i9dQZF1DX0XUsuxWHRQd"));
        assert_eq!(spotify_uri("https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy").as_deref(), Some("spotify:album:4aawyAB9vmqN3uQ7FjRGTy"));
        assert_eq!(spotify_uri("spotify:playlist:37i9dQZF1DX0XUsuxWHRQd").as_deref(), Some("spotify:playlist:37i9dQZF1DX0XUsuxWHRQd"));
        assert_eq!(spotify_uri("spotify:playlist:x\" & do shell script \"rm"), None);
        assert_eq!(spotify_uri("Sunday walk-in"), None);
    }

    #[test]
    fn quotes_applescript_strings() {
        assert_eq!(quote(r#"He said "hi" \o/"#), r#""He said \"hi\" \\o/""#);
    }

    #[test]
    fn explains_the_permission_error() {
        assert!(explain("execution error: Not authorized to send Apple events to Spotify. (-1743)", "spotify").contains("Automation"));
    }
}
