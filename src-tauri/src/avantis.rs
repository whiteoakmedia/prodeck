// Avantis console mirror — MIDI over TCP (port 51325), per Allen & Heath's
// "Avantis TCP/IP Protocol" (firmware V1.10). PHASE 1 IS READ-ONLY: the only
// bytes ProDeck ever sends are the documented SysEx *get* requests for
// channel names/colours. Mutes, fader moves, and scene recalls arrive on
// their own because the desk transmits every surface change to connected
// clients. No control message is ever written to the console from here.
//
// Channel addressing (base MIDI channel B, 1-based, desk maximum 12):
//   nibble B-1+0 = Inputs 1-64            (note 00-3F)
//   nibble B-1+1 = Mono/Stereo Groups     (00-27 / 40-53)
//   nibble B-1+2 = Mono/Stereo Aux        (00-27 / 40-53)
//   nibble B-1+3 = Mono/Stereo Matrix     (00-27 / 40-53)
//   nibble B-1+4 = FX/Mains/DCA/MuteGrp   (00-0B/10-1B/20-2B/30-32/36-45/46-4D)

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::ahmap::{self, DeskModel, SYSEX_HEADER};

#[derive(Default)]
pub struct AvantisInner {
    pub connected: bool,
    /// Which Allen & Heath console (and therefore which dialect + address map)
    /// the current connection speaks.
    pub model: DeskModel,
    /// 1-based scene number (bank*128 + program + 1).
    pub scene: Option<u32>,
    pub mutes: HashMap<String, bool>,
    /// Raw 0-127 fader values (dB = value/127*64 - 54, per the protocol table).
    pub faders: HashMap<String, u8>,
    pub names: HashMap<String, String>,
    pub colors: HashMap<String, u8>,
    /// Writer half of the live connection (a try_clone of the mirror's
    /// stream). Phase 2 control commands write through this; None = offline.
    pub writer: Option<TcpStream>,
    /// Base MIDI channel nibble the current connection was made with.
    pub base_nibble: u8,
    /// Desk-watchdog change buffer: everything the DESK reported changed
    /// (surface moves, other MIDI controllers) since the last flush. Writes
    /// made through ProDeck update the mirror first, so their echoes diff to
    /// no-change and never land here. Drained (or discarded, when disarmed)
    /// by spawn_watch_flush every 45 s.
    pub watch: Vec<WatchRec>,
    /// Human-readable recent watchdog lines, for the snapshot/UI.
    pub watch_log: std::collections::VecDeque<String>,
}

#[derive(Clone)]
pub struct WatchRec {
    pub kind: WatchKind,
    pub key: String,
    pub old: String,
    pub new: String,
}
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum WatchKind {
    Mute,
    Fader,
    Scene,
    Name,
}

pub fn fader_db(v: u8) -> String {
    let db = v as f32 / 127.0 * 64.0 - 54.0;
    if v == 0 { "-inf".into() } else { format!("{db:.1}") }
}

/// True for controls whose movement means SETUP changed rather than a mix
/// being mixed: FX sends and returns. Input/DCA/aux/main faders and mutes are
/// what an engineer legitimately rides all service — never alert on those.
fn is_setup_key(key: &str) -> bool {
    key.starts_with("fxs:")
        || key.starts_with("sfxs:")
        || key.starts_with("fxr:")
        || key.starts_with("ufxs:")
        || key.starts_with("ufxr:")
}

/// Record a desk-originated change. Only called when an OLD value existed —
/// the connect-time baseline sweep (None → value) must never read as
/// tampering. Consecutive moves of the same control coalesce in place so a
/// fader drag is one record, not forty.
fn watch_record(s: &mut AvantisInner, kind: WatchKind, key: &str, old: String, new: String) {
    if let Some(last) = s.watch.last_mut() {
        if last.kind == kind && last.key == key {
            last.new = new;
            return;
        }
    }
    if s.watch.len() >= 400 {
        return; // runaway guard; the flush drains every 45 s
    }
    s.watch.push(WatchRec { kind, key: key.to_string(), old, new });
}

pub type AvantisState = Arc<Mutex<AvantisInner>>;

pub fn snapshot(state: &AvantisState) -> Value {
    let s = state.lock().unwrap_or_else(|p| p.into_inner());
    json!({
        "connected": s.connected,
        "scene": s.scene,
        "mutes": s.mutes,
        "faders": s.faders,
        "names": s.names,
        "watchLog": s.watch_log.iter().rev().take(20).collect::<Vec<_>>(),
        "colors": s.colors,
        "model": s.model.id(),
        "namesSupported": s.model.has_names(),
        "maxScene": s.model.max_scene(),
    })
}

#[tauri::command]
pub fn avantis_state(state: tauri::State<'_, AvantisState>) -> Value {
    snapshot(state.inner())
}

/// Write raw bytes to the desk through the mirror's socket. Every control
/// command funnels through here; errors out cleanly when offline.
fn write_desk(state: &AvantisState, bytes: &[u8]) -> Result<(), String> {
    let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
    let Some(w) = s.writer.as_mut() else {
        return Err("not connected to the console".into());
    };
    w.write_all(bytes).map_err(|e| format!("desk write failed: {e}"))
}

// ---- Phase 2 control (admin-tier only; see web.rs dispatch) --------------

/// Mute or unmute one channel: Note On vel 7F/3F followed by Note On vel 00,
/// exactly as the protocol prescribes.
#[tauri::command]
pub fn avantis_set_mute(
    id: String,
    muted: bool,
    state: tauri::State<'_, AvantisState>,
    app: AppHandle,
) -> Result<(), String> {
    let st = state.inner().clone();
    let (base, model) = desk_cfg(&st);
    let bytes = ahmap::mute_bytes(model, base, &id, muted)
        .ok_or_else(|| format!("{id} is not a channel on the {}", model.label()))?;
    write_desk(&st, &bytes)?;
    // Optimistic local update; the desk's echo confirms/corrects it.
    {
        let mut s = st.lock().unwrap_or_else(|p| p.into_inner());
        s.mutes.insert(id, muted);
    }
    app.emit("avantis:state", snapshot(&st)).ok();
    Ok(())
}

/// Recall a scene (1-500): Bank Select + Program Change on the base channel.
#[tauri::command]
pub fn avantis_recall_scene(
    scene: u32,
    state: tauri::State<'_, AvantisState>,
    app: AppHandle,
) -> Result<(), String> {
    let st = state.inner().clone();
    let (base, model) = desk_cfg(&st);
    if !(1..=model.max_scene()).contains(&scene) {
        return Err(format!("scene must be 1-{} on the {}", model.max_scene(), model.label()));
    }
    write_desk(&st, &ahmap::scene_bytes(base, scene))?;
    {
        let mut s = st.lock().unwrap_or_else(|p| p.into_inner());
        s.scene = Some(scene);
    }
    app.emit("avantis:state", snapshot(&st)).ok();
    Ok(())
}

/// Rename one channel on the desk: SysEx op 0x03, up to 8 ASCII characters.
/// Used to stamp this week's vocalists onto their mic channels (and the
/// mirror channels that share the mic but process differently).
#[tauri::command]
pub fn avantis_set_name(
    id: String,
    name: String,
    state: tauri::State<'_, AvantisState>,
    app: AppHandle,
) -> Result<(), String> {
    let clean: String = name
        .chars()
        .filter(|c| (' '..='~').contains(c))
        .take(8)
        .collect();
    let st = state.inner().clone();
    let (base, model) = desk_cfg(&st);
    if !model.has_names() {
        return Err(format!("the {} has no channel-name messages in its MIDI protocol", model.label()));
    }
    let msg = ahmap::name_bytes(model, base, &id, &clean)
        .ok_or_else(|| format!("{id} is not a channel on the {}", model.label()))?;
    write_desk(&st, &msg)?;
    // The desk doesn't echo name sets — update the mirror locally.
    {
        let mut s = st.lock().unwrap_or_else(|p| p.into_inner());
        s.names.insert(id, clean);
    }
    app.emit("avantis:state", snapshot(&st)).ok();
    Ok(())
}

/// Set one fader (0-127 raw; dB = v/127*64 − 54): NRPN parameter 0x17.
#[tauri::command]
pub fn avantis_set_fader(
    id: String,
    value: u8,
    state: tauri::State<'_, AvantisState>,
    app: AppHandle,
) -> Result<(), String> {
    let v = value.min(0x7F);
    let st = state.inner().clone();
    let (base, model) = desk_cfg(&st);
    let bytes = ahmap::fader_bytes(model, base, &id, v)
        .ok_or_else(|| format!("{id} has no fader on the {}", model.label()))?;
    write_desk(&st, &bytes)?;
    {
        let mut s = st.lock().unwrap_or_else(|p| p.into_inner());
        s.faders.insert(id, v);
    }
    app.emit("avantis:state", snapshot(&st)).ok();
    Ok(())
}

fn key(kind: &str, idx: u8) -> String {
    format!("{kind}:{idx}")
}

/// (base nibble, model) of the current connection.
fn desk_cfg(st: &AvantisState) -> (u8, DeskModel) {
    let s = st.lock().unwrap_or_else(|p| p.into_inner());
    (s.base_nibble, s.model)
}

/// Human label for a channel key: a readable form of the address
/// ("FX Return 2", not "fxr:2").
pub fn pretty_key(key: &str) -> String {
    let (kind, idx) = key.split_once(':').unwrap_or((key, ""));
    match ahmap::pretty_kind(kind) {
        Some(word) => format!("{word} {idx}"),
        None => key.to_string(),
    }
}

/// Apply a desk-reported mute; returns true if the mirror changed. Watchdog
/// records only real changes to setup controls (never the connect baseline).
fn apply_mute(s: &mut AvantisInner, kk: String, muted: bool) -> bool {
    let old = s.mutes.insert(kk.clone(), muted);
    if old.is_some() && old != Some(muted) && is_setup_key(&kk) {
        watch_record(
            s,
            WatchKind::Mute,
            &kk,
            if old == Some(true) { "muted" } else { "open" }.into(),
            if muted { "muted" } else { "open" }.into(),
        );
    }
    old != Some(muted)
}

/// Apply a desk-reported fader value (ProDeck 0-127 scale).
fn apply_fader(s: &mut AvantisInner, kk: String, val: u8) -> bool {
    let old = s.faders.insert(kk.clone(), val);
    if let Some(o) = old {
        if o != val && is_setup_key(&kk) {
            watch_record(s, WatchKind::Fader, &kk, fader_db(o), fader_db(val));
        }
    }
    old != Some(val)
}

struct Parser {
    status: Option<u8>,
    data: Vec<u8>,
    sysex: Option<Vec<u8>>,
    /// Pending NRPN parameter per MIDI channel: (channel-select CC63, param CC62).
    nrpn: HashMap<u8, (Option<u8>, Option<u8>)>,
    /// Last Bank Select value per MIDI channel (for scene recall).
    bank: HashMap<u8, u8>,
    /// SQ only: pending coarse value (CC 06) per channel, completed by CC 26.
    vc: HashMap<u8, u8>,
    /// Note Ons that aren't mutes (softkey custom messages) — drained by the
    /// mirror loop, which emits them for the learn UI and fires page maps.
    softkeys: Vec<(u8, u8, u8)>, // (0-based channel, note, velocity)
}

impl Parser {
    fn new() -> Self {
        Self {
            status: None,
            data: Vec::new(),
            sysex: None,
            nrpn: HashMap::new(),
            bank: HashMap::new(),
            vc: HashMap::new(),
            softkeys: Vec::new(),
        }
    }

    /// Feed one byte; returns true when console state changed.
    fn feed(&mut self, b: u8, model: DeskModel, base_nibble: u8, st: &AvantisState) -> bool {
        if b >= 0xF8 {
            return false; // realtime — ignore, even mid-SysEx
        }
        if let Some(buf) = self.sysex.as_mut() {
            if b == 0xF7 {
                let msg = self.sysex.take().unwrap();
                return self.on_sysex(&msg, model, base_nibble, st);
            }
            if b >= 0x80 {
                self.sysex = None; // malformed — a status byte cancels SysEx
            } else {
                if buf.len() < 64 {
                    buf.push(b);
                }
                return false;
            }
        }
        if b == 0xF0 {
            self.sysex = Some(Vec::new());
            return false;
        }
        if b >= 0x80 {
            self.status = Some(b);
            self.data.clear();
            return false;
        }
        let Some(status) = self.status else { return false };
        self.data.push(b);
        let kind = status & 0xF0;
        let chan = status & 0x0F;
        let need = match kind {
            0xC0 | 0xD0 => 1,
            _ => 2,
        };
        if self.data.len() < need {
            return false;
        }
        let d: Vec<u8> = self.data.drain(..).collect();
        match kind {
            0x90 => {
                // Mute state. Velocity 0 and Note Off are ignored per spec.
                let (note, vel) = (d[0], d[1]);
                if vel == 0 {
                    return false;
                }
                if model.note_mutes() {
                    if let Some((k, i)) = ahmap::note_decode(model, base_nibble, chan, note) {
                        let muted = vel >= 0x40;
                        let mut s = st.lock().unwrap_or_else(|p| p.into_inner());
                        return apply_mute(&mut s, key(k, i), muted);
                    }
                }
                // Not addressable as a channel → a softkey's custom message.
                self.softkeys.push((chan, note, vel));
                false
            }
            0xB0 => {
                let (cc, val) = (d[0], d[1]);
                match cc {
                    0x00 => {
                        self.bank.insert(chan, val);
                        false
                    }
                    0x63 => {
                        self.nrpn.entry(chan).or_default().0 = Some(val);
                        false
                    }
                    0x62 => {
                        self.nrpn.entry(chan).or_default().1 = Some(val);
                        false
                    }
                    0x06 => {
                        if model == DeskModel::Sq {
                            // Coarse half of a 14-bit value; the fine half (CC 26) completes it.
                            self.vc.insert(chan, val);
                            return false;
                        }
                        let (sel, param) = self.nrpn.get(&chan).copied().unwrap_or((None, None));
                        if let (Some(note), Some(0x17)) = (sel, param) {
                            if let Some((k, i)) = ahmap::note_decode(model, base_nibble, chan, note) {
                                let mut s = st.lock().unwrap_or_else(|p| p.into_inner());
                                return apply_fader(&mut s, key(k, i), val);
                            }
                        }
                        false
                    }
                    0x26 if model == DeskModel::Sq => {
                        // SQ: everything is NRPN on the one channel. MSB/LSB name the
                        // parameter; 06/26 carry the value. Mutes are 06 00 / 26 01|00.
                        if chan != base_nibble {
                            return false; // the DAW-strip channel (base+1) is not the mixer
                        }
                        let (msb, lsb) = self.nrpn.get(&chan).copied().unwrap_or((None, None));
                        let (Some(msb), Some(lsb)) = (msb, lsb) else { return false };
                        let param = ((msb as u16) << 7) | lsb as u16;
                        let vc = self.vc.remove(&chan).unwrap_or(0);
                        if let Some((k, i)) = ahmap::sq_decode_mute(param) {
                            let mut s = st.lock().unwrap_or_else(|p| p.into_inner());
                            return apply_mute(&mut s, key(k, i), val != 0);
                        }
                        if let Some((k, i)) = ahmap::sq_decode_level(param) {
                            let v14 = ((vc as u16) << 7) | val as u16;
                            let v = ahmap::fader_u8_from_db(ahmap::sq_level_to_db(v14));
                            let mut s = st.lock().unwrap_or_else(|p| p.into_inner());
                            return apply_fader(&mut s, key(k, i), v);
                        }
                        false
                    }
                    _ => false,
                }
            }
            0xC0 => {
                // Scene recall — the desk transmits this on every recall.
                if chan == base_nibble {
                    let bank = *self.bank.get(&chan).unwrap_or(&0) as u32;
                    let scene = bank * 128 + d[0] as u32 + 1;
                    let mut s = st.lock().unwrap_or_else(|p| p.into_inner());
                    let old = s.scene.replace(scene);
                    if let Some(o) = old {
                        if o != scene {
                            watch_record(
                                &mut s,
                                WatchKind::Scene,
                                "scene",
                                o.to_string(),
                                scene.to_string(),
                            );
                        }
                    }
                    return old != Some(scene);
                }
                false
            }
            _ => false,
        }
    }

    fn on_sysex(&mut self, msg: &[u8], model: DeskModel, base_nibble: u8, st: &AvantisState) -> bool {
        // msg is the payload between F0 and F7. Expect our header (minus F0).
        if msg.len() < 10 || msg[..7] != SYSEX_HEADER[1..] {
            return false;
        }
        let chan = msg[7] & 0x0F;
        let op = msg[8];
        let note = msg[9];
        let Some((k, i)) = ahmap::note_decode(model, base_nibble, chan, note) else { return false };
        match op {
            0x02 => {
                // Name reply — an 8-byte field padded with NULs, so keep
                // printable ASCII only.
                let name: String = msg[10..]
                    .iter()
                    .filter(|&&b| (0x20..0x7F).contains(&b))
                    .map(|&b| b as char)
                    .collect::<String>()
                    .trim()
                    .to_string();
                let mut s = st.lock().unwrap_or_else(|p| p.into_inner());
                let kk = key(k, i);
                let old = s.names.insert(kk.clone(), name.clone());
                if let Some(o) = old {
                    if !o.is_empty() && o != name {
                        watch_record(&mut s, WatchKind::Name, &kk, o, name);
                    }
                }
                true
            }
            0x05 => {
                // Colour reply.
                if msg.len() > 10 {
                    let mut s = st.lock().unwrap_or_else(|p| p.into_inner());
                    s.colors.insert(key(k, i), msg[10]);
                    return true;
                }
                false
            }
            _ => false,
        }
    }
}

// ---- state cache -----------------------------------------------------
// The desk never announces current state, only changes — and this desk is
// run solid-state (saved, not recalled), so anything ProDeck has ever seen
// stays true across app restarts. Cache the mirror to disk so a relaunch
// starts knowing, instead of blind until every mute is touched again.

fn cache_path() -> std::path::PathBuf {
    let mut d = dirs::config_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    d.push("ProDeck");
    let _ = std::fs::create_dir_all(&d);
    d.push("avantis.json");
    d
}

fn load_cache(state: &AvantisState) {
    let Ok(txt) = std::fs::read_to_string(cache_path()) else { return };
    let Ok(v) = serde_json::from_str::<Value>(&txt) else { return };
    let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
    let take = |field: &str| -> HashMap<String, Value> {
        v.get(field)
            .and_then(|x| x.as_object())
            .map(|o| o.iter().map(|(k, val)| (k.clone(), val.clone())).collect())
            .unwrap_or_default()
    };
    for (k, val) in take("mutes") {
        if let Some(b) = val.as_bool() {
            s.mutes.entry(k).or_insert(b);
        }
    }
    for (k, val) in take("faders") {
        if let Some(n) = val.as_u64() {
            s.faders.entry(k).or_insert(n as u8);
        }
    }
    for (k, val) in take("names") {
        if let Some(t) = val.as_str() {
            s.names.entry(k).or_insert_with(|| t.to_string());
        }
    }
    for (k, val) in take("colors") {
        if let Some(n) = val.as_u64() {
            s.colors.entry(k).or_insert(n as u8);
        }
    }
}

fn save_cache(state: &AvantisState) {
    let json = {
        let s = state.lock().unwrap_or_else(|p| p.into_inner());
        json!({ "mutes": s.mutes, "faders": s.faders, "names": s.names, "colors": s.colors })
            .to_string()
    };
    let path = cache_path();
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, json).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

/// (enabled, host, base channel 1-based, model, port) — everything the mirror
/// needs to (re)connect. The base is clamped to what the chosen desk allows.
fn settings_tuple(app: &AppHandle) -> (bool, String, u8, DeskModel, u16) {
    let st = app.state::<crate::settings::SettingsState>();
    let s = st.lock().unwrap_or_else(|p| p.into_inner());
    let model = DeskModel::parse(&s.avantis_model);
    let port = if s.avantis_port == 0 { 51325 } else { s.avantis_port };
    (
        s.avantis_enabled,
        s.avantis_host.clone(),
        s.avantis_midi_base.clamp(1, model.max_base()),
        model,
        port,
    )
}

fn set_connected(app: &AppHandle, state: &AvantisState, up: bool) {
    let changed = {
        let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
        let was = s.connected;
        s.connected = up;
        if !up {
            // Keep mutes/faders: the desk is solid-state at this church (they
            // save, never recall), so last-known values stay the best guess
            // across a reconnect — live traffic corrects any drift.
            s.writer = None;
        }
        was != up
    };
    if changed {
        app.emit("avantis:status", json!({ "connected": up })).ok();
        app.emit("avantis:state", snapshot(state)).ok();
    }
}

/// Fire the configured page for a softkey press, at most once per key per
/// 1.5 s (a softkey transmits press AND release, and nervous fingers double-tap).
fn fire_softkeys(
    app: &AppHandle,
    pressed: Vec<(u8, u8, u8)>,
    last_fire: &mut HashMap<(u8, u8), Instant>,
) {
    for (chan, note, vel) in pressed {
        app.emit(
            "avantis:midi",
            json!({ "channel": chan + 1, "note": note, "velocity": vel }),
        )
        .ok();
        let maps = {
            let st = app.state::<crate::settings::SettingsState>();
            let s = st.lock().unwrap_or_else(|p| p.into_inner());
            s.avantis_softkeys.clone()
        };
        for m in maps {
            if m.midi_channel != chan + 1 || m.note != note || m.body.trim().is_empty() {
                continue;
            }
            if let Some(t) = last_fire.get(&(chan, note)) {
                if t.elapsed() < Duration::from_millis(1500) {
                    continue;
                }
            }
            last_fire.insert((chan, note), Instant::now());
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            // Empty = "everyone" — hand that to send_core unchanged so it
            // resolves to everyone IN THE BUILDING (roster ∩ checked in), the
            // same rule every other broadcast follows. Expanding it here to
            // every approved id paged people at home.
            let recipients = m.recipients.clone();
            let pages = app.state::<crate::pages::PagesState>().inner().clone();
            let _ = crate::pages::send_core(
                app,
                &pages,
                &identity,
                "FOH Desk".into(),
                m.body.clone(),
                recipients,
                true,
            );
        }
    }
}

pub fn spawn_mirror(app: AppHandle) {
    std::thread::spawn(move || {
        let state: AvantisState = app.state::<AvantisState>().inner().clone();
        let mut softkey_fired: HashMap<(u8, u8), Instant> = HashMap::new();
        load_cache(&state);
        let mut last_save = Instant::now();
        loop {
            let (enabled, host, base, model, port) = settings_tuple(&app);
            if !enabled || host.is_empty() {
                set_connected(&app, &state, false);
                std::thread::sleep(Duration::from_secs(3));
                continue;
            }
            let base_nibble = base - 1;
            let stream = TcpStream::connect((host.as_str(), port));
            let Ok(mut stream) = stream else {
                set_connected(&app, &state, false);
                std::thread::sleep(Duration::from_secs(5));
                continue;
            };
            stream.set_read_timeout(Some(Duration::from_millis(1000))).ok();
            {
                let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
                s.writer = stream.try_clone().ok();
                s.base_nibble = base_nibble;
                s.model = model;
            }
            set_connected(&app, &state, true);

            // Connect-time queries (names/colours; on dLive and SQ also the
            // current mutes and levels), in gentle chunks.
            let q = ahmap::query_bytes(model, base_nibble);
            for chunk in q.chunks(96) {
                if stream.write_all(chunk).is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(15));
            }

            let mut parser = Parser::new();
            let mut buf = [0u8; 1024];
            let mut dirty = false;
            let mut last_emit = Instant::now();
            let mut last_cfg_check = Instant::now();
            // A busy desk occasionally drops a few replies from the initial
            // name burst — one full re-ask a few seconds in closes the gap
            // (replies are idempotent and the whole burst is ~2 KB).
            let connected_at = Instant::now();
            let mut requeried = false;
            loop {
                match stream.read(&mut buf) {
                    Ok(0) => break, // desk closed the connection
                    Ok(n) => {
                        for &b in &buf[..n] {
                            dirty |= parser.feed(b, model, base_nibble, &state);
                        }
                        if !parser.softkeys.is_empty() {
                            let pressed = std::mem::take(&mut parser.softkeys);
                            fire_softkeys(&app, pressed, &mut softkey_fired);
                        }
                    }
                    Err(e)
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            || e.kind() == std::io::ErrorKind::TimedOut => {}
                    Err(_) => break,
                }
                if dirty && last_emit.elapsed() >= Duration::from_millis(250) {
                    app.emit("avantis:state", snapshot(&state)).ok();
                    dirty = false;
                    last_emit = Instant::now();
                    if last_save.elapsed() >= Duration::from_secs(5) {
                        save_cache(&state);
                        last_save = Instant::now();
                    }
                }
                if !requeried && connected_at.elapsed() >= Duration::from_secs(4) {
                    requeried = true;
                    for chunk in ahmap::query_bytes(model, base_nibble).chunks(96) {
                        if stream.write_all(chunk).is_err() {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(15));
                    }
                }
                if last_cfg_check.elapsed() >= Duration::from_secs(2) {
                    last_cfg_check = Instant::now();
                    let now = settings_tuple(&app);
                    if now != (enabled, host.clone(), base, model, port) {
                        break; // settings changed — reconnect with new config
                    }
                }
            }
            set_connected(&app, &state, false);
            save_cache(&state);
            std::thread::sleep(Duration::from_secs(3));
        }
    });
}


/// Desk watchdog: every 45 s, drain the change buffer and page the ONE
/// configured person with what moved. Disarmed (or no recipient) = the buffer
/// is discarded, so Sunday mixing never builds a backlog that pages the
/// moment someone re-arms it. The recipient is paged BY ID — explicit
/// recipients bypass the in-building broadcast filter on purpose: a tamper
/// alert matters most when the owner is NOT in the building.
pub fn spawn_watch_flush(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut tick: u32 = 0;
        loop {
            tokio::time::sleep(Duration::from_secs(45)).await;
            tick = tick.wrapping_add(1);
            let (armed, user) = {
                let st = app.state::<crate::settings::SettingsState>();
                let s = st.lock().unwrap_or_else(|p| p.into_inner());
                (s.avantis_watch_armed, s.avantis_watch_user.clone())
            };
            // Every ~5 min while armed, re-query every channel name. An FX
            // swap renames its return ("Hall 480" → "Tap Delay"); re-polling
            // catches that even when the desk doesn't push rename events. The
            // replies flow through the normal parser, whose name tap diffs
            // old → new and records the change.
            // (On SQ there are no names to re-ask for; its query set is mutes +
            // levels, which the live stream already keeps current — skip.)
            if armed && tick % 7 == 0 {
                // Clone the writer and drop the lock BEFORE the socket write: a
                // multi-KB blocking write under the state mutex would stall the
                // mirror's parser and every snapshot for the duration.
                let (writer, q) = {
                    let st = app.state::<AvantisState>().inner().lock().unwrap_or_else(|p| p.into_inner());
                    if !st.model.has_names() {
                        (None, Vec::new())
                    } else {
                        (
                            st.writer.as_ref().and_then(|w| w.try_clone().ok()),
                            ahmap::query_bytes(st.model, st.base_nibble),
                        )
                    }
                };
                if let Some(mut w) = writer {
                    for chunk in q.chunks(96) {
                        if w.write_all(chunk).is_err() {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(15));
                    }
                }
            }
            let state = app.state::<AvantisState>();
            let (recs, labels): (Vec<WatchRec>, HashMap<String, String>) = {
                let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
                if s.watch.is_empty() {
                    continue;
                }
                if !armed || user.trim().is_empty() {
                    s.watch.clear();
                    continue;
                }
                (std::mem::take(&mut s.watch), s.names.clone())
            };

            // Coalesce: one line per control, first old → last new. A control
            // moved and returned to its original value still gets a line —
            // "touched" is exactly what a tamper watchdog exists to report.
            let mut order: Vec<(WatchKind, String)> = Vec::new();
            let mut agg: HashMap<(WatchKind, String), (String, String)> = HashMap::new();
            for r in recs {
                let k = (r.kind, r.key.clone());
                match agg.get_mut(&k) {
                    Some(e) => e.1 = r.new,
                    None => {
                        order.push(k.clone());
                        agg.insert(k, (r.old, r.new));
                    }
                }
            }
            let label = |key: &str| labels.get(key).cloned().filter(|n| !n.is_empty()).unwrap_or_else(|| pretty_key(key));
            let lines: Vec<String> = order
                .iter()
                .map(|(kind, key)| {
                    let (old, new) = agg.get(&(*kind, key.clone())).cloned().unwrap_or_default();
                    match kind {
                        WatchKind::Mute => format!("{} {}", label(key), new),
                        WatchKind::Fader if old == new => format!("{} fader touched ({} dB)", label(key), new),
                        WatchKind::Fader => format!("{} fader {}→{} dB", label(key), old, new),
                        WatchKind::Scene => format!("scene {}→{}", old, new),
                        WatchKind::Name => format!("{} renamed to {}", old, new),
                    }
                })
                .collect();

            // Log for the snapshot, then fit what we can into one page body.
            {
                let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
                for l in &lines {
                    if s.watch_log.len() >= 100 {
                        s.watch_log.pop_front();
                    }
                    s.watch_log.push_back(l.clone());
                }
            }
            let mut body = String::from("Desk changed: ");
            let mut used = 0usize;
            for (i, l) in lines.iter().enumerate() {
                let sep = if i == 0 { "" } else { "; " };
                if body.len() + sep.len() + l.len() > 210 {
                    body.push_str(&format!(" (+{} more)", lines.len() - used));
                    break;
                }
                body.push_str(sep);
                body.push_str(l);
                used += 1;
            }

            let pages = app.state::<crate::pages::PagesState>().inner().clone();
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            if let Err(e) = crate::pages::send_core(
                &app,
                &pages,
                &identity,
                "Desk watchdog".into(),
                body,
                vec![user],
                true,
            ) {
                // e.g. the configured user was un-approved: don't lose the
                // alert silently.
                crate::diag::log(format!("[avantis] watchdog page failed: {e}"));
            }
        }
    });
}

#[cfg(test)]
mod parser_tests {
    use super::*;

    fn fresh() -> AvantisState {
        Arc::new(Mutex::new(AvantisInner::default()))
    }
    fn feed_all(p: &mut Parser, bytes: &[u8], model: DeskModel, base: u8, st: &AvantisState) -> bool {
        bytes.iter().fold(false, |acc, &b| p.feed(b, model, base, st) | acc)
    }

    #[test]
    fn sq_stream_mutes_and_levels_land_in_the_mirror() {
        let st = fresh();
        let mut p = Parser::new();
        // Issue 5 example: "Ip1, Mute On, Ch1  B0 63 00 B0 62 00 B0 06 00 B0 26 01"
        assert!(feed_all(&mut p, &[0xB0, 0x63, 0x00, 0xB0, 0x62, 0x00, 0xB0, 0x06, 0x00, 0xB0, 0x26, 0x01], DeskModel::Sq, 0, &st));
        // "Mute Grp 4, Mute On, Ch7" would be on base 6 — on base 0 it is ignored (wrong channel).
        assert!(!feed_all(&mut p, &[0xB6, 0x63, 0x04, 0xB6, 0x62, 0x03, 0xB6, 0x06, 0x00, 0xB6, 0x26, 0x01], DeskModel::Sq, 0, &st));
        // "Ip1 to LR, 0dB  B0 63 40 B0 62 00 B0 06 76 B0 26 5C" → fader on ProDeck's scale at 0 dB.
        assert!(feed_all(&mut p, &[0xB0, 0x63, 0x40, 0xB0, 0x62, 0x00, 0xB0, 0x06, 0x76, 0xB0, 0x26, 0x5C], DeskModel::Sq, 0, &st));
        // LR master level -20 dB (table: 64 16).
        assert!(feed_all(&mut p, &[0xB0, 0x63, 0x4F, 0xB0, 0x62, 0x00, 0xB0, 0x06, 0x64, 0xB0, 0x26, 0x16], DeskModel::Sq, 0, &st));
        let s = st.lock().unwrap();
        assert_eq!(s.mutes.get("input:1"), Some(&true));
        assert_eq!(s.mutes.get("mgrp:4"), None);
        // SQ's 14-bit levels land on ProDeck's 0-127 scale (½ dB steps), so
        // compare within the quantisation, not to the exact table dB.
        let db = |k: &str| fader_db(*s.faders.get(k).unwrap()).parse::<f32>().unwrap();
        assert!((db("input:1") - 0.0).abs() < 0.5, "input:1 = {}", db("input:1"));
        assert!((db("main:1") + 20.0).abs() < 0.5, "main:1 = {}", db("main:1"));
        // A Note On on SQ is never a mute — it is a softkey.
        drop(s);
        assert!(!feed_all(&mut p, &[0x90, 0x30, 0x7F], DeskModel::Sq, 0, &st));
        assert_eq!(p.softkeys, vec![(0, 0x30, 0x7F)]);
        assert_eq!(st.lock().unwrap().mutes.len(), 1);
    }

    #[test]
    fn dlive_stream_uses_its_own_address_map() {
        let st = fresh();
        let mut p = Parser::new();
        // dLive V2.0: base channel 12 → 9B; DCA 17 is note 46 on N+4 (= channel 16, 9F).
        assert!(feed_all(&mut p, &[0x9B, 0x7F, 0x7F, 0x9B, 0x7F, 0x00], DeskModel::DLive, 0x0B, &st));
        assert!(feed_all(&mut p, &[0x9F, 0x46, 0x7F], DeskModel::DLive, 0x0B, &st));
        // Fader on input 128: BB 63 7F, BB 62 17, BB 06 40
        assert!(feed_all(&mut p, &[0xBB, 0x63, 0x7F, 0xBB, 0x62, 0x17, 0xBB, 0x06, 0x40], DeskModel::DLive, 0x0B, &st));
        let s = st.lock().unwrap();
        assert_eq!(s.mutes.get("input:128"), Some(&true));
        assert_eq!(s.mutes.get("dca:17"), Some(&true)); // on Avantis this same note is mgrp:1
        assert_eq!(s.faders.get("input:128"), Some(&0x40));
        assert!(p.softkeys.is_empty());
    }

    #[test]
    fn avantis_stream_unchanged() {
        let st = fresh();
        let mut p = Parser::new();
        // Same bytes as the dLive DCA-17 test: on an Avantis, note 46 on N+4 is Mute Group 1.
        assert!(feed_all(&mut p, &[0x9F, 0x46, 0x7F], DeskModel::Avantis, 0x0B, &st));
        // Note 7F on the input channel is out of range on a 64-input Avantis → softkey.
        assert!(!feed_all(&mut p, &[0x9B, 0x7F, 0x7F], DeskModel::Avantis, 0x0B, &st));
        let s = st.lock().unwrap();
        assert_eq!(s.mutes.get("mgrp:1"), Some(&true));
        assert_eq!(s.mutes.get("input:128"), None);
        assert_eq!(p.softkeys, vec![(0x0B, 0x7F, 0x7F)]);
    }
}
