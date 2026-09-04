use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub pp_host: String,
    pub pp_port: u16,
    pub pp_auto_connect: bool,
    pub audio_input: Option<String>,
    pub whisper_bin: Option<String>,
    pub whisper_model: Option<String>,
    pub captions_enabled: bool,
    pub osc_port: u16,
    pub midi_port: Option<String>,
    pub relay_url: String,
    pub device_name: String,
    pub theme: String,
    pub pco_app_id: Option<String>,
    pub pco_secret: Option<String>,
    pub spl_calibration: f64,
    /// Browser access: serve the dashboards over HTTP on the LAN.
    pub web_enabled: bool,
    pub web_port: u16,
    /// Admin access password — full control (the booth owner's tier).
    pub web_password: String,
    /// Member access password — dashboards, streams, and TEAM chat only; no
    /// stage/confidence sends, no control commands. Empty = tier disabled.
    pub web_member_password: String,
    /// Rotatable crew-invite token: a ?join=<token> link grants MEMBER-tier
    /// gateway access with no password typing. Rotating it kills every old
    /// link. Empty = feature off.
    pub web_invite_token: String,
    /// Bearer token the booth uses to push tokens/extras to the crew-edge
    /// worker (your-domain/edge). Empty = edge push off.
    pub edge_admin_token: String,
    /// Google Gemini API key (AI Studio). Used to make Auto‑Follow smarter:
    /// Gemini matches the noisy live transcript against the known slide lyrics.
    /// Stays on this machine; never sent to browser clients.
    /// Google Analytics 4 realtime viewer count for the Church Online watch
    /// page. Property id is the numeric one from GA4 Admin, NOT the G- id.
    /// Empty = feature off.
    #[serde(default)]
    pub ga4_property_id: String,
    /// Absolute path to the service-account JSON key. The key never leaves
    /// this machine and is never sent to browser clients.
    #[serde(default)]
    pub ga4_key_path: String,
    /// Optional page filter, e.g. "watch" — narrows the count to the watch
    /// page instead of the whole site. Empty = whole property.
    #[serde(default)]
    pub ga4_page_filter: String,
    /// Desk watchdog: page THIS crew user id with any change made on the
    /// Avantis surface (mute/fader/scene/name). Empty = watchdog off.
    #[serde(default)]
    pub avantis_watch_user: String,
    /// Armed = changes are paged; disarmed = changes are discarded. Disarm on
    /// Sundays — a mixed service is thousands of legitimate moves.
    #[serde(default)]
    pub avantis_watch_armed: bool,
    /// The public origin volunteers reach from anywhere (your tunnel/domain,
    /// e.g. "https://booth.yourchurch.org"). Empty = no public origin: edge
    /// push stays off and links use the LAN address.
    #[serde(default)]
    pub public_url: String,
    pub gemini_api_key: Option<String>,
    /// When true (and a key is set), Auto‑Follow uses Gemini to pick the slide,
    /// falling back to the local token matcher if Gemini is unavailable.
    pub gemini_match_enabled: bool,
    /// Multi-channel (Dante) routing — 1-based channel numbers on the audio input
    /// device. The measurement engine (SPL/RTA/LUFS) mixes these channels; empty
    /// means "all channels" (legacy behaviour).
    pub audio_measure_channels: Vec<u32>,
    /// Channels mixed into the overflow / "Listen" stream. Empty = overflow off.
    pub audio_overflow_channels: Vec<u32>,
    /// Auto-send the live song's key to a backing-track / vocal-tune rig as the
    /// pitch class (0–11). OSC goes to keysend_osc_host:port (empty host = off);
    /// MIDI Program Change (+ optional CC) goes out keysend_midi_port (None = off).
    pub keysend_enabled: bool,
    pub keysend_osc_host: String,
    pub keysend_osc_port: u16,
    pub keysend_midi_port: Option<String>,
    pub keysend_midi_channel: u8,
    pub keysend_cc: i32,
    /// TapLink: push the current service moment (tap:<keyword> in slide notes)
    /// to the taplink-edge worker so NFC taps land on the right page. The token
    /// stays on this machine; tap_* commands aren't exposed to web clients.
    pub tap_enabled: bool,
    pub tap_edge_url: String,
    pub tap_token: String,
    /// Avantis console mirror (MIDI over TCP, port 51325). Phase 1 is
    /// read-only: ProDeck listens to mutes/faders/scene and queries names —
    /// it never sends control messages to the desk.
    pub avantis_enabled: bool,
    pub avantis_host: String,
    /// Base MIDI channel (1-based, as shown on the desk under
    /// Utility → Control → MIDI). Avantis spans base..base+4; max base is 12.
    pub avantis_midi_base: u8,
    /// Local names for desk scenes ("1" → "Pre-service") — the protocol only
    /// carries numbers, so the labels live here.
    pub avantis_scene_labels: std::collections::HashMap<String, String>,
    /// Desk softkeys → crew pages. A softkey configured on the Avantis to send
    /// a custom MIDI note (on a channel OUTSIDE the base..base+4 range, so it
    /// can never read as a mute) fires a page to the mapped crew.
    pub avantis_softkeys: Vec<AvantisSoftkey>,
    /// Lobby TVs auto-restore. When set, a booth-side watchdog re-triggers
    /// this playlist item onto the announcements layer whenever the layer is
    /// EMPTY — ProPresenter boots dark, and the lobby TVs shouldn't stay dark
    /// with it. Empty playlist uuid = auto-restore off.
    pub lobby_auto_playlist: String,
    pub lobby_auto_index: u64,
    /// Display label only (what the widget shows as the standing loop).
    pub lobby_auto_name: String,
    /// Auto check-in via geolocation: the building's coordinates + radius in
    /// meters. Both blank = the geo path is off and phones never prompt for
    /// location (the wifi/IP path needs no configuration at all).
    pub church_lat: String,
    pub church_lng: String,
    pub checkin_radius_m: u32,
    /// Page crew who haven't checked in when their per-position call time
    /// (PCO Setup → "Check-in times") arrives on a service day.
    pub checkin_nudge: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct AvantisSoftkey {
    /// 1-based MIDI channel the softkey transmits on.
    pub midi_channel: u8,
    pub note: u8,
    /// Page body, e.g. "FOH needs the producer at the desk".
    pub body: String,
    /// Crew user ids to page; empty = every approved crew member.
    pub recipients: Vec<String>,
}

impl Default for AvantisSoftkey {
    fn default() -> Self {
        Self { midi_channel: 1, note: 0, body: String::new(), recipients: Vec::new() }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            public_url: String::new(),
            avantis_watch_user: String::new(),
            avantis_watch_armed: false,
            ga4_property_id: String::new(),
            ga4_key_path: String::new(),
            ga4_page_filter: String::new(),
            pp_host: "localhost".into(),
            pp_port: 1025,
            pp_auto_connect: false,
            audio_input: None,
            whisper_bin: detect_whisper_bin(),
            whisper_model: detect_whisper_model(),
            captions_enabled: false,
            osc_port: 8010,
            midi_port: None,
            relay_url: String::new(),
            device_name: default_device_name(),
            theme: "dark".into(),
            pco_app_id: None,
            pco_secret: None,
            spl_calibration: 100.0,
            web_enabled: false,
            web_port: 8088,
            web_password: String::new(),
            web_member_password: String::new(),
            web_invite_token: String::new(),
            edge_admin_token: String::new(),
            gemini_api_key: None,
            gemini_match_enabled: false,
            audio_measure_channels: Vec::new(),
            audio_overflow_channels: Vec::new(),
            keysend_enabled: false,
            keysend_osc_host: String::new(),
            keysend_osc_port: 12321,
            keysend_midi_port: None,
            keysend_midi_channel: 1,
            keysend_cc: -1,
            tap_enabled: false,
            tap_edge_url: String::new(),
            tap_token: String::new(),
            avantis_enabled: false,
            avantis_host: String::new(),
            avantis_midi_base: 12,
            avantis_scene_labels: std::collections::HashMap::new(),
            avantis_softkeys: Vec::new(),
            lobby_auto_playlist: String::new(),
            lobby_auto_index: 0,
            lobby_auto_name: String::new(),
            church_lat: String::new(),
            church_lng: String::new(),
            checkin_radius_m: 150,
            checkin_nudge: false,
        }
    }
}

pub type SettingsState = Mutex<Settings>;

fn config_dir() -> PathBuf {
    let mut dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    dir.push("ProDeck");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Crash-safe JSON persistence. All the app's data files were written with a
/// bare fs::write — two threads (the app + a web-gateway request) could tear
/// the file, and a crash mid-write left invalid JSON that load() silently
/// turned into Null, wiping the data on the next save. Serialize writers and
/// write temp-then-rename so the file on disk is always a complete document.
static FILE_IO: Mutex<()> = Mutex::new(());

fn write_json_atomic(path: PathBuf, json: String) -> Result<(), String> {
    let _guard = FILE_IO.lock().unwrap_or_else(|p| p.into_inner());
    write_locked(&path, &json)
}

/// How stale the rolling backup may get before the next write refreshes it.
/// Long enough that a mistaken erase (which the autosave would otherwise copy
/// into the backup within seconds) stays recoverable for a while.
const BACKUP_MAX_AGE_SECS: u64 = 600;

/// Atomic write that also keeps one previous-generation copy alongside.
///
/// Used for service tracking, where the file is irreplaceable: it's the only
/// record of what actually happened in past services. The backup is time-gated
/// rather than per-write, so a bad write or an accidental Reset doesn't
/// immediately overwrite the last good copy (the autosave runs every 4s).
fn write_json_atomic_backed_up(path: PathBuf, json: String) -> Result<(), String> {
    let _guard = FILE_IO.lock().unwrap_or_else(|p| p.into_inner());
    let bak = path.with_extension("bak.json");
    let stale = match std::fs::metadata(&bak) {
        Ok(m) => m
            .modified()
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|age| age.as_secs() >= BACKUP_MAX_AGE_SECS)
            .unwrap_or(true),
        Err(_) => true, // no backup yet
    };
    // Only ever back up a file that parses — copying a corrupt file over the
    // last good copy is precisely the failure this exists to prevent.
    if stale && path.exists() {
        if let Ok(cur) = std::fs::read_to_string(&path) {
            if serde_json::from_str::<serde_json::Value>(&cur).is_ok() {
                let _ = std::fs::write(&bak, &cur);
            }
        }
    }
    write_locked(&path, &json)
}

fn write_locked(path: &PathBuf, json: &str) -> Result<(), String> {
    use std::io::Write;
    let tmp = path.with_extension("json.tmp");
    // fsync before the rename: without it a power cut can leave the rename
    // durable but the bytes not, i.e. an empty file where the data was.
    let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    drop(f);
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn config_path() -> PathBuf {
    config_dir().join("settings.json")
}

fn dashboards_path() -> PathBuf {
    config_dir().join("dashboards.json")
}

/// Dashboards are stored as opaque JSON so the widget/layout schema can live
/// entirely in the frontend and evolve without touching Rust.
#[tauri::command]
pub fn load_dashboards() -> serde_json::Value {
    match std::fs::read_to_string(dashboards_path()) {
        Ok(s) => serde_json::from_str(&s).unwrap_or(serde_json::Value::Null),
        Err(_) => serde_json::Value::Null,
    }
}

#[tauri::command]
pub fn save_dashboards(data: serde_json::Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    write_json_atomic(dashboards_path(), json)
}

fn pco_data_path() -> PathBuf {
    config_dir().join("pco.json")
}

/// Planning Center local state (selected plan + mic assignments), kept as
/// opaque JSON owned by the frontend.
#[tauri::command]
pub fn load_pco_data() -> serde_json::Value {
    match std::fs::read_to_string(pco_data_path()) {
        Ok(s) => serde_json::from_str(&s).unwrap_or(serde_json::Value::Null),
        Err(_) => serde_json::Value::Null,
    }
}

#[tauri::command]
pub fn save_pco_data(data: serde_json::Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    write_json_atomic(pco_data_path(), json)
}

fn checklists_path() -> PathBuf {
    config_dir().join("checklists.json")
}

/// App-wide checklists (with due dates), owned by the frontend as opaque JSON.
#[tauri::command]
pub fn load_checklists() -> serde_json::Value {
    match std::fs::read_to_string(checklists_path()) {
        Ok(s) => serde_json::from_str(&s).unwrap_or(serde_json::Value::Null),
        Err(_) => serde_json::Value::Null,
    }
}

#[tauri::command]
pub fn save_checklists(data: serde_json::Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    write_json_atomic(checklists_path(), json)
}

fn routing_path() -> PathBuf {
    config_dir().join("routing.json")
}

/// System signal-routing map (chains of hops with troubleshooting steps),
/// owned by the frontend as opaque JSON. Read by every web tier so volunteer
/// phones/laptops can see the chain; writes stay booth-only like the rest.
#[tauri::command]
pub fn load_routing() -> serde_json::Value {
    match std::fs::read_to_string(routing_path()) {
        Ok(s) => serde_json::from_str(&s).unwrap_or(serde_json::Value::Null),
        Err(_) => serde_json::Value::Null,
    }
}

#[tauri::command]
pub fn save_routing(data: serde_json::Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    write_json_atomic(routing_path(), json)
}

fn tracking_path() -> PathBuf {
    config_dir().join("tracking.json")
}

/// Service-tracking history (planned vs actual + SPL per item), keyed by plan.
///
/// Errors are NOT flattened into "no data". A missing file means a fresh
/// install and returns null; anything else — unreadable, truncated, corrupt —
/// returns Err so the caller can refuse to persist over it. Returning null for
/// a corrupt file is what silently destroyed history: the store started empty
/// and the next 4-second autosave wrote that emptiness back over the real file.
#[tauri::command]
pub fn load_tracking() -> Result<serde_json::Value, String> {
    read_json_strict(&tracking_path(), "tracking.json")
}

/// Read a data file, distinguishing "not there yet" from "there but broken".
/// Missing → Ok(null); unreadable or unparseable → Err, so the caller can stop
/// writing instead of persisting an empty store over recoverable data.
fn read_json_strict(path: &PathBuf, name: &str) -> Result<serde_json::Value, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| {
            let bak = path.with_extension("bak.json");
            let hint = if bak.exists() {
                format!(" A backup from the previous save is at {}.", bak.display())
            } else {
                String::new()
            };
            format!("{name} could not be parsed ({e}).{hint}")
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::Value::Null),
        Err(e) => Err(format!("{name} could not be read ({e}).")),
    }
}

#[tauri::command]
pub fn save_tracking(data: serde_json::Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    write_json_atomic_backed_up(tracking_path(), json)
}

fn schedules_path() -> PathBuf {
    config_dir().join("schedules.json")
}

/// Scheduled alerts (fire a page at a clock time or T-minus the service).
/// Opaque JSON: the schema lives in the frontend, which is also what evaluates
/// the schedule — it's the half that knows the Planning Center service times.
#[tauri::command]
pub fn load_schedules() -> Result<serde_json::Value, String> {
    read_json_strict(&schedules_path(), "schedules.json")
}

#[tauri::command]
pub fn save_schedules(data: serde_json::Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    write_json_atomic_backed_up(schedules_path(), json)
}

fn reports_path() -> PathBuf {
    config_dir().join("reports.json")
}

/// Saved service reports — append-only snapshots, deliberately kept in their
/// own file so nothing in the live tracking flow (Reset, a bucket switch, a
/// corrupt tracking.json) can take them with it.
#[tauri::command]
pub fn load_reports() -> Result<serde_json::Value, String> {
    read_json_strict(&reports_path(), "reports.json")
}

#[tauri::command]
pub fn save_reports(data: serde_json::Value) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    write_json_atomic_backed_up(reports_path(), json)
}

fn default_device_name() -> String {
    hostname().unwrap_or_else(|| "ProDeck".into())
}

fn hostname() -> Option<String> {
    std::env::var("HOSTNAME").ok().or_else(|| {
        std::process::Command::new("hostname")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
    })
}

/// Look for a whisper.cpp CLI binary in common locations so captions work
/// out of the box when the user has whisper.cpp installed.
fn detect_whisper_bin() -> Option<String> {
    let candidates = [
        "/opt/homebrew/bin/whisper-cli",
        "/usr/local/bin/whisper-cli",
        "/opt/homebrew/bin/whisper-cpp",
        "/usr/local/bin/whisper-cpp",
        "/opt/homebrew/bin/whisper",
        "/usr/local/bin/whisper",
    ];
    candidates
        .iter()
        .find(|p| std::path::Path::new(p).exists())
        .map(|p| p.to_string())
}

/// Find a whisper model in ProDeck's own data dir first (models/), then the
/// Homebrew share. No other app bundle is consulted — ProDeck stands alone.
fn detect_whisper_model() -> Option<String> {
    if let Some(own) = dirs::data_dir().map(|d| d.join("ProDeck/models/ggml-base.en.bin")) {
        if own.exists() {
            return own.to_str().map(|s| s.to_string());
        }
    }
    let candidates = ["/opt/homebrew/share/whisper-cpp/ggml-base.en.bin"];
    candidates
        .iter()
        .find(|p| std::path::Path::new(p).exists())
        .map(|p| p.to_string())
}

pub fn load() -> Settings {
    match std::fs::read_to_string(config_path()) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save(settings: &Settings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    write_json_atomic(config_path(), json)
}

#[tauri::command]
pub fn get_settings(state: tauri::State<'_, SettingsState>) -> Settings {
    state.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

#[tauri::command]
pub fn update_settings(
    settings: Settings,
    state: tauri::State<'_, SettingsState>,
) -> Result<(), String> {
    let to_save = {
        let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
        *s = settings;
        s.clone()
    };
    save(&to_save)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("prodeck-test-{tag}-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&p);
        p
    }

    // The bug this guards: a corrupt file that read as "no data" let the store
    // start empty and autosave that emptiness over every past service.
    #[test]
    fn corrupt_file_errors_instead_of_reading_as_empty() {
        let dir = tmpdir("corrupt");
        let path = dir.join("tracking.json");
        std::fs::write(&path, r#"{"85286763::210196414":{"a":{"actual":12"#).unwrap();
        let out = read_json_strict(&path, "tracking.json");
        assert!(out.is_err(), "corrupt file must not read as valid data");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_file_is_not_an_error() {
        let dir = tmpdir("missing");
        let out = read_json_strict(&dir.join("nope.json"), "nope.json").unwrap();
        assert!(out.is_null(), "a fresh install must start clean, not fail");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn valid_file_round_trips() {
        let dir = tmpdir("valid");
        let path = dir.join("tracking.json");
        write_json_atomic_backed_up(path.clone(), r#"{"k":{"item":{"actual":5}}}"#.into()).unwrap();
        let out = read_json_strict(&path, "tracking.json").unwrap();
        assert_eq!(out["k"]["item"]["actual"], 5);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // The backup must never be overwritten by an unparseable current file —
    // that would destroy the only good copy at the moment it's needed.
    #[test]
    fn backup_is_kept_and_never_holds_corrupt_data() {
        let dir = tmpdir("backup");
        let path = dir.join("tracking.json");
        let bak = path.with_extension("bak.json");

        write_json_atomic_backed_up(path.clone(), r#"{"good":1}"#.into()).unwrap();
        // Corrupt the live file, then write again. The backup refresh is
        // time-gated, but even when it does run it must reject this content.
        std::fs::write(&path, "{{{ not json").unwrap();
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        filetime_set(&bak, old);
        write_json_atomic_backed_up(path.clone(), r#"{"good":2}"#.into()).unwrap();

        if bak.exists() {
            let b = std::fs::read_to_string(&bak).unwrap();
            assert!(
                serde_json::from_str::<serde_json::Value>(&b).is_ok(),
                "backup must always be parseable, got: {b}"
            );
        }
        assert_eq!(
            read_json_strict(&path, "t").unwrap()["good"],
            2,
            "the new write must have landed"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    // Age the backup so the time gate opens, without pulling in a crate.
    fn filetime_set(path: &PathBuf, when: std::time::SystemTime) {
        if !path.exists() {
            return;
        }
        let secs = when
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = std::process::Command::new("touch")
            .arg("-t")
            .arg(fmt_touch(secs))
            .arg(path)
            .status();
    }

    fn fmt_touch(epoch_secs: u64) -> String {
        let out = std::process::Command::new("date")
            .args(["-r", &epoch_secs.to_string(), "+%Y%m%d%H%M.%S"])
            .output()
            .expect("date");
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }
}

/// Toggle one checklist item, booth-side.
///
/// Phones must never write whole data files (that's why `save_checklists` is
/// refused over the gateway — every browser holding its own copy meant
/// last-writer-wins clobbering). But a volunteer ticking their own list is a
/// legitimate, tiny mutation, so it gets a targeted command: the booth reads,
/// flips exactly one item, and writes. Returns the new state of that item.
#[tauri::command]
pub fn checklist_toggle(list_id: String, item_id: String) -> Result<bool, String> {
    let mut data = read_json_strict(&checklists_path(), "checklists.json")?;
    let lists = data
        .as_array_mut()
        .ok_or("checklists.json is not a list")?;
    let list = lists
        .iter_mut()
        .find(|l| l.get("id").and_then(|v| v.as_str()) == Some(list_id.as_str()))
        .ok_or("that checklist no longer exists")?;
    let items = list
        .get_mut("items")
        .and_then(|v| v.as_array_mut())
        .ok_or("that checklist has no items")?;
    let item = items
        .iter_mut()
        .find(|i| i.get("id").and_then(|v| v.as_str()) == Some(item_id.as_str()))
        .ok_or("that item no longer exists")?;
    // Section headers are labels, not steps. The phone hides their checkbox,
    // but that guard runs against the device's own copy — a phone holding a
    // stale list could still ask. The booth owns the truth, so it refuses here.
    if item.get("header").and_then(|v| v.as_bool()).unwrap_or(false) {
        return Err("that line is a section header, not a step".into());
    }
    let now = !item.get("done").and_then(|v| v.as_bool()).unwrap_or(false);
    item["done"] = serde_json::Value::Bool(now);
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    write_json_atomic_backed_up(checklists_path(), json)?;
    Ok(now)
}
