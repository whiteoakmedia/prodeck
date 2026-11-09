// Crew address: this booth's crew reach it from anywhere at
// <name>-crew.prodeck.live, and still see the week while it's off.
// (design/CREW_ADDRESS.md; the Worker is crew-cloud/.)
//
// Two loops, both outbound only, so the church sets up nothing (no port
// forwarding, no tunnel):
//
//  - Sync, every two minutes and whenever the plan changes: push the cloud
//    copy (this week's plan as the booth already built it, checklists, crew
//    names, team chat) and take back what phones did while the booth was off
//    (checklist ticks, chat messages, signups). Planning Center credentials
//    never leave this computer; only what the booth already fetched does.
//  - Link: one WebSocket to the church's Durable Object. Phone requests to the
//    crew address (/api/cmd, the /api/events stream, the app's pages) come down
//    it, go to this booth's own gateway on loopback exactly as a request through
//    a Cloudflare Tunnel would (CF-Connecting-IP names the phone, so the
//    password throttle and on-site check-in see the phone), and the answer
//    streams back up. The gateway checks every password itself.
//
// The name is the secure local address's (localhttps.rs) when the booth has
// one, else one claimed from the same service just for this (crew_name).
// Gateway passwords go up only as PBKDF2 verifiers with this booth's salt;
// crew sessions only as SHA-256 hashes.

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, Notify};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

use crate::settings::SettingsState;

/// After the church's name: <name>-crew.prodeck.live. One level under the
/// zone, so Cloudflare's free *.prodeck.live certificate covers it. Names are
/// at most 32 characters, so the label stays well inside DNS's 63.
pub const SUFFIX: &str = "-crew.prodeck.live";
const SYNC_EVERY: Duration = Duration::from_secs(120);
/// After a plan change, wait this long for more before sending.
const SETTLE: Duration = Duration::from_secs(5);
/// Must match crew-cloud/src/util.ts PBKDF2_ITERATIONS.
pub const PBKDF2_ITERATIONS: u32 = 20000;
const MIRROR_MSGS: usize = 50;
/// Body bytes per relayed frame.
const CHUNK: usize = 48 * 1024;
/// Ticks older than this are acknowledged but not applied: a list that
/// rolled over to a new week since must not inherit last week's ticks.
const TICK_MAX_AGE_MS: u64 = 12 * 3600 * 1000;
const B64: base64::engine::general_purpose::GeneralPurpose = base64::engine::general_purpose::STANDARD;

/// The crew Worker's own address, which always exists. The booth talks to it
/// here, saying which church in a header, so it never has to look up its own
/// <name>-crew.prodeck.live: a brand new name looked up before its record
/// reached the internet gets "no such name" cached by the computer for up to
/// half an hour (it happened on the first live enable, 2026-11-09).
const API_ORIGIN: &str = "https://prodeck-crew.taplink-edge.workers.dev";

/// The crew address once phones can be told it (public DNS has it).
static PUBLISHED: Mutex<String> = Mutex::new(String::new());
/// Which of `origins` answered last, tried first next time.
static WORKING: Mutex<String> = Mutex::new(String::new());

/// Where the booth reaches the crew Worker, in order: its own always-there
/// address, then (only once public DNS has it) the church's crew address, for
/// a Worker deployed without its workers.dev address. Overridable for a local
/// test (wrangler dev). The church always goes in a header too.
pub fn origins(name: &str, published: bool, override_origin: Option<&str>, working: &str) -> Vec<String> {
    if let Some(o) = override_origin.filter(|o| !o.is_empty()) {
        return vec![o.to_string()];
    }
    let mut v = vec![API_ORIGIN.to_string()];
    if published {
        v.push(crew_url(name));
    }
    if let Some(i) = v.iter().position(|o| o == working) {
        let w = v.remove(i);
        v.insert(0, w);
    }
    v
}

fn origins_now(name: &str) -> Vec<String> {
    let published = *PUBLISHED.lock().unwrap_or_else(|p| p.into_inner()) == name;
    let working = WORKING.lock().unwrap_or_else(|p| p.into_inner()).clone();
    origins(name, published, std::env::var("PRODECK_CREW_ORIGIN").ok().as_deref(), &working)
}

/// POST to the crew Worker, trying each way in. Only a JSON answer counts as
/// the Worker's: a workers.dev address that's switched off answers with a page.
async fn booth_post(name: &str, secret: &str, path: &str, body: &Value) -> Result<reqwest::Response, String> {
    let mut last = String::from("no way to reach it");
    for o in origins_now(name) {
        let r = http()?
            .post(format!("{o}{path}"))
            .bearer_auth(secret)
            .header("x-prodeck-church", name)
            .json(body)
            .send()
            .await;
        match r {
            Ok(r) if r.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").contains("json") => {
                *WORKING.lock().unwrap_or_else(|p| p.into_inner()) = o;
                return Ok(r);
            }
            Ok(r) => last = format!("{o} answered {}", r.status()),
            Err(e) => last = e.to_string(),
        }
    }
    Err(format!("Couldn't reach the crew address service: {last}"))
}

/// Does public DNS have the name yet? Asked of Cloudflare's resolver over https,
/// so this computer's own resolver never caches a "no". None = couldn't ask.
async fn publicly_resolves(host: &str) -> Option<bool> {
    let r = http()
        .ok()?
        .get("https://cloudflare-dns.com/dns-query")
        .query(&[("name", host), ("type", "A")])
        .header("accept", "application/dns-json")
        .send()
        .await
        .ok()?;
    let v: Value = r.json().await.ok()?;
    Some(dns_json_has_answer(&v))
}

pub fn dns_json_has_answer(v: &Value) -> bool {
    v.get("Status").and_then(|s| s.as_u64()) == Some(0) && v.get("Answer").and_then(|a| a.as_array()).map(|a| !a.is_empty()).unwrap_or(false)
}

/// What phones open: https://<name>-crew.prodeck.live
pub fn crew_url(name: &str) -> String {
    format!("https://{name}{SUFFIX}")
}

// ---------------------------------------------------------------- status

#[derive(Debug, Clone, Serialize, Default)]
pub struct Status {
    /// off | waiting (the service isn't open yet: nothing is sent) | starting | ready | error
    pub phase: String,
    pub name: String,
    pub url: String,
    /// The relay link is up: phones away from church reach the live booth.
    pub linked: bool,
    /// Epoch ms of the last copy the cloud accepted; 0 = none yet.
    pub last_sync_ms: u64,
    pub error: String,
}

static STATUS: Mutex<Option<Status>> = Mutex::new(None);

fn set_status(app: &AppHandle, f: impl FnOnce(&mut Status)) {
    let snap = {
        let mut g = STATUS.lock().unwrap_or_else(|p| p.into_inner());
        let s = g.get_or_insert_with(Status::default);
        f(s);
        s.clone()
    };
    app.emit("crewcloud:status", &snap).ok();
}

fn status() -> Status {
    STATUS.lock().unwrap_or_else(|p| p.into_inner()).clone().unwrap_or_default()
}

// ---------------------------------------------------------------- the name

/// The name this booth answers to and its secret: the secure local address's
/// if claimed, else the crew address's own.
pub fn claim_of(s: &crate::settings::Settings) -> Option<(String, String)> {
    if !s.local_name.is_empty() && !s.local_secret.is_empty() {
        return Some((s.local_name.clone(), s.local_secret.clone()));
    }
    if !s.crew_name.is_empty() && !s.crew_secret.is_empty() {
        return Some((s.crew_name.clone(), s.crew_secret.clone()));
    }
    None
}

/// Mirrors local-edge/src/names.ts RESERVED.
const RESERVED: &[&str] = &[
    "www", "api", "app", "admin", "root", "mail", "smtp", "ftp", "ns1", "ns2", "dns", "local", "localhost", "edge", "claim",
    "status", "help", "support", "docs", "test", "demo", "prodeck", "pro-deck", "whiteoak", "white-oak", "whiteoakmedia",
    "booth", "crew", "login", "secure", "account", "billing", "update", "updates", "download", "downloads",
];

/// Same rules as local-edge/src/names.ts nameProblem.
pub fn name_ok(n: &str) -> bool {
    (3..=32).contains(&n.len())
        && n.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !n.starts_with('-')
        && !n.ends_with('-')
        && !n.contains("--")
        && !RESERVED.contains(&n)
}

/// "St. John's Church" → "st-johns-church" (local-edge/src/names.ts suggestName).
pub fn suggest_name(from: &str) -> String {
    let mut out = String::new();
    for c in from.to_lowercase().chars() {
        if c == '\'' || c == '’' {
            continue;
        }
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let t: String = out.trim_matches('-').chars().take(32).collect();
    t.trim_end_matches('-').to_string()
}

/// Names to try, in order, for a booth claiming one on its first sync.
pub fn candidates(from: &str, rand4: &str) -> Vec<String> {
    let base = suggest_name(from);
    let base = if base.len() >= 3 && !RESERVED.contains(&base.as_str()) { base } else { "church".to_string() };
    let short: String = base.chars().take(26).collect::<String>().trim_end_matches('-').to_string();
    let mut v = Vec::new();
    if name_ok(&base) {
        v.push(base.clone());
    }
    for n in 2..=4 {
        v.push(format!("{short}-{n}"));
    }
    v.push(format!("{short}-{rand4}"));
    v.into_iter().filter(|n| name_ok(n)).collect()
}

/// The church's name from Planning Center (the organization's name on the
/// Services API), when the booth is signed in there.
async fn church_name(app: &AppHandle) -> Option<String> {
    let auth = crate::pco::auth(app.state::<SettingsState>().inner()).await.ok()?;
    let v = crate::pco::pco_request(&auth, "services/v2").await.ok()?;
    v.pointer("/data/attributes/name").and_then(|n| n.as_str()).map(|n| n.trim().to_string()).filter(|n| !n.is_empty())
}

/// Words in a computer's name that say nothing about the church.
const GENERIC: &[&str] = &[
    "local", "lan", "home", "booth", "mac", "macbook", "imac", "mini", "pro", "air", "max", "studio", "computer", "pc",
    "laptop", "desktop", "workstation", "command", "center", "centre", "control", "room", "production", "prod", "av",
    "media", "sound", "audio", "video", "foh", "tech", "office", "admin", "user", "the", "windows", "server", "main",
];

/// What a first claim's name is made from: the church's name when ProDeck
/// knows it, else the computer's name with ".local", generic words, someone's
/// name ("Zach's MacBook") and machine numbers taken out. "" = nothing usable
/// ("church" is then used).
pub fn name_source(church: Option<&str>, device: &str) -> String {
    if let Some(c) = church.map(fold).filter(|c| suggest_name(c).len() >= 3) {
        return c;
    }
    let d = fold(device);
    let d = d.trim().trim_end_matches('.');
    let d = d.strip_suffix(".local").or_else(|| d.strip_suffix(".lan")).unwrap_or(d);
    d.split(|c: char| !c.is_alphanumeric() && c != '\'' && c != '’')
        .filter(|w| !w.is_empty())
        .filter(|w| !w.ends_with("'s") && !w.ends_with("’s"))
        .filter(|w| !GENERIC.contains(&w.to_lowercase().as_str()))
        // DESKTOP-4F2K9QZ and the like: a machine number, not a name.
        .filter(|w| !(w.len() >= 5 && w.chars().any(|c| c.is_ascii_digit()) && w.chars().any(|c| c.is_alphabetic())))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Common accented letters to their plain ones ("Église" → "Eglise").
fn fold(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => 'a',
            'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' => 'A',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'È' | 'É' | 'Ê' | 'Ë' => 'E',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'Ì' | 'Í' | 'Î' | 'Ï' => 'I',
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' => 'o',
            'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' => 'O',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            'Ù' | 'Ú' | 'Û' | 'Ü' => 'U',
            'ñ' => 'n',
            'Ñ' => 'N',
            'ç' => 'c',
            'Ç' => 'C',
            other => other,
        })
        .collect()
}

/// Claim a name just for the crew address, from the same service the secure
/// local address uses. Nothing is pointed anywhere: no DNS record is made.
async fn claim(app: &AppHandle) -> Result<(String, String), String> {
    let device = {
        let g = app.state::<SettingsState>();
        let g = g.lock().unwrap_or_else(|p| p.into_inner());
        g.device_name.clone()
    };
    let from = name_source(church_name(app).await.as_deref(), &device);
    let rand4: String = uuid::Uuid::new_v4().simple().to_string().chars().take(4).collect();
    let mut last = String::from("No name could be claimed.");
    for name in candidates(&from, &rand4) {
        match crate::localhttps::edge_call(reqwest::Method::POST, "/v1/claim", json!({ "name": name })).await {
            Ok(v) => {
                let secret = v["secret"].as_str().ok_or("The address service sent no secret")?.to_string();
                return Ok((name, secret));
            }
            Err(e) => last = e, // taken: try the next
        }
    }
    Err(last)
}

fn save_settings(app: &AppHandle, f: impl FnOnce(&mut crate::settings::Settings)) {
    let state = app.state::<SettingsState>();
    let to_save = {
        let mut g = state.lock().unwrap_or_else(|p| p.into_inner());
        let before = serde_json::to_string(&*g).unwrap_or_default();
        f(&mut g);
        if serde_json::to_string(&*g).unwrap_or_default() == before {
            return;
        }
        g.clone()
    };
    let _ = crate::settings::save(&to_save);
    app.emit("settings:changed", ()).ok();
}

// ---------------------------------------------------------------- passwords

fn hmac_keys(key: &[u8]) -> (Sha256, Sha256) {
    let mut k = [0u8; 64];
    if key.len() > 64 {
        let h = Sha256::digest(key);
        k[..32].copy_from_slice(&h);
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut i = Sha256::new();
    let mut o = Sha256::new();
    i.update(k.map(|b| b ^ 0x36));
    o.update(k.map(|b| b ^ 0x5c));
    (i, o)
}

fn hmac(keys: &(Sha256, Sha256), msg: &[u8]) -> [u8; 32] {
    let mut i = keys.0.clone();
    i.update(msg);
    let inner = i.finalize();
    let mut o = keys.1.clone();
    o.update(&inner);
    let mut out = [0u8; 32];
    out.copy_from_slice(&o.finalize());
    out
}

/// PBKDF2-HMAC-SHA256, 32 bytes, hex: how a gateway password is kept in the
/// cloud. Same as crew-cloud/src/util.ts `verifier`.
pub fn verifier(token: &str, salt: &str, iterations: u32) -> String {
    let keys = hmac_keys(token.as_bytes());
    let mut msg = salt.as_bytes().to_vec();
    msg.extend_from_slice(&1u32.to_be_bytes());
    let mut u = hmac(&keys, &msg);
    let mut t = u;
    for _ in 1..iterations {
        u = hmac(&keys, &u);
        for (a, b) in t.iter_mut().zip(u.iter()) {
            *a ^= b;
        }
    }
    hex::encode(t)
}

/// Verifiers are slow on purpose; each password is worked out once per run.
static VERIFIERS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn cached_verifier(token: &str, salt: &str) -> String {
    let key = hex::encode(Sha256::digest(format!("{salt}\u{0}{token}").as_bytes()));
    if let Some(v) = VERIFIERS.lock().unwrap_or_else(|p| p.into_inner()).get_or_insert_with(HashMap::new).get(&key) {
        return v.clone();
    }
    let v = verifier(token, salt, PBKDF2_ITERATIONS);
    VERIFIERS.lock().unwrap_or_else(|p| p.into_inner()).get_or_insert_with(HashMap::new).insert(key, v.clone());
    v
}

// ---------------------------------------------------------------- local state

/// crew-cloud.json: the plan the booth's window last built, and the salt.
fn state_path() -> PathBuf {
    crate::settings::config_dir().join("crew-cloud.json")
}

fn read_state() -> Value {
    std::fs::read_to_string(state_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| json!({}))
}

fn write_state(v: &Value) {
    if let Ok(s) = serde_json::to_string(v) {
        let _ = crate::settings::write_json_atomic_backed_up(state_path(), s);
    }
}

fn salt() -> String {
    let mut st = read_state();
    if let Some(s) = st.get("salt").and_then(|s| s.as_str()).filter(|s| s.len() >= 16) {
        return s.to_string();
    }
    let s = uuid::Uuid::new_v4().simple().to_string();
    st["salt"] = json!(s);
    write_state(&st);
    s
}

// ---------------------------------------------------------------- the copy

/// Everything one sync sends, before it becomes JSON. Kept apart from the app
/// so it can be tested.
pub struct Parts {
    pub sent_ms: u64,
    pub church: String,
    pub plan: Value,
    pub checklists: Value,
    /// (id, name, role), approved crew only.
    pub crew: Vec<(String, String, String)>,
    /// (sha256(session), user id).
    pub sessions: Vec<(String, String)>,
    pub names: Vec<String>,
    pub salt: String,
    /// Gateway passwords, raw: turned into verifiers here.
    pub admin: Vec<String>,
    pub member: Vec<String>,
    pub msgs: Vec<Value>,
    pub since_seq: u64,
    pub ack_ticks: Vec<u64>,
    pub consumed_joins: Vec<String>,
}

pub fn build_copy(p: &Parts, verify: &dyn Fn(&str, &str) -> String) -> Value {
    let v = |list: &[String]| -> Vec<String> { list.iter().filter(|t| !t.is_empty()).map(|t| verify(t, &p.salt)).collect() };
    let sessions: serde_json::Map<String, Value> = p.sessions.iter().map(|(h, id)| (h.clone(), json!(id))).collect();
    json!({
        "sentMs": p.sent_ms,
        "church": { "name": p.church },
        "plan": p.plan,
        "checklists": if p.checklists.is_array() { p.checklists.clone() } else { json!([]) },
        "crew": p.crew.iter().map(|(id, name, role)| json!({ "id": id, "name": name, "role": role })).collect::<Vec<_>>(),
        "auth": { "salt": p.salt, "admin": v(&p.admin), "member": v(&p.member), "sessions": sessions },
        "names": p.names,
        "msgs": p.msgs,
        "sinceSeq": p.since_seq,
        "ackTicks": p.ack_ticks,
        "consumedJoins": p.consumed_joins,
    })
}

static LAST_SEQ: AtomicU64 = AtomicU64::new(0);
static ACK_TICKS: Mutex<Vec<u64>> = Mutex::new(Vec::new());
static CONSUMED_JOINS: Mutex<Vec<String>> = Mutex::new(Vec::new());
static POKE: Notify = Notify::const_new();

/// Send the copy soon (the plan changed).
pub fn poke() {
    POKE.notify_one();
}

fn parts(app: &AppHandle) -> Parts {
    let (device, admin, member) = {
        let g = app.state::<SettingsState>();
        let s = g.lock().unwrap_or_else(|p| p.into_inner());
        (s.device_name.clone(), s.web_password.clone(), vec![s.web_member_password.clone(), s.web_invite_token.clone()])
    };
    let identity = app.state::<crate::identity::IdentityState>().inner().clone();
    let (crew, sessions) = crate::identity::cloud_crew(&identity);
    let msgs = {
        let chat = app.state::<crate::chat::ChatState>();
        crate::chat::recent_team(chat.inner(), MIRROR_MSGS)
            .into_iter()
            .map(|m| json!({ "id": m.id, "from": m.from, "text": m.text, "channel": m.channel, "ts": m.ts }))
            .collect()
    };
    Parts {
        sent_ms: crate::identity::now_ms(),
        church: device,
        plan: read_state().get("plan").cloned().unwrap_or(Value::Null),
        checklists: crate::settings::load_checklists().unwrap_or(Value::Null),
        crew,
        sessions,
        names: crate::identity::all_names(&identity),
        salt: salt(),
        admin: vec![admin],
        member,
        msgs,
        since_seq: LAST_SEQ.load(Ordering::Relaxed),
        ack_ticks: ACK_TICKS.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        consumed_joins: CONSUMED_JOINS.lock().unwrap_or_else(|p| p.into_inner()).clone(),
    }
}

/// Which of the cloud's queued ticks to apply now: (id, list, item, done),
/// plus the ids to acknowledge without applying (too old).
pub fn plan_ticks(ticks: &[Value], now_ms: u64) -> (Vec<(u64, String, String, bool)>, Vec<u64>) {
    let mut apply = Vec::new();
    let mut stale = Vec::new();
    for t in ticks {
        let Some(id) = t.get("id").and_then(|v| v.as_u64()) else { continue };
        let ts = t.get("ts").and_then(|v| v.as_u64()).unwrap_or(0);
        if now_ms.saturating_sub(ts) > TICK_MAX_AGE_MS {
            stale.push(id);
            continue;
        }
        let s = |k: &str| t.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
        apply.push((id, s("listId"), s("itemId"), t.get("done").and_then(|v| v.as_bool()).unwrap_or(false)));
    }
    (apply, stale)
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("ProDeck/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// Is the crew address service open? prodeck-local answers /v1/crew/ready
/// once White Oak Media has deployed prodeck-crew and set CREW_READY. Until
/// then a booth claims nothing, sends nothing and links to nothing: asked at
/// most once an hour, and a prodeck-local without the route (404) counts as
/// not open. Once open it stays open for this run.
static READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static READY_ASKED_MS: AtomicU64 = AtomicU64::new(0);
const READY_RECHECK_MS: u64 = 3600 * 1000;

pub fn should_ask_ready(ready: bool, asked_ms: u64, now_ms: u64) -> bool {
    !ready && (asked_ms == 0 || now_ms.saturating_sub(asked_ms) >= READY_RECHECK_MS)
}

async fn service_ready() -> bool {
    let now = crate::identity::now_ms();
    if !should_ask_ready(READY.load(Ordering::Relaxed), READY_ASKED_MS.load(Ordering::Relaxed), now) {
        return READY.load(Ordering::Relaxed);
    }
    READY_ASKED_MS.store(now, Ordering::Relaxed);
    let ready = match crate::localhttps::edge_call(reqwest::Method::GET, "/v1/crew/ready", Value::Null).await {
        Ok(v) => v.get("ready").and_then(|r| r.as_bool()).unwrap_or(false),
        Err(_) => false,
    };
    READY.store(ready, Ordering::Relaxed);
    ready
}

/// The name whose DNS record (<name>-crew) was confirmed this run, and when.
static RECORD_FOR: Mutex<String> = Mutex::new(String::new());
static RECORD_SINCE: AtomicU64 = AtomicU64::new(0);

/// Make sure <name>-crew.prodeck.live exists (prodeck-local writes it, proxied).
async fn ensure_record(name: &str, secret: &str) -> Result<(), String> {
    if *RECORD_FOR.lock().unwrap_or_else(|p| p.into_inner()) == name {
        return Ok(());
    }
    crate::localhttps::edge_call(reqwest::Method::POST, "/v1/crew", json!({ "name": name, "secret": secret, "on": true })).await?;
    *RECORD_FOR.lock().unwrap_or_else(|p| p.into_inner()) = name.to_string();
    RECORD_SINCE.store(crate::identity::now_ms(), Ordering::Relaxed);
    Ok(())
}

/// The name to use, claiming one first if the booth has none. None = off,
/// or the service isn't open yet.
async fn ensure_name(app: &AppHandle) -> Result<Option<(String, String)>, String> {
    let (on, claim_now) = {
        let g = app.state::<SettingsState>();
        let s = g.lock().unwrap_or_else(|p| p.into_inner());
        (s.crew_cloud, claim_of(&s))
    };
    if !on {
        save_settings(app, |s| s.crew_url.clear());
        // Switched off after it was on: ask the cloud to delete the copy.
        let mut st = read_state();
        if st.get("live").and_then(|v| v.as_bool()).unwrap_or(false) {
            if let Some((name, secret)) = claim_now {
                let r = booth_post(&name, &secret, "/_booth/forget", &json!({}))
                    .await
                    .map_err(|e| format!("{e} (to delete the copy)"))?;
                if !r.status().is_success() && r.status() != reqwest::StatusCode::FORBIDDEN {
                    return Err(format!("The crew address service didn't delete the copy ({}).", r.status()));
                }
                // And the address itself stops resolving.
                let _ = crate::localhttps::edge_call(reqwest::Method::POST, "/v1/crew", json!({ "name": name, "secret": secret, "on": false })).await;
                RECORD_FOR.lock().unwrap_or_else(|p| p.into_inner()).clear();
            }
            st["live"] = json!(false);
            write_state(&st);
        }
        return Ok(None);
    }
    if !service_ready().await {
        return Ok(None);
    }
    let (name, secret) = match claim_now {
        Some(c) => c,
        None => {
            let (n, sec) = claim(app).await?;
            save_settings(app, |s| {
                s.crew_name = n.clone();
                s.crew_secret = sec.clone();
            });
            (n, sec)
        }
    };
    ensure_record(&name, &secret).await?;
    // Phones learn the address only once public DNS has it: a phone (or the
    // church's own resolver) asking too early would cache "no such name" for
    // up to half an hour. If public DNS can't be asked (a filter blocks it),
    // ten minutes after the record was confirmed is long enough.
    let url = crew_url(&name);
    let already = {
        let g = app.state::<SettingsState>();
        let s = g.lock().unwrap_or_else(|p| p.into_inner());
        s.crew_url == url
    };
    let published = already
        || std::env::var("PRODECK_CREW_ORIGIN").is_ok()
        || match publicly_resolves(url.trim_start_matches("https://")).await {
            Some(yes) => yes,
            None => crate::identity::now_ms().saturating_sub(RECORD_SINCE.load(Ordering::Relaxed)) > 10 * 60 * 1000,
        };
    if published {
        *PUBLISHED.lock().unwrap_or_else(|p| p.into_inner()) = name.clone();
        save_settings(app, |s| s.crew_url = url.clone());
    }
    Ok(Some((name, secret)))
}

async fn sync_once(app: &AppHandle) -> Result<(), String> {
    let Some((name, secret)) = ensure_name(app).await? else {
        let on = app.state::<SettingsState>().lock().unwrap_or_else(|p| p.into_inner()).crew_cloud;
        let phase = if on { "waiting" } else { "off" };
        set_status(app, |s| *s = Status { phase: phase.into(), ..Default::default() });
        return Ok(());
    };
    // The card shows the address once phones are told it (public DNS has it).
    let published = *PUBLISHED.lock().unwrap_or_else(|p| p.into_inner()) == name;
    set_status(app, |s| {
        s.name = name.clone();
        s.url = if published { crew_url(&name) } else { String::new() };
        if s.phase.is_empty() || s.phase == "off" {
            s.phase = "starting".into();
        }
    });
    let p = parts(app);
    let acked = p.ack_ticks.clone();
    let consumed = p.consumed_joins.clone();
    let body = tokio::task::spawn_blocking(move || build_copy(&p, &cached_verifier)).await.map_err(|e| e.to_string())?;
    let r = booth_post(&name, &secret, "/_booth/sync", &body).await?;
    if r.status() == reqwest::StatusCode::FORBIDDEN {
        // The name isn't this booth's any more (freed by White Oak Media). A
        // crew-only name is claimed afresh next round; a secure local address
        // is its own card's business.
        let crew_only = {
            let g = app.state::<SettingsState>();
            let s = g.lock().unwrap_or_else(|p| p.into_inner());
            s.local_name.is_empty()
        };
        if crew_only {
            save_settings(app, |s| {
                s.crew_name.clear();
                s.crew_secret.clear();
                s.crew_url.clear();
            });
        }
        return Err("The crew address service says this name belongs to another booth.".into());
    }
    if !r.status().is_success() {
        return Err(format!("The crew address service refused the copy ({}).", r.status()));
    }
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    // What the cloud had from last time is applied: forget the acknowledgements.
    ACK_TICKS.lock().unwrap_or_else(|p| p.into_inner()).retain(|id| !acked.contains(id));
    CONSUMED_JOINS.lock().unwrap_or_else(|p| p.into_inner()).retain(|id| !consumed.contains(id));

    if let Some(arr) = v.get("edgeMsgs").and_then(|x| x.as_array()) {
        let chat = app.state::<crate::chat::ChatState>();
        for m in arr {
            let s = |k: &str| m.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
            let ch = if s("channel").is_empty() { "team".to_string() } else { s("channel") };
            crate::chat::ingest_edge(app, chat.inner(), s("from"), s("text"), ch, m.get("ts").and_then(|x| x.as_u64()).unwrap_or(0));
        }
    }
    if let Some(s) = v.get("edgeSeq").and_then(|x| x.as_u64()) {
        LAST_SEQ.store(s, Ordering::Relaxed);
    }
    if let Some(arr) = v.get("ticks").and_then(|x| x.as_array()) {
        let (apply, stale) = plan_ticks(arr, crate::identity::now_ms());
        let mut done = stale;
        let mut changed = false;
        for (id, list, item, on) in apply {
            match crate::settings::checklist_set(&list, &item, on) {
                Ok(_) => {
                    done.push(id);
                    changed = true;
                }
                Err(e) => crate::diag::log(format!("[crew-cloud] tick: {e}")),
            }
        }
        if changed {
            app.emit("checklist:changed", json!({})).ok();
        }
        ACK_TICKS.lock().unwrap_or_else(|p| p.into_inner()).extend(done);
    }
    if let Some(arr) = v.get("pendingJoins").and_then(|x| x.as_array()) {
        if !arr.is_empty() {
            let identity = app.state::<crate::identity::IdentityState>().inner().clone();
            let done = crate::identity::ingest_edge_joins(app, &identity, arr);
            CONSUMED_JOINS.lock().unwrap_or_else(|p| p.into_inner()).extend(done);
        }
    }
    let mut st = read_state();
    if st.get("live").and_then(|v| v.as_bool()) != Some(true) {
        st["live"] = json!(true);
        write_state(&st);
    }
    set_status(app, |s| {
        s.phase = "ready".into();
        s.last_sync_ms = crate::identity::now_ms();
        s.error.clear();
    });
    Ok(())
}

// ---------------------------------------------------------------- the relay

/// The raw HTTP request for the booth's own gateway, or None if the frame
/// asks for something that isn't a plain request. Only safe headers survive
/// (the Worker already filters; this is the booth not trusting that), and the
/// phone's address goes in CF-Connecting-IP exactly as Cloudflare's tunnel
/// would put it, so web.rs treats a relayed phone like one through a tunnel.
pub fn build_request(method: &str, path: &str, headers: &serde_json::Map<String, Value>, ip: &str, body_len: usize) -> Option<String> {
    if !["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"].contains(&method) {
        return None;
    }
    if !path.starts_with('/') || path.len() > 8192 || path.bytes().any(|b| b <= b' ' || b == 0x7f) {
        return None;
    }
    let mut out = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nX-ProDeck-Relay: 1\r\n");
    if ip.parse::<std::net::IpAddr>().is_ok() {
        out.push_str(&format!("CF-Connecting-IP: {ip}\r\n"));
    }
    const DROP: &[&str] = &["host", "connection", "content-length", "transfer-encoding", "cf-connecting-ip", "x-prodeck-peer", "x-prodeck-relay", "upgrade"];
    for (k, v) in headers {
        let Some(v) = v.as_str() else { continue };
        let k = k.to_ascii_lowercase();
        if k.is_empty() || !k.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') || DROP.contains(&k.as_str()) {
            continue;
        }
        if v.bytes().any(|b| b == b'\r' || b == b'\n' || b == 0) || v.len() > 1024 {
            continue;
        }
        out.push_str(&format!("{k}: {v}\r\n"));
    }
    if body_len > 0 || method == "POST" || method == "PUT" {
        out.push_str(&format!("Content-Length: {body_len}\r\n"));
    }
    out.push_str("\r\n");
    Some(out)
}

/// The gateway's response head: (status, headers, content length).
pub fn parse_head(head: &[u8]) -> Option<(u16, serde_json::Map<String, Value>, Option<usize>)> {
    let text = std::str::from_utf8(head).ok()?;
    let mut lines = text.split("\r\n");
    let status: u16 = lines.next()?.split_whitespace().nth(1)?.parse().ok()?;
    let mut headers = serde_json::Map::new();
    let mut len = None;
    for l in lines {
        let Some((k, v)) = l.split_once(':') else { continue };
        let (k, v) = (k.trim(), v.trim());
        if k.eq_ignore_ascii_case("content-length") {
            len = v.parse().ok();
        }
        headers.insert(k.to_string(), json!(v));
    }
    Some((status, headers, len))
}

type Out = mpsc::UnboundedSender<Message>;

fn send(out: &Out, v: Value) -> bool {
    out.send(Message::Text(v.to_string())).is_ok()
}

/// One relayed request: to the gateway on loopback, the answer back up in frames.
async fn proxy(f: Value, port: u16, out: Out) {
    let id = f.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
    let fail = |m: &str| {
        send(&out, json!({ "t": "error", "id": id, "message": m }));
    };
    if port == 0 {
        return fail("Browser access is off at the booth.");
    }
    let body = f.get("b").and_then(|v| v.as_str()).and_then(|b| B64.decode(b).ok()).unwrap_or_default();
    let empty = serde_json::Map::new();
    let Some(head) = build_request(
        f.get("method").and_then(|v| v.as_str()).unwrap_or(""),
        f.get("path").and_then(|v| v.as_str()).unwrap_or(""),
        f.get("headers").and_then(|v| v.as_object()).unwrap_or(&empty),
        f.get("ip").and_then(|v| v.as_str()).unwrap_or(""),
        body.len(),
    ) else {
        return fail("That isn't a request the booth answers.");
    };
    let Ok(Ok(mut up)) = tokio::time::timeout(Duration::from_secs(5), tokio::net::TcpStream::connect(("127.0.0.1", port))).await else {
        return fail("The booth's browser access isn't answering.");
    };
    if up.write_all(head.as_bytes()).await.is_err() || up.write_all(&body).await.is_err() {
        return fail("The booth's browser access isn't answering.");
    }
    // The head, then the body as it comes (the event stream never ends by itself).
    let mut buf = Vec::with_capacity(8192);
    let mut tmp = vec![0u8; CHUNK];
    let head_end = loop {
        let n = match tokio::time::timeout(Duration::from_secs(30), up.read(&mut tmp)).await {
            Ok(Ok(n)) if n > 0 => n,
            _ => return fail("The booth stopped answering."),
        };
        buf.extend_from_slice(&tmp[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        if buf.len() > 64 * 1024 {
            return fail("The booth's answer wasn't readable.");
        }
    };
    let Some((status, headers, len)) = parse_head(&buf[..head_end]) else {
        return fail("The booth's answer wasn't readable.");
    };
    if !send(&out, json!({ "t": "head", "id": id, "status": status, "headers": headers })) {
        return;
    }
    let mut left = len;
    let mut chunk = buf[head_end..].to_vec();
    loop {
        if let Some(l) = left.as_mut() {
            chunk.truncate(*l);
            *l -= chunk.len();
        }
        if !chunk.is_empty() && !send(&out, json!({ "t": "data", "id": id, "b": B64.encode(&chunk) })) {
            return; // the link went away
        }
        if left == Some(0) {
            break;
        }
        match up.read(&mut tmp).await {
            Ok(n) if n > 0 => chunk = tmp[..n].to_vec(),
            _ => break,
        }
    }
    send(&out, json!({ "t": "end", "id": id }));
}

/// The gateway's port while it's serving; 0 = browser access is off.
fn gateway_port(app: &AppHandle) -> u16 {
    let web = app.state::<crate::web::WebState>();
    if web.running.load(Ordering::Acquire) {
        web.port.load(Ordering::Acquire)
    } else {
        0
    }
}

/// The WebSocket request for the link: the church in a header as well as the
/// host, so a local test Worker (PRODECK_CREW_ORIGIN) knows it too.
fn link_request(origin: &str, name: &str, secret: &str) -> Result<tokio_tungstenite::tungstenite::handshake::client::Request, String> {
    let url = format!("{}/_booth/link", origin.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1));
    let mut req = url.as_str().into_client_request().map_err(|e| e.to_string())?;
    req.headers_mut().insert("authorization", format!("Bearer {secret}").parse().map_err(|_| "bad secret")?);
    req.headers_mut().insert("x-prodeck-church", name.parse().map_err(|_| "bad name")?);
    Ok(req)
}

async fn link_once(app: &AppHandle) -> Result<(), String> {
    let Some((name, secret)) = ({
        let g = app.state::<SettingsState>();
        let s = g.lock().unwrap_or_else(|p| p.into_inner());
        if s.crew_cloud { claim_of(&s) } else { None }
    }) else {
        return Ok(());
    };
    // Each way in, as booth_post does (the Worker's own address first).
    let mut linked = None;
    let mut last = String::from("no way to reach it");
    for o in origins_now(&name) {
        match tokio::time::timeout(Duration::from_secs(20), tokio_tungstenite::connect_async(link_request(&o, &name, &secret)?)).await {
            Ok(Ok((ws, _))) => {
                *WORKING.lock().unwrap_or_else(|p| p.into_inner()) = o;
                linked = Some(ws);
                break;
            }
            Ok(Err(e)) => last = e.to_string(),
            Err(_) => last = format!("{o} didn't answer"),
        }
    }
    let ws = linked.ok_or_else(|| format!("Couldn't link to the crew address service: {last}"))?;
    set_status(app, |s| s.linked = true);
    crate::diag::log(format!("[crew-cloud] linked as {name}"));
    let result = serve_link(
        ws,
        || gateway_port(app),
        || {
            let g = app.state::<SettingsState>();
            let s = g.lock().unwrap_or_else(|p| p.into_inner());
            s.crew_cloud && claim_of(&s).map(|c| c.0) == Some(name.clone())
        },
    )
    .await;
    set_status(app, |s| s.linked = false);
    result
}

/// Answer relayed requests until the link drops or `still` says to stop.
async fn serve_link<S>(
    ws: tokio_tungstenite::WebSocketStream<S>,
    port: impl Fn() -> u16,
    still: impl Fn() -> bool,
) -> Result<(), String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let (mut sink, mut stream) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    let tasks: Arc<Mutex<HashMap<u64, tokio::task::AbortHandle>>> = Arc::new(Mutex::new(HashMap::new()));
    send(&tx, json!({ "t": "hello", "version": env!("CARGO_PKG_VERSION") }));

    let mut ping = tokio::time::interval(Duration::from_secs(30));
    let mut last_heard = std::time::Instant::now();
    let result: Result<(), String> = loop {
        tokio::select! {
            m = rx.recv() => {
                let Some(m) = m else { break Ok(()) };
                if sink.send(m).await.is_err() { break Err("The link dropped.".into()); }
            }
            _ = ping.tick() => {
                // The Worker answers "pong" without waking up; nothing for 90
                // seconds means the link is dead even if the socket says not.
                if last_heard.elapsed() > Duration::from_secs(95) { break Err("The link went quiet.".into()); }
                if !still() { break Ok(()); }
                if sink.send(Message::Text("ping".into())).await.is_err() { break Err("The link dropped.".into()); }
            }
            m = stream.next() => {
                last_heard = std::time::Instant::now();
                let t = match m {
                    None | Some(Ok(Message::Close(_))) => break Err("The crew address service closed the link.".into()),
                    Some(Err(e)) => break Err(format!("The link dropped: {e}")),
                    Some(Ok(Message::Text(t))) => t,
                    Some(Ok(_)) => continue,
                };
                if t == "pong" { continue; }
                let Ok(f) = serde_json::from_str::<Value>(&t) else { continue };
                let id = f.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                match f.get("t").and_then(|v| v.as_str()) {
                    Some("req") => {
                        let p = port();
                        let out = tx.clone();
                        let tasks2 = tasks.clone();
                        let h = tokio::spawn(async move {
                            proxy(f, p, out).await;
                            tasks2.lock().unwrap_or_else(|p| p.into_inner()).remove(&id);
                        });
                        tasks.lock().unwrap_or_else(|p| p.into_inner()).insert(id, h.abort_handle());
                    }
                    Some("cancel") => {
                        if let Some(h) = tasks.lock().unwrap_or_else(|p| p.into_inner()).remove(&id) { h.abort(); }
                    }
                    _ => {}
                }
            }
        }
    };
    for (_, h) in tasks.lock().unwrap_or_else(|p| p.into_inner()).drain() {
        h.abort();
    }
    result
}

// ---------------------------------------------------------------- loops

pub fn spawn(app: AppHandle) {
    let a = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(20)).await;
        loop {
            if let Err(e) = sync_once(&a).await {
                crate::diag::log(format!("[crew-cloud] {e}"));
                set_status(&a, |s| {
                    s.phase = "error".into();
                    s.error = e.clone();
                });
            }
            // Every two minutes, or soon after the plan changes.
            if tokio::time::timeout(SYNC_EVERY, POKE.notified()).await.is_ok() {
                tokio::time::sleep(SETTLE).await;
            }
        }
    });
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(25)).await;
        let mut wait = 2u64;
        loop {
            let named = {
                let g = app.state::<SettingsState>();
                let s = g.lock().unwrap_or_else(|p| p.into_inner());
                s.crew_cloud && claim_of(&s).is_some()
            };
            // Nothing until the service is open (the sync loop asks).
            if !named || !READY.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_secs(15)).await;
                continue;
            }
            let started = std::time::Instant::now();
            if let Err(e) = link_once(&app).await {
                crate::diag::log(format!("[crew-cloud] {e}"));
            }
            // A link that stayed up a while starts the wait over.
            if started.elapsed() > Duration::from_secs(120) {
                wait = 2;
            }
            tokio::time::sleep(Duration::from_secs(wait)).await;
            wait = (wait * 2).min(60);
        }
    });
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn crew_cloud_status() -> Status {
    status()
}

/// The booth's window hands over this week's plan as it shows it (overrides
/// and all; src/lib/crewCloud.ts builds it). Booth only.
#[tauri::command]
pub fn crew_cloud_set_plan(plan: Value) -> Result<(), String> {
    let mut st = read_state();
    if st.get("plan") == Some(&plan) {
        return Ok(());
    }
    st["plan"] = plan;
    write_state(&st);
    poke();
    Ok(())
}

#[tauri::command]
pub async fn crew_cloud_retry(app: AppHandle) -> Status {
    if let Err(e) = sync_once(&app).await {
        set_status(&app, |s| {
            s.phase = "error".into();
            s.error = e;
        });
    }
    status()
}

/// Choose the crew address's name. Only for a booth without a secure local
/// address (that name is used when there is one). The old name is given back.
#[tauri::command]
pub async fn crew_cloud_rename(name: String, app: AppHandle) -> Result<Status, String> {
    let name = name.trim().to_lowercase();
    if !name_ok(&name) {
        return Err("Use 3 to 32 lowercase letters, numbers and single hyphens.".into());
    }
    let (local, old) = {
        let g = app.state::<SettingsState>();
        let s = g.lock().unwrap_or_else(|p| p.into_inner());
        (s.local_name.clone(), (s.crew_name.clone(), s.crew_secret.clone()))
    };
    if !local.is_empty() {
        return Err("This booth's crew address uses its secure local address name. Change that one instead.".into());
    }
    if name == old.0 {
        return Ok(status());
    }
    let v = crate::localhttps::edge_call(reqwest::Method::POST, "/v1/claim", json!({ "name": name })).await?;
    let secret = v["secret"].as_str().ok_or("The address service sent no secret")?.to_string();
    save_settings(&app, |s| {
        s.crew_name = name.clone();
        s.crew_secret = secret.clone();
        s.crew_url = crew_url(&name);
    });
    // The new name's record is made on the next sync; giving the old name
    // back removes its record too.
    RECORD_FOR.lock().unwrap_or_else(|p| p.into_inner()).clear();
    if !old.0.is_empty() {
        let _ = crate::localhttps::edge_call(reqwest::Method::POST, "/v1/release", json!({ "name": old.0, "secret": old.1 })).await;
    }
    poke();
    set_status(&app, |s| {
        s.name = name.clone();
        s.url = crew_url(&name);
    });
    Ok(status())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifier_is_pbkdf2_hmac_sha256() {
        // Published vectors; crew-cloud/test/util.test.ts checks the same ones.
        assert_eq!(verifier("password", "salt", 1), "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b");
        assert_eq!(verifier("password", "salt", 4096), "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a");
        // A key longer than a block is hashed first.
        let long = "x".repeat(100);
        assert_eq!(verifier(&long, "s", 2).len(), 64);
    }

    #[test]
    fn names_follow_the_address_service_rules() {
        assert_eq!(suggest_name("St. John's Church"), "st-johns-church");
        assert_eq!(suggest_name("Booth Mac!!"), "booth-mac");
        assert!(name_ok("cornerstone"));
        assert!(!name_ok("crew"));
        assert!(!name_ok("ab"));
        assert!(!name_ok("a--b"));
        assert!(!name_ok("-ab"));
        let c = candidates("Grace Church", "a1b2");
        assert_eq!(c[0], "grace-church");
        assert!(c.contains(&"grace-church-2".to_string()));
        assert!(c.contains(&"grace-church-a1b2".to_string()));
        // Nothing usable in the device name: a plain fallback, still valid.
        assert!(candidates("", "a1b2").iter().all(|n| name_ok(n) && n.starts_with("church")));
        assert!(candidates("Crew", "zz99").iter().all(|n| name_ok(n)));
    }

    #[test]
    fn the_crew_address_is_one_label_under_the_zone() {
        assert_eq!(crew_url("grace"), "https://grace-crew.prodeck.live");
        let longest = "a".repeat(32);
        assert!(name_ok(&longest) && !name_ok(&"a".repeat(33)));
        let host = crew_url(&longest).trim_start_matches("https://").to_string();
        assert_eq!(host.matches('.').count(), 2, "exactly <label>.prodeck.live");
        assert!(host.split('.').next().unwrap().len() <= 63);
    }

    #[test]
    fn the_booth_never_needs_its_own_crew_address_looked_up() {
        // Before public DNS has the name: only the Worker's own address.
        assert_eq!(origins("grace", false, None, ""), vec![API_ORIGIN.to_string()]);
        // After: the crew address as a second way in, the last one that worked first.
        assert_eq!(origins("grace", true, None, ""), vec![API_ORIGIN.to_string(), "https://grace-crew.prodeck.live".to_string()]);
        assert_eq!(
            origins("grace", true, None, "https://grace-crew.prodeck.live"),
            vec!["https://grace-crew.prodeck.live".to_string(), API_ORIGIN.to_string()]
        );
        // A local test Worker replaces both.
        assert_eq!(origins("grace", true, Some("http://127.0.0.1:8799"), ""), vec!["http://127.0.0.1:8799".to_string()]);
        assert!(!API_ORIGIN.contains("prodeck.live"), "never under prodeck.live: it must always exist");
    }

    #[test]
    fn public_dns_answers_are_read_carefully() {
        assert!(dns_json_has_answer(&json!({ "Status": 0, "Answer": [{ "data": "104.21.1.1" }] })));
        assert!(!dns_json_has_answer(&json!({ "Status": 3, "Authority": [] })), "NXDOMAIN");
        assert!(!dns_json_has_answer(&json!({ "Status": 0 })), "no records yet");
        assert!(!dns_json_has_answer(&json!({})));
    }

    #[test]
    fn a_first_name_comes_from_the_church_not_the_computer() {
        assert_eq!(name_source(Some("Cornerstone Church"), "Command-Center.local"), "Cornerstone Church");
        assert_eq!(suggest_name(&name_source(Some("Église Saint-Jean"), "x")), "eglise-saint-jean");
        // No church name: the computer's, minus what says nothing.
        assert_eq!(name_source(None, "Command-Center.local"), "");
        assert_eq!(suggest_name(&name_source(None, "Grace-Booth-Mac.local")), "grace");
        assert_eq!(suggest_name(&name_source(None, "Zach's MacBook Pro")), "", "never someone's name");
        assert_eq!(suggest_name(&name_source(None, "DESKTOP-4F2K9QZ")), "");
        assert_eq!(suggest_name(&name_source(None, "Hope Fellowship FOH")), "hope-fellowship");
        // A church name too short to use falls back too.
        assert_eq!(name_source(Some("  "), "Hope Fellowship Booth"), "Hope Fellowship");
        // And nothing usable at all still claims a valid name.
        assert!(candidates(&name_source(None, "Command-Center.local"), "a1b2").iter().all(|n| name_ok(n) && n.starts_with("church")));
    }

    #[test]
    fn asks_whether_the_service_is_open_at_most_hourly() {
        assert!(should_ask_ready(false, 0, 1_000));
        assert!(!should_ask_ready(false, 1_000, 1_000 + 60_000));
        assert!(should_ask_ready(false, 1_000, 1_000 + 3600 * 1000));
        assert!(!should_ask_ready(true, 0, 1_000), "open stays open");
    }

    #[test]
    fn the_secure_local_name_wins() {
        let mut s = crate::settings::Settings::default();
        assert!(s.crew_cloud, "on unless turned off");
        assert_eq!(claim_of(&s), None);
        s.crew_name = "grace".into();
        s.crew_secret = "c".into();
        assert_eq!(claim_of(&s), Some(("grace".into(), "c".into())));
        s.local_name = "stjohns".into();
        s.local_secret = "l".into();
        assert_eq!(claim_of(&s), Some(("stjohns".into(), "l".into())));
    }

    #[test]
    fn the_copy_carries_verifiers_never_passwords() {
        let p = Parts {
            sent_ms: 5,
            church: "Booth".into(),
            plan: json!({ "items": [] }),
            checklists: Value::Null,
            crew: vec![("u1".into(), "Sam".into(), "Camera 1".into())],
            sessions: vec![("ab".repeat(32), "u1".into())],
            names: vec!["Sam".into()],
            salt: "saltsaltsaltsalt".into(),
            admin: vec!["admin-pw".into()],
            member: vec!["crew-pw".into(), String::new()],
            msgs: vec![],
            since_seq: 9,
            ack_ticks: vec![3],
            consumed_joins: vec![],
        };
        let v = build_copy(&p, &|t, s| verifier(t, s, 2));
        let text = v.to_string();
        assert!(!text.contains("admin-pw") && !text.contains("crew-pw"));
        assert_eq!(v["auth"]["admin"][0], json!(verifier("admin-pw", "saltsaltsaltsalt", 2)));
        assert_eq!(v["auth"]["member"].as_array().unwrap().len(), 1, "an unset password isn't sent");
        assert_eq!(v["checklists"], json!([]));
        assert_eq!(v["crew"][0]["role"], "Camera 1");
        assert_eq!(v["sinceSeq"], 9);
        assert_eq!(v["ackTicks"], json!([3]));
    }

    #[test]
    fn old_ticks_are_acknowledged_not_applied() {
        let now = 100 * 3600 * 1000;
        let ticks = vec![
            json!({ "id": 1, "listId": "l", "itemId": "a", "done": true, "ts": now - 60_000 }),
            json!({ "id": 2, "listId": "l", "itemId": "b", "done": true, "ts": now - 13 * 3600 * 1000 }),
            json!({ "bad": true }),
        ];
        let (apply, stale) = plan_ticks(&ticks, now);
        assert_eq!(apply, vec![(1, "l".into(), "a".into(), true)]);
        assert_eq!(stale, vec![2]);
    }

    #[test]
    fn relayed_requests_name_the_phone_and_carry_nothing_forged() {
        let mut h = serde_json::Map::new();
        h.insert("content-type".into(), json!("application/json"));
        h.insert("CF-Connecting-IP".into(), json!("10.0.0.1"));
        h.insert("x-prodeck-peer".into(), json!("10.0.0.2"));
        h.insert("x-evil".into(), json!("a\r\nCF-Connecting-IP: 1.1.1.1"));
        h.insert("bad header".into(), json!("x"));
        let r = build_request("POST", "/api/cmd", &h, "198.51.100.7", 12).unwrap();
        assert!(r.starts_with("POST /api/cmd HTTP/1.1\r\n"));
        assert!(r.contains("CF-Connecting-IP: 198.51.100.7\r\n"));
        assert_eq!(r.matches("CF-Connecting-IP").count(), 1);
        assert!(!r.contains("x-prodeck-peer") && !r.contains("x-evil") && !r.contains("bad header"));
        assert!(r.contains("content-type: application/json\r\n"));
        assert!(r.ends_with("Content-Length: 12\r\n\r\n"));
        // No address we can read: no header at all (the gateway then can't
        // be told the phone is somewhere it isn't).
        assert!(!build_request("GET", "/", &h, "nonsense", 0).unwrap().contains("CF-Connecting-IP"));
        assert!(build_request("CONNECT", "/", &h, "", 0).is_none());
        assert!(build_request("GET", "/a b", &h, "", 0).is_none());
        assert!(build_request("GET", "/a\r\nX: y", &h, "", 0).is_none());
        assert!(build_request("GET", "http://evil/", &h, "", 0).is_none());
    }

    #[test]
    fn reads_the_gateways_answer_head() {
        let (status, headers, len) =
            parse_head(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 17\r\n\r\n").unwrap();
        assert_eq!(status, 200);
        assert_eq!(headers["Content-Type"], "application/json");
        assert_eq!(len, Some(17));
        let (s, _, l) = parse_head(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n").unwrap();
        assert_eq!((s, l), (200, None));
        assert!(parse_head(b"garbage").is_none());
    }

    #[tokio::test]
    async fn proxies_a_request_to_the_gateway_and_streams_the_answer() {
        // A stand-in gateway on loopback that echoes what it was sent.
        let l = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            let mut buf = vec![0u8; 4096];
            let mut got = Vec::new();
            while !got.windows(4).any(|w| w == b"\r\n\r\n") || !got.ends_with(b"{}") {
                let n = s.read(&mut buf).await.unwrap();
                if n == 0 {
                    break;
                }
                got.extend_from_slice(&buf[..n]);
            }
            let req = String::from_utf8_lossy(&got).to_string();
            let body = if req.contains("CF-Connecting-IP: 203.0.113.4") { "relayed" } else { "wrong" };
            let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{body}", body.len());
            s.write_all(resp.as_bytes()).await.unwrap();
        });
        let (tx, mut rx) = mpsc::unbounded_channel();
        let f = json!({ "t": "req", "id": 7, "method": "POST", "path": "/api/cmd", "headers": {}, "ip": "203.0.113.4", "b": B64.encode(b"{}") });
        proxy(f, port, tx).await;
        let mut frames = Vec::new();
        while let Ok(Message::Text(t)) = rx.try_recv() {
            frames.push(serde_json::from_str::<Value>(&t).unwrap());
        }
        assert_eq!(frames[0]["t"], "head");
        assert_eq!(frames[0]["status"], 200);
        let body: Vec<u8> = frames.iter().filter(|f| f["t"] == "data").flat_map(|f| B64.decode(f["b"].as_str().unwrap()).unwrap()).collect();
        assert_eq!(String::from_utf8(body).unwrap(), "relayed");
        assert_eq!(frames.last().unwrap()["t"], "end");
    }

    #[tokio::test]
    async fn says_so_when_browser_access_is_off() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        proxy(json!({ "t": "req", "id": 1, "method": "GET", "path": "/" }), 0, tx).await;
        let Ok(Message::Text(t)) = rx.try_recv() else { panic!("no frame") };
        let v: Value = serde_json::from_str(&t).unwrap();
        assert_eq!(v["t"], "error");
    }

    /// The real link and relay against a running Worker (crew-cloud, `npm run
    /// dev` on 8799, with local-edge on 8798 and a name claimed there):
    /// PRODECK_CREW_ORIGIN=http://127.0.0.1:8799 CREW_NAME=<name> CREW_SECRET=<secret>
    ///   cargo test --lib live_link -- --ignored
    #[tokio::test]
    #[ignore]
    async fn live_link_relays_a_phone_request_through_the_worker() {
        let origin = std::env::var("PRODECK_CREW_ORIGIN").expect("PRODECK_CREW_ORIGIN");
        let name = std::env::var("CREW_NAME").expect("CREW_NAME");
        let secret = std::env::var("CREW_SECRET").expect("CREW_SECRET");
        // A stand-in gateway that answers like the booth's would.
        let l = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (mut s, _) = l.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 8192];
                    let n = s.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let who = req.lines().find_map(|l| l.strip_prefix("CF-Connecting-IP: ")).unwrap_or("nobody").to_string();
                    let relay = req.contains("X-ProDeck-Relay: 1");
                    let body = json!({ "result": { "via": "rust relay", "phone": who, "relay": relay } }).to_string();
                    let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len());
                    let _ = s.write_all(resp.as_bytes()).await;
                });
            }
        });
        let (ws, _) = tokio_tungstenite::connect_async(link_request(&origin, &name, &secret).unwrap()).await.expect("link");
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop2 = stop.clone();
        let link = tokio::spawn(async move { serve_link(ws, move || port, move || !stop2.load(Ordering::Relaxed)).await });
        tokio::time::sleep(Duration::from_millis(500)).await;
        let r = reqwest::Client::new()
            .post(format!("{origin}/api/cmd"))
            .header("x-prodeck-church", &name)
            .json(&json!({ "cmd": "get_settings", "token": "x" }))
            .send()
            .await
            .unwrap();
        assert_eq!(r.headers().get("x-prodeck-via").and_then(|v| v.to_str().ok()), Some("relay"));
        let v: Value = r.json().await.unwrap();
        println!("relayed answer: {v}");
        assert_eq!(v["result"]["via"], "rust relay");
        assert_eq!(v["result"]["relay"], true);
        stop.store(true, Ordering::Relaxed);
        link.abort();
    }
}
