// Crew identity — church-sized accounts: a person picks a name + 4-digit PIN
// on their phone, an admin approves them once, and from then on chat messages
// carry a server-verified name (no more self-declared labels). Sessions are
// long-lived device tokens so volunteers never re-enter anything.
//
// Deliberately NOT enterprise auth: PINs are 4 digits on a church LAN. A
// failed-attempt lockout blunts brute force; the access-password tiers still
// gate what anyone can DO. Identity answers "who", tiers answer "may".

use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

const MAX_NAME: usize = 32;
const LOCKOUT_AFTER: u32 = 5;
const LOCKOUT_SECS: u64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub name: String,
    pub pin_hash: String,
    pub salt: String,
    pub approved: bool,
    pub created_ms: u64,
    #[serde(default)]
    pub last_seen_ms: u64,
    /// What this person is doing on Sunday ("Camera 1", "Audio A2"). Free text,
    /// set by an admin — the leader board sorts by exception, and a role is what
    /// makes "not arrived" actionable rather than just a name.
    #[serde(default)]
    pub role: String,
    /// The canonical Planning Center spelling of this person's name, healed in
    /// once a confident roster match is seen ("zach green" → "Zachary Green").
    /// Matching-only: login and chat keep the name the person typed. Empty =
    /// not yet linked.
    #[serde(default)]
    pub pco_name: String,
}

/// A personal, one-time onboarding link: grants member-tier gateway access
/// while unclaimed, prefills name+role, and registers PRE-APPROVED — the
/// invite itself is the approval, so the volunteer never sees a pending
/// screen. Expires after a week; revocable from the booth.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invite {
    pub token: String,
    pub name: String,
    #[serde(default)]
    pub role: String,
    pub created_ms: u64,
    pub expires_ms: u64,
    #[serde(default)]
    pub used: bool,
}

pub const INVITE_TTL_MS: u64 = 7 * 24 * 3600 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Store {
    users: Vec<User>,
    /// session token -> user id (device logins survive booth restarts)
    sessions: HashMap<String, String>,
    #[serde(default)]
    invites: Vec<Invite>,
}

#[derive(Default)]
pub struct IdentityInner {
    store: Mutex<Store>,
    /// name -> (fail count, locked-until ms). In-memory: reboot clears it.
    lockouts: Mutex<HashMap<String, (u32, u64)>>,
}

pub type IdentityState = std::sync::Arc<IdentityInner>;

fn store_path() -> PathBuf {
    let mut dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    dir.push("ProDeck");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("identity.json")
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn rand_hex(bytes: usize) -> String {
    // No new crypto dependency: SHA-256 over OS-provided entropy sources.
    let seed = format!(
        "{:?}:{}:{}",
        std::time::SystemTime::now(),
        std::process::id(),
        uuid::Uuid::new_v4()
    );
    let mut h = Sha256::new();
    h.update(seed.as_bytes());
    hex::encode(&h.finalize()[..bytes])
}

fn hash_pin(salt: &str, pin: &str) -> String {
    let mut h = Sha256::new();
    h.update(salt.as_bytes());
    h.update(pin.as_bytes());
    hex::encode(h.finalize())
}

impl IdentityInner {
    pub fn load() -> Self {
        let store = std::fs::read_to_string(store_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self { store: Mutex::new(store), lockouts: Mutex::new(HashMap::new()) }
    }

    fn persist(&self, store: &Store) {
        if let Ok(json) = serde_json::to_string_pretty(store) {
            let tmp = store_path().with_extension("json.tmp");
            if std::fs::write(&tmp, json).is_ok() {
                let _ = std::fs::rename(&tmp, store_path());
            }
        }
    }
}

fn valid_pin(pin: &str) -> bool {
    pin.len() == 4 && pin.chars().all(|c| c.is_ascii_digit())
}

// ---------------------------------------------------------------- core ops
// (shared by desktop commands and the web gateway dispatch)

pub fn register_core(
    app: &AppHandle,
    id_state: &IdentityState,
    name: String,
    pin: String,
    // Position from the Planning Center roster when the volunteer picked their
    // name off this week's plan. Safe to accept from the device: a role is a
    // label, never a permission (tiers come from the gateway password), and an
    // admin can correct it under Settings → Crew.
    role: String,
    // Personal invite token. A valid one makes this registration PRE-APPROVED
    // (the admin approved by sending the link) and overrides name/role with
    // what the invite was issued for — the token is the credential, so the
    // claimer can't register as somebody else with it.
    invite: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    let now = now_ms();

    let inv = match invite.as_deref().filter(|t| !t.is_empty()) {
        Some(tok) => {
            let Some(i) = s
                .invites
                .iter()
                .find(|i| i.token == tok && !i.used && i.expires_ms > now)
                .cloned()
            else {
                return Err("this invite link was already used or has expired — ask for a new one".into());
            };
            Some(i)
        }
        None => None,
    };

    let name = inv
        .as_ref()
        .map(|i| i.name.clone())
        .unwrap_or(name)
        .trim()
        .chars()
        .take(MAX_NAME)
        .collect::<String>();
    let role = inv.as_ref().map(|i| i.role.clone()).unwrap_or(role);
    if name.is_empty() {
        return Err("name is required".into());
    }
    if !valid_pin(&pin) {
        return Err("PIN must be exactly 4 digits".into());
    }
    if s.users.iter().any(|u| u.name.eq_ignore_ascii_case(&name)) {
        return Err(format!("\"{name}\" is taken — pick another name or log in"));
    }
    let approved = inv.is_some();
    let salt = rand_hex(16);
    let user = User {
        id: rand_hex(8),
        pin_hash: hash_pin(&salt, &pin),
        salt,
        name: name.clone(),
        approved,
        created_ms: now,
        last_seen_ms: 0,
        role: role.trim().chars().take(48).collect(),
        pco_name: String::new(),
    };
    let uid = user.id.clone();
    let urole = user.role.clone();
    s.users.push(user);

    if let Some(i) = &inv {
        if let Some(stored) = s.invites.iter_mut().find(|x| x.token == i.token) {
            stored.used = true;
        }
        // Invited = approved = signed in, in one step: mint the device session
        // now so the phone lands on Home, not on a PIN re-entry.
        let session = rand_hex(24);
        s.sessions.insert(session.clone(), uid.clone());
        id_state.persist(&s);
        app.emit("identity:changed", json!({})).ok();
        return Ok(json!({
            "status": "ok", "session": session, "name": name, "id": uid, "role": urole,
        }));
    }

    id_state.persist(&s);
    app.emit("identity:changed", json!({})).ok();
    Ok(json!({ "status": "pending", "name": name }))
}

// ------------------------------------------------------------- invites

pub fn invite_create_core(
    id_state: &IdentityState,
    name: String,
    role: String,
) -> Result<Invite, String> {
    let name = name.trim().chars().take(MAX_NAME).collect::<String>();
    if name.is_empty() {
        return Err("who is this invite for?".into());
    }
    let mut s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    if s.users.iter().any(|u| u.name.eq_ignore_ascii_case(&name)) {
        return Err(format!("\"{name}\" already has an account"));
    }
    // One open invite per name — re-inviting replaces the old link.
    s.invites.retain(|i| !i.name.eq_ignore_ascii_case(&name));
    let now = now_ms();
    let inv = Invite {
        token: rand_hex(12),
        name,
        role: role.trim().chars().take(48).collect(),
        created_ms: now,
        expires_ms: now + INVITE_TTL_MS,
        used: false,
    };
    s.invites.push(inv.clone());
    id_state.persist(&s);
    Ok(inv)
}

pub fn invite_list_core(id_state: &IdentityState) -> serde_json::Value {
    let s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    let now = now_ms();
    json!(s
        .invites
        .iter()
        .map(|i| json!({
            "token": i.token, "name": i.name, "role": i.role,
            "expires_ms": i.expires_ms, "used": i.used,
            "expired": i.expires_ms <= now,
        }))
        .collect::<Vec<_>>())
}

pub fn invite_revoke_core(id_state: &IdentityState, token: String) {
    let mut s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    s.invites.retain(|i| i.token != token);
    id_state.persist(&s);
}

/// Public view of a valid (unused, unexpired) invite — what the claiming
/// phone shows before the PIN is chosen. None = invalid.
pub fn invite_info_core(id_state: &IdentityState, token: &str) -> Option<serde_json::Value> {
    let s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    let now = now_ms();
    s.invites
        .iter()
        .find(|i| i.token == token && !i.used && i.expires_ms > now)
        .map(|i| json!({ "name": i.name, "role": i.role }))
}

/// Does this token grant member-tier gateway access? (Unclaimed, unexpired
/// personal invites do — the claim swaps the phone onto the durable token.)
pub fn invite_grants_gateway(id_state: &IdentityState, token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    let s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    let now = now_ms();
    s.invites
        .iter()
        .any(|i| i.token == token && !i.used && i.expires_ms > now)
}

pub fn login_core(
    id_state: &IdentityState,
    name: String,
    pin: String,
) -> Result<serde_json::Value, String> {
    let key = name.trim().to_lowercase();
    {
        let lock = id_state.lockouts.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((n, until)) = lock.get(&key) {
            if *n >= LOCKOUT_AFTER && now_ms() < *until {
                return Err("too many attempts — try again in a few minutes".into());
            }
        }
    }
    let mut s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    // Typed name first; the healed PCO spelling second. Phones adopt pco_name
    // as their display/matching name after the heal, so a re-login typed from
    // what the phone now SHOWS must still find the account (audit finding:
    // matching only `name` broke PIN unlock after a heal).
    let trimmed = name.trim();
    let idx = s
        .users
        .iter()
        .position(|u| u.name.eq_ignore_ascii_case(trimmed))
        .or_else(|| {
            s.users
                .iter()
                .position(|u| !u.pco_name.is_empty() && u.pco_name.eq_ignore_ascii_case(trimmed))
        })
        .ok_or("no such name — register first")?;
    let user = &mut s.users[idx];
    if hash_pin(&user.salt, &pin) != user.pin_hash {
        drop(s);
        let mut lock = id_state.lockouts.lock().unwrap_or_else(|p| p.into_inner());
        let e = lock.entry(key).or_insert((0, 0));
        e.0 += 1;
        e.1 = now_ms() + LOCKOUT_SECS * 1000;
        return Err("wrong PIN".into());
    }
    if !user.approved {
        return Ok(json!({ "status": "pending", "name": user.name }));
    }
    user.last_seen_ms = now_ms();
    let uid = user.id.clone();
    let uname = user.name.clone();
    let urole = user.role.clone();
    let token = rand_hex(24);
    s.sessions.insert(token.clone(), uid.clone());
    id_state.persist(&s);
    id_state.lockouts.lock().unwrap_or_else(|p| p.into_inner()).remove(&name.trim().to_lowercase());
    // The id rides along so devices can match checklist-item owners without a
    // second round-trip (names stay display-only).
    Ok(json!({ "status": "ok", "session": token, "name": uname, "id": uid, "role": urole }))
}

/// Resolve a session token to the user's verified name (None = invalid).
pub fn session_name(id_state: &IdentityState, session: &str) -> Option<String> {
    if session.is_empty() {
        return None;
    }
    let mut s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    let uid = s.sessions.get(session)?.clone();
    let user = s.users.iter_mut().find(|u| u.id == uid)?;
    if !user.approved {
        return None; // approval revoked → sessions die with it
    }
    user.last_seen_ms = now_ms();
    Some(user.name.clone())
}

/// Session → (user id, display name). Pages key receipts by id, so knowing the
/// name alone (as `session_name` returns) isn't enough to record a confirm.
pub fn session_user(id_state: &IdentityState, session: &str) -> Option<(String, String)> {
    if session.is_empty() {
        return None;
    }
    let mut s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    let uid = s.sessions.get(session)?.clone();
    let user = s.users.iter_mut().find(|u| u.id == uid)?;
    if !user.approved {
        return None; // approval revoked → sessions die with it
    }
    user.last_seen_ms = now_ms();
    Some((user.id.clone(), user.name.clone()))
}

/// Session → full self-description for the device holding it. Existing phones
/// signed in before login returned ids use this once to learn who they are.
pub fn whoami_core(id_state: &IdentityState, session: &str) -> Option<serde_json::Value> {
    let mut s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    let uid = s.sessions.get(session)?.clone();
    let user = s.users.iter_mut().find(|u| u.id == uid)?;
    if !user.approved {
        return None;
    }
    user.last_seen_ms = now_ms();
    Some(json!({
        "id": user.id, "name": user.name, "role": user.role,
        "pcoName": user.pco_name,
    }))
}

/// Every approved crew member as (id, name) — the set that can be paged.
pub fn approved_users(id_state: &IdentityState) -> Vec<(String, String)> {
    let s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    s.users
        .iter()
        .filter(|u| u.approved)
        .map(|u| (u.id.clone(), u.name.clone()))
        .collect()
}

pub fn set_role_core(
    app: &AppHandle,
    id_state: &IdentityState,
    id: String,
    role: String,
) -> Result<(), String> {
    let mut s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    let user = s
        .users
        .iter_mut()
        .find(|u| u.id == id)
        .ok_or("no such crew member")?;
    user.role = role.trim().chars().take(48).collect();
    let snapshot = s.clone();
    drop(s);
    id_state.persist(&snapshot);
    app.emit("identity:changed", json!({})).ok();
    Ok(())
}

/// Distinct roles in use across approved crew — strings only, no names or
/// ids, so it's safe for the MEMBER tier. This is how a phone learns which
/// role channels exist (the full roster stays admin-only).
pub fn roles_core(id_state: &IdentityState) -> serde_json::Value {
    let s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    let mut roles: Vec<String> = s
        .users
        .iter()
        .filter(|u| u.approved)
        .map(|u| u.role.trim().to_string())
        .filter(|r| !r.is_empty())
        .collect();
    roles.sort();
    roles.dedup();
    json!(roles)
}

pub fn list_core(id_state: &IdentityState) -> serde_json::Value {
    let s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    json!(s
        .users
        .iter()
        .map(|u| json!({
            "id": u.id, "name": u.name, "approved": u.approved,
            "created_ms": u.created_ms, "last_seen_ms": u.last_seen_ms,
            "role": u.role, "pco_name": u.pco_name,
        }))
        .collect::<Vec<_>>())
}

pub fn approve_core(
    app: &AppHandle,
    id_state: &IdentityState,
    id: String,
    approved: bool,
) -> Result<(), String> {
    let mut s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    let user = s.users.iter_mut().find(|u| u.id == id).ok_or("no such user")?;
    user.approved = approved;
    if !approved {
        s.sessions.retain(|_, uid| *uid != id);
    }
    id_state.persist(&s);
    app.emit("identity:changed", json!({})).ok();
    Ok(())
}

pub fn remove_core(app: &AppHandle, id_state: &IdentityState, id: String) -> Result<(), String> {
    let mut s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    s.users.retain(|u| u.id != id);
    s.sessions.retain(|_, uid| *uid != id);
    id_state.persist(&s);
    app.emit("identity:changed", json!({})).ok();
    Ok(())
}

// ------------------------------------------------------------ PCO name heal
// A volunteer who TYPED their name at signup ("zach green") instead of tapping
// it off the plan never gets the exact PCO spelling — and name-keyed features
// (arrival call time, position guides, position-gated checklists) match
// weakly or not at all. Whenever the booth has a roster, this pass links each
// approved user to their PCO person (same rule as the phone's arrival match:
// exact normalized name, else same last name + first-name prefix either way)
// and, when the user has no role yet, adopts their scheduled position so
// role-gated checklists and channels start working without an admin visit.

fn norm_name(s: &str) -> String {
    s.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Exact or nickname-style match ("zach green" ↔ "Zachary Green"). Mirrors
/// arrivalForIn in pcoStore.tsx — keep the two in agreement.
fn name_matches(mine: &str, theirs: &str) -> bool {
    let me = norm_name(mine);
    let them = norm_name(theirs);
    if me.is_empty() || them.is_empty() {
        return false;
    }
    if me == them {
        return true;
    }
    let mp: Vec<&str> = me.split(' ').collect();
    let tp: Vec<&str> = them.split(' ').collect();
    if mp.len() < 2 || tp.len() < 2 {
        return false;
    }
    let (my_first, my_last) = (mp[0], mp[mp.len() - 1]);
    let (their_first, their_last) = (tp[0], tp[tp.len() - 1]);
    my_last == their_last
        && my_first.len() > 1
        && their_first.len() > 1
        && (my_first.starts_with(their_first) || their_first.starts_with(my_first))
}

/// One roster row as the frontend sends it: the PCO spelling + this week's
/// scheduled position.
#[derive(Debug, Clone, Deserialize)]
pub struct RosterEntry {
    pub name: String,
    #[serde(default)]
    pub position: String,
}

/// Pure heal step over a user list — returns (pco_name set, role set) counts
/// so the caller knows whether anything changed. Ambiguity rule: a nickname
/// match that fits MORE THAN ONE roster person links nobody (better unlinked
/// than linked to the wrong sibling); an exact match always wins.
fn heal_users(users: &mut [User], roster: &[RosterEntry]) -> (usize, usize) {
    let (mut linked, mut roled) = (0usize, 0usize);
    // One PCO person per account: without this, "Zach G" and "Zachary Green"
    // both nickname-link to the same roster row and both inherit its position
    // (audit finding). First-come keeps the link; later candidates skip.
    let mut claimed: Vec<String> = users
        .iter()
        .filter(|u| !u.pco_name.is_empty())
        .map(|u| norm_name(&u.pco_name))
        .collect();
    for i in 0..users.len() {
        if !users[i].approved {
            continue;
        }
        let key = if users[i].pco_name.is_empty() {
            users[i].name.clone()
        } else {
            users[i].pco_name.clone()
        };
        let exact: Vec<&RosterEntry> =
            roster.iter().filter(|r| norm_name(&r.name) == norm_name(&key)).collect();
        let hit = if let Some(e) = exact.first() {
            Some(*e)
        } else {
            let nicks: Vec<&RosterEntry> =
                roster.iter().filter(|r| name_matches(&key, &r.name)).collect();
            // Distinct people can share a plan row spelling; dedupe by name
            // before calling it ambiguous.
            let mut names: Vec<String> = nicks.iter().map(|r| norm_name(&r.name)).collect();
            names.sort();
            names.dedup();
            if names.len() == 1 { nicks.into_iter().next() } else { None }
        };
        if let Some(r) = hit {
            let canonical: String = r.name.trim().chars().take(MAX_NAME).collect();
            let cnorm = norm_name(&canonical);
            let already_mine = norm_name(&users[i].pco_name) == cnorm;
            if !already_mine && claimed.contains(&cnorm) {
                continue; // someone else already owns this PCO person
            }
            if users[i].pco_name != canonical {
                users[i].pco_name = canonical;
                claimed.push(cnorm);
                linked += 1;
            }
            if users[i].role.trim().is_empty() && !r.position.trim().is_empty() {
                users[i].role = r.position.trim().chars().take(48).collect();
                roled += 1;
            }
        }
    }
    (linked, roled)
}

/// Find an approved user by display OR healed PCO name (normalized) — the
/// Stream Deck's crew-board nudge keys address people by name.
pub fn find_approved_by_name(id_state: &IdentityState, name: &str) -> Option<(String, String)> {
    let want = norm_name(name);
    if want.is_empty() {
        return None;
    }
    let s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    s.users
        .iter()
        .filter(|u| u.approved)
        .find(|u| norm_name(&u.name) == want || norm_name(&u.pco_name) == want)
        .map(|u| (u.id.clone(), u.name.clone()))
}

/// Every user name (any approval state) — mirrored to the edge so booth-off
/// signups get "name taken" immediately instead of failing at ingest.
pub fn all_names(id_state: &IdentityState) -> Vec<String> {
    let s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    s.users.iter().map(|u| u.name.clone()).collect()
}

/// Booth-off signups from the cloud: create the pending-approval account and
/// adopt the edge-minted session, so the phone that joined at the edge is
/// already signed in when the booth wakes. Returns every id to mark consumed
/// — including duplicates and malformed rows, or a bad row would be
/// re-delivered on every heartbeat forever.
pub fn ingest_edge_joins(
    app: &AppHandle,
    id_state: &IdentityState,
    joins: &[serde_json::Value],
) -> Vec<String> {
    let mut consumed = Vec::new();
    if joins.is_empty() {
        return consumed;
    }
    let mut s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    let mut changed = false;
    for j in joins {
        let get = |k: &str| j.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let id = get("id");
        if id.is_empty() {
            continue;
        }
        consumed.push(id);
        let name: String = get("name").trim().chars().take(MAX_NAME).collect();
        let (salt, pin_hash, session) = (get("salt"), get("pinHash"), get("session"));
        // The edge hashes with our own salt+sha256 scheme; anything that
        // doesn't look like that output is dropped, not guessed at.
        if name.len() < 2 || salt.is_empty() || pin_hash.len() != 64 || session.len() < 16 {
            continue;
        }
        // Same normalization as the edge dup-check (lowercase + whitespace
        // collapse), so a spelling the edge would have refused can't slip
        // in as a near-duplicate here (audit finding).
        let n = norm_name(&name);
        if s.users.iter().any(|u| norm_name(&u.name) == n || norm_name(&u.pco_name) == n) {
            continue; // taken — that phone redoes the join against the booth
        }
        let user = User {
            id: rand_hex(8),
            name,
            pin_hash,
            salt,
            approved: false,
            created_ms: j.get("ts").and_then(|v| v.as_u64()).unwrap_or_else(now_ms),
            last_seen_ms: 0,
            role: get("role").trim().chars().take(48).collect(),
            pco_name: String::new(),
        };
        s.sessions.insert(session, user.id.clone());
        s.users.push(user);
        changed = true;
    }
    if changed {
        let snapshot = s.clone();
        drop(s);
        id_state.persist(&snapshot);
        app.emit("identity:changed", json!({})).ok();
    }
    consumed
}

pub fn heal_pco_core(
    app: &AppHandle,
    id_state: &IdentityState,
    roster: Vec<RosterEntry>,
) -> serde_json::Value {
    let mut s = id_state.store.lock().unwrap_or_else(|p| p.into_inner());
    let (linked, roled) = heal_users(&mut s.users, &roster);
    if linked + roled > 0 {
        let snapshot = s.clone();
        drop(s);
        id_state.persist(&snapshot);
        app.emit("identity:changed", json!({})).ok();
    }
    json!({ "linked": linked, "rolesFilled": roled })
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn identity_list(identity: tauri::State<'_, IdentityState>) -> serde_json::Value {
    list_core(identity.inner())
}

#[tauri::command]
pub fn identity_roles(identity: tauri::State<'_, IdentityState>) -> serde_json::Value {
    roles_core(identity.inner())
}

#[tauri::command]
pub fn identity_approve(
    id: String,
    approved: bool,
    identity: tauri::State<'_, IdentityState>,
    app: AppHandle,
) -> Result<(), String> {
    approve_core(&app, identity.inner(), id, approved)
}

#[tauri::command]
pub fn identity_set_role(
    id: String,
    role: String,
    identity: tauri::State<'_, IdentityState>,
    app: AppHandle,
) -> Result<(), String> {
    set_role_core(&app, identity.inner(), id, role)
}

#[tauri::command]
pub fn identity_remove(
    id: String,
    identity: tauri::State<'_, IdentityState>,
    app: AppHandle,
) -> Result<(), String> {
    remove_core(&app, identity.inner(), id)
}

#[tauri::command]
pub fn invite_create(
    name: String,
    role: String,
    identity: tauri::State<'_, IdentityState>,
) -> Result<Invite, String> {
    invite_create_core(identity.inner(), name, role)
}

#[tauri::command]
pub fn invite_list(identity: tauri::State<'_, IdentityState>) -> serde_json::Value {
    invite_list_core(identity.inner())
}

#[tauri::command]
pub fn invite_revoke(token: String, identity: tauri::State<'_, IdentityState>) {
    invite_revoke_core(identity.inner(), token)
}

/// Booth-only (never on the gateway allowlist): the booth frontend calls this
/// whenever a PCO roster lands, so typed-name signups converge on their PCO
/// person without anyone touching Settings.
#[tauri::command]
pub fn identity_heal_pco(
    team: Vec<RosterEntry>,
    identity: tauri::State<'_, IdentityState>,
    app: AppHandle,
) -> serde_json::Value {
    heal_pco_core(&app, identity.inner(), team)
}

#[cfg(test)]
mod heal_tests {
    use super::*;

    fn user(name: &str, role: &str, pco: &str) -> User {
        User {
            id: name.to_string(),
            name: name.to_string(),
            pin_hash: String::new(),
            salt: String::new(),
            approved: true,
            created_ms: 0,
            last_seen_ms: 0,
            role: role.to_string(),
            pco_name: pco.to_string(),
        }
    }
    fn entry(name: &str, position: &str) -> RosterEntry {
        RosterEntry { name: name.to_string(), position: position.to_string() }
    }

    #[test]
    fn nickname_links_and_fills_empty_role() {
        let mut users = vec![user("zach green", "", "")];
        let (linked, roled) =
            heal_users(&mut users, &[entry("Zachary Green", "Audio Engineer")]);
        assert_eq!((linked, roled), (1, 1));
        assert_eq!(users[0].pco_name, "Zachary Green");
        assert_eq!(users[0].role, "Audio Engineer");
        // typed name untouched — logins keep working
        assert_eq!(users[0].name, "zach green");
    }

    #[test]
    fn existing_role_is_never_overwritten() {
        let mut users = vec![user("zach green", "Camera 1", "")];
        let (_, roled) = heal_users(&mut users, &[entry("Zachary Green", "Audio")]);
        assert_eq!(roled, 0);
        assert_eq!(users[0].role, "Camera 1");
    }

    #[test]
    fn ambiguous_nickname_links_nobody() {
        let mut users = vec![user("jo smith", "", "")];
        let roster = [entry("John Smith", "Audio"), entry("Joseph Smith", "Video")];
        let (linked, _) = heal_users(&mut users, &roster);
        assert_eq!(linked, 0);
        assert_eq!(users[0].pco_name, "");
    }

    #[test]
    fn exact_match_beats_ambiguity_and_repeat_is_idempotent() {
        let mut users = vec![user("John Smith", "", "")];
        let roster = [entry("John Smith", "Audio"), entry("Joseph Smith", "Video")];
        let (linked, _) = heal_users(&mut users, &roster);
        assert_eq!(linked, 1);
        let (again, roled_again) = heal_users(&mut users, &roster);
        assert_eq!((again, roled_again), (0, 0));
    }

    #[test]
    fn unapproved_and_single_word_names_are_skipped() {
        let mut users = vec![user("madison", "", "")];
        users.push(User { approved: false, ..user("zach green", "", "") });
        let (linked, _) =
            heal_users(&mut users, &[entry("Madison Clark", "Lyrics"), entry("Zachary Green", "Audio")]);
        assert_eq!(linked, 0);
    }

    #[test]
    fn one_pco_person_never_links_to_two_accounts() {
        // Both accounts nickname-match "Zachary Green"; only the first links.
        let mut users = vec![user("zach green", "", ""), user("zachary g green", "", "")];
        let roster = [entry("Zachary Green", "Audio")];
        let (linked, _) = heal_users(&mut users, &roster);
        assert_eq!(linked, 1);
        let linked_names: Vec<&str> =
            users.iter().filter(|u| !u.pco_name.is_empty()).map(|u| u.name.as_str()).collect();
        assert_eq!(linked_names, vec!["zach green"]);
    }

    #[test]
    fn healed_link_follows_pco_rename() {
        // Already linked; PCO spelling changes (marriage, typo fix) — the link
        // re-heals off the stored pco_name via the nickname rule.
        let mut users = vec![user("zach green", "Audio", "Zachary Green")];
        let (linked, _) = heal_users(&mut users, &[entry("Zach Green", "Audio")]);
        assert_eq!(linked, 1);
        assert_eq!(users[0].pco_name, "Zach Green");
    }
}
