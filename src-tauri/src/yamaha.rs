//! Yamaha CL / QL / TF, over Yamaha's Remote Control Protocol (RCP).
//!
//! Like x32.rs this is a different transport from the A&H desks but it fills
//! the SAME mirror state with the SAME channel keys, so the channel wall, the
//! dashboards and the desk watchdog work unchanged.
//!
//! READ ONLY. The only lines ProDeck ever sends are reads: `devinfo`, `get`,
//! `sscurrent_ex`, `ssinfo_ex` and a `devstatus` heartbeat. The control
//! commands in avantis.rs refuse a Yamaha desk before reaching here.
//!
//! Protocol (no real desk was available; everything below was checked against
//! the parameter tables and parser of the MIT licensed Bitfocus Companion
//! module `companion-module-yamaha-rcp`, v3.5):
//!   * Plain text over TCP port 49280, one command per line, `\n` terminated.
//!   * `devinfo productname` -> `OK devinfo productname "QL5"`.
//!   * `get MIXER:Current/InCh/Fader/Level 0 0` -> `OK get ... 0 0 -1000`.
//!     Channel index (X) is 0 based; Y is 0 here. Levels are 0.01 dB steps,
//!     -32768 is -inf, +10.00 dB is the top.
//!   * `.../Fader/On` is 1 when the channel is ON, i.e. NOT muted. Inverted
//!     from how ProDeck stores it. Mute groups (`MuteMaster/On`) are not:
//!     1 means the group is muting.
//!   * Names are quoted strings: `OK get .../Label/Name 0 0 "Pastor"`.
//!   * The desk pushes `NOTIFY set <addr> <x> <y> <value> "<text>"` to every
//!     connected client when anything changes on the surface.
//!   * Scenes: CL/QL `sscurrent_ex MIXER:Lib/Scene` -> `OK sscurrent_ex
//!     MIXER:Lib/Scene 12`; TF has two banks, `scene_a` and `scene_b`. A
//!     recall arrives as `NOTIFY sscurrent_ex ...`; `ssinfo_ex` gives its name.
//!     RIVAGE PM and DM7 number scenes as text ("1.00") with different
//!     commands, so they are not claimed as supported.

use crate::ahmap::{self, DeskModel};
use crate::avantis::{apply_fader, apply_mute, snapshot, AvantisInner, AvantisState};
use serde_json::json;
use std::collections::VecDeque;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// RCP's port. Fixed in the console firmware.
pub const PORT: u16 = 49280;
/// What a control command says for a Yamaha desk.
pub const READ_ONLY: &str = "Control isn't available for Yamaha desks yet. ProDeck mirrors them read only.";

/// Delay between queued reads. The Companion module paces at 5 ms; a desk
/// that is sent hundreds of lines at once can drop some.
const SEND_GAP_MS: u64 = 4;
/// Heartbeat: a harmless read every 10 s so a dead link shows up.
const BEAT_SECS: u64 = 10;
/// Silence longer than this means the desk is gone.
const SILENT_SECS: u64 = 25;

// ---- which desk ---------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Family {
    /// CL1/3/5 and QL1/5: one scene list, `MIXER:Lib/Scene`.
    ClQl,
    /// TF1/3/5 and TF-RACK: two scene banks, `scene_a` / `scene_b`.
    Tf,
    /// Answered RCP but isn't a model we have tables for (RIVAGE PM, DM7, DM3
    /// and so on). Mirrored on a best effort CL style map; not advertised.
    Other,
}

/// Channel counts for one model, from the Companion parameter tables and the
/// models' published channel counts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Profile {
    pub product: String,
    pub family: Family,
    /// Mono input channels (`InCh`).
    pub inputs: u16,
    /// Stereo input channels (`StInCh`), each side counted, as RCP does.
    pub st_inputs: u16,
    /// Mix buses (`Mix`), shown in ProDeck as aux.
    pub mixes: u16,
    /// Matrices (`Mtrx`). The TF has none.
    pub matrices: u16,
    pub dcas: u16,
    /// Mute groups (`MuteMaster`).
    pub mute_groups: u16,
}

/// Size the mirror from `devinfo productname`.
pub fn profile_for(product: &str) -> Profile {
    let p: String = product
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_uppercase();
    let mk = |family, inputs, st_inputs, mixes, matrices, dcas, mute_groups| Profile {
        product: product.trim().to_string(),
        family,
        inputs,
        st_inputs,
        mixes,
        matrices,
        dcas,
        mute_groups,
    };
    use Family::*;
    if p.starts_with("CL5") {
        mk(ClQl, 72, 16, 24, 8, 16, 8)
    } else if p.starts_with("CL3") {
        mk(ClQl, 64, 16, 24, 8, 16, 8)
    } else if p.starts_with("CL1") {
        mk(ClQl, 48, 16, 24, 8, 16, 8)
    } else if p.starts_with("QL5") {
        mk(ClQl, 64, 16, 16, 8, 16, 8)
    } else if p.starts_with("QL1") {
        mk(ClQl, 32, 16, 16, 8, 16, 8)
    } else if p.starts_with("TF") {
        // TF1, TF3, TF5 and TF-RACK share one mixing engine: 40 mono, 4
        // stereo/return channels, 20 aux, 8 DCA, 6 mute groups, no matrix.
        mk(Tf, 40, 4, 20, 0, 8, 6)
    } else {
        // Largest CL map: anything that doesn't exist on the desk just
        // answers with an error, which the parser ignores.
        mk(Other, 72, 16, 24, 8, 16, 8)
    }
}

impl Profile {
    /// Every read the mirror makes on connect and after a scene recall.
    pub fn queries(&self) -> Vec<String> {
        let mut v = Vec::new();
        let mut add = |kind: &str, n: u16| {
            for x in 0..n {
                v.push(format!("get MIXER:Current/{kind}/Label/Name {x} 0"));
                v.push(format!("get MIXER:Current/{kind}/Fader/On {x} 0"));
                v.push(format!("get MIXER:Current/{kind}/Fader/Level {x} 0"));
            }
        };
        add("InCh", self.inputs);
        add("StInCh", self.st_inputs);
        add("Mix", self.mixes);
        add("Mtrx", self.matrices);
        add("DCA", self.dcas);
        match self.family {
            // St 0 = stereo L, 1 = stereo R (linked), 2 = mono on CL/QL.
            Family::ClQl | Family::Other => {
                for x in [0, 2] {
                    v.push(format!("get MIXER:Current/St/Label/Name {x} 0"));
                    v.push(format!("get MIXER:Current/St/Fader/On {x} 0"));
                    v.push(format!("get MIXER:Current/St/Fader/Level {x} 0"));
                }
            }
            // TF: St 0/1 = stereo L/R, and a separate Mono bus.
            Family::Tf => {
                for kind in ["St", "Mono"] {
                    v.push(format!("get MIXER:Current/{kind}/Label/Name 0 0"));
                    v.push(format!("get MIXER:Current/{kind}/Fader/On 0 0"));
                    v.push(format!("get MIXER:Current/{kind}/Fader/Level 0 0"));
                }
            }
        }
        for x in 0..self.mute_groups {
            v.push(format!("get MIXER:Current/MuteMaster/Label/Name {x} 0"));
            v.push(format!("get MIXER:Current/MuteMaster/On {x} 0"));
        }
        v
    }

    /// How to ask which scene is current.
    pub fn scene_queries(&self) -> Vec<String> {
        match self.family {
            Family::Tf => vec!["sscurrent_ex scene_a".into(), "sscurrent_ex scene_b".into()],
            _ => vec!["sscurrent_ex MIXER:Lib/Scene".into()],
        }
    }

    /// How to ask a scene's name.
    pub fn scene_info_query(&self, bank: Option<char>, n: u32) -> String {
        match bank {
            Some(b) => format!("ssinfo_ex scene_{} {n}", b.to_ascii_lowercase()),
            None => format!("ssinfo_ex MIXER:Lib/Scene {n}"),
        }
    }

    /// An RCP address and channel index -> ProDeck's channel key and property.
    pub fn map(&self, addr: &str, x: u32) -> Option<Field> {
        let rest = addr.strip_prefix("MIXER:Current/")?;
        let (kind, tail) = rest.split_once('/')?;
        let n = x as u16; // 0 based
        if kind == "MuteMaster" {
            if n >= self.mute_groups {
                return None;
            }
            let key = format!("mgrp:{}", n + 1);
            return match tail {
                "On" => Some(Field::Mute { key, inverted: false }),
                "Label/Name" => Some(Field::Name(key)),
                _ => None,
            };
        }
        let key = match kind {
            "InCh" if n < self.inputs => format!("input:{}", n + 1),
            // Stereo inputs continue the input list, like aux inputs on the X32.
            "StInCh" if n < self.st_inputs => format!("input:{}", self.inputs + n + 1),
            "Mix" if n < self.mixes => format!("aux:{}", n + 1),
            "Mtrx" if n < self.matrices => format!("mtx:{}", n + 1),
            "DCA" if n < self.dcas => format!("dca:{}", n + 1),
            "St" => match (self.family, n) {
                (_, 0) => "main:1".to_string(),
                (Family::ClQl | Family::Other, 2) => "main:2".to_string(),
                _ => return None, // the linked right side
            },
            "Mono" if self.family == Family::Tf && n == 0 => "main:2".to_string(),
            _ => return None,
        };
        match tail {
            "Fader/On" => Some(Field::Mute { key, inverted: true }),
            "Fader/Level" => Some(Field::Fader(key)),
            "Label/Name" => Some(Field::Name(key)),
            _ => None,
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Field {
    /// `inverted`: the desk's value is "on" (1 = live), not "muted".
    Mute { key: String, inverted: bool },
    Fader(String),
    Name(String),
}

// ---- the line parser ----------------------------------------------------------

/// Split an RCP line on spaces, keeping quoted strings whole (quotes removed,
/// `\"` and `\\` unescaped).
pub fn tokenize(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_q = false;
    let mut had = false;
    let mut chars = line.trim_end_matches(['\r', '\n']).chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                in_q = !in_q;
                had = true;
            }
            '\\' if in_q => {
                if let Some(n) = chars.next() {
                    cur.push(n);
                }
            }
            c if c.is_whitespace() && !in_q => {
                if had {
                    out.push(std::mem::take(&mut cur));
                    had = false;
                }
            }
            c => {
                cur.push(c);
                had = true;
            }
        }
    }
    if had {
        out.push(cur);
    }
    out
}

#[derive(Debug, PartialEq)]
pub enum Line {
    /// A parameter value: a `get` reply or a `NOTIFY set`.
    Param { addr: String, x: u32, value: String },
    Product(String),
    /// The current scene (a reply, or a recall someone made). `bank` is
    /// Some('A'|'B') on a TF.
    Scene { bank: Option<char>, number: u32 },
    SceneInfo { bank: Option<char>, number: u32, name: String },
    /// Anything else that is still a sign of life (devstatus, errors).
    Other,
}

fn bank_of(list: &str) -> Option<char> {
    match list.to_ascii_lowercase().as_str() {
        "scene_a" => Some('A'),
        "scene_b" => Some('B'),
        _ => None,
    }
}

pub fn parse_line(line: &str) -> Option<Line> {
    let t = tokenize(line);
    if t.is_empty() {
        return None;
    }
    let status = t[0].to_ascii_uppercase();
    if !matches!(status.as_str(), "OK" | "OKM" | "NOTIFY") {
        return Some(Line::Other); // ERROR replies: alive, nothing to apply
    }
    let action = t.get(1).map(|s| s.as_str()).unwrap_or("");
    match action {
        // `OK set` only ever echoes a client's own write (we make none).
        "get" | "set" if status == "OK" && action == "set" => Some(Line::Other),
        "get" | "set" => {
            let addr = t.get(2)?.clone();
            let x: u32 = t.get(3)?.parse().ok()?;
            let value = t.get(5)?.clone();
            Some(Line::Param { addr, x, value })
        }
        "devinfo" if t.get(2).map(|s| s.as_str()) == Some("productname") => Some(Line::Product(t.get(3)?.clone())),
        "sscurrent_ex" | "ssrecall_ex" => {
            let bank = bank_of(t.get(2)?);
            let number: u32 = t.get(3)?.parse().ok()?;
            Some(Line::Scene { bank, number })
        }
        "ssinfo_ex" => {
            let bank = bank_of(t.get(2)?);
            let number: u32 = t.get(3)?.parse().ok()?;
            // The Companion module reads these fields after the number as
            // text value, name, comment, type. If the desk sends fewer, the
            // first one is the name.
            let rest = &t[4.min(t.len())..];
            let name = if rest.len() >= 3 { rest[1].clone() } else { rest.first().cloned().unwrap_or_default() };
            Some(Line::SceneInfo { bank, number, name: name.trim().to_string() })
        }
        _ => Some(Line::Other),
    }
}

// ---- applying it to the mirror -------------------------------------------------

/// Apply one parameter value. Returns true when the mirror changed.
pub fn apply_param(s: &mut AvantisInner, profile: &Profile, addr: &str, x: u32, value: &str) -> bool {
    let Some(field) = profile.map(addr, x) else { return false };
    match field {
        Field::Mute { key, inverted } => {
            let Ok(v) = value.parse::<i32>() else { return false };
            let on = v != 0;
            apply_mute(s, key, if inverted { !on } else { on })
        }
        Field::Fader(key) => {
            let Ok(v) = value.parse::<i32>() else { return false };
            let db = if v <= -32768 { None } else { Some(v as f32 / 100.0) };
            apply_fader(s, key, ahmap::fader_u8_from_db(db))
        }
        Field::Name(key) => {
            let n = value.trim().to_string();
            let old = s.names.insert(key.clone(), n.clone());
            if let Some(o) = old.as_ref() {
                if !o.is_empty() && *o != n {
                    crate::avantis::watch_record(s, crate::avantis::WatchKind::Name, &key, o.clone(), n.clone());
                }
            }
            old.as_deref() != Some(n.as_str())
        }
    }
}

/// A scene recall (or the current scene at connect). True when it changed.
pub fn apply_scene(s: &mut AvantisInner, number: u32) -> bool {
    let old = s.scene.replace(number);
    if old != Some(number) {
        s.scene_at = Some(crate::avantis::now_ms());
        s.scene_name = None; // until ssinfo_ex answers
        if let Some(o) = old {
            crate::avantis::watch_record(s, crate::avantis::WatchKind::Scene, "scene", o.to_string(), number.to_string());
        }
        true
    } else {
        false
    }
}

/// The scene's name as the desk shows it. A TF also gets its bank and number
/// ("A05 Sunday"), since bank A 5 and bank B 5 are different scenes.
pub fn scene_label(bank: Option<char>, number: u32, name: &str) -> String {
    match bank {
        Some(b) if name.is_empty() => format!("{b}{number:02}"),
        Some(b) => format!("{b}{number:02} {name}"),
        None => name.to_string(),
    }
}

// ---- the connection ------------------------------------------------------------

/// What a session reports to whoever runs it: the app, or a test.
pub trait Host {
    fn connected(&mut self, up: bool);
    fn changed(&mut self);
    /// False when settings changed or someone asked to reconnect.
    fn keep_going(&mut self) -> bool;
}

/// Drive one connection until it fails or the host says stop.
pub async fn run<H: Host>(stream: tokio::net::TcpStream, state: &AvantisState, host: &mut H) -> Result<(), String> {
    stream.set_nodelay(true).ok();
    let (rd, mut wr) = stream.into_split();
    let mut rd = BufReader::new(rd);
    let mut buf: Vec<u8> = Vec::new();

    let mut queue: VecDeque<String> = VecDeque::from(vec!["devinfo productname".to_string()]);
    let mut profile: Option<Profile> = None;
    let mut seen_any = false;
    let mut dirty = false;
    let started = tokio::time::Instant::now();
    let mut last_rx = started;
    let mut tf_bank: Option<char> = None;

    let mut send = tokio::time::interval(Duration::from_millis(SEND_GAP_MS));
    send.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut beat = tokio::time::interval(Duration::from_secs(BEAT_SECS));
    beat.tick().await;
    let mut emit = tokio::time::interval(Duration::from_millis(250));
    let mut check = tokio::time::interval(Duration::from_secs(2));
    check.tick().await;

    loop {
        tokio::select! {
            // read_until keeps partial bytes in `buf` if another branch wins,
            // so a line split across packets is never lost.
            r = rd.read_until(b'\n', &mut buf) => {
                let n = r.map_err(|e| e.to_string())?;
                if n == 0 {
                    return Err("the console closed the connection".into());
                }
                if buf.last() != Some(&b'\n') {
                    continue; // EOF mid-line; the next read reports the close
                }
                // Names may not be UTF-8 on older firmware; never drop a line for it.
                let text = String::from_utf8_lossy(&buf).to_string();
                buf.clear();
                let Some(line) = parse_line(&text) else { continue };
                last_rx = tokio::time::Instant::now();
                if !seen_any {
                    seen_any = true;
                    host.connected(true);
                }
                match line {
                    Line::Product(name) => {
                        if profile.is_none() {
                            let p = profile_for(&name);
                            crate::diag::log(format!("[yamaha] {} ({:?})", p.product, p.family));
                            queue.extend(p.scene_queries());
                            queue.extend(p.queries());
                            profile = Some(p);
                        }
                    }
                    Line::Param { addr, x, value } => {
                        if let Some(p) = profile.as_ref() {
                            let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
                            dirty |= apply_param(&mut s, p, &addr, x, &value);
                        }
                    }
                    Line::Scene { bank, number } => {
                        let changed = {
                            let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
                            // A TF bank switch with the same number is still a new scene.
                            let bank_moved = bank.is_some() && bank != tf_bank;
                            let c = apply_scene(&mut s, number);
                            if bank_moved && !c {
                                s.scene_at = Some(crate::avantis::now_ms());
                                s.scene_name = None;
                            }
                            c || bank_moved
                        };
                        tf_bank = bank.or(tf_bank);
                        dirty |= changed;
                        if let Some(p) = profile.as_ref() {
                            queue.push_front(p.scene_info_query(bank, number));
                            // A recall rewrites the desk; the desk may not
                            // NOTIFY every parameter, so read everything again.
                            if changed && queue.len() < 50 {
                                queue.extend(p.queries());
                            }
                        }
                    }
                    Line::SceneInfo { bank, number, name } => {
                        let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
                        if s.scene == Some(number) {
                            let label = scene_label(bank, number, &name);
                            let label = if label.is_empty() { None } else { Some(label) };
                            if s.scene_name != label {
                                s.scene_name = label;
                                dirty = true;
                            }
                        }
                    }
                    Line::Other => {}
                }
            }
            _ = send.tick() => {
                if let Some(cmd) = queue.pop_front() {
                    let line = format!("{cmd}\n");
                    match tokio::time::timeout(Duration::from_secs(2), wr.write_all(line.as_bytes())).await {
                        Ok(Ok(())) => {}
                        Ok(Err(e)) => return Err(e.to_string()),
                        Err(_) => return Err("the console stopped reading".into()),
                    }
                }
            }
            _ = beat.tick() => {
                queue.push_back("devstatus runmode".into());
            }
            _ = emit.tick() => {
                if dirty {
                    dirty = false;
                    host.changed();
                }
            }
            _ = check.tick() => {
                if !host.keep_going() {
                    return Ok(());
                }
                // No product name after a few seconds: still mirror, on the
                // widest map, rather than sit blind.
                if profile.is_none() && seen_any && started.elapsed() > Duration::from_secs(4) {
                    let p = profile_for("");
                    queue.extend(p.scene_queries());
                    queue.extend(p.queries());
                    profile = Some(p);
                }
                if (!seen_any && started.elapsed() > Duration::from_secs(8))
                    || last_rx.elapsed() > Duration::from_secs(SILENT_SECS)
                {
                    return Err("no reply from the console".into());
                }
            }
        }
    }
}

// ---- wiring into the app ---------------------------------------------------------

type Cfg = (bool, String, DeskModel, u16);

fn settings(app: &AppHandle) -> Cfg {
    let st = app.state::<crate::settings::SettingsState>();
    let s = st.lock().unwrap_or_else(|p| p.into_inner());
    // avantis_port carries other desks' defaults (51325 A&H, 10023 X32) on an
    // install that switched desks; those mean nothing to RCP.
    let port = match s.avantis_port {
        0 | 51325 | 51328 | 10023 => PORT,
        p => p,
    };
    (s.avantis_enabled, s.avantis_host.clone(), DeskModel::parse(&s.avantis_model), port)
}

fn set_connected(app: &AppHandle, state: &AvantisState, up: bool) {
    let changed = {
        let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
        let was = s.connected;
        s.connected = up;
        if up {
            s.model = DeskModel::Yamaha;
            if !was {
                s.connected_at = Some(crate::avantis::now_ms());
            }
        } else {
            s.connected_at = None;
        }
        was != up
    };
    if changed {
        app.emit("avantis:status", json!({ "connected": up })).ok();
        app.emit("avantis:state", snapshot(state)).ok();
    }
}

struct AppHost<'a> {
    app: &'a AppHandle,
    state: &'a AvantisState,
    cfg: Cfg,
}

impl Host for AppHost<'_> {
    fn connected(&mut self, up: bool) {
        set_connected(self.app, self.state, up);
    }
    fn changed(&mut self) {
        self.app.emit("avantis:state", snapshot(self.state)).ok();
    }
    fn keep_going(&mut self) -> bool {
        !crate::avantis::take_reconnect() && settings(self.app) == self.cfg
    }
}

pub fn spawn_mirror(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state: AvantisState = app.state::<AvantisState>().inner().clone();
        loop {
            let cfg = settings(&app);
            let (enabled, host, model, port) = cfg.clone();
            if !enabled || host.trim().is_empty() || !model.is_rcp() {
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
            let res = match tokio::time::timeout(
                Duration::from_secs(5),
                tokio::net::TcpStream::connect((host.trim(), port)),
            )
            .await
            {
                Err(_) => Err("timed out reaching the console".to_string()),
                Ok(Err(e)) => Err(e.to_string()),
                Ok(Ok(stream)) => {
                    let mut h = AppHost { app: &app, state: &state, cfg };
                    run(stream, &state, &mut h).await
                }
            };
            if let Err(e) = res {
                crate::diag::log(format!("[yamaha] {e}"));
            }
            set_connected(&app, &state, false);
            tokio::time::sleep(Duration::from_secs(4)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn ql5() -> Profile {
        profile_for("QL5")
    }

    #[test]
    fn tokenizer_keeps_quoted_names_whole() {
        assert_eq!(
            tokenize("OK get MIXER:Current/InCh/Label/Name 0 0 \"Lead Vox\"\n"),
            vec!["OK", "get", "MIXER:Current/InCh/Label/Name", "0", "0", "Lead Vox"]
        );
        assert_eq!(tokenize("NOTIFY set A 1 0 \"\""), vec!["NOTIFY", "set", "A", "1", "0", ""]);
        assert_eq!(tokenize("OK x \"say \\\"hi\\\"\"\r\n"), vec!["OK", "x", "say \"hi\""]);
        assert!(tokenize("   \r\n").is_empty());
    }

    #[test]
    fn parses_replies_and_notifies() {
        assert_eq!(
            parse_line("OK get MIXER:Current/InCh/Fader/Level 4 0 -1000"),
            Some(Line::Param { addr: "MIXER:Current/InCh/Fader/Level".into(), x: 4, value: "-1000".into() })
        );
        // NOTIFY carries a text rendering after the value; ignored.
        assert_eq!(
            parse_line("NOTIFY set MIXER:Current/InCh/Fader/On 0 0 0 \"OFF\""),
            Some(Line::Param { addr: "MIXER:Current/InCh/Fader/On".into(), x: 0, value: "0".into() })
        );
        assert_eq!(parse_line("OK devinfo productname \"QL5\""), Some(Line::Product("QL5".into())));
        assert_eq!(parse_line("NOTIFY sscurrent_ex MIXER:Lib/Scene 13"), Some(Line::Scene { bank: None, number: 13 }));
        assert_eq!(parse_line("OK sscurrent_ex scene_b 5"), Some(Line::Scene { bank: Some('B'), number: 5 }));
        assert_eq!(
            parse_line("OK ssinfo_ex MIXER:Lib/Scene 13 \"013\" \"Sermon\" \"keep vox\" 0"),
            Some(Line::SceneInfo { bank: None, number: 13, name: "Sermon".into() })
        );
        assert_eq!(
            parse_line("OK ssinfo_ex scene_a 2 \"Walk in\""),
            Some(Line::SceneInfo { bank: Some('A'), number: 2, name: "Walk in".into() })
        );
        // Our own writes would echo as OK set; we make none, and never apply them.
        assert_eq!(parse_line("OK set MIXER:Current/InCh/Fader/On 0 0 1"), Some(Line::Other));
        assert_eq!(parse_line("ERROR get MIXER:Current/Mix/Fader/On 20 0 InvalidArgument"), Some(Line::Other));
        assert_eq!(parse_line(""), None);
    }

    #[test]
    fn models_are_sized_from_the_product_name() {
        let q = ql5();
        assert_eq!((q.family, q.inputs, q.mixes, q.dcas), (Family::ClQl, 64, 16, 16));
        assert_eq!(profile_for("QL1").inputs, 32);
        assert_eq!(profile_for("CL5").inputs, 72);
        assert_eq!(profile_for("CL5").mixes, 24);
        assert_eq!(profile_for("CL1").inputs, 48);
        let tf = profile_for("TF-RACK");
        assert_eq!((tf.family, tf.inputs, tf.mixes, tf.matrices, tf.dcas), (Family::Tf, 40, 20, 0, 8));
        assert_eq!(profile_for("TF5").scene_queries(), vec!["sscurrent_ex scene_a", "sscurrent_ex scene_b"]);
        assert_eq!(profile_for("PM10").family, Family::Other);
        assert_eq!(ql5().scene_info_query(None, 4), "ssinfo_ex MIXER:Lib/Scene 4");
        assert_eq!(ql5().scene_info_query(Some('B'), 4), "ssinfo_ex scene_b 4");
    }

    #[test]
    fn addresses_map_onto_prodecks_channel_keys() {
        let q = ql5();
        let m = |a: &str, x| q.map(a, x);
        assert_eq!(m("MIXER:Current/InCh/Fader/On", 0), Some(Field::Mute { key: "input:1".into(), inverted: true }));
        assert_eq!(m("MIXER:Current/InCh/Fader/Level", 63), Some(Field::Fader("input:64".into())));
        assert_eq!(m("MIXER:Current/InCh/Fader/Level", 64), None, "a QL5 has 64 mono inputs");
        assert_eq!(m("MIXER:Current/StInCh/Label/Name", 0), Some(Field::Name("input:65".into())));
        assert_eq!(m("MIXER:Current/Mix/Fader/On", 15), Some(Field::Mute { key: "aux:16".into(), inverted: true }));
        assert_eq!(m("MIXER:Current/Mix/Fader/On", 16), None, "a QL has 16 mixes, not 24");
        assert_eq!(m("MIXER:Current/Mtrx/Fader/Level", 7), Some(Field::Fader("mtx:8".into())));
        assert_eq!(m("MIXER:Current/DCA/Label/Name", 15), Some(Field::Name("dca:16".into())));
        assert_eq!(m("MIXER:Current/St/Fader/Level", 0), Some(Field::Fader("main:1".into())));
        assert_eq!(m("MIXER:Current/St/Fader/Level", 1), None, "the right side is linked to the left");
        assert_eq!(m("MIXER:Current/St/Fader/On", 2), Some(Field::Mute { key: "main:2".into(), inverted: true }));
        assert_eq!(m("MIXER:Current/MuteMaster/On", 7), Some(Field::Mute { key: "mgrp:8".into(), inverted: false }));
        assert_eq!(m("MIXER:Current/InCh/EQ/On", 0), None);
        assert_eq!(m("MIXER:Current/InCh/ToMix/Level", 0), None, "a send is not the fader");
        let tf = profile_for("TF5");
        assert_eq!(tf.map("MIXER:Current/Mono/Fader/Level", 0), Some(Field::Fader("main:2".into())));
        assert_eq!(tf.map("MIXER:Current/Mtrx/Fader/Level", 0), None);
        // Every connect-time read is one we can interpret.
        for p in [ql5(), profile_for("CL5"), tf] {
            for line in p.queries() {
                let t = tokenize(&line);
                let x: u32 = t[2].parse().unwrap();
                assert!(p.map(&t[1], x).is_some(), "queried {line} but can't map it");
            }
        }
    }

    #[test]
    fn mute_polarity_is_not_inverted() {
        // THE bit that must not be wrong: Fader/On 1 means the channel is LIVE.
        let q = ql5();
        let mut s = AvantisInner::default();
        apply_param(&mut s, &q, "MIXER:Current/InCh/Fader/On", 0, "1");
        assert_eq!(s.mutes.get("input:1"), Some(&false), "ON must read as NOT muted");
        apply_param(&mut s, &q, "MIXER:Current/InCh/Fader/On", 0, "0");
        assert_eq!(s.mutes.get("input:1"), Some(&true), "OFF must read as muted");
        apply_param(&mut s, &q, "MIXER:Current/DCA/Fader/On", 2, "0");
        assert_eq!(s.mutes.get("dca:3"), Some(&true));
        // Mute groups: 1 means the group is muting.
        apply_param(&mut s, &q, "MIXER:Current/MuteMaster/On", 1, "1");
        assert_eq!(s.mutes.get("mgrp:2"), Some(&true));
    }

    #[test]
    fn fader_levels_convert_to_prodecks_scale() {
        let q = ql5();
        let mut s = AvantisInner::default();
        assert!(apply_param(&mut s, &q, "MIXER:Current/InCh/Fader/Level", 4, "-1000"));
        assert_eq!(s.faders.get("input:5"), Some(&ahmap::fader_u8_from_db(Some(-10.0))));
        apply_param(&mut s, &q, "MIXER:Current/InCh/Fader/Level", 4, "-32768");
        assert_eq!(s.faders.get("input:5"), Some(&0), "-32768 is -inf");
        apply_param(&mut s, &q, "MIXER:Current/InCh/Fader/Level", 4, "1000");
        assert_eq!(s.faders.get("input:5"), Some(&127), "+10 dB is the top");
        apply_param(&mut s, &q, "MIXER:Current/InCh/Fader/Level", 4, "0");
        assert_eq!(ahmap::db_from_fader_u8(*s.faders.get("input:5").unwrap()).map(|d| d.round()), Some(0.0));
        assert!(!apply_param(&mut s, &q, "MIXER:Current/InCh/Fader/Level", 4, "junk"));
    }

    #[test]
    fn names_and_scenes_update_the_mirror() {
        let q = ql5();
        let mut s = AvantisInner::default();
        assert!(apply_param(&mut s, &q, "MIXER:Current/InCh/Label/Name", 2, " Pastor "));
        assert_eq!(s.names.get("input:3").unwrap(), "Pastor");
        assert!(!apply_param(&mut s, &q, "MIXER:Current/InCh/Label/Name", 2, "Pastor"), "same name is not a change");
        assert!(apply_scene(&mut s, 12));
        assert!(!apply_scene(&mut s, 12));
        assert!(apply_scene(&mut s, 13));
        assert_eq!(s.scene, Some(13));
        assert!(s.watch.iter().any(|w| w.kind == crate::avantis::WatchKind::Scene));
        assert_eq!(scene_label(Some('A'), 5, "Sunday"), "A05 Sunday");
        assert_eq!(scene_label(None, 5, "Sunday"), "Sunday");
    }

    // ---- a fake desk on localhost ----

    struct TestHost {
        ups: Arc<Mutex<Vec<bool>>>,
    }
    impl Host for TestHost {
        fn connected(&mut self, up: bool) {
            self.ups.lock().unwrap().push(up);
        }
        fn changed(&mut self) {}
        fn keep_going(&mut self) -> bool {
            true
        }
    }

    /// A tiny RCP desk: answers devinfo, get, sscurrent_ex and ssinfo_ex,
    /// and after the tenth line someone "on the surface" mutes channel 1,
    /// pulls channel 5 to -10 dB and recalls scene 13.
    async fn fake_desk(listener: tokio::net::TcpListener) {
        let (sock, _) = listener.accept().await.unwrap();
        let (rd, mut wr) = sock.into_split();
        let mut lines = BufReader::new(rd).lines();
        let mut ch1_on = 1;
        let mut ch5_level = 0;
        let mut scene = 12;
        let mut count = 0;
        while let Ok(Some(l)) = lines.next_line().await {
            count += 1;
            let t = tokenize(&l);
            let reply = match t.first().map(|s| s.as_str()) {
                Some("devinfo") => "OK devinfo productname \"QL5\"".to_string(),
                Some("sscurrent_ex") => format!("OK sscurrent_ex MIXER:Lib/Scene {scene}"),
                Some("ssinfo_ex") => {
                    let n: u32 = t[2].parse().unwrap();
                    let name = if n == 13 { "Sermon" } else { "Walk in" };
                    format!("OK ssinfo_ex MIXER:Lib/Scene {n} \"{n:03}\" \"{name}\" \"\" 0")
                }
                Some("get") => {
                    let (addr, x) = (t[1].as_str(), t[2].as_str());
                    let v = match (addr, x) {
                        ("MIXER:Current/InCh/Label/Name", "0") => "\"Pastor\"".to_string(),
                        ("MIXER:Current/InCh/Label/Name", _) => format!("\"ch {}\"", x.parse::<u32>().unwrap() + 1),
                        ("MIXER:Current/InCh/Fader/On", "0") => ch1_on.to_string(),
                        ("MIXER:Current/InCh/Fader/Level", "4") => ch5_level.to_string(),
                        (a, _) if a.ends_with("/Name") => "\"\"".to_string(),
                        (a, _) if a.ends_with("/On") => "1".to_string(),
                        _ => "0".to_string(),
                    };
                    format!("OK get {addr} {x} 0 {v}")
                }
                Some("devstatus") => "OK devstatus runmode \"normal\"".to_string(),
                _ => "ERROR unknown".to_string(),
            };
            wr.write_all(format!("{reply}\n").as_bytes()).await.unwrap();
            if count == 10 {
                ch1_on = 0;
                ch5_level = -1000;
                scene = 13;
                // Split one NOTIFY across two writes, as TCP may.
                wr.write_all(b"NOTIFY set MIXER:Current/InCh/Fader/On 0 0 0 \"O").await.unwrap();
                wr.flush().await.unwrap();
                tokio::time::sleep(Duration::from_millis(30)).await;
                wr.write_all(b"FF\"\nNOTIFY set MIXER:Current/InCh/Fader/Level 4 0 -1000 \"-10.00\"\n").await.unwrap();
                wr.write_all(b"NOTIFY sscurrent_ex MIXER:Lib/Scene 13\n").await.unwrap();
            }
        }
    }

    #[tokio::test]
    async fn mirrors_a_fake_desk_over_tcp() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(fake_desk(listener));

        let state: AvantisState = Arc::new(Mutex::new(AvantisInner::default()));
        let ups = Arc::new(Mutex::new(Vec::new()));
        let st = state.clone();
        let mut host = TestHost { ups: ups.clone() };
        let stream = tokio::net::TcpStream::connect(addr).await.unwrap();
        let session = tokio::spawn(async move { run(stream, &st, &mut host).await });

        let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
        loop {
            let done = {
                let s = state.lock().unwrap();
                s.mutes.get("input:1") == Some(&true)
                    && s.faders.get("input:5") == Some(&ahmap::fader_u8_from_db(Some(-10.0)))
                    && s.names.get("input:1").map(|n| n.as_str()) == Some("Pastor")
                    && s.names.get("input:64").map(|n| n.as_str()) == Some("ch 64")
                    && s.mutes.get("input:2") == Some(&false)
                    && s.scene == Some(13)
                    && s.scene_name.as_deref() == Some("Sermon")
            };
            if done {
                break;
            }
            assert!(tokio::time::Instant::now() < deadline, "mirror never caught up: {:?}", {
                let s = state.lock().unwrap();
                (s.mutes.get("input:1").copied(), s.faders.get("input:5").copied(), s.scene, s.scene_name.clone(), s.names.len())
            });
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert_eq!(ups.lock().unwrap().first(), Some(&true));
        // Nothing beyond the QL5's 64 inputs was invented.
        assert!(state.lock().unwrap().names.get("input:81").is_none());
        session.abort();
    }
}
