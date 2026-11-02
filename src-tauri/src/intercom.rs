// Intercom: push-to-talk between crew phones and tablets.
//
// The booth never carries audio. Phones talk to each other directly over the
// church network (WebRTC, src/lib/intercom.ts); all the booth does is keep the
// roster (who is on, which channels they hear, who is talking where) and pass
// the connection set-up messages between two phones. That keeps the delay to
// what the Wi-Fi adds, and means the booth Mac can never put comms into the
// house: there is nothing here that makes a sound.
//
// Membership is per DEVICE, keyed by its crew session and never by an id the
// phone supplies, so a phone can only ever join, talk or send set-up messages
// as itself. Per device, not per person: the director on a phone and an iPad
// is two devices, and keyed by person they collapsed into one entry with
// nobody to call. Each device gets a random public id; the session never
// leaves the booth. A phone that stops checking in (locked, walked off the
// Wi-Fi) drops off the roster after STALE_MS.

use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// The party lines. "All" is the director's line: everyone hears it unless
/// they turn it off.
pub const CHANNELS: &[&str] = &["All", "Cameras", "Stage", "Booth"];
/// Phones re-join every 15s; three missed means gone.
const STALE_MS: u64 = 45_000;
/// Set-up messages are SDP and ICE candidates: a few KB at most.
const MAX_SIGNAL: usize = 16 * 1024;
/// A mesh: every phone connects to every other. Past this the phones, not the
/// booth, run out of breath.
pub const MAX_MEMBERS: usize = 16;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Member {
    /// The device's crew session. Booth only: it is the device's password.
    #[serde(skip)]
    pub key: String,
    /// Random, public: what other phones address set-up messages to.
    pub id: String,
    pub name: String,
    pub listen: Vec<String>,
    /// The channel this person is talking on right now, if any.
    pub talk: Option<String>,
    #[serde(skip)]
    pub seen_ms: u64,
}

static MEMBERS: Mutex<Vec<Member>> = Mutex::new(Vec::new());

fn known(ch: &str) -> bool {
    CHANNELS.contains(&ch)
}

/// Add or refresh a member. Unknown channels are dropped, not an error: a
/// phone from an older or newer ProDeck may name lines this booth lacks.
pub fn join(
    members: &mut Vec<Member>,
    key: &str,
    name: &str,
    listen: &[String],
    now: u64,
    new_id: impl FnOnce() -> String,
) -> Result<String, String> {
    let listen: Vec<String> = CHANNELS
        .iter()
        .filter(|c| listen.iter().any(|l| l == *c))
        .map(|c| c.to_string())
        .collect();
    if let Some(m) = members.iter_mut().find(|m| m.key == key) {
        m.name = name.to_string();
        m.listen = listen;
        m.seen_ms = now;
        return Ok(m.id.clone());
    }
    if members.len() >= MAX_MEMBERS {
        return Err(format!("comms is full ({MAX_MEMBERS} devices). Someone has to leave first"));
    }
    let id = new_id();
    members.push(Member { key: key.to_string(), id: id.clone(), name: name.to_string(), listen, talk: None, seen_ms: now });
    Ok(id)
}

pub fn leave(members: &mut Vec<Member>, key: &str) -> bool {
    let before = members.len();
    members.retain(|m| m.key != key);
    members.len() != before
}

/// Start (Some) or stop (None) talking. Only on a real line, only as a member.
pub fn talk(members: &mut [Member], key: &str, channel: Option<&str>, now: u64) -> Result<(), String> {
    if let Some(c) = channel {
        if !known(c) {
            return Err(format!("there is no {c} line"));
        }
    }
    let m = members.iter_mut().find(|m| m.key == key).ok_or("join comms first")?;
    m.talk = channel.map(|c| c.to_string());
    m.seen_ms = now;
    Ok(())
}

/// Drop phones that stopped checking in. True if anyone went.
pub fn prune(members: &mut Vec<Member>, now: u64) -> bool {
    let before = members.len();
    members.retain(|m| now.saturating_sub(m.seen_ms) < STALE_MS);
    members.len() != before
}

/// A set-up message may only pass between two devices that are both on
/// comms. Returns the sender's public id.
pub fn may_signal(members: &[Member], from_key: &str, to: &str, data: &Value) -> Result<String, String> {
    let from = members.iter().find(|m| m.key == from_key).ok_or("join comms first")?;
    if from.id == to {
        return Err("can't connect to yourself".into());
    }
    if !members.iter().any(|m| m.id == to) {
        return Err("that device has left comms".into());
    }
    if data.to_string().len() > MAX_SIGNAL {
        return Err("set-up message too large".into());
    }
    Ok(from.id.clone())
}

fn now_ms() -> u64 {
    crate::identity::now_ms()
}

fn roster_json(members: &[Member]) -> Value {
    json!({ "channels": CHANNELS, "members": members })
}

fn emit_roster(app: &AppHandle, members: &[Member]) {
    app.emit("intercom:roster", roster_json(members)).ok();
}

/// Shown on every phone when the booth has comms switched off.
pub const OFF: &str = "Comms is turned off at the booth (Settings, Crew & screens, Comms)";

/// Who a comms call comes from, worked out by the gateway.
pub struct Who {
    /// Booth-only device key: a crew session, or "station:" + a camera
    /// station's own random key.
    pub key: String,
    pub name: String,
}

/// A camera station (an iPad on a tally link) has a member token but no crew
/// account: it names itself after its camera and keys itself with a random
/// id it keeps. Only plain, longish keys, so it can't be confused with
/// anything else, and a short printable name.
pub fn station_who(key: &str, name: &str) -> Option<Who> {
    let ok = (16..=64).contains(&key.len()) && key.chars().all(|c| c.is_ascii_alphanumeric());
    if !ok {
        return None;
    }
    let name: String = name.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(24).collect();
    Some(Who { key: format!("station:{key}"), name: if name.is_empty() { "Camera station".into() } else { name } })
}

/// Everything the gateway routes here. `enabled` is the booth's Comms switch.
pub fn handle(app: &AppHandle, cmd: &str, who: Who, enabled: bool, args: &Value) -> Result<Value, String> {
    let key = who.key.as_str();
    let name = who.name.as_str();
    let now = now_ms();
    let mut g = MEMBERS.lock().unwrap_or_else(|p| p.into_inner());
    if !enabled {
        // Switched off: drop everyone, so phones that are still on hang up.
        if !g.is_empty() {
            g.clear();
            emit_roster(app, &g);
        }
        return if cmd == "intercom_leave" { Ok(json!({ "ok": true })) } else { Err(OFF.into()) };
    }
    let pruned = prune(&mut g, now);
    let out = match cmd {
        "intercom_join" => {
            let listen: Vec<String> = args
                .get("listen")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let was = g.clone();
            let id = join(&mut g, key, name, &listen, now, || uuid::Uuid::new_v4().simple().to_string()[..12].to_string())?;
            // A heartbeat that changes nothing must not wake every phone.
            if pruned || strip_seen(&was) != strip_seen(&g) {
                emit_roster(app, &g);
            }
            return Ok(json!({ "me": id, "roster": roster_json(&g) }));
        }
        "intercom_leave" => {
            if leave(&mut g, key) || pruned {
                emit_roster(app, &g);
            }
            json!({ "ok": true })
        }
        "intercom_talk" => {
            let ch = args.get("channel").and_then(|v| v.as_str());
            talk(&mut g, key, ch, now)?;
            emit_roster(app, &g);
            return Ok(json!({ "ok": true }));
        }
        "intercom_signal" => {
            let to = args.get("to").and_then(|v| v.as_str()).unwrap_or("");
            let data = args.get("data").cloned().unwrap_or(Value::Null);
            let from = may_signal(&g, key, to, &data)?;
            app.emit("intercom:signal", json!({ "from": from, "to": to, "data": data })).ok();
            json!({ "ok": true })
        }
        "intercom_roster" => roster_json(&g),
        _ => return Err(format!("unknown intercom command {cmd}")),
    };
    if pruned {
        emit_roster(app, &g);
    }
    Ok(out)
}

fn strip_seen(ms: &[Member]) -> Vec<Member> {
    ms.iter().cloned().map(|mut m| {
        m.seen_ms = 0;
        m
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }
    fn j(m: &mut Vec<Member>, key: &str, listen: &[&str], now: u64) -> Result<String, String> {
        // Like the real ids: nothing derived from the session.
        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        join(m, key, "Sam", &s(listen), now, || format!("dev{}", N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)))
    }

    #[test]
    fn join_keeps_only_real_lines_and_refreshes_in_place() {
        let mut m = Vec::new();
        let id = j(&mut m, "sess1", &["All", "Nope", "Cameras"], 1).unwrap();
        assert_eq!(m[0].listen, s(&["All", "Cameras"]));
        let again = j(&mut m, "sess1", &["Stage"], 2).unwrap();
        assert_eq!(m.len(), 1, "a heartbeat must not add a second entry");
        assert_eq!(again, id, "the device keeps its public id");
        assert_eq!(m[0].listen, s(&["Stage"]));
        assert_eq!(m[0].seen_ms, 2);
    }

    // The director on a phone and an iPad, both signed in as themselves:
    // keyed by person they were one entry and could never call each other.
    #[test]
    fn two_devices_of_one_person_are_two_members() {
        let mut m = Vec::new();
        let a = j(&mut m, "phone", &["All"], 0).unwrap();
        let b = j(&mut m, "ipad", &["All"], 0).unwrap();
        assert_ne!(a, b);
        assert_eq!(m.len(), 2);
        assert_eq!(may_signal(&m, "phone", &b, &json!({})).unwrap(), a);
    }

    #[test]
    fn the_session_never_appears_in_the_roster() {
        let mut m = Vec::new();
        j(&mut m, "secret-session", &["All"], 0).unwrap();
        let out = roster_json(&m).to_string();
        assert!(!out.contains("secret-session"), "{out}");
    }

    #[test]
    fn talking_needs_membership_and_a_real_line() {
        let mut m = Vec::new();
        assert!(talk(&mut m, "sess1", Some("All"), 1).is_err(), "not on comms yet");
        j(&mut m, "sess1", &["All"], 1).unwrap();
        assert!(talk(&mut m, "sess1", Some("Lobby"), 2).is_err());
        talk(&mut m, "sess1", Some("Cameras"), 2).unwrap();
        assert_eq!(m[0].talk.as_deref(), Some("Cameras"));
        talk(&mut m, "sess1", None, 3).unwrap();
        assert_eq!(m[0].talk, None);
    }

    #[test]
    fn silent_phones_drop_off() {
        let mut m = Vec::new();
        j(&mut m, "s1", &["All"], 0).unwrap();
        j(&mut m, "s2", &["All"], 40_000).unwrap();
        assert!(prune(&mut m, STALE_MS));
        assert_eq!(m.iter().map(|x| x.key.as_str()).collect::<Vec<_>>(), vec!["s2"]);
        assert!(!prune(&mut m, STALE_MS + 1), "s2 checked in recently");
    }

    // The booth relays set-up messages between phones; it must not become a
    // way for anyone to message a phone that isn't on comms.
    #[test]
    fn set_up_messages_only_pass_between_members() {
        let mut m = Vec::new();
        let a = j(&mut m, "s1", &["All"], 0).unwrap();
        let d = json!({ "sdp": "x" });
        assert!(may_signal(&m, "s1", "nobody", &d).is_err(), "nobody isn't on comms");
        let b = j(&mut m, "s2", &["All"], 0).unwrap();
        assert!(may_signal(&m, "s1", &b, &d).is_ok());
        assert!(may_signal(&m, "s3", &b, &d).is_err(), "s3 isn't on comms");
        assert!(may_signal(&m, "s1", &a, &d).is_err());
        let big = json!({ "sdp": "x".repeat(MAX_SIGNAL) });
        assert!(may_signal(&m, "s1", &b, &big).is_err());
    }

    #[test]
    fn a_camera_station_needs_a_proper_key_and_gets_a_short_name() {
        let w = station_who("a1b2c3d4e5f6a7b8c9d0", "  CAM 2  ").unwrap();
        assert_eq!(w.key, "station:a1b2c3d4e5f6a7b8c9d0");
        assert_eq!(w.name, "CAM 2");
        assert!(station_who("short", "CAM 2").is_none());
        assert!(station_who("has spaces in the key!!", "CAM 2").is_none());
        assert_eq!(station_who("a1b2c3d4e5f6a7b8c9d0", "").unwrap().name, "Camera station");
        assert_eq!(station_who("a1b2c3d4e5f6a7b8c9d0", &"x".repeat(80)).unwrap().name.len(), 24);
        // A station key can never be mistaken for a crew session.
        assert!(station_who("a1b2c3d4e5f6a7b8c9d0", "x").unwrap().key.starts_with("station:"));
    }

    #[test]
    fn comms_has_a_ceiling() {
        let mut m = Vec::new();
        for i in 0..MAX_MEMBERS {
            j(&mut m, &format!("s{i}"), &["All"], 0).unwrap();
        }
        assert!(j(&mut m, "late", &["All"], 0).is_err());
        assert!(j(&mut m, "s0", &["All"], 1).is_ok(), "a device already on can still check in");
    }
}
