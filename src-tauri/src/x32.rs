//! Behringer X32 / Midas M32, over OSC.
//!
//! Probably more churches run an X32 than any other digital desk, so this is
//! the widest-reach console after Allen & Heath. It is a completely different
//! transport from the A&H desks (OSC over UDP, not MIDI over TCP) but it
//! populates the SAME mirror state with the SAME channel keys, so every
//! dashboard widget, the channel wall and the desk watchdog work unchanged.
//!
//! Protocol (from the unofficial X32/M32 OSC reference):
//!   * UDP port 10023.
//!   * `/xremote` subscribes this client to every parameter change. It times
//!     out after 10 s and must be renewed — we resend every 8.
//!   * Sending an address with NO arguments is a read; the console replies
//!     with that address and its current value.
//!   * Mute is `/ch/01/mix/on` as {OFF, ON} — ON means UNMUTED. Inverted from
//!     how ProDeck stores it, and the one bit that must not be wrong: showing
//!     a live channel as muted (or worse, the reverse) during a service is the
//!     failure that matters.
//!   * Faders are floats 0.0–1.0 on a pseudo-log curve (unity at 0.75).

use crate::ahmap::{self, DeskModel};
use crate::avantis::{apply_fader, apply_mute, snapshot, AvantisState};
use rosc::{encoder, OscMessage, OscPacket, OscType};
use serde_json::json;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// The X32/M32 remote-control port. Fixed in the console's firmware — there is
/// no setting for it on the desk — but `avantis_port` is offered in Settings and
/// used to be saved and then ignored here, so an operator who changed it got a
/// mirror that silently never connected. It is honoured now, defaulting to this.
const PORT: u16 = 10023;
/// The console drops us after 10 s of silence; renew comfortably inside that.
const XREMOTE_SECS: u64 = 8;

/// X32 float (0.0–1.0) → dB. Piecewise, straight from the console's own level
/// table: 0.0625→-60, 0.125→-50, 0.25→-30, 0.5→-10, 0.75→0 (unity), 1.0→+10.
pub fn fader_to_db(f: f32) -> Option<f32> {
    if f <= 0.0 {
        return None; // -oo
    }
    Some(if f >= 0.5 {
        f * 40.0 - 30.0
    } else if f >= 0.25 {
        f * 80.0 - 50.0
    } else if f >= 0.0625 {
        f * 160.0 - 70.0
    } else {
        f * 480.0 - 90.0
    })
}

/// Inverse, for writing a fader.
pub fn db_to_fader(db: Option<f32>) -> f32 {
    let Some(d) = db else { return 0.0 };
    let f = if d >= -10.0 {
        (d + 30.0) / 40.0
    } else if d >= -30.0 {
        (d + 50.0) / 80.0
    } else if d >= -60.0 {
        (d + 70.0) / 160.0
    } else {
        (d + 90.0) / 480.0
    };
    f.clamp(0.0, 1.0)
}

/// An OSC address → ProDeck's channel key ("input:3", "dca:2"), plus which
/// property it carries. None for the many addresses we don't mirror.
#[derive(Debug, PartialEq)]
pub enum Field {
    Mute(String),
    Fader(String),
    Name(String),
}

/// X32 numbers aux inputs and FX returns separately from channels; ProDeck has
/// one "input" list, so aux inputs continue it at 33. Everything else maps
/// one-to-one onto keys the widgets already understand.
pub fn map_address(addr: &str) -> Option<Field> {
    let p: Vec<&str> = addr.trim_start_matches('/').split('/').collect();
    // Mute groups: /config/mute/1..6
    if p.len() == 3 && p[0] == "config" && p[1] == "mute" {
        let n: u8 = p[2].parse().ok()?;
        return (1..=6).contains(&n).then(|| Field::Mute(format!("mgrp:{n}")));
    }
    // DCAs use /dca/1/on and /dca/1/fader — NOT /mix/on like everything else.
    if p.first() == Some(&"dca") && p.len() >= 3 {
        let n: u8 = p[1].parse().ok()?;
        if !(1..=8).contains(&n) {
            return None;
        }
        let key = format!("dca:{n}");
        return match (p[2], p.get(3)) {
            ("on", None) => Some(Field::Mute(key)),
            ("fader", None) => Some(Field::Fader(key)),
            ("config", Some(&"name")) => Some(Field::Name(key)),
            _ => None,
        };
    }
    // Mains are named, not numbered: /main/st and /main/m.
    let key = if p.first() == Some(&"main") && p.len() >= 2 {
        match p[1] {
            "st" => "main:1".to_string(),
            "m" => "main:2".to_string(),
            _ => return None,
        }
    } else {
        // /ch/01, /auxin/01, /fxrtn/01, /bus/01, /mtx/01
        let n: u8 = p.get(1)?.parse().ok()?;
        match *p.first()? {
            "ch" if (1..=32).contains(&n) => format!("input:{n}"),
            "auxin" if (1..=8).contains(&n) => format!("input:{}", 32 + n),
            "fxrtn" if (1..=8).contains(&n) => format!("fxr:{n}"),
            "bus" if (1..=16).contains(&n) => format!("aux:{n}"),
            "mtx" if (1..=6).contains(&n) => format!("mtx:{n}"),
            _ => return None,
        }
    };
    // Tail is /mix/on, /mix/fader or /config/name.
    let tail: Vec<&str> = p[if p.first() == Some(&"main") { 2 } else { 2 }..].to_vec();
    match tail.as_slice() {
        ["mix", "on"] => Some(Field::Mute(key)),
        ["mix", "fader"] => Some(Field::Fader(key)),
        ["config", "name"] => Some(Field::Name(key)),
        _ => None,
    }
}

/// Every address we ask for at connect. The console answers each one, which is
/// how the mirror starts complete instead of blind until someone moves a fader.
fn query_addresses() -> Vec<String> {
    let mut v = Vec::new();
    let mut add = |base: String| {
        v.push(format!("{base}/mix/on"));
        v.push(format!("{base}/mix/fader"));
        v.push(format!("{base}/config/name"));
    };
    for n in 1..=32 {
        add(format!("/ch/{n:02}"));
    }
    for n in 1..=8 {
        add(format!("/auxin/{n:02}"));
    }
    for n in 1..=8 {
        add(format!("/fxrtn/{n:02}"));
    }
    for n in 1..=16 {
        add(format!("/bus/{n:02}"));
    }
    for n in 1..=6 {
        add(format!("/mtx/{n:02}"));
    }
    add("/main/st".to_string());
    add("/main/m".to_string());
    for n in 1..=8 {
        v.push(format!("/dca/{n}/on"));
        v.push(format!("/dca/{n}/fader"));
        v.push(format!("/dca/{n}/config/name"));
    }
    for n in 1..=6 {
        v.push(format!("/config/mute/{n}"));
    }
    v
}

fn msg(addr: &str, args: Vec<OscType>) -> Result<Vec<u8>, String> {
    encoder::encode(&OscPacket::Message(OscMessage {
        addr: addr.to_string(),
        args,
    }))
    .map_err(|e| e.to_string())
}

fn settings(app: &AppHandle) -> (bool, String, DeskModel, u16) {
    let st = app.state::<crate::settings::SettingsState>();
    let s = st.lock().unwrap_or_else(|p| p.into_inner());
    // avantis_port carries the A&H MIDI-over-TCP port (51325) for those desks;
    // an X32 install that never touched it would inherit that meaningless value,
    // so anything outside the OSC range falls back to the console's own port.
    let port = if s.avantis_port == 0 || s.avantis_port == 51325 {
        PORT
    } else {
        s.avantis_port
    };
    (
        s.avantis_enabled,
        s.avantis_host.clone(),
        DeskModel::parse(&s.avantis_model),
        port,
    )
}

fn set_connected(app: &AppHandle, state: &AvantisState, up: bool) {
    let changed = {
        let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
        let was = s.connected;
        s.connected = up;
        if up {
            s.model = DeskModel::X32;
        }
        was != up
    };
    if changed {
        app.emit("avantis:status", json!({ "connected": up })).ok();
        app.emit("avantis:state", snapshot(state)).ok();
    }
}

/// Apply one decoded OSC message to the mirror. Returns true when something
/// changed. Kept separate from the socket so it can be tested directly.
pub fn apply_message(s: &mut crate::avantis::AvantisInner, addr: &str, args: &[OscType]) -> bool {
    let Some(field) = map_address(addr) else { return false };
    let first = args.first();
    match field {
        Field::Mute(key) => {
            let on = match first {
                Some(OscType::Int(i)) => *i != 0,
                Some(OscType::Float(f)) => *f != 0.0,
                Some(OscType::Bool(b)) => *b,
                _ => return false,
            };
            // Channels/DCAs: /mix/on ON means UNMUTED, so invert into
            // ProDeck's "is muted". Mute GROUPS are the exception —
            // /config/mute/N is "Mute Group selection", where ON means the
            // group is actively muting, which is already what we store.
            // (The write path in set_mute makes the same distinction; a test
            // caught them disagreeing.)
            let muted = if key.starts_with("mgrp:") { on } else { !on };
            apply_mute(s, key, muted)
        }
        Field::Fader(key) => {
            let f = match first {
                Some(OscType::Float(f)) => *f,
                Some(OscType::Int(i)) => *i as f32,
                _ => return false,
            };
            apply_fader(s, key, ahmap::fader_u8_from_db(fader_to_db(f)))
        }
        Field::Name(key) => {
            let n = match first {
                Some(OscType::String(v)) => v.trim().to_string(),
                _ => return false,
            };
            let old = s.names.insert(key, n.clone());
            old.as_deref() != Some(n.as_str())
        }
    }
}

pub fn spawn_mirror(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state: AvantisState = app.state::<AvantisState>().inner().clone();
        loop {
            let (enabled, host, model, port) = settings(&app);
            if !enabled || host.trim().is_empty() || !model.is_osc() {
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
            if let Err(e) =
                session(&app, &state, &host, port, (enabled, host.clone(), model, port)).await
            {
                crate::diag::log(format!("[x32] {e}"));
            }
            set_connected(&app, &state, false);
            tokio::time::sleep(Duration::from_secs(4)).await;
        }
    });
}

async fn session(
    app: &AppHandle,
    state: &AvantisState,
    host: &str,
    port: u16,
    cfg: (bool, String, DeskModel, u16),
) -> Result<(), String> {
    let sock = tokio::net::UdpSocket::bind(("0.0.0.0", 0))
        .await
        .map_err(|e| e.to_string())?;
    sock.connect((host.trim(), port)).await.map_err(|e| e.to_string())?;

    // Subscribe, then read everything once.
    sock.send(&msg("/xremote", vec![])?).await.map_err(|e| e.to_string())?;
    for a in query_addresses() {
        sock.send(&msg(&a, vec![])?).await.map_err(|e| e.to_string())?;
        // The console drops requests if you flood it; this is ~450 reads.
        tokio::time::sleep(Duration::from_millis(4)).await;
    }

    let mut buf = [0u8; 8192];
    let mut renew = tokio::time::interval(Duration::from_secs(XREMOTE_SECS));
    renew.tick().await;
    let mut emit = tokio::time::interval(Duration::from_millis(250));
    let mut cfg_check = tokio::time::interval(Duration::from_secs(2));
    cfg_check.tick().await;
    let mut dirty = false;
    let mut seen_any = false;
    // `seen_any` alone was a one-way latch: once the first packet arrived, the
    // only liveness test could never fire again. UDP gives no close event, so a
    // desk that rebooted or dropped off the network left the mirror sitting
    // here forever — still reporting connected, still showing the mutes and
    // faders from before it vanished. On a channel wall that is the one thing
    // that must not be wrong.
    let mut last_rx = tokio::time::Instant::now();

    loop {
        tokio::select! {
            r = sock.recv(&mut buf) => {
                let n = r.map_err(|e| e.to_string())?;
                last_rx = tokio::time::Instant::now();
                if !seen_any {
                    seen_any = true;
                    set_connected(app, state, true);
                }
                if let Ok((_, packet)) = rosc::decoder::decode_udp(&buf[..n]) {
                    let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
                    dirty |= apply_packet(&mut s, packet);
                }
            }
            _ = renew.tick() => {
                sock.send(&msg("/xremote", vec![])?).await.map_err(|e| e.to_string())?;
            }
            _ = emit.tick() => {
                if dirty {
                    dirty = false;
                    app.emit("avantis:state", snapshot(state)).ok();
                }
            }
            _ = cfg_check.tick() => {
                let now = settings(app);
                if now != cfg {
                    return Ok(()); // settings changed — reconnect with them
                }
                // Nothing at all in ~10s means the desk went away. /xremote is
                // renewed every 8s and the console answers, so silence past
                // that is real — whether or not we ever heard from it.
                if !seen_any || last_rx.elapsed() > Duration::from_secs(12) {
                    return Err("no reply from the console".into());
                }
            }
        }
    }
}

fn apply_packet(s: &mut crate::avantis::AvantisInner, packet: OscPacket) -> bool {
    match packet {
        OscPacket::Message(m) => apply_message(s, &m.addr, &m.args),
        OscPacket::Bundle(b) => b.content.into_iter().fold(false, |acc, p| apply_packet(s, p) | acc),
    }
}

// ---- control (admin tier only; routed here from the desk commands) --------

async fn fire(app: &AppHandle, addr: &str, args: Vec<OscType>) -> Result<(), String> {
    let (enabled, host, model, port) = settings(app);
    if !enabled || host.trim().is_empty() || !model.is_osc() {
        return Err("no X32/M32 configured".into());
    }
    let sock = tokio::net::UdpSocket::bind(("0.0.0.0", 0))
        .await
        .map_err(|e| e.to_string())?;
    sock.connect((host.trim(), port)).await.map_err(|e| e.to_string())?;
    sock.send(&msg(addr, args)?).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// ProDeck key → the console's address prefix, for writes.
pub fn address_for(key: &str) -> Option<(String, bool)> {
    let (kind, idx) = key.split_once(':')?;
    let i: u8 = idx.parse().ok()?;
    Some(match kind {
        "input" if (1..=32).contains(&i) => (format!("/ch/{i:02}"), false),
        "input" if (33..=40).contains(&i) => (format!("/auxin/{:02}", i - 32), false),
        "fxr" if (1..=8).contains(&i) => (format!("/fxrtn/{i:02}"), false),
        "aux" if (1..=16).contains(&i) => (format!("/bus/{i:02}"), false),
        "mtx" if (1..=6).contains(&i) => (format!("/mtx/{i:02}"), false),
        "main" if i == 1 => ("/main/st".to_string(), false),
        "main" if i == 2 => ("/main/m".to_string(), false),
        "dca" if (1..=8).contains(&i) => (format!("/dca/{i}"), true),
        "mgrp" if (1..=6).contains(&i) => (format!("/config/mute/{i}"), true),
        _ => return None,
    })
}

pub async fn set_mute(app: &AppHandle, key: &str, muted: bool) -> Result<(), String> {
    let (base, bare) = address_for(key).ok_or("that channel doesn't exist on an X32")?;
    // Mute groups are the one place where the value is NOT inverted:
    // /config/mute/N ON means the group is muting.
    let addr = if key.starts_with("mgrp:") {
        base
    } else if bare {
        format!("{base}/on")
    } else {
        format!("{base}/mix/on")
    };
    let v = if key.starts_with("mgrp:") { muted } else { !muted };
    fire(app, &addr, vec![OscType::Int(if v { 1 } else { 0 })]).await
}

pub async fn set_fader(app: &AppHandle, key: &str, value: u8) -> Result<(), String> {
    let (base, bare) = address_for(key).ok_or("that channel has no fader on an X32")?;
    let addr = if bare { format!("{base}/fader") } else { format!("{base}/mix/fader") };
    let f = db_to_fader(ahmap::db_from_fader_u8(value));
    fire(app, &addr, vec![OscType::Float(f)]).await
}

pub async fn set_name(app: &AppHandle, key: &str, name: &str) -> Result<(), String> {
    let (base, _) = address_for(key).ok_or("that channel can't be renamed on an X32")?;
    // The console truncates at 12 characters.
    let n: String = name.chars().take(12).collect();
    fire(app, &format!("{base}/config/name"), vec![OscType::String(n)]).await
}

pub async fn recall_scene(app: &AppHandle, scene: u32) -> Result<(), String> {
    // The console's scenes are 0-based; ProDeck shows them 1-based like the A&H desks.
    fire(app, "/-action/goscene", vec![OscType::Int(scene as i32 - 1)]).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fader_curve_matches_the_consoles_own_level_table() {
        // Values quoted from the X32 level table appendix.
        let pairs = [
            (0.0625_f32, -60.0_f32),
            (0.1250, -50.0),
            (0.2500, -30.0),
            (0.5000, -10.0),
            (0.7500, 0.0), // unity
            (1.0000, 10.0),
            (0.1000, -54.0),
            (0.3000, -26.0),
            (0.6000, -6.0),
        ];
        for (f, db) in pairs {
            let got = fader_to_db(f).unwrap();
            assert!((got - db).abs() < 0.05, "f={f} expected {db}dB got {got}");
        }
        assert_eq!(fader_to_db(0.0), None, "0.0 is -oo, not -90dB");
        // Round-trips within the resolution of ProDeck's 0-127 scale.
        for f in [0.1_f32, 0.25, 0.5, 0.75, 0.9, 1.0] {
            let back = db_to_fader(fader_to_db(f));
            assert!((back - f).abs() < 0.01, "round trip {f} -> {back}");
        }
        assert_eq!(db_to_fader(None), 0.0);
    }

    #[test]
    fn mute_polarity_is_not_inverted() {
        // THE bit that must not be wrong: /mix/on ON(1) means UNMUTED.
        let mut s = crate::avantis::AvantisInner::default();
        apply_message(&mut s, "/ch/01/mix/on", &[OscType::Int(1)]);
        assert_eq!(s.mutes.get("input:1"), Some(&false), "ON must read as NOT muted");
        apply_message(&mut s, "/ch/01/mix/on", &[OscType::Int(0)]);
        assert_eq!(s.mutes.get("input:1"), Some(&true), "OFF must read as muted");
        // DCAs use the bare /on address and the same polarity.
        apply_message(&mut s, "/dca/3/on", &[OscType::Int(0)]);
        assert_eq!(s.mutes.get("dca:3"), Some(&true));
        // Mute GROUPS are the exception: ON means the group is muting.
        apply_message(&mut s, "/config/mute/2", &[OscType::Int(1)]);
        assert_eq!(s.mutes.get("mgrp:2"), Some(&true));
    }

    #[test]
    fn addresses_map_onto_prodecks_channel_keys() {
        use Field::*;
        assert_eq!(map_address("/ch/01/mix/on"), Some(Mute("input:1".into())));
        assert_eq!(map_address("/ch/32/mix/fader"), Some(Fader("input:32".into())));
        assert_eq!(map_address("/ch/07/config/name"), Some(Name("input:7".into())));
        // Aux inputs continue the input list at 33.
        assert_eq!(map_address("/auxin/01/mix/on"), Some(Mute("input:33".into())));
        assert_eq!(map_address("/auxin/08/mix/on"), Some(Mute("input:40".into())));
        assert_eq!(map_address("/fxrtn/02/mix/on"), Some(Mute("fxr:2".into())));
        assert_eq!(map_address("/bus/16/mix/fader"), Some(Fader("aux:16".into())));
        assert_eq!(map_address("/mtx/06/mix/on"), Some(Mute("mtx:6".into())));
        assert_eq!(map_address("/main/st/mix/fader"), Some(Fader("main:1".into())));
        assert_eq!(map_address("/main/m/mix/on"), Some(Mute("main:2".into())));
        assert_eq!(map_address("/dca/8/fader"), Some(Fader("dca:8".into())));
        assert_eq!(map_address("/dca/1/config/name"), Some(Name("dca:1".into())));
        assert_eq!(map_address("/config/mute/6"), Some(Mute("mgrp:6".into())));
        // Out of range and uninteresting addresses are ignored, not guessed at.
        assert_eq!(map_address("/ch/33/mix/on"), None);
        assert_eq!(map_address("/dca/9/on"), None);
        assert_eq!(map_address("/config/mute/7"), None);
        assert_eq!(map_address("/ch/01/eq/1/g"), None);
        assert_eq!(map_address("/-stat/solosw/01"), None);
        assert_eq!(map_address("/ch/01/mix/03/level"), None, "a bus SEND is not the fader");
    }

    #[test]
    fn write_addresses_round_trip_with_the_read_map() {
        // Anything we can write, we must read back to the same key — otherwise
        // a change made from ProDeck would land on a different channel in the
        // mirror than the one it moved on the desk.
        for key in [
            "input:1", "input:32", "input:33", "input:40", "fxr:1", "fxr:8", "aux:1", "aux:16",
            "mtx:1", "mtx:6", "main:1", "main:2", "dca:1", "dca:8",
        ] {
            let (base, bare) = address_for(key).expect(key);
            let addr = if bare { format!("{base}/on") } else { format!("{base}/mix/on") };
            assert_eq!(map_address(&addr), Some(Field::Mute(key.to_string())), "{key} -> {addr}");
        }
        assert_eq!(address_for("mgrp:1").unwrap().0, "/config/mute/1");
        assert!(address_for("input:41").is_none());
        assert!(address_for("sgrp:1").is_none(), "the X32 has no stereo groups");
    }

    #[test]
    fn names_are_read_and_truncated_like_the_console() {
        let mut s = crate::avantis::AvantisInner::default();
        assert!(apply_message(&mut s, "/ch/05/config/name", &[OscType::String("  Pastor  ".into())]));
        assert_eq!(s.names.get("input:5").unwrap(), "Pastor");
        // Same value twice is not a change (keeps the watchdog quiet).
        assert!(!apply_message(&mut s, "/ch/05/config/name", &[OscType::String("Pastor".into())]));
    }

    #[test]
    fn the_connect_time_read_covers_every_surface() {
        let q = query_addresses();
        assert!(q.contains(&"/ch/01/mix/on".to_string()));
        assert!(q.contains(&"/ch/32/config/name".to_string()));
        assert!(q.contains(&"/dca/8/fader".to_string()));
        assert!(q.contains(&"/config/mute/6".to_string()));
        assert!(q.contains(&"/main/st/mix/fader".to_string()));
        // Every queried address must be one we can actually interpret.
        for a in &q {
            assert!(map_address(a).is_some(), "queried {a} but can't map it");
        }
    }
}
