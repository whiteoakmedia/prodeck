//! Behringer WING (WING, WING Compact, WING Rack), over OSC.
//!
//! Like the X32 it is OSC over UDP, but a different dialect, so it has its own
//! driver. It fills the SAME mirror state with the SAME channel keys, so every
//! dashboard widget, the channel wall, automix and the desk watchdog work
//! unchanged.
//!
//! Protocol (Patrick-Gilles Maillot, "WING Remote Protocols", v3.0.5/3.0.6):
//!   * UDP port 2223.
//!   * `/*S` subscribes this client to parameter changes, each arriving as one
//!     typed value (`/ch/1/fdr ,f -3.0`, `/ch/1/mute ,i 1`). It dies after
//!     10 s and must be renewed; we resend every 8. The console keeps ONE OSC
//!     subscription, given to whoever asked last, so another OSC app (a
//!     Companion WING connection, say) can take the event stream away. The
//!     mirror therefore also re-reads everything every 30 s, so it can't sit
//!     on old values while someone else holds the subscription.
//!   * Sending an address with no arguments is a read. The reply carries three
//!     values: text, raw 0..1, and the real value (`,sff` / `,sfi`), or one
//!     string (`,s`) for names.
//!   * Mute is `/ch/1/mute` 0..1 where 1 means MUTED: the same sense ProDeck
//!     stores, not inverted like the X32's /mix/on.
//!   * Faders are dB floats, -144 meaning -oo, +10 at the top.
//!   * Like the X32, the desk only talks when something changes, so `/?`
//!     (always answered) goes out with each renewal as the heartbeat.

use crate::ahmap::{self, DeskModel};
use crate::avantis::{apply_fader, apply_mute, snapshot, AvantisState};
use rosc::{encoder, OscMessage, OscPacket, OscType};
use serde_json::json;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// The WING's OSC port. Fixed in the console's firmware.
const PORT: u16 = 2223;
/// Subscriptions and idle connections drop after 10 s; renew inside that.
const RENEW_SECS: u64 = 8;
/// Full re-read, in case another OSC app took the single subscription.
const REREAD_SECS: u64 = 30;
/// The desk's own floor: -144 dB is how it says -oo.
const FLOOR_DB: f32 = -144.0;

/// What one address carries, keyed to ProDeck's channel key.
#[derive(Debug, PartialEq)]
pub enum Field {
    Mute(String),
    Fader(String),
    Name(String),
    /// The scene number of the open show (`/$ctl/lib/$actidx`, 0 = none).
    Scene,
}

/// ProDeck key for a WING strip. Aux inputs continue the input list after the
/// 40 channels, as the X32's do after its 32.
fn key_for(kind: &str, n: u8) -> Option<String> {
    Some(match kind {
        "ch" if (1..=40).contains(&n) => format!("input:{n}"),
        "aux" if (1..=8).contains(&n) => format!("input:{}", 40 + n),
        "bus" if (1..=16).contains(&n) => format!("aux:{n}"),
        "mtx" if (1..=8).contains(&n) => format!("mtx:{n}"),
        "main" if (1..=4).contains(&n) => format!("main:{n}"),
        "dca" if (1..=16).contains(&n) => format!("dca:{n}"),
        "mgrp" if (1..=8).contains(&n) => format!("mgrp:{n}"),
        _ => return None,
    })
}

/// An OSC address → which channel and property. None for everything we don't
/// mirror, including the `$`-prefixed read-only twins (`/ch/1/$fdr` is the
/// level after DCAs, not the fader the operator set).
pub fn map_address(addr: &str) -> Option<Field> {
    if addr == "/$ctl/lib/$actidx" {
        return Some(Field::Scene);
    }
    let p: Vec<&str> = addr.trim_start_matches('/').split('/').collect();
    if p.len() != 3 {
        return None;
    }
    let n: u8 = p[1].parse().ok()?;
    let key = key_for(p[0], n)?;
    match p[2] {
        "mute" => Some(Field::Mute(key)),
        // Mute groups have a name and a mute, no fader.
        "fdr" if p[0] != "mgrp" => Some(Field::Fader(key)),
        "name" => Some(Field::Name(key)),
        _ => None,
    }
}

/// ProDeck key → the WING address prefix, for writes.
pub fn address_for(key: &str) -> Option<String> {
    let (kind, idx) = key.split_once(':')?;
    let i: u8 = idx.parse().ok()?;
    let (wing, n) = match kind {
        "input" if (1..=40).contains(&i) => ("ch", i),
        "input" if (41..=48).contains(&i) => ("aux", i - 40),
        "aux" if (1..=16).contains(&i) => ("bus", i),
        "mtx" if (1..=8).contains(&i) => ("mtx", i),
        "main" if (1..=4).contains(&i) => ("main", i),
        "dca" if (1..=16).contains(&i) => ("dca", i),
        "mgrp" if (1..=8).contains(&i) => ("mgrp", i),
        _ => return None,
    };
    Some(format!("/{wing}/{n}"))
}

/// Every address read at connect (and on each re-read), so the mirror starts
/// complete instead of blind until someone moves a fader.
fn query_addresses() -> Vec<String> {
    let mut v = Vec::new();
    let strips: [(&str, u8); 6] = [("ch", 40), ("aux", 8), ("bus", 16), ("mtx", 8), ("main", 4), ("dca", 16)];
    for (kind, count) in strips {
        for n in 1..=count {
            v.push(format!("/{kind}/{n}/mute"));
            v.push(format!("/{kind}/{n}/fdr"));
            v.push(format!("/{kind}/{n}/name"));
        }
    }
    for n in 1..=8 {
        v.push(format!("/mgrp/{n}/mute"));
        v.push(format!("/mgrp/{n}/name"));
    }
    v.push("/$ctl/lib/$actidx".to_string());
    v
}

/// The value that matters from a reply or an event. Reads answer `,sff` /
/// `,sfi` (text, raw 0..1, real value): the real value is the last one. Events
/// from `/*S` carry the real value alone.
fn real_value(args: &[OscType]) -> Option<&OscType> {
    match args.len() {
        3 => args.get(2),
        1 => args.first(),
        _ => None,
    }
}

fn as_f32(v: &OscType) -> Option<f32> {
    match v {
        OscType::Float(f) => Some(*f),
        OscType::Int(i) => Some(*i as f32),
        OscType::Double(d) => Some(*d as f32),
        _ => None,
    }
}

/// Apply one decoded OSC message to the mirror. True when something changed.
pub fn apply_message(s: &mut crate::avantis::AvantisInner, addr: &str, args: &[OscType]) -> bool {
    let Some(field) = map_address(addr) else { return false };
    match field {
        Field::Mute(key) => {
            let Some(v) = real_value(args).and_then(as_f32) else { return false };
            // 1 = muted, for channels, DCAs and mute groups alike.
            apply_mute(s, key, v >= 0.5)
        }
        Field::Fader(key) => {
            let Some(db) = real_value(args).and_then(as_f32) else { return false };
            let db = (db > FLOOR_DB + 0.5).then_some(db);
            apply_fader(s, key, ahmap::fader_u8_from_db(db))
        }
        Field::Name(key) => {
            let Some(OscType::String(n)) = args.first() else { return false };
            let n = n.trim().to_string();
            let old = s.names.insert(key, n.clone());
            old.as_deref() != Some(n.as_str())
        }
        Field::Scene => {
            let Some(v) = real_value(args).and_then(as_f32) else { return false };
            let scene = (v >= 1.0).then_some(v as u32);
            let changed = s.scene != scene;
            s.scene = scene;
            changed
        }
    }
}

fn msg(addr: &str, args: Vec<OscType>) -> Result<Vec<u8>, String> {
    encoder::encode(&OscPacket::Message(OscMessage { addr: addr.to_string(), args })).map_err(|e| e.to_string())
}

type Cfg = (bool, String, DeskModel, u16);

fn settings(app: &AppHandle) -> Cfg {
    let st = app.state::<crate::settings::SettingsState>();
    let s = st.lock().unwrap_or_else(|p| p.into_inner());
    // avantis_port may still hold another desk's default from before the
    // switch; those mean nothing to a WING.
    let port = match s.avantis_port {
        0 | 51325 | 51328 | 10023 | 49280 => PORT,
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
            s.model = DeskModel::Wing;
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

pub fn spawn_mirror(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state: AvantisState = app.state::<AvantisState>().inner().clone();
        loop {
            let cfg = settings(&app);
            let (enabled, host, model, port) = cfg.clone();
            if !enabled || host.trim().is_empty() || model != DeskModel::Wing {
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
            if let Err(e) = session(&app, &state, &host, port, cfg).await {
                crate::diag::log(format!("[wing] {e}"));
            }
            set_connected(&app, &state, false);
            tokio::time::sleep(Duration::from_secs(4)).await;
        }
    });
}

async fn read_all(sock: &tokio::net::UdpSocket) -> Result<(), String> {
    for a in query_addresses() {
        sock.send(&msg(&a, vec![])?).await.map_err(|e| e.to_string())?;
        // Don't flood the console: ~370 reads over about a second and a half.
        tokio::time::sleep(Duration::from_millis(4)).await;
    }
    Ok(())
}

async fn session(app: &AppHandle, state: &AvantisState, host: &str, port: u16, cfg: Cfg) -> Result<(), String> {
    let sock = tokio::net::UdpSocket::bind(("0.0.0.0", 0)).await.map_err(|e| e.to_string())?;
    sock.connect((host.trim(), port)).await.map_err(|e| e.to_string())?;

    sock.send(&msg("/*S", vec![])?).await.map_err(|e| e.to_string())?;
    sock.send(&msg("/?", vec![])?).await.map_err(|e| e.to_string())?;
    read_all(&sock).await?;

    let mut buf = [0u8; 32768];
    let mut renew = tokio::time::interval(Duration::from_secs(RENEW_SECS));
    renew.tick().await;
    let mut reread = tokio::time::interval(Duration::from_secs(REREAD_SECS));
    reread.tick().await;
    let mut emit = tokio::time::interval(Duration::from_millis(250));
    let mut check = tokio::time::interval(Duration::from_secs(2));
    check.tick().await;
    let mut dirty = false;
    let mut seen_any = false;
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
                if let Ok((_, OscPacket::Message(m))) = rosc::decoder::decode_udp(&buf[..n]) {
                    let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
                    dirty |= apply_message(&mut s, &m.addr, &m.args);
                }
            }
            _ = renew.tick() => {
                sock.send(&msg("/*S", vec![])?).await.map_err(|e| e.to_string())?;
                sock.send(&msg("/?", vec![])?).await.map_err(|e| e.to_string())?;
            }
            _ = reread.tick() => {
                read_all(&sock).await?;
            }
            _ = emit.tick() => {
                if dirty {
                    dirty = false;
                    app.emit("avantis:state", snapshot(state)).ok();
                }
            }
            _ = check.tick() => {
                if settings(app) != cfg {
                    return Ok(()); // settings changed: reconnect with them
                }
                if !seen_any || last_rx.elapsed() > Duration::from_secs(12) {
                    return Err("no reply from the console".into());
                }
            }
        }
    }
}

// ---- control (admin tier only; routed here from the desk commands) --------

async fn fire(app: &AppHandle, sends: Vec<(String, Vec<OscType>)>) -> Result<(), String> {
    let (enabled, host, model, port) = settings(app);
    if !enabled || host.trim().is_empty() || model != DeskModel::Wing {
        return Err("no WING configured".into());
    }
    let sock = tokio::net::UdpSocket::bind(("0.0.0.0", 0)).await.map_err(|e| e.to_string())?;
    sock.connect((host.trim(), port)).await.map_err(|e| e.to_string())?;
    for (addr, args) in sends {
        sock.send(&msg(&addr, args)?).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn set_mute(app: &AppHandle, key: &str, muted: bool) -> Result<(), String> {
    let base = address_for(key).ok_or("that channel doesn't exist on a WING")?;
    fire(app, vec![(format!("{base}/mute"), vec![OscType::Int(muted as i32)])]).await
}

pub async fn set_fader(app: &AppHandle, key: &str, value: u8) -> Result<(), String> {
    if key.starts_with("mgrp:") {
        return Err("mute groups have no fader".into());
    }
    let base = address_for(key).ok_or("that channel has no fader on a WING")?;
    let db = ahmap::db_from_fader_u8(value).unwrap_or(FLOOR_DB).clamp(FLOOR_DB, 10.0);
    fire(app, vec![(format!("{base}/fdr"), vec![OscType::Float(db)])]).await
}

pub async fn set_name(app: &AppHandle, key: &str, name: &str) -> Result<(), String> {
    let base = address_for(key).ok_or("that channel can't be renamed on a WING")?;
    // DCAs and mute groups take 8 characters, everything else 16.
    let max = if key.starts_with("dca:") || key.starts_with("mgrp:") { 8 } else { 16 };
    let n: String = name.chars().take(max).collect();
    fire(app, vec![(format!("{base}/name"), vec![OscType::String(n)])]).await
}

/// Load scene N of the show open on the desk (a show must be open).
pub async fn recall_scene(app: &AppHandle, scene: u32) -> Result<(), String> {
    fire(
        app,
        vec![
            ("/$ctl/lib/$actionidx".to_string(), vec![OscType::Int(scene as i32)]),
            ("/$ctl/lib/$action".to_string(), vec![OscType::String("GO".into())]),
        ],
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mute_reads_the_same_way_round_as_prodeck() {
        // The WING's 1 means muted. Getting this backwards would show a live
        // mic as muted during a service.
        let mut s = crate::avantis::AvantisInner::default();
        apply_message(&mut s, "/ch/1/mute", &[OscType::Int(1)]);
        assert_eq!(s.mutes.get("input:1"), Some(&true));
        apply_message(&mut s, "/ch/1/mute", &[OscType::Int(0)]);
        assert_eq!(s.mutes.get("input:1"), Some(&false));
        // A read reply: text, raw, real value.
        apply_message(&mut s, "/dca/3/mute", &[OscType::String("1".into()), OscType::Float(1.0), OscType::Int(1)]);
        assert_eq!(s.mutes.get("dca:3"), Some(&true));
        apply_message(&mut s, "/mgrp/2/mute", &[OscType::Int(1)]);
        assert_eq!(s.mutes.get("mgrp:2"), Some(&true));
    }

    #[test]
    fn faders_are_decibels_with_minus_144_as_off() {
        let mut s = crate::avantis::AvantisInner::default();
        apply_message(&mut s, "/ch/2/fdr", &[OscType::Float(0.0)]);
        assert_eq!(s.faders.get("input:2"), Some(&ahmap::fader_u8_from_db(Some(0.0))));
        // The reply form takes the dB value, not the raw 0..1 position.
        apply_message(&mut s, "/bus/4/fdr", &[OscType::String("-3.0".into()), OscType::Float(0.675), OscType::Float(-3.0)]);
        assert_eq!(s.faders.get("aux:4"), Some(&ahmap::fader_u8_from_db(Some(-3.0))));
        apply_message(&mut s, "/ch/2/fdr", &[OscType::Float(-144.0)]);
        assert_eq!(s.faders.get("input:2"), Some(&0), "-144 is off, not a very quiet fader");
    }

    #[test]
    fn addresses_map_onto_prodecks_channel_keys() {
        use Field::*;
        assert_eq!(map_address("/ch/1/mute"), Some(Mute("input:1".into())));
        assert_eq!(map_address("/ch/40/fdr"), Some(Fader("input:40".into())));
        assert_eq!(map_address("/aux/1/name"), Some(Name("input:41".into())));
        assert_eq!(map_address("/aux/8/mute"), Some(Mute("input:48".into())));
        assert_eq!(map_address("/bus/16/fdr"), Some(Fader("aux:16".into())));
        assert_eq!(map_address("/mtx/8/mute"), Some(Mute("mtx:8".into())));
        assert_eq!(map_address("/main/4/fdr"), Some(Fader("main:4".into())));
        assert_eq!(map_address("/dca/16/name"), Some(Name("dca:16".into())));
        assert_eq!(map_address("/mgrp/8/mute"), Some(Mute("mgrp:8".into())));
        assert_eq!(map_address("/$ctl/lib/$actidx"), Some(Scene));
        // Not ours: the DCA-affected twin, sends, out of range, a mute group fader.
        assert_eq!(map_address("/ch/1/$fdr"), None);
        assert_eq!(map_address("/ch/1/send/3/lvl"), None);
        assert_eq!(map_address("/ch/41/mute"), None);
        assert_eq!(map_address("/dca/17/fdr"), None);
        assert_eq!(map_address("/mgrp/1/fdr"), None);
    }

    #[test]
    fn write_addresses_round_trip_with_the_read_map() {
        for key in ["input:1", "input:40", "input:41", "input:48", "aux:1", "aux:16", "mtx:8", "main:1", "main:4", "dca:1", "dca:16", "mgrp:1", "mgrp:8"] {
            let base = address_for(key).expect(key);
            assert_eq!(map_address(&format!("{base}/mute")), Some(Field::Mute(key.to_string())), "{key} -> {base}");
        }
        assert!(address_for("input:49").is_none());
        assert!(address_for("fxr:1").is_none(), "WING FX returns come back on channels, not a separate list");
    }

    #[test]
    fn names_and_scene_number() {
        let mut s = crate::avantis::AvantisInner::default();
        assert!(apply_message(&mut s, "/ch/5/name", &[OscType::String(" Pastor ".into())]));
        assert_eq!(s.names.get("input:5").unwrap(), "Pastor");
        assert!(!apply_message(&mut s, "/ch/5/name", &[OscType::String("Pastor".into())]));
        apply_message(&mut s, "/$ctl/lib/$actidx", &[OscType::Int(3)]);
        assert_eq!(s.scene, Some(3));
        apply_message(&mut s, "/$ctl/lib/$actidx", &[OscType::Int(0)]);
        assert_eq!(s.scene, None, "0 means no scene loaded");
    }

    #[test]
    fn the_connect_time_read_covers_every_surface_and_only_what_we_read() {
        let q = query_addresses();
        for a in ["/ch/1/mute", "/ch/40/name", "/aux/8/fdr", "/bus/16/mute", "/main/4/fdr", "/dca/16/fdr", "/mgrp/8/name"] {
            assert!(q.contains(&a.to_string()), "{a}");
        }
        for a in &q {
            assert!(map_address(a).is_some(), "queried {a} but can't map it");
        }
    }
}
