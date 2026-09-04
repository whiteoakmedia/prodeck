// Crew check-in — "I'm here", with a timestamp the booth can trust.
//
// The design makes this one source of truth used in two places (the Home bar
// and item zero on the checklist) and is explicit that it cannot be checked
// twice. So the booth owns it: check-in is recorded here against the crew
// identity behind the session, is idempotent, and keeps the FIRST time — a
// second tap must not make someone look later than they arrived.
//
// Persisted, because a booth restart mid-morning must not un-arrive the crew.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

use crate::identity::IdentityState;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Store {
    /// user id -> epoch ms of arrival.
    at: HashMap<String, u64>,
    /// The service this set belongs to, so a new service starts everyone clear
    /// rather than inheriting last week's arrivals.
    service_key: String,
    /// When this set of arrivals began. Drives the staleness sweep below.
    #[serde(default)]
    started_ms: u64,
}

/// How long a set of arrivals stays meaningful.
///
/// Switching the PCO plan used to be the ONLY thing that cleared check-ins, so
/// a booth left on last Sunday's plan showed the whole crew as "here" all week
/// — and a volunteer who tapped "I'm here" once could never get back to the
/// un-checked-in state. Twelve hours covers a morning service and anything
/// following it, while always resetting before the next day's service.
const STALE_MS: u64 = 12 * 60 * 60 * 1000;

/// Drop arrivals that belong to a service that is long over. Returns whether
/// anything was cleared, so callers know to persist and announce it.
fn expire_if_stale(s: &mut Store, now: u64) -> bool {
    if s.at.is_empty() {
        return false;
    }
    if now.saturating_sub(s.started_ms) <= STALE_MS {
        return false;
    }
    s.at.clear();
    s.started_ms = 0;
    true
}

#[derive(Default)]
pub struct CheckinInner {
    store: Mutex<Store>,
    /// The booth's CURRENT service key, pushed by the booth UI whenever the
    /// selected plan/time changes. When set, it — not whatever key a phone
    /// happens to carry — decides which sheet an arrival lands on. Audit
    /// finding: trusting the client key let one backgrounded phone (stale
    /// key) or an offline replay WIPE the whole live sheet mid-morning.
    current_key: Mutex<String>,
}

pub type CheckinState = Arc<CheckinInner>;

fn store_path() -> PathBuf {
    let mut dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    dir.push("ProDeck");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("checkin.json")
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl CheckinInner {
    pub fn load() -> Self {
        let mut store: Store = std::fs::read_to_string(store_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        // Sweep at startup too. Only the phones and the report page read this,
        // so waiting for a read would leave a stale sheet sitting on the booth
        // across a restart — which is exactly when services change over.
        //
        // Sheets written before started_ms existed have it at 0 and therefore
        // clear on the first run of this build. That is correct: they are last
        // service's arrivals, which is the bug this fixes.
        let me = Self { store: Mutex::new(Store::default()), current_key: Mutex::new(String::new()) };
        if expire_if_stale(&mut store, now_ms()) {
            me.persist(&store);
        }
        *me.store.lock().unwrap_or_else(|p| p.into_inner()) = store;
        me
    }

    fn persist(&self, s: &Store) {
        // Atomic like every other data file: a crash mid-write must not turn
        // the morning's arrivals into a half-file that load() silently drops.
        let tmp = store_path().with_extension("json.tmp");
        if std::fs::write(&tmp, serde_json::to_string_pretty(s).unwrap_or_default()).is_ok() {
            let _ = std::fs::rename(&tmp, store_path());
        }
    }
}

/// Booth UI → "this is the service we're on now". Client-supplied keys are
/// only trusted when this has never been set (old builds mid-upgrade).
pub fn set_current_service(state: &CheckinState, key: &str) {
    let mut g = state.current_key.lock().unwrap_or_else(|p| p.into_inner());
    *g = key.to_string();
}

/// Record an arrival. Idempotent — the first timestamp wins.
pub fn check_in(
    app: &AppHandle,
    state: &CheckinState,
    identity: &IdentityState,
    session: &str,
    service_key: &str,
) -> Result<u64, String> {
    let (user_id, _name) = crate::identity::session_user(identity, session)
        .ok_or("sign in first — check-in is recorded against your crew identity")?;
    // The booth's own key wins over the client's whenever it exists: a phone
    // backgrounded through a service change carries LAST service's key, and
    // honoring it here cleared everyone who'd arrived since (audit finding).
    let booth_key = {
        let g = state.current_key.lock().unwrap_or_else(|p| p.into_inner());
        g.clone()
    };
    let effective_key: &str = if booth_key.is_empty() { service_key } else { &booth_key };
    let ts = {
        let mut s = state.store.lock().unwrap_or_else(|p| p.into_inner());
        let now = now_ms();
        // A different service means a fresh sheet...
        if !effective_key.is_empty() && s.service_key != effective_key {
            s.at.clear();
            s.started_ms = 0;
            s.service_key = effective_key.to_string();
        }
        // ...and so does a set that has simply gone stale on the same plan.
        expire_if_stale(&mut s, now);
        if s.at.is_empty() {
            s.started_ms = now;
        }
        let ts = *s.at.entry(user_id).or_insert(now);
        state.persist(&s);
        ts
    };
    app.emit("checkin:changed", json!({})).ok();
    Ok(ts)
}

// ---------------------------------------------------------- auto check-in
// Phones can't be pinged — iOS PWAs have no background execution — so the
// direction flips: when the app talks to the gateway, the REQUEST is the
// presence evidence. Two proofs, tried in this order by the phone:
//   1. Network: the request came from a LAN peer, or it rode the tunnel and
//      Cloudflare's CF-Connecting-IP equals this building's WAN address —
//      either way the phone is on church wifi.
//   2. Geolocation (opt-in prompt on the phone): coordinates within the
//      configured radius of the building — catches "in the lot on LTE".
// Both funnel into the same check_in (first timestamp wins), so an auto
// arrival is indistinguishable from a tapped one.

/// This building's public egress addresses, cached. v4 and v6 both matter:
/// a phone on the wifi may reach Cloudflare over IPv6 while the booth's
/// fetch went over IPv4 — comparing against only one arm would call an
/// on-site phone remote.
static WAN_IPS: Mutex<(Vec<String>, u64)> = Mutex::new((Vec::new(), 0));
const WAN_TTL_MS: u64 = 6 * 60 * 60 * 1000;
/// Failure cache: without it every tunnel-side check-in re-runs two 6s
/// fetches while ipify is down, stalling each attempt up to ~12s.
const WAN_RETRY_MS: u64 = 5 * 60 * 1000;

pub async fn wan_ips() -> Vec<String> {
    {
        let g = WAN_IPS.lock().unwrap_or_else(|p| p.into_inner());
        let age = now_ms().saturating_sub(g.1);
        // Fresh success, or a recent failure — either way, don't refetch.
        if (!g.0.is_empty() && age < WAN_TTL_MS) || (g.0.is_empty() && g.1 > 0 && age < WAN_RETRY_MS)
        {
            return g.0.clone();
        }
    }
    let mut ips = Vec::new();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
        .ok();
    if let Some(c) = client {
        for url in ["https://api4.ipify.org", "https://api6.ipify.org"] {
            if let Ok(r) = c.get(url).send().await {
                // ipify sits behind a CDN whose error pages come back 4xx/5xx
                // with short text bodies ("error code: 1015") — caching one of
                // those as our "WAN IP" killed wifi check-in for 6 hours
                // (audit finding). Only a 2xx body that parses as a real IP
                // counts.
                if !r.status().is_success() {
                    continue;
                }
                if let Ok(t) = r.text().await {
                    let t = t.trim().to_string();
                    if t.parse::<std::net::IpAddr>().is_ok() {
                        ips.push(t);
                    }
                }
            }
        }
    }
    let mut g = WAN_IPS.lock().unwrap_or_else(|p| p.into_inner());
    *g = (ips.clone(), now_ms());
    ips
}

/// Presence evidence extracted per-request by the gateway.
pub struct ClientNet {
    /// The TCP peer — a private (non-loopback) address means the phone hit
    /// :8088 directly on the LAN. Loopback means the booth itself OR the
    /// tunnel, which proves nothing by itself.
    pub peer_private: bool,
    /// CF-Connecting-IP when the request rode Cloudflare: the phone's real
    /// public address.
    pub cf_ip: Option<String>,
}

pub async fn on_site(net: &ClientNet) -> bool {
    if net.peer_private {
        return true;
    }
    if let Some(ip) = &net.cf_ip {
        let wans = wan_ips().await;
        return wans.iter().any(|w| same_network(w, ip));
    }
    false
}

/// v4: exact equality (NAT means everyone shares the WAN address). v6: same
/// /64 — there is no NAT66, so a phone's own v6 address NEVER equals the
/// booth's; sharing the site's /64 prefix is the actual "same building"
/// signal (audit finding: exact-match made the v6 arm permanently inert).
fn same_network(a: &str, b: &str) -> bool {
    use std::net::IpAddr;
    match (a.parse::<IpAddr>(), b.parse::<IpAddr>()) {
        (Ok(IpAddr::V4(x)), Ok(IpAddr::V4(y))) => x == y,
        (Ok(IpAddr::V6(x)), Ok(IpAddr::V6(y))) => x.segments()[..4] == y.segments()[..4],
        _ => a == b,
    }
}

/// Great-circle distance in meters — close enough at parking-lot scale.
fn haversine_m(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let r = 6_371_000.0_f64;
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let (dp, dl) = ((lat2 - lat1).to_radians(), (lng2 - lng1).to_radians());
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    2.0 * r * a.sqrt().atan2((1.0 - a).sqrt())
}

/// Geolocation proof: inside the configured radius → same check_in.
/// (church_lat/lng unset = geo path disabled; the phone learns that from
/// checkin_auto's `geo` flag and never prompts for location.)
pub fn geo_check_in(
    app: &AppHandle,
    state: &CheckinState,
    identity: &IdentityState,
    session: &str,
    service_key: &str,
    lat: f64,
    lng: f64,
    church: Option<(f64, f64, f64)>,
) -> Result<serde_json::Value, String> {
    let Some((clat, clng, radius)) = church else {
        return Ok(json!({ "checkedIn": false, "reason": "geo not configured" }));
    };
    let d = haversine_m(lat, lng, clat, clng);
    if d > radius {
        return Ok(json!({ "checkedIn": false, "reason": "too far", "meters": d.round() }));
    }
    let ts = check_in(app, state, identity, session, service_key)?;
    Ok(json!({ "checkedIn": true, "at": ts }))
}

/// Everyone who has checked in for the current service, as {user_id: ms}.
/// `mine` is this session's own arrival — a phone knows its session but not its
/// crew user id, so without it the device cannot tell whether it checked in.
/// User ids checked in for the CURRENT service — "who is in the building".
/// Sweeps staleness first so a page can never go out against last Sunday's
/// sheet. Used by paging to keep broadcasts inside the building.
pub fn arrived_ids(app: &AppHandle, state: &CheckinState) -> std::collections::HashSet<String> {
    let mut s = state.store.lock().unwrap_or_else(|p| p.into_inner());
    if expire_if_stale(&mut s, now_ms()) {
        state.persist(&s);
        app.emit("checkin:changed", json!({})).ok();
    }
    s.at.keys().cloned().collect()
}

pub fn list(
    app: &AppHandle,
    state: &CheckinState,
    identity: &IdentityState,
    session: &str,
) -> serde_json::Value {
    let mut s = state.store.lock().unwrap_or_else(|p| p.into_inner());
    // Swept on read as well as on write: nobody may check in for days, and a
    // stale sheet must not survive just because no one touched it.
    if expire_if_stale(&mut s, now_ms()) {
        state.persist(&s);
        app.emit("checkin:changed", json!({})).ok();
    }
    let who = crate::identity::session_user(identity, session);
    let mine = who.as_ref().and_then(|(id, _)| s.at.get(id).copied());
    // Whether the caller's crew session still resolves. Cheap (already looked
    // up) and side-effect free, so a phone can check on launch whether its
    // account still exists — a deleted or revoked account otherwise leaves the
    // device apparently signed in, with every action silently failing.
    json!({
        "at": s.at,
        "serviceKey": s.service_key,
        "mine": mine,
        "sessionValid": who.is_some(),
    })
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn checkin_set(
    session: String,
    service_key: String,
    state: tauri::State<'_, CheckinState>,
    identity: tauri::State<'_, IdentityState>,
    app: AppHandle,
) -> Result<u64, String> {
    check_in(&app, state.inner(), identity.inner(), &session, &service_key)
}

#[tauri::command]
pub fn checkin_list(
    session: String,
    state: tauri::State<'_, CheckinState>,
    identity: tauri::State<'_, IdentityState>,
    app: AppHandle,
) -> serde_json::Value {
    list(&app, state.inner(), identity.inner(), &session)
}

/// Booth desktop only — Settings shows the detected WAN address(es) so the
/// wifi auto check-in is inspectable rather than magic.
#[tauri::command]
pub async fn checkin_wan_ip() -> Vec<String> {
    wan_ips().await
}

/// Booth desktop only — the UI reports the currently-selected service so
/// arrivals land on the right sheet no matter what key a phone carries.
#[tauri::command]
pub fn checkin_set_service(service_key: String, state: tauri::State<'_, CheckinState>) {
    set_current_service(state.inner(), &service_key);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_network_v4_exact_v6_prefix() {
        assert!(same_network("203.0.113.7", "203.0.113.7"));
        assert!(!same_network("203.0.113.7", "203.0.113.8"));
        // Same /64 = same building; different /64 = elsewhere.
        assert!(same_network("2001:db8:aa:bb::1", "2001:db8:aa:bb:9999::7"));
        assert!(!same_network("2001:db8:aa:bb::1", "2001:db8:aa:cc::1"));
    }

    #[test]
    fn haversine_scale_is_sane() {
        // Same point → 0; one degree of latitude ≈ 111.3 km; ~100 m across a
        // parking lot must land inside a 150 m radius and outside a 50 m one.
        assert!(haversine_m(41.5, -73.0, 41.5, -73.0) < 0.001);
        let deg = haversine_m(41.0, -73.0, 42.0, -73.0);
        assert!((110_000.0..113_000.0).contains(&deg), "1° lat = {deg} m");
        let lot = haversine_m(41.50000, -73.00000, 41.50090, -73.00000); // ~100 m
        assert!(lot > 50.0 && lot < 150.0, "lot hop = {lot} m");
    }

    #[test]
    fn arrival_time_is_kept_on_a_second_tap() {
        let mut s = Store::default();
        let first = *s.at.entry("u1".into()).or_insert(1000);
        let second = *s.at.entry("u1".into()).or_insert(9999);
        assert_eq!(first, second, "a second check-in must not move the time");
        assert_eq!(s.at.len(), 1, "and must not create a second entry");
    }

    #[test]
    fn arrivals_expire_once_the_service_is_long_over() {
        let mut s = Store {
            at: HashMap::from([("u1".to_string(), 1_000u64)]),
            service_key: "planA::time1".into(),
            started_ms: 1_000,
        };
        // Same morning: still checked in.
        assert!(!expire_if_stale(&mut s, 1_000 + 4 * 60 * 60 * 1000));
        assert_eq!(s.at.len(), 1);
        // Next day on the same plan: the sheet is stale and clears itself.
        assert!(expire_if_stale(&mut s, 1_000 + STALE_MS + 1));
        assert!(s.at.is_empty(), "a stale sheet must not survive to next week");
        assert_eq!(s.started_ms, 0);
    }

    #[test]
    fn an_empty_sheet_is_never_reported_as_expiring() {
        let mut s = Store::default();
        assert!(!expire_if_stale(&mut s, u64::MAX), "nothing to clear, nothing to announce");
    }

    #[test]
    fn a_new_service_clears_last_weeks_arrivals() {
        let mut s = Store {
            at: HashMap::from([("u1".to_string(), 1000u64)]),
            service_key: "planA::time1".into(),
            started_ms: 1000,
        };
        let incoming = "planB::time1";
        if s.service_key != incoming {
            s.at.clear();
            s.service_key = incoming.to_string();
        }
        assert!(s.at.is_empty(), "a new service starts everyone un-arrived");
    }
}
