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

const PORT: u16 = 51325;
const SYSEX_HEADER: [u8; 8] = [0xF0, 0x00, 0x00, 0x1A, 0x50, 0x10, 0x01, 0x00];

#[derive(Default)]
pub struct AvantisInner {
    pub connected: bool,
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
    key.starts_with("fxs:") || key.starts_with("sfxs:") || key.starts_with("fxr:")
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
        return Err("not connected to the Avantis".into());
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
    let base = { st.lock().unwrap_or_else(|p| p.into_inner()).base_nibble };
    let (chan, note) = encode(base, &id).ok_or("unknown channel id")?;
    let status = 0x90 | chan;
    let vel = if muted { 0x7F } else { 0x3F };
    write_desk(&st, &[status, note, vel, status, note, 0x00])?;
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
    if !(1..=500).contains(&scene) {
        return Err("scene must be 1-500".into());
    }
    let st = state.inner().clone();
    let base = { st.lock().unwrap_or_else(|p| p.into_inner()).base_nibble };
    let z = scene - 1;
    let bank = (z / 128) as u8;
    let ss = (z % 128) as u8;
    write_desk(&st, &[0xB0 | base, 0x00, bank, 0xC0 | base, ss])?;
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
    let base = { st.lock().unwrap_or_else(|p| p.into_inner()).base_nibble };
    let (chan, note) = encode(base, &id).ok_or("unknown channel id")?;
    let mut msg = Vec::with_capacity(20);
    msg.extend_from_slice(&SYSEX_HEADER);
    msg.push(chan);
    msg.push(0x03);
    msg.push(note);
    msg.extend(clean.bytes());
    msg.push(0xF7);
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
    let base = { st.lock().unwrap_or_else(|p| p.into_inner()).base_nibble };
    let (chan, note) = encode(base, &id).ok_or("unknown channel id")?;
    let status = 0xB0 | chan;
    write_desk(&st, &[status, 0x63, note, status, 0x62, 0x17, status, 0x06, v])?;
    {
        let mut s = st.lock().unwrap_or_else(|p| p.into_inner());
        s.faders.insert(id, v);
    }
    app.emit("avantis:state", snapshot(&st)).ok();
    Ok(())
}

/// Inverse of `decode`: "kind:idx" → (MIDI channel nibble, note number).
fn encode(base_nibble: u8, id: &str) -> Option<(u8, u8)> {
    let (kind, idx) = id.split_once(':')?;
    let i: u8 = idx.parse().ok()?;
    if i == 0 {
        return None;
    }
    let z = i - 1; // 0-based
    match kind {
        "input" if i <= 64 => Some((base_nibble, z)),
        "grp" if i <= 40 => Some((base_nibble + 1, z)),
        "sgrp" if i <= 20 => Some((base_nibble + 1, 0x40 + z)),
        "aux" if i <= 40 => Some((base_nibble + 2, z)),
        "saux" if i <= 20 => Some((base_nibble + 2, 0x40 + z)),
        "mtx" if i <= 40 => Some((base_nibble + 3, z)),
        "smtx" if i <= 20 => Some((base_nibble + 3, 0x40 + z)),
        "fxs" if i <= 12 => Some((base_nibble + 4, z)),
        "sfxs" if i <= 12 => Some((base_nibble + 4, 0x10 + z)),
        "fxr" if i <= 12 => Some((base_nibble + 4, 0x20 + z)),
        "main" if i <= 3 => Some((base_nibble + 4, 0x30 + z)),
        "dca" if i <= 16 => Some((base_nibble + 4, 0x36 + z)),
        "mgrp" if i <= 8 => Some((base_nibble + 4, 0x46 + z)),
        _ => None,
    }
}

/// (kind, 1-based index) for a MIDI channel nibble + note, or None.
fn decode(base_nibble: u8, chan: u8, note: u8) -> Option<(&'static str, u8)> {
    let off = chan.checked_sub(base_nibble)?;
    match off {
        0 if note <= 0x3F => Some(("input", note + 1)),
        1 if note <= 0x27 => Some(("grp", note + 1)),
        1 if (0x40..=0x53).contains(&note) => Some(("sgrp", note - 0x40 + 1)),
        2 if note <= 0x27 => Some(("aux", note + 1)),
        2 if (0x40..=0x53).contains(&note) => Some(("saux", note - 0x40 + 1)),
        3 if note <= 0x27 => Some(("mtx", note + 1)),
        3 if (0x40..=0x53).contains(&note) => Some(("smtx", note - 0x40 + 1)),
        4 if note <= 0x0B => Some(("fxs", note + 1)),
        4 if (0x10..=0x1B).contains(&note) => Some(("sfxs", note - 0x10 + 1)),
        4 if (0x20..=0x2B).contains(&note) => Some(("fxr", note - 0x20 + 1)),
        4 if (0x30..=0x32).contains(&note) => Some(("main", note - 0x30 + 1)),
        4 if (0x36..=0x45).contains(&note) => Some(("dca", note - 0x36 + 1)),
        4 if (0x46..=0x4D).contains(&note) => Some(("mgrp", note - 0x46 + 1)),
        _ => None,
    }
}

fn key(kind: &str, idx: u8) -> String {
    format!("{kind}:{idx}")
}

/// The read-only name+colour queries sent once per connection. Inputs, DCAs
/// and Mains cover the volunteer-facing surfaces; everything else can wait.
fn query_bytes(base_nibble: u8) -> Vec<u8> {
    let mut out = Vec::new();
    let mut get = |chan: u8, note: u8| {
        for op in [0x01u8, 0x04u8] {
            out.extend_from_slice(&SYSEX_HEADER);
            out.push(chan); // 0N — absolute MIDI channel nibble as a byte
            out.push(op); // 01 = get name, 04 = get colour
            out.push(note);
            out.push(0xF7);
        }
    };
    for n in 0..=0x3F {
        get(base_nibble, n); // inputs 1-64
    }
    for n in 0x36..=0x45 {
        get(base_nibble + 4, n); // DCA 1-16
    }
    for n in 0x30..=0x32 {
        get(base_nibble + 4, n); // Mains 1-3
    }
    for n in 0x46..=0x4D {
        get(base_nibble + 4, n); // Mute Groups 1-8 — the widget's big toggles
    }
    // FX sends + returns, so a desk-watchdog line reads "Vocal Verb muted"
    // rather than "fxs:3 muted".
    for n in 0x00..=0x0B {
        get(base_nibble + 4, n); // FX sends 1-12
    }
    for n in 0x10..=0x1B {
        get(base_nibble + 4, n); // stereo FX sends 1-12
    }
    for n in 0x20..=0x2B {
        get(base_nibble + 4, n); // FX returns 1-12
    }
    out
}

/// Human label for a channel key: the desk name when known, else a readable
/// form of the address ("FX Return 2", not "fxr:2").
pub fn pretty_key(key: &str) -> String {
    let (kind, idx) = key.split_once(':').unwrap_or((key, ""));
    let word = match kind {
        "input" => "Ch",
        "grp" => "Group",
        "sgrp" => "Group(st)",
        "aux" => "Aux",
        "saux" => "Aux(st)",
        "mtx" => "Matrix",
        "smtx" => "Matrix(st)",
        "fxs" => "FX Send",
        "sfxs" => "FX Send(st)",
        "fxr" => "FX Return",
        "main" => "Main",
        "dca" => "DCA",
        "mgrp" => "Mute Grp",
        _ => return key.to_string(),
    };
    format!("{word} {idx}")
}

struct Parser {
    status: Option<u8>,
    data: Vec<u8>,
    sysex: Option<Vec<u8>>,
    /// Pending NRPN parameter per MIDI channel: (channel-select CC63, param CC62).
    nrpn: HashMap<u8, (Option<u8>, Option<u8>)>,
    /// Last Bank Select value per MIDI channel (for scene recall).
    bank: HashMap<u8, u8>,
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
            softkeys: Vec::new(),
        }
    }

    /// Feed one byte; returns true when console state changed.
    fn feed(&mut self, b: u8, base_nibble: u8, st: &AvantisState) -> bool {
        if b >= 0xF8 {
            return false; // realtime — ignore, even mid-SysEx
        }
        if let Some(buf) = self.sysex.as_mut() {
            if b == 0xF7 {
                let msg = self.sysex.take().unwrap();
                return self.on_sysex(&msg, base_nibble, st);
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
                if let Some((k, i)) = decode(base_nibble, chan, note) {
                    let muted = vel >= 0x40;
                    let mut s = st.lock().unwrap_or_else(|p| p.into_inner());
                    let kk = key(k, i);
                    let old = s.mutes.insert(kk.clone(), muted);
                    if old.is_some() && old != Some(muted) && is_setup_key(&kk) {
                        watch_record(
                            &mut s,
                            WatchKind::Mute,
                            &kk,
                            if old == Some(true) { "muted" } else { "open" }.into(),
                            if muted { "muted" } else { "open" }.into(),
                        );
                    }
                    return old != Some(muted);
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
                        let (sel, param) = self.nrpn.get(&chan).copied().unwrap_or((None, None));
                        if let (Some(note), Some(0x17)) = (sel, param) {
                            if let Some((k, i)) = decode(base_nibble, chan, note) {
                                let mut s = st.lock().unwrap_or_else(|p| p.into_inner());
                                let kk = key(k, i);
                                let old = s.faders.insert(kk.clone(), val);
                                if let Some(o) = old {
                                    if o != val && is_setup_key(&kk) {
                                        watch_record(
                                            &mut s,
                                            WatchKind::Fader,
                                            &kk,
                                            fader_db(o),
                                            fader_db(val),
                                        );
                                    }
                                }
                                return old != Some(val);
                            }
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

    fn on_sysex(&mut self, msg: &[u8], base_nibble: u8, st: &AvantisState) -> bool {
        // msg is the payload between F0 and F7. Expect our header (minus F0).
        if msg.len() < 10 || msg[..7] != SYSEX_HEADER[1..] {
            return false;
        }
        let chan = msg[7] & 0x0F;
        let op = msg[8];
        let note = msg[9];
        let Some((k, i)) = decode(base_nibble, chan, note) else { return false };
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

fn settings_tuple(app: &AppHandle) -> (bool, String, u8) {
    let st = app.state::<crate::settings::SettingsState>();
    let s = st.lock().unwrap_or_else(|p| p.into_inner());
    (s.avantis_enabled, s.avantis_host.clone(), s.avantis_midi_base.clamp(1, 12))
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
            let recipients = if m.recipients.is_empty() {
                crate::identity::approved_users(&identity)
                    .into_iter()
                    .map(|(id, _)| id)
                    .collect()
            } else {
                m.recipients.clone()
            };
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
            let (enabled, host, base) = settings_tuple(&app);
            if !enabled || host.is_empty() {
                set_connected(&app, &state, false);
                std::thread::sleep(Duration::from_secs(3));
                continue;
            }
            let base_nibble = base - 1;
            let stream = TcpStream::connect((host.as_str(), PORT));
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
            }
            set_connected(&app, &state, true);

            // Read-only name/colour queries, in gentle chunks.
            let q = query_bytes(base_nibble);
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
                            dirty |= parser.feed(b, base_nibble, &state);
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
                    for chunk in query_bytes(base_nibble).chunks(96) {
                        if stream.write_all(chunk).is_err() {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(15));
                    }
                }
                if last_cfg_check.elapsed() >= Duration::from_secs(2) {
                    last_cfg_check = Instant::now();
                    let now = settings_tuple(&app);
                    if now != (enabled, host.clone(), base) {
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
            if armed && tick % 7 == 0 {
                let mut st = app.state::<AvantisState>().inner().lock().unwrap_or_else(|p| p.into_inner());
                let nib = st.base_nibble;
                let q = query_bytes(nib);
                if let Some(w) = st.writer.as_mut() {
                    let _ = w.write_all(&q);
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
            let _ = crate::pages::send_core(
                &app,
                &pages,
                &identity,
                "Desk watchdog".into(),
                body,
                vec![user],
                true,
            );
        }
    });
}
