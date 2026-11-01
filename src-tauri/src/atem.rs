//! Blackmagic ATEM switchers, over the ATEM UDP protocol (port 9910).
//!
//! The booth asks one thing of the switcher all service: *what's on Program,
//! what's on Preview, and take it*. So that is all this does. Program and
//! Preview tally on every M/E, the input names the switcher already has, Cut
//! and Auto, and picking the Preview source. No keyers, macros, audio or
//! media pool. Downstream keys (on air, auto, tie), Fade to Black and the
//! switcher's own macros (run, stop) too. Each ATEM tile picks its own M/E; Settings picks the default
//! (and the one Stream Deck drives unless a link says &me=).
//!
//! Off until a church ticks it on and types the switcher's address
//! (Settings → Video). A booth without an ATEM never opens the socket.
//!
//! Transport (reverse-engineered by the community; reference implementation
//! Sofie's atem-connection, MIT, which we tested against):
//!   Every packet: a 12-byte header, then commands.
//!     0..2   flags (top 5 bits) | packet length (low 11 bits)
//!     2..4   session id
//!     4..6   ack id (when acknowledging the switcher's packet)
//!     6..8   packet id the switcher wants resent (retransmit request)
//!     10..12 our packet id (when we want an ack)
//!   Flags: AckRequest 1, NewSessionId 2, IsRetransmit 4, RetransmitRequest 8,
//!   AckReply 16. Packet ids are 15 bits and wrap.
//!   Connect: send HELLO; the switcher answers with NewSessionId; ack it. It
//!   then streams its whole state (each packet wants an ack), switches to a
//!   new session id (always adopt the id on the latest packet), and keeps
//!   pinging with empty ack-requests. Silence for 5 s means it's gone.
//!   Commands: u16 length (incl. 8-byte header), u16 0, 4-char name, data.
//!
//! Admin-tier only from browsers, or a member with the "control" grant
//! (web.rs perm_for_cmd): this changes what the room and the stream see.

use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

pub const PORT: u16 = 9910;
const MAX_ID: u32 = 1 << 15;

const F_ACK_REQUEST: u8 = 1;
const F_NEW_SESSION: u8 = 2;
const F_RETRANSMIT_REQUEST: u8 = 8;
const F_ACK_REPLY: u8 = 16;

/// The connect packet every client sends (flags NewSessionId, length 20).
pub const HELLO: [u8; 20] = [
    0x10, 0x14, 0x53, 0xab, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3a, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00,
];

/// How long without a packet before we call the switcher gone. It pings
/// several times a second, so this only trips when it really is.
const SILENCE: Duration = Duration::from_secs(5);
/// Resend a command the switcher hasn't confirmed after this long.
const RESEND_AFTER: Duration = Duration::from_millis(150);
const MAX_RESENDS: u8 = 10;
/// A connected switcher sends its whole state within a second or two.
const STATE_DUMP_LIMIT: Duration = Duration::from_secs(10);
/// Re-ack the last packet if we've sent nothing for this long.
const KEEPALIVE: Duration = Duration::from_secs(1);

#[derive(Clone, Debug, PartialEq)]
pub struct Input {
    pub id: u16,
    pub name: String,
    pub short: String,
    /// The switcher's internal port type: 0 camera/external, 1 black,
    /// 2 bars, 3 colour, 4 media player, 5 media player key, 128+ outputs.
    pub kind: u8,
    /// Bit n set = usable on M/E n. Outputs and keys have none.
    pub me_mask: u8,
}

/// One M/E's tally.
#[derive(Clone, Default, Debug, PartialEq)]
pub struct MeState {
    pub program: Option<u16>,
    pub preview: Option<u16>,
    pub in_transition: bool,
}

/// One downstream keyer.
#[derive(Clone, Default, Debug, PartialEq)]
pub struct Dsk {
    pub on_air: bool,
    pub in_transition: bool,
    pub tie: bool,
    pub fill: Option<u16>,
    pub key: Option<u16>,
}

/// A macro stored on the switcher (only used slots are kept).
#[derive(Clone, Debug, PartialEq)]
pub struct Macro {
    pub index: u16,
    pub name: String,
    pub description: String,
}

/// Fade to Black on one M/E.
#[derive(Clone, Copy, Default, Debug, PartialEq)]
pub struct Ftb {
    pub black: bool,
    pub in_transition: bool,
}

/// Switchers have 1 to 4 M/Es. A byte claiming more is ignored, never allocated.
pub const MAX_MES: usize = 8;

#[derive(Default)]
pub struct AtemInner {
    pub connected: bool,
    /// "ATEM Television Studio HD8", from the switcher itself.
    pub product: String,
    /// How many M/Es the switcher has.
    pub mes: u8,
    /// The default M/E (Settings), 0-based. Tiles may show another.
    pub me: u8,
    pub inputs: Vec<Input>,
    /// Tally for every M/E the switcher has told us about, by index.
    pub buses: Vec<MeState>,
    /// The switcher's own tally, by source: bit 1 on air, bit 2 on preview.
    /// It already allows for keys, transitions and every M/E, which is what
    /// a camera operator's tally light must show. Empty until it sends one.
    pub tally: std::collections::BTreeMap<u16, u8>,
    /// Downstream keyers by index, as the switcher reports them.
    pub dsks: Vec<Dsk>,
    /// Used macro slots, by index.
    pub macros: std::collections::BTreeMap<u16, Macro>,
    /// The macro running now, if any, and whether it's waiting for Continue.
    pub macro_running: Option<u16>,
    pub macro_waiting: bool,
    /// Fade to Black by M/E.
    pub ftb: Vec<Ftb>,
    /// The address this state came from, so a new switcher starts clean.
    pub host: String,
    /// Link health for Settings: when this session connected and when the
    /// switcher was last heard (epoch ms), and drops since ProDeck started.
    pub link_since: Option<u64>,
    pub last_heard: Option<u64>,
    pub drops: u32,
    /// The switcher finished sending its state.
    pub ready: bool,
    pub error: Option<String>,
    /// Commands for the live session, if there is one.
    tx: Option<mpsc::UnboundedSender<Vec<u8>>>,
}

impl AtemInner {
    fn bus_mut(&mut self, me: u8) -> Option<&mut MeState> {
        let i = me as usize;
        if i >= MAX_MES {
            return None;
        }
        if self.buses.len() <= i {
            self.buses.resize(i + 1, MeState::default());
        }
        Some(&mut self.buses[i])
    }

    fn dsk_mut(&mut self, i: u8) -> &mut Dsk {
        let i = (i as usize).min(7);
        if self.dsks.len() <= i {
            self.dsks.resize(i + 1, Dsk::default());
        }
        &mut self.dsks[i]
    }

    pub fn bus(&self, me: u8) -> MeState {
        self.buses.get(me as usize).cloned().unwrap_or_default()
    }

    /// How many M/Es to offer: what the switcher says, at least one.
    pub fn me_count(&self) -> usize {
        (self.mes as usize).max(self.buses.len()).clamp(1, MAX_MES)
    }
}

pub type AtemState = Arc<Mutex<AtemInner>>;

pub fn new_state() -> AtemState {
    Arc::new(Mutex::new(AtemInner::default()))
}

/// Inputs worth a button on an M/E: anything the switcher says can go to
/// it. That leaves out outputs and media-player keys, which can't.
pub fn bus_inputs(s: &AtemInner, me: u8) -> Vec<&Input> {
    let bit = 1u8.checked_shl(me as u32).unwrap_or(0);
    s.inputs.iter().filter(|i| i.me_mask & bit != 0).collect()
}

pub fn snapshot(state: &AtemState) -> Value {
    let s = state.lock().unwrap_or_else(|p| p.into_inner());
    // Every source that can go to some M/E; each tile filters by its own.
    let inputs: Vec<Value> = s
        .inputs
        .iter()
        .filter(|i| i.me_mask != 0)
        .map(|i| json!({ "id": i.id, "name": i.name, "short": i.short, "camera": i.kind == 0, "meMask": i.me_mask }))
        .collect();
    let buses: Vec<Value> = (0..s.me_count())
        .map(|i| {
            let b = s.bus(i as u8);
            json!({ "program": b.program, "preview": b.preview, "inTransition": b.in_transition })
        })
        .collect();
    let cur = s.bus(s.me);
    json!({
        "connected": s.connected,
        "ready": s.ready,
        "product": s.product,
        "me": s.me,
        "mes": s.me_count(),
        // The default M/E's tally, as before M/E support.
        "program": cur.program,
        "preview": cur.preview,
        "inTransition": cur.in_transition,
        "buses": buses,
        // Source id → 1 on air, 2 preview, 3 both. Only sources that are lit.
        "dsks": s.dsks.iter().enumerate().map(|(i, k)| json!({ "index": i, "onAir": k.on_air, "inTransition": k.in_transition, "tie": k.tie, "fill": k.fill, "key": k.key })).collect::<Vec<_>>(),
        "macros": s.macros.values().map(|m| json!({ "index": m.index, "name": m.name, "description": m.description })).collect::<Vec<_>>(),
        "macroRunning": s.macro_running,
        "macroWaiting": s.macro_waiting,
        "ftb": s.ftb.iter().map(|f| json!({ "black": f.black, "inTransition": f.in_transition })).collect::<Vec<_>>(),
        "tally": s.tally.iter().filter(|(_, f)| **f != 0).map(|(k, v)| (k.to_string(), json!(v))).collect::<serde_json::Map<String, Value>>(),
        "inputs": inputs,
        "error": s.error,
        "linkSince": s.link_since,
        "lastHeard": s.last_heard,
        "drops": s.drops,
    })
}

// ---------------------------------------------------------------- packets

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Header {
    pub flags: u8,
    pub session: u16,
    pub ack_id: u16,
    pub resend_from: u16,
    pub packet_id: u16,
}

/// Read a packet's header. None if it's short or its length field lies.
pub fn parse_header(buf: &[u8]) -> Option<Header> {
    if buf.len() < 12 {
        return None;
    }
    let word = u16::from_be_bytes([buf[0], buf[1]]);
    if (word & 0x07ff) as usize != buf.len() {
        return None;
    }
    Some(Header {
        flags: buf[0] >> 3,
        session: u16::from_be_bytes([buf[2], buf[3]]),
        ack_id: u16::from_be_bytes([buf[4], buf[5]]),
        resend_from: u16::from_be_bytes([buf[6], buf[7]]),
        packet_id: u16::from_be_bytes([buf[10], buf[11]]),
    })
}

fn header(flags: u8, len: usize, session: u16) -> [u8; 12] {
    let mut h = [0u8; 12];
    let word = ((flags as u16) << 11) | (len as u16 & 0x07ff);
    h[0..2].copy_from_slice(&word.to_be_bytes());
    h[2..4].copy_from_slice(&session.to_be_bytes());
    h
}

/// "Got everything up to `id`."
pub fn ack_packet(session: u16, id: u16) -> [u8; 12] {
    let mut h = header(F_ACK_REPLY, 12, session);
    h[4..6].copy_from_slice(&id.to_be_bytes());
    h
}

/// Commands we want confirmed, as packet `id`.
pub fn data_packet(session: u16, id: u16, payload: &[u8]) -> Vec<u8> {
    let mut p = header(F_ACK_REQUEST, 12 + payload.len(), session).to_vec();
    p[10..12].copy_from_slice(&id.to_be_bytes());
    p.extend_from_slice(payload);
    p
}

pub fn command(name: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut c = Vec::with_capacity(8 + data.len());
    c.extend_from_slice(&((8 + data.len()) as u16).to_be_bytes());
    c.extend_from_slice(&[0, 0]);
    c.extend_from_slice(name);
    c.extend_from_slice(data);
    c
}

pub fn cmd_cut(me: u8) -> Vec<u8> {
    command(b"DCut", &[me, 0, 0, 0])
}
pub fn cmd_auto(me: u8) -> Vec<u8> {
    command(b"DAut", &[me, 0, 0, 0])
}
pub fn cmd_preview(me: u8, source: u16) -> Vec<u8> {
    let s = source.to_be_bytes();
    command(b"CPvI", &[me, 0, s[0], s[1]])
}
pub fn cmd_program(me: u8, source: u16) -> Vec<u8> {
    let s = source.to_be_bytes();
    command(b"CPgI", &[me, 0, s[0], s[1]])
}
/// Downstream key straight on or off air.
pub fn cmd_dsk_on_air(index: u8, on: bool) -> Vec<u8> {
    command(b"CDsL", &[index, on as u8, 0, 0])
}
/// Downstream key on or off with its own transition.
pub fn cmd_dsk_auto(index: u8) -> Vec<u8> {
    command(b"DDsA", &[index, 0, 0, 0])
}
/// Downstream key tied to the next transition.
pub fn cmd_dsk_tie(index: u8, tie: bool) -> Vec<u8> {
    command(b"CDsT", &[index, tie as u8, 0, 0])
}
/// Macro actions: 0 run, 1 stop (index 0xFFFF), 4 continue.
pub fn cmd_macro(index: u16, action: u8) -> Vec<u8> {
    let i = index.to_be_bytes();
    command(b"MAct", &[i[0], i[1], action, 0])
}
/// Fade to Black on an M/E (toggles: into black, or back out).
pub fn cmd_ftb(me: u8) -> Vec<u8> {
    command(b"FtbA", &[me, 0, 0, 0])
}

/// Split a packet's payload into (name, data). Stops at the first malformed
/// command rather than guessing.
pub fn parse_commands(mut p: &[u8]) -> Vec<([u8; 4], &[u8])> {
    let mut out = Vec::new();
    while p.len() >= 8 {
        let len = u16::from_be_bytes([p[0], p[1]]) as usize;
        if len < 8 || len > p.len() {
            break;
        }
        let name = [p[4], p[5], p[6], p[7]];
        out.push((name, &p[8..len]));
        p = &p[len..];
    }
    out
}

fn cstr(b: &[u8]) -> String {
    let end = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    String::from_utf8_lossy(&b[..end]).trim().to_string()
}

/// Apply one command from the switcher. True if anything a screen shows changed.
pub fn apply(s: &mut AtemInner, name: &[u8; 4], d: &[u8]) -> bool {
    match name {
        b"_pin" if d.len() >= 40 => {
            s.product = cstr(&d[..40]);
            true
        }
        b"_top" if !d.is_empty() => {
            s.mes = d[0];
            true
        }
        b"InPr" if d.len() >= 36 => {
            let input = Input {
                id: u16::from_be_bytes([d[0], d[1]]),
                name: cstr(&d[2..22]),
                short: cstr(&d[22..26]),
                kind: d[32],
                me_mask: d[35],
            };
            match s.inputs.iter_mut().find(|i| i.id == input.id) {
                Some(i) if *i == input => return false,
                Some(i) => *i = input,
                None => s.inputs.push(input),
            }
            true
        }
        b"PrgI" if d.len() >= 4 => {
            let v = Some(u16::from_be_bytes([d[2], d[3]]));
            match s.bus_mut(d[0]) {
                Some(b) if b.program != v => {
                    b.program = v;
                    true
                }
                _ => false,
            }
        }
        b"PrvI" if d.len() >= 4 => {
            let v = Some(u16::from_be_bytes([d[2], d[3]]));
            match s.bus_mut(d[0]) {
                Some(b) if b.preview != v => {
                    b.preview = v;
                    true
                }
                _ => false,
            }
        }
        b"TrPs" if d.len() >= 2 => {
            let t = d[1] == 1;
            match s.bus_mut(d[0]) {
                Some(b) if b.in_transition != t => {
                    b.in_transition = t;
                    true
                }
                _ => false,
            }
        }
        // Tally by source: u16 count, then (u16 source, u8 flags) each.
        b"TlSr" if d.len() >= 2 => {
            let n = u16::from_be_bytes([d[0], d[1]]) as usize;
            let mut t = std::collections::BTreeMap::new();
            for i in 0..n {
                let at = 2 + i * 3;
                let Some(e) = d.get(at..at + 3) else { break };
                t.insert(u16::from_be_bytes([e[0], e[1]]), e[2] & 0x03);
            }
            if t == s.tally {
                return false;
            }
            s.tally = t;
            true
        }
        // Downstream keyer state: index, on air, in transition, auto, frames left.
        b"DskS" if d.len() >= 3 => {
            let (on, tr) = (d[1] != 0, d[2] != 0);
            let k = s.dsk_mut(d[0]);
            let changed = k.on_air != on || k.in_transition != tr;
            k.on_air = on;
            k.in_transition = tr;
            changed
        }
        // Downstream keyer properties: index, tie, …
        b"DskP" if d.len() >= 2 => {
            let tie = d[1] != 0;
            let k = s.dsk_mut(d[0]);
            let changed = k.tie != tie;
            k.tie = tie;
            changed
        }
        // Downstream keyer sources: index, pad, u16 fill, u16 key.
        b"DskB" if d.len() >= 6 => {
            let (fill, key) = (u16::from_be_bytes([d[2], d[3]]), u16::from_be_bytes([d[4], d[5]]));
            let k = s.dsk_mut(d[0]);
            let changed = k.fill != Some(fill) || k.key != Some(key);
            k.fill = Some(fill);
            k.key = Some(key);
            changed
        }
        // Macro properties: u16 index, used, unsupported ops, u16 name length,
        // u16 description length, name, description.
        b"MPrp" if d.len() >= 8 => {
            let index = u16::from_be_bytes([d[0], d[1]]);
            let used = d[2] != 0;
            let nl = u16::from_be_bytes([d[4], d[5]]) as usize;
            let dl = u16::from_be_bytes([d[6], d[7]]) as usize;
            let name = d.get(8..8 + nl).map(|b| String::from_utf8_lossy(b).trim_end_matches('\0').trim().to_string()).unwrap_or_default();
            let description = d.get(8 + nl..8 + nl + dl).map(|b| String::from_utf8_lossy(b).trim_end_matches('\0').trim().to_string()).unwrap_or_default();
            if !used {
                return s.macros.remove(&index).is_some();
            }
            let m = Macro { index, name, description };
            if s.macros.get(&index) == Some(&m) {
                return false;
            }
            s.macros.insert(index, m);
            true
        }
        // Macro run status: flags (1 running, 2 waiting), loop, u16 index.
        b"MRPr" if d.len() >= 4 => {
            let running = d[0] & 1 != 0;
            let waiting = d[0] & 2 != 0;
            let now = running.then(|| u16::from_be_bytes([d[2], d[3]]));
            let changed = s.macro_running != now || s.macro_waiting != waiting;
            s.macro_running = now;
            s.macro_waiting = waiting;
            changed
        }
        // Fade to Black state: M/E, fully black, in transition, frames left.
        b"FtbS" if d.len() >= 3 => {
            let me = (d[0] as usize).min(MAX_MES - 1);
            if s.ftb.len() <= me {
                s.ftb.resize(me + 1, Ftb::default());
            }
            let f = Ftb { black: d[1] != 0, in_transition: d[2] != 0 };
            let changed = s.ftb[me] != f;
            s.ftb[me] = f;
            changed
        }
        b"InCm" => {
            s.ready = true;
            true
        }
        _ => false,
    }
}

/// Is packet `id` at or before `upto`, allowing for the 15-bit wrap?
pub fn covered(upto: u16, id: u16) -> bool {
    let d = (upto as u32 + MAX_ID - id as u32) % MAX_ID;
    d < MAX_ID / 2
}

/// How far `id` is past `last`: 1 = the next one in order.
pub fn distance(last: u16, id: u16) -> u32 {
    (id as u32 + MAX_ID - last as u32) % MAX_ID
}

// ---------------------------------------------------------------- client

fn settings(app: &AppHandle) -> (bool, String, u8) {
    let st = app.state::<crate::settings::SettingsState>();
    let g = st.lock().unwrap_or_else(|p| p.into_inner());
    (g.atem_enabled, g.atem_host.trim().to_string(), g.atem_me)
}

fn emit(app: &AppHandle, state: &AtemState) {
    let _ = app.emit("atem:state", snapshot(state));
}

fn set_down(app: &AppHandle, state: &AtemState, error: Option<String>) {
    let changed = {
        let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
        let changed = s.connected || s.error != error || s.tx.is_some();
        s.connected = false;
        s.ready = false;
        for b in s.buses.iter_mut() {
            b.in_transition = false;
        }
        s.tx = None;
        s.error = error;
        changed
    };
    if changed {
        emit(app, state);
    }
}

static RECONNECT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
pub fn atem_reconnect() {
    RECONNECT.store(true, std::sync::atomic::Ordering::Release);
}

#[tauri::command]
pub fn atem_state(state: tauri::State<'_, AtemState>) -> Value {
    snapshot(state.inner())
}

pub fn spawn_client(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state: AtemState = app.state::<AtemState>().inner().clone();
        let mut failures: u32 = 0;
        loop {
            let (enabled, host, me) = settings(&app);
            if !enabled || host.is_empty() {
                set_down(&app, &state, None);
                tokio::time::sleep(Duration::from_secs(3)).await;
                continue;
            }
            let result = run_session(&app, &state, &host, me).await;
            // A session that got as far as the switcher's whole state was a
            // real connection: reconnect quickly. One that never did backs
            // off, so a switcher that's off or full isn't hammered with new
            // sessions (each HELLO it answers holds one of its few slots
            // until it times out).
            let was_up = {
                let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
                let up = s.ready;
                if up && result.is_err() {
                    s.drops = s.drops.saturating_add(1);
                }
                up
            };
            match result {
                Ok(()) => set_down(&app, &state, None),
                Err(e) => {
                    crate::diag::log(format!("[atem] {e}"));
                    set_down(&app, &state, Some(e));
                }
            }
            failures = if was_up { 0 } else { failures.saturating_add(1) };
            tokio::time::sleep(retry_delay(failures)).await;
        }
    });
}

/// 1 s after a working session dropped; then 2, 4, 8, capped at 15 s while
/// the switcher keeps not answering.
pub fn retry_delay(failures: u32) -> Duration {
    Duration::from_millis((1000u64 << failures.min(4)).min(15_000))
}

async fn run_session(app: &AppHandle, state: &AtemState, host: &str, me: u8) -> Result<(), String> {
    let cfg = (true, host.to_string(), me);
    run_link(
        state,
        host,
        me,
        &|| emit(app, state),
        &|| !RECONNECT.swap(false, std::sync::atomic::Ordering::AcqRel) && settings(app) == cfg,
    )
    .await
}

/// The connection itself, with no app attached, so a test can drive it
/// against a stand-in switcher. `changed` runs after anything a screen shows
/// changes; `keep_going` is asked every two seconds (settings changed, or the
/// operator pressed Reconnect, ends the session cleanly).
pub async fn run_link(
    state: &AtemState,
    host: &str,
    me: u8,
    changed: &(dyn Fn() + Sync),
    keep_going: &(dyn Fn() -> bool + Sync),
) -> Result<(), String> {
    let sock = tokio::net::UdpSocket::bind(("0.0.0.0", 0))
        .await
        .map_err(|e| format!("couldn't open a network socket: {e}"))?;
    let addr = if host.contains(':') && !host.starts_with('[') && host.matches(':').count() == 1 {
        host.to_string() // host:port, for testing against a stand-in
    } else {
        format!("{host}:{PORT}")
    };
    sock.connect(&addr)
        .await
        .map_err(|_| format!("Can't find the switcher at {host}. Check the address in Settings."))?;

    // ---- Handshake: hello, wait for NewSessionId, ack it.
    let mut buf = [0u8; 2048];
    let mut session: u16 = 0;
    let mut last_recv: u16 = 0;
    let mut answered = false;
    for _ in 0..5 {
        let _ = sock.send(&HELLO).await;
        let deadline = Instant::now() + Duration::from_secs(1);
        while let Some(left) = deadline.checked_duration_since(Instant::now()) {
            let Ok(Ok(n)) = tokio::time::timeout(left, sock.recv(&mut buf)).await else { break };
            if let Some(h) = parse_header(&buf[..n]) {
                if h.flags & F_NEW_SESSION != 0 {
                    session = h.session;
                    last_recv = h.packet_id;
                    answered = true;
                    break;
                }
            }
        }
        if answered {
            break;
        }
    }
    if !answered {
        return Err(format!(
            "No answer from the switcher at {host}. Check it's on and on the same network as this computer."
        ));
    }
    let _ = sock.send(&ack_packet(session, last_recv)).await;

    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    {
        let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
        // Same switcher as before: keep the last known names and tally on
        // screen while it re-sends them, instead of blanking every tile on a
        // blip. A different address starts clean.
        if s.host != host {
            s.inputs.clear();
            s.buses.clear();
            s.tally.clear();
            s.dsks.clear();
            s.macros.clear();
            s.ftb.clear();
            s.macro_running = None;
            s.product.clear();
            s.mes = 0;
            s.host = host.to_string();
        }
        s.connected = true;
        s.ready = false;
        s.me = me;
        s.error = None;
        s.tx = Some(tx);
        let now = crate::identity::now_ms();
        s.link_since = Some(now);
        s.last_heard = Some(now);
    }
    changed();
    let connected_at = Instant::now();
    let mut last_sent = Instant::now();

    let mut next_id: u16 = 1;
    // (packet id, bytes, last sent, resends)
    let mut inflight: VecDeque<(u16, Vec<u8>, Instant, u8)> = VecDeque::new();
    let mut last_heard = Instant::now();
    let mut tick = tokio::time::interval(Duration::from_millis(50));
    let mut cfg_check = tokio::time::interval(Duration::from_secs(2));
    cfg_check.tick().await;

    loop {
        tokio::select! {
            r = sock.recv(&mut buf) => {
                let n = match r {
                    Ok(n) => n,
                    // ICMP "port unreachable" lands here on some systems; the
                    // silence check decides when it's really gone. The pause
                    // keeps an error that repeats from spinning the loop.
                    Err(_) => {
                        tokio::time::sleep(Duration::from_millis(20)).await;
                        continue;
                    }
                };
                let Some(h) = parse_header(&buf[..n]) else { continue };
                if last_heard.elapsed() > Duration::from_millis(500) {
                    state.lock().unwrap_or_else(|p| p.into_inner()).last_heard = Some(crate::identity::now_ms());
                }
                last_heard = Instant::now();
                session = h.session;
                if h.flags & F_NEW_SESSION != 0 {
                    last_recv = h.packet_id;
                    let _ = sock.send(&ack_packet(session, last_recv)).await;
                    continue;
                }
                if h.flags & F_RETRANSMIT_REQUEST != 0 {
                    for (id, pkt, sent, tries) in inflight.iter_mut() {
                        if *id == h.resend_from || !covered(h.resend_from, *id) {
                            pkt[2..4].copy_from_slice(&session.to_be_bytes());
                            let _ = sock.send(pkt).await;
                            *sent = Instant::now();
                            *tries += 1;
                        }
                    }
                }
                if h.flags & F_ACK_REQUEST != 0 && (h.packet_id as u32) < MAX_ID {
                    match distance(last_recv, h.packet_id) {
                        1 => {
                            last_recv = h.packet_id;
                            if n > 12 {
                                let dirty = {
                                    let mut s = state.lock().unwrap_or_else(|p| p.into_inner());
                                    let mut d = false;
                                    for (name, data) in parse_commands(&buf[12..n]) {
                                        d |= apply(&mut s, &name, data);
                                    }
                                    d
                                };
                                if dirty {
                                    changed();
                                }
                            }
                            let _ = sock.send(&ack_packet(session, last_recv)).await;
                            last_sent = Instant::now();
                        }
                        // A resend of something we already have: ack again so
                        // it stops. Anything ahead of a gap is dropped; the
                        // switcher resends it after the missing one.
                        d if d == 0 || d > MAX_ID / 2 => {
                            let _ = sock.send(&ack_packet(session, last_recv)).await;
                        }
                        _ => {}
                    }
                }
                if h.flags & F_ACK_REPLY != 0 {
                    inflight.retain(|(id, ..)| !covered(h.ack_id, *id));
                }
            }
            Some(payload) = rx.recv() => {
                let id = next_id;
                next_id = ((next_id as u32 + 1) % MAX_ID) as u16;
                let pkt = data_packet(session, id, &payload);
                let _ = sock.send(&pkt).await;
                last_sent = Instant::now();
                inflight.push_back((id, pkt, Instant::now(), 0));
            }
            _ = tick.tick() => {
                if last_heard.elapsed() > SILENCE {
                    return Err("The switcher stopped answering. Reconnecting.".into());
                }
                // It answered hello but never sent its state: usually every
                // connection slot it has is taken.
                if connected_at.elapsed() > STATE_DUMP_LIMIT && !state.lock().unwrap_or_else(|p| p.into_inner()).ready {
                    return Err("The switcher answered but didn't send its settings. It may have no free connections: close ATEM Software Control on another computer, then press Reconnect.".into());
                }
                // Our side of the keepalive, so a quiet link through a busy
                // switch or firewall still looks alive from both ends.
                if last_sent.elapsed() > KEEPALIVE {
                    let _ = sock.send(&ack_packet(session, last_recv)).await;
                    last_sent = Instant::now();
                }
                for (_, pkt, sent, tries) in inflight.iter_mut() {
                    if sent.elapsed() >= RESEND_AFTER {
                        if *tries >= MAX_RESENDS {
                            return Err("The switcher didn't confirm a command. Reconnecting.".into());
                        }
                        pkt[2..4].copy_from_slice(&session.to_be_bytes());
                        let _ = sock.send(pkt).await;
                        *sent = Instant::now();
                        *tries += 1;
                    }
                }
            }
            _ = cfg_check.tick() => {
                if !keep_going() {
                    return Ok(());
                }
            }
        }
    }
}

// ---------------------------------------------------------------- control

fn send(state: &AtemState, payload: Vec<u8>) -> Result<(), String> {
    let s = state.lock().unwrap_or_else(|p| p.into_inner());
    match (&s.tx, s.connected) {
        (Some(tx), true) => tx.send(payload).map_err(|_| "The switcher just disconnected. Try again in a moment.".to_string()),
        _ => Err("The switcher isn't connected.".into()),
    }
}

/// The M/E a command is for: the one asked for, else the default. Refused if
/// the switcher doesn't have it.
fn resolve_me(state: &AtemState, me: Option<u8>) -> Result<u8, String> {
    let s = state.lock().unwrap_or_else(|p| p.into_inner());
    let me = me.unwrap_or(s.me);
    if s.mes > 0 && me >= s.mes {
        return Err(format!("This switcher has {} M/E{}.", s.mes, if s.mes == 1 { "" } else { "s" }));
    }
    Ok(me)
}

fn check_source(state: &AtemState, source: u16, me: Option<u8>) -> Result<u8, String> {
    let me = resolve_me(state, me)?;
    let s = state.lock().unwrap_or_else(|p| p.into_inner());
    if !bus_inputs(&s, me).iter().any(|i| i.id == source) {
        return Err("That source can't go to this M/E.".into());
    }
    Ok(me)
}

/// Take Preview to Program with no transition. `me` 0-based; default M/E if absent.
#[tauri::command]
pub fn atem_cut(me: Option<u8>, state: tauri::State<'_, AtemState>) -> Result<(), String> {
    let st = state.inner();
    send(st, cmd_cut(resolve_me(st, me)?))
}

/// Take Preview to Program with the switcher's current transition.
#[tauri::command]
pub fn atem_auto(me: Option<u8>, state: tauri::State<'_, AtemState>) -> Result<(), String> {
    let st = state.inner();
    send(st, cmd_auto(resolve_me(st, me)?))
}

#[tauri::command]
pub fn atem_set_preview(source: u16, me: Option<u8>, state: tauri::State<'_, AtemState>) -> Result<(), String> {
    let st = state.inner();
    let me = check_source(st, source, me)?;
    send(st, cmd_preview(me, source))
}

fn check_dsk(state: &AtemState, index: u8) -> Result<(), String> {
    let s = state.lock().unwrap_or_else(|p| p.into_inner());
    if (index as usize) < s.dsks.len() {
        Ok(())
    } else {
        Err(format!("This switcher has {} downstream key{}.", s.dsks.len(), if s.dsks.len() == 1 { "" } else { "s" }))
    }
}

/// Downstream key `index` (0-based) on or off air at once; `on` absent = the opposite of now.
#[tauri::command]
pub fn atem_dsk_on_air(index: u8, on: Option<bool>, state: tauri::State<'_, AtemState>) -> Result<(), String> {
    let st = state.inner();
    check_dsk(st, index)?;
    let on = on.unwrap_or_else(|| !st.lock().unwrap_or_else(|p| p.into_inner()).dsks[index as usize].on_air);
    send(st, cmd_dsk_on_air(index, on))
}

/// Downstream key on or off with the key's own transition.
#[tauri::command]
pub fn atem_dsk_auto(index: u8, state: tauri::State<'_, AtemState>) -> Result<(), String> {
    let st = state.inner();
    check_dsk(st, index)?;
    send(st, cmd_dsk_auto(index))
}

#[tauri::command]
pub fn atem_dsk_tie(index: u8, tie: bool, state: tauri::State<'_, AtemState>) -> Result<(), String> {
    let st = state.inner();
    check_dsk(st, index)?;
    send(st, cmd_dsk_tie(index, tie))
}

/// Run one of the switcher's macros (0-based slot).
#[tauri::command]
pub fn atem_macro_run(index: u16, state: tauri::State<'_, AtemState>) -> Result<(), String> {
    let st = state.inner();
    if !st.lock().unwrap_or_else(|p| p.into_inner()).macros.contains_key(&index) {
        return Err("There's no macro in that slot on the switcher.".into());
    }
    send(st, cmd_macro(index, 0))
}

/// Stop the running macro.
#[tauri::command]
pub fn atem_macro_stop(state: tauri::State<'_, AtemState>) -> Result<(), String> {
    send(state.inner(), cmd_macro(0xFFFF, 1))
}

/// A macro waiting at a user wait goes on.
#[tauri::command]
pub fn atem_macro_continue(state: tauri::State<'_, AtemState>) -> Result<(), String> {
    send(state.inner(), cmd_macro(0xFFFF, 4))
}

/// Fade to Black (or back) on an M/E; default M/E if absent.
#[tauri::command]
pub fn atem_ftb(me: Option<u8>, state: tauri::State<'_, AtemState>) -> Result<(), String> {
    let st = state.inner();
    send(st, cmd_ftb(resolve_me(st, me)?))
}

/// Straight to Program, no transition. The tile doesn't offer this (a stray
/// tap would cut live); it's here for Stream Deck and the deck routes.
#[tauri::command]
pub fn atem_set_program(source: u16, me: Option<u8>, state: tauri::State<'_, AtemState>) -> Result<(), String> {
    let st = state.inner();
    let me = check_source(st, source, me)?;
    send(st, cmd_program(me, source))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn in_pr(id: u16, long: &str, short: &str, kind: u8, me_mask: u8) -> Vec<u8> {
        let mut d = vec![0u8; 36];
        d[0..2].copy_from_slice(&id.to_be_bytes());
        d[2..2 + long.len()].copy_from_slice(long.as_bytes());
        d[22..22 + short.len()].copy_from_slice(short.as_bytes());
        d[32] = kind;
        d[35] = me_mask;
        d
    }

    // Byte layouts checked against Sofie's atem-connection (MIT), the
    // reference client: CPgI/CPvI are me, pad, u16 source; DCut/DAut are me
    // plus three pad bytes; every command has an 8-byte header.
    #[test]
    fn commands_match_the_reference_layout() {
        assert_eq!(cmd_cut(0), vec![0, 12, 0, 0, b'D', b'C', b'u', b't', 0, 0, 0, 0]);
        assert_eq!(cmd_auto(1), vec![0, 12, 0, 0, b'D', b'A', b'u', b't', 1, 0, 0, 0]);
        assert_eq!(cmd_preview(0, 3010), vec![0, 12, 0, 0, b'C', b'P', b'v', b'I', 0, 0, 0x0b, 0xc2]);
        assert_eq!(cmd_program(0, 2), vec![0, 12, 0, 0, b'C', b'P', b'g', b'I', 0, 0, 0, 2]);
    }

    #[test]
    fn packets_round_trip() {
        let p = data_packet(0x8123, 7, &cmd_cut(0));
        let h = parse_header(&p).unwrap();
        assert_eq!(h.flags, F_ACK_REQUEST);
        assert_eq!(h.session, 0x8123);
        assert_eq!(h.packet_id, 7);
        assert_eq!(parse_commands(&p[12..]), vec![(*b"DCut", &[0u8, 0, 0, 0][..])]);

        let a = ack_packet(0x8123, 42);
        let h = parse_header(&a).unwrap();
        assert_eq!((h.flags, h.ack_id), (F_ACK_REPLY, 42));

        let hello = parse_header(&HELLO).unwrap();
        assert_eq!(hello.flags, F_NEW_SESSION);
        // A packet whose length field disagrees with its size is ignored.
        assert!(parse_header(&p[..p.len() - 1]).is_none());
        assert!(parse_header(&[0u8; 5]).is_none());
    }

    #[test]
    fn malformed_commands_stop_the_parse() {
        let mut p = command(b"PrgI", &[0, 0, 0, 1]);
        p.extend_from_slice(&[0, 200, 0, 0, b'X', b'X', b'X', b'X']); // claims 200 bytes, has 8
        assert_eq!(parse_commands(&p).len(), 1);
        assert!(parse_commands(&[0, 3, 0, 0, b'a', b'b', b'c', b'd']).is_empty());
    }

    #[test]
    fn state_follows_the_switcher() {
        let mut s = AtemInner::default();
        let mut pin = vec![0u8; 44];
        pin[..26].copy_from_slice(b"ATEM Television Studio HD8");
        assert!(apply(&mut s, b"_pin", &pin));
        assert_eq!(s.product, "ATEM Television Studio HD8");
        assert!(apply(&mut s, b"InPr", &in_pr(1, "Camera 1 Wide", "CAM1", 0, 0x1f)));
        assert!(apply(&mut s, b"InPr", &in_pr(3011, "Media Player 1 Key", "MP1K", 5, 0)));
        assert!(apply(&mut s, b"InPr", &in_pr(10010, "Program", "PGM", 128, 0)));
        // The same input again changes nothing.
        assert!(!apply(&mut s, b"InPr", &in_pr(1, "Camera 1 Wide", "CAM1", 0, 0x1f)));
        // Renamed on the switcher: picked up.
        assert!(apply(&mut s, b"InPr", &in_pr(1, "Wide", "WIDE", 0, 0x1f)));
        let names: Vec<_> = bus_inputs(&s, 0).iter().map(|i| i.name.clone()).collect();
        assert_eq!(names, vec!["Wide"], "keys and outputs never get a button");

        assert!(apply(&mut s, b"PrgI", &[0, 0, 0, 1]));
        assert!(apply(&mut s, b"PrvI", &[0, 0, 0x0b, 0xc2]));
        assert_eq!((s.bus(0).program, s.bus(0).preview), (Some(1), Some(3010)));
        // The same tally again isn't news.
        assert!(!apply(&mut s, b"PrgI", &[0, 0, 0, 1]));
        // Another M/E keeps its own tally.
        assert!(apply(&mut s, b"PrgI", &[1, 0, 0, 4]));
        assert_eq!((s.bus(0).program, s.bus(1).program), (Some(1), Some(4)));
        // A nonsense M/E index is ignored, never allocated.
        assert!(!apply(&mut s, b"PrgI", &[200, 0, 0, 4]));
        assert_eq!(s.buses.len(), 2);
        assert!(apply(&mut s, b"TrPs", &[0, 1, 25, 0, 0, 0, 0, 0]));
        assert!(s.bus(0).in_transition);
        assert!(!apply(&mut s, b"TrPs", &[0, 1, 20, 0, 0, 0, 0, 0]), "still mid-transition");
        assert!(apply(&mut s, b"InCm", &[]));
        assert!(s.ready);
        // Short or unknown commands are ignored, never a panic.
        assert!(!apply(&mut s, b"PrgI", &[0]));
        assert!(!apply(&mut s, b"InPr", &[0; 10]));
        assert!(!apply(&mut s, b"Zzzz", &[1, 2, 3]));
    }

    #[test]
    fn me_two_reads_its_own_bus() {
        let mut s = AtemInner { me: 1, ..Default::default() };
        apply(&mut s, b"InPr", &in_pr(1, "Cam 1", "C1", 0, 0b01)); // M/E 1 only
        apply(&mut s, b"InPr", &in_pr(2, "Cam 2", "C2", 0, 0b11));
        assert_eq!(bus_inputs(&s, 1).iter().map(|i| i.id).collect::<Vec<_>>(), vec![2]);
        assert_eq!(bus_inputs(&s, 0).len(), 2);
        assert!(apply(&mut s, b"PrgI", &[1, 0, 0, 2]));
        assert_eq!(s.bus(1).program, Some(2));
        assert!(bus_inputs(&s, 9).is_empty(), "an out-of-range M/E shows nothing instead of panicking");
    }

    #[test]
    fn snapshot_carries_every_me() {
        let st = new_state();
        {
            let mut s = st.lock().unwrap();
            s.mes = 2;
            apply(&mut s, b"InPr", &in_pr(1, "Cam 1", "C1", 0, 0b11));
            apply(&mut s, b"InPr", &in_pr(3011, "MP1 Key", "MP1K", 5, 0));
            apply(&mut s, b"PrgI", &[0, 0, 0, 1]);
            apply(&mut s, b"PrvI", &[1, 0, 0, 1]);
        }
        let v = snapshot(&st);
        assert_eq!(v["mes"], 2);
        assert_eq!(v["buses"][0]["program"], 1);
        assert_eq!(v["buses"][1]["preview"], 1);
        assert_eq!(v["program"], 1, "the default M/E, as before");
        assert_eq!(v["inputs"].as_array().unwrap().len(), 1, "keys never get a button");
        assert_eq!(v["inputs"][0]["meMask"], 3);
    }

    #[test]
    fn commands_refuse_an_me_the_switcher_lacks() {
        let st = new_state();
        {
            let mut s = st.lock().unwrap();
            s.mes = 1;
            apply(&mut s, b"InPr", &in_pr(1, "Cam 1", "C1", 0, 0b01));
        }
        assert_eq!(resolve_me(&st, None), Ok(0));
        assert!(resolve_me(&st, Some(1)).unwrap_err().contains("1 M/E."));
        assert_eq!(check_source(&st, 1, Some(0)), Ok(0));
        assert!(check_source(&st, 2, None).is_err());
    }

    #[test]
    fn tally_by_source_is_the_switchers_own() {
        let mut s = AtemInner::default();
        // Three sources: 1 on air, 2 on preview, 3 both (mid-transition).
        let d = [0, 3, 0, 1, 1, 0, 2, 2, 0, 3, 3];
        assert!(apply(&mut s, b"TlSr", &d));
        assert_eq!(s.tally.get(&1), Some(&1));
        assert_eq!(s.tally.get(&2), Some(&2));
        assert_eq!(s.tally.get(&3), Some(&3));
        assert!(!apply(&mut s, b"TlSr", &d), "unchanged tally isn't news");
        // A count that overstates what's there stops at the data, no panic.
        assert!(apply(&mut s, b"TlSr", &[0, 9, 0, 4, 1]));
        assert_eq!(s.tally.len(), 1);
        assert!(!apply(&mut s, b"TlSr", &[0]));
        let st = new_state();
        st.lock().unwrap().tally = [(1u16, 1u8), (2, 0)].into_iter().collect();
        let v = snapshot(&st);
        assert_eq!(v["tally"]["1"], 1);
        assert!(v["tally"].get("2").is_none(), "only lit sources are sent");
    }

    #[test]
    fn keys_macros_and_fade_to_black_follow_the_switcher() {
        let mut s = AtemInner::default();
        assert!(apply(&mut s, b"DskB", &[1, 0, 0, 15, 0, 16]));
        assert_eq!(s.dsks.len(), 2, "keyer 2 reported first still makes room for 1");
        assert_eq!((s.dsks[1].fill, s.dsks[1].key), (Some(15), Some(16)));
        assert!(apply(&mut s, b"DskS", &[1, 1, 0, 0, 0, 0, 0, 0]));
        assert!(s.dsks[1].on_air);
        assert!(!apply(&mut s, b"DskS", &[1, 1, 0, 0, 0, 0, 0, 0]), "unchanged isn't news");
        assert!(apply(&mut s, b"DskP", &[1, 1, 25, 0]));
        assert!(s.dsks[1].tie);

        // Macro 3 "Sermon look" with a description.
        let mut m = vec![0, 3, 1, 0, 0, 11, 0, 5];
        m.extend_from_slice(b"Sermon lookCam 2");
        assert!(apply(&mut s, b"MPrp", &m));
        assert_eq!(s.macros[&3].name, "Sermon look");
        assert_eq!(s.macros[&3].description, "Cam 2");
        // An emptied slot disappears.
        assert!(apply(&mut s, b"MPrp", &[0, 3, 0, 0, 0, 0, 0, 0]));
        assert!(s.macros.is_empty());
        // A name length past the data is cut short, not a panic.
        assert!(apply(&mut s, b"MPrp", &[0, 4, 1, 0, 0, 99, 0, 0, b'X']));
        assert_eq!(s.macros[&4].name, "");
        assert!(apply(&mut s, b"MRPr", &[1, 0, 0, 4]));
        assert_eq!((s.macro_running, s.macro_waiting), (Some(4), false));
        assert!(apply(&mut s, b"MRPr", &[0, 0, 0, 0]));
        assert_eq!(s.macro_running, None);

        assert!(apply(&mut s, b"FtbS", &[0, 1, 0, 0]));
        assert!(s.ftb[0].black);
        assert!(!apply(&mut s, b"FtbS", &[0]), "short is ignored");
    }

    #[test]
    fn key_macro_and_fade_commands_match_the_reference_layout() {
        assert_eq!(cmd_dsk_on_air(1, true), vec![0, 12, 0, 0, b'C', b'D', b's', b'L', 1, 1, 0, 0]);
        assert_eq!(cmd_dsk_auto(0), vec![0, 12, 0, 0, b'D', b'D', b's', b'A', 0, 0, 0, 0]);
        assert_eq!(cmd_dsk_tie(0, true), vec![0, 12, 0, 0, b'C', b'D', b's', b'T', 0, 1, 0, 0]);
        assert_eq!(cmd_macro(3, 0), vec![0, 12, 0, 0, b'M', b'A', b'c', b't', 0, 3, 0, 0]);
        assert_eq!(cmd_macro(0xFFFF, 1), vec![0, 12, 0, 0, b'M', b'A', b'c', b't', 0xFF, 0xFF, 1, 0]);
        assert_eq!(cmd_ftb(1), vec![0, 12, 0, 0, b'F', b't', b'b', b'A', 1, 0, 0, 0]);
    }

    #[test]
    fn retries_back_off_but_not_forever() {
        assert_eq!(retry_delay(0), Duration::from_secs(1));
        assert_eq!(retry_delay(1), Duration::from_secs(2));
        assert_eq!(retry_delay(3), Duration::from_secs(8));
        assert_eq!(retry_delay(40), Duration::from_secs(15));
    }

    #[test]
    fn packet_ids_wrap_at_fifteen_bits() {
        assert_eq!(distance(5, 6), 1);
        assert_eq!(distance(32767, 0), 1);
        assert_eq!(distance(6, 6), 0);
        assert!(distance(10, 3) > MAX_ID / 2, "an old resend reads as behind us");
        assert!(covered(10, 3));
        assert!(covered(10, 10));
        assert!(!covered(10, 11));
        assert!(covered(2, 32760), "acks across the wrap");
    }

    /// End to end against a stand-in switcher: scripts/fake-atem.cjs, which we
    /// checked against atem-connection (the reference client) first.
    ///   node scripts/fake-atem.cjs --port 9911 &   (add --drop 0.2 for loss)
    ///   ATEM_TEST_ADDR=127.0.0.1:9911 cargo test atem_live -- --ignored
    #[tokio::test]
    #[ignore]
    async fn atem_live_against_the_stand_in() {
        let addr = std::env::var("ATEM_TEST_ADDR").expect("set ATEM_TEST_ADDR=host:port");
        let state = new_state();
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let changes = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let (st, sp, ch) = (state.clone(), stop.clone(), changes.clone());
        let link = tokio::spawn(async move {
            run_link(
                &st,
                &addr,
                0,
                &move || {
                    ch.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                },
                &move || !sp.load(std::sync::atomic::Ordering::Relaxed),
            )
            .await
        });
        async fn wait_for(state: &AtemState, what: &str, f: impl Fn(&AtemInner) -> bool) {
            for _ in 0..100 {
                if f(&state.lock().unwrap()) {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            let s = state.lock().unwrap();
            panic!("timed out waiting for {what}: tally {:?} ready {} err {:?}", s.bus(0), s.ready, s.error);
        }
        wait_for(&state, "the state dump", |s| s.ready).await;
        {
            let s = state.lock().unwrap();
            assert_eq!(s.product, "ATEM Television Studio HD8");
            assert_eq!((s.bus(0).program, s.bus(0).preview), (Some(1), Some(2)));
            let names: Vec<_> = bus_inputs(&s, 0).iter().map(|i| i.name.clone()).collect();
            assert_eq!(names, ["Black", "Camera 1 Wide", "Camera 2 Pulpit", "Camera 3 Stage", "ProPresenter", "Color Bars", "Media Player 1"]);
        }
        assert!(changes.load(std::sync::atomic::Ordering::Relaxed) > 0, "screens were told");

        let me = check_source(&state, 4, None).unwrap();
        assert!(check_source(&state, 10010, None).is_err(), "outputs can't go to Preview");
        send(&state, cmd_preview(me, 4)).unwrap();
        wait_for(&state, "preview 4", |s| s.bus(0).preview == Some(4)).await;
        send(&state, cmd_cut(me)).unwrap();
        wait_for(&state, "the cut", |s| s.bus(0).program == Some(4) && s.bus(0).preview == Some(1)).await;
        // The switcher's own tally follows: camera 4 on air, 1 on preview.
        wait_for(&state, "tally after the cut", |s| s.tally.get(&4) == Some(&1) && s.tally.get(&1) == Some(&2)).await;
        send(&state, cmd_auto(me)).unwrap();
        wait_for(&state, "the auto transition", |s| s.bus(0).program == Some(1) && !s.bus(0).in_transition).await;
        // Keys, macros and Fade to Black, the way the switcher reports them.
        wait_for(&state, "the keys and macros", |s| s.dsks.len() == 2 && s.macros.len() == 2).await;
        assert_eq!(state.lock().unwrap().macros[&2].name, "Sermon look");
        send(&state, cmd_dsk_on_air(1, true)).unwrap();
        wait_for(&state, "DSK 2 on air", |s| s.dsks[1].on_air).await;
        send(&state, cmd_dsk_auto(1)).unwrap();
        wait_for(&state, "DSK 2 off again", |s| !s.dsks[1].on_air).await;
        send(&state, cmd_macro(2, 0)).unwrap();
        wait_for(&state, "the macro running", |s| s.macro_running == Some(2)).await;
        wait_for(&state, "the macro done", |s| s.macro_running.is_none()).await;
        send(&state, cmd_ftb(0)).unwrap();
        wait_for(&state, "fade to black", |s| s.ftb.first().map(|f| f.black) == Some(true)).await;
        send(&state, cmd_ftb(0)).unwrap();
        wait_for(&state, "back from black", |s| s.ftb.first().map(|f| f.black) == Some(false)).await;
        send(&state, cmd_program(me, 3)).unwrap();
        wait_for(&state, "program 3", |s| s.bus(0).program == Some(3)).await;

        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let r = tokio::time::timeout(Duration::from_secs(5), link).await.expect("session ends when asked").unwrap();
        assert_eq!(r, Ok(()));
    }

    /// The switcher loses power mid-service: the session must end with a
    /// plain reason (so the tile says so) instead of showing stale tally.
    ///   cargo test atem_live_power_cut -- --ignored   (needs node on PATH)
    #[tokio::test]
    #[ignore]
    async fn atem_live_power_cut() {
        let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../scripts/fake-atem.cjs");
        let mut fake = std::process::Command::new("node")
            .args([script, "--port", "9912", "--quiet"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("node on PATH");
        tokio::time::sleep(Duration::from_millis(700)).await;
        let state = new_state();
        let st = state.clone();
        let link = tokio::spawn(async move { run_link(&st, "127.0.0.1:9912", 0, &|| {}, &|| true).await });
        for _ in 0..100 {
            if state.lock().unwrap().ready {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(state.lock().unwrap().ready, "connected first");
        fake.kill().unwrap();
        let r = tokio::time::timeout(Duration::from_secs(8), link).await.expect("noticed within the silence window").unwrap();
        assert_eq!(r, Err("The switcher stopped answering. Reconnecting.".to_string()));
    }
}

