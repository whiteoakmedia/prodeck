// Intercom: push-to-talk between crew phones and tablets.
//
// The booth never carries audio. Phones talk to each other directly over the
// church network (WebRTC, src/lib/intercom.ts); all the booth does is keep the
// roster (who is on, which channels they hear, who is talking where) and pass
// the connection set-up messages between two phones. That keeps the delay to
// what the Wi-Fi adds, and means the booth Mac can never put comms into the
// house: there is nothing here that makes a sound.
//
// Membership is tied to the crew session, never to an id the phone supplies,
// so a phone can only ever join, talk or send set-up messages as itself. A
// phone that stops checking in (locked, walked off the Wi-Fi) drops off the
// roster after STALE_MS.

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
pub fn join(members: &mut Vec<Member>, id: &str, name: &str, listen: &[String], now: u64) -> Result<(), String> {
    let listen: Vec<String> = CHANNELS
        .iter()
        .filter(|c| listen.iter().any(|l| l == *c))
        .map(|c| c.to_string())
        .collect();
    if let Some(m) = members.iter_mut().find(|m| m.id == id) {
        m.name = name.to_string();
        m.listen = listen;
        m.seen_ms = now;
        return Ok(());
    }
    if members.len() >= MAX_MEMBERS {
        return Err(format!("comms is full ({MAX_MEMBERS} people). Someone has to leave first"));
    }
    members.push(Member { id: id.to_string(), name: name.to_string(), listen, talk: None, seen_ms: now });
    Ok(())
}

pub fn leave(members: &mut Vec<Member>, id: &str) -> bool {
    let before = members.len();
    members.retain(|m| m.id != id);
    members.len() != before
}

/// Start (Some) or stop (None) talking. Only on a real line, only as a member.
pub fn talk(members: &mut [Member], id: &str, channel: Option<&str>, now: u64) -> Result<(), String> {
    if let Some(c) = channel {
        if !known(c) {
            return Err(format!("there is no {c} line"));
        }
    }
    let m = members.iter_mut().find(|m| m.id == id).ok_or("join comms first")?;
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

/// A set-up message may only pass between two people who are both on comms.
pub fn may_signal(members: &[Member], from: &str, to: &str, data: &Value) -> Result<(), String> {
    if from == to {
        return Err("can't connect to yourself".into());
    }
    if !members.iter().any(|m| m.id == from) {
        return Err("join comms first".into());
    }
    if !members.iter().any(|m| m.id == to) {
        return Err("that person has left comms".into());
    }
    if data.to_string().len() > MAX_SIGNAL {
        return Err("set-up message too large".into());
    }
    Ok(())
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

/// Everything the gateway routes here. `who` is (user id, name) from the
/// crew session, already resolved by the caller.
pub fn handle(app: &AppHandle, cmd: &str, who: (String, String), args: &Value) -> Result<Value, String> {
    let (id, name) = who;
    let now = now_ms();
    let mut g = MEMBERS.lock().unwrap_or_else(|p| p.into_inner());
    let pruned = prune(&mut g, now);
    let out = match cmd {
        "intercom_join" => {
            let listen: Vec<String> = args
                .get("listen")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let was = g.clone();
            join(&mut g, &id, &name, &listen, now)?;
            // A heartbeat that changes nothing must not wake every phone.
            if pruned || strip_seen(&was) != strip_seen(&g) {
                emit_roster(app, &g);
            }
            return Ok(json!({ "me": id, "roster": roster_json(&g) }));
        }
        "intercom_leave" => {
            if leave(&mut g, &id) || pruned {
                emit_roster(app, &g);
            }
            json!({ "ok": true })
        }
        "intercom_talk" => {
            let ch = args.get("channel").and_then(|v| v.as_str());
            talk(&mut g, &id, ch, now)?;
            emit_roster(app, &g);
            return Ok(json!({ "ok": true }));
        }
        "intercom_signal" => {
            let to = args.get("to").and_then(|v| v.as_str()).unwrap_or("");
            let data = args.get("data").cloned().unwrap_or(Value::Null);
            may_signal(&g, &id, to, &data)?;
            app.emit("intercom:signal", json!({ "from": id, "to": to, "data": data })).ok();
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

    #[test]
    fn join_keeps_only_real_lines_and_refreshes_in_place() {
        let mut m = Vec::new();
        join(&mut m, "u1", "Sam", &s(&["All", "Nope", "Cameras"]), 1).unwrap();
        assert_eq!(m[0].listen, s(&["All", "Cameras"]));
        join(&mut m, "u1", "Sam", &s(&["Stage"]), 2).unwrap();
        assert_eq!(m.len(), 1, "a heartbeat must not add a second Sam");
        assert_eq!(m[0].listen, s(&["Stage"]));
        assert_eq!(m[0].seen_ms, 2);
    }

    #[test]
    fn talking_needs_membership_and_a_real_line() {
        let mut m = Vec::new();
        assert!(talk(&mut m, "u1", Some("All"), 1).is_err(), "not on comms yet");
        join(&mut m, "u1", "Sam", &s(&["All"]), 1).unwrap();
        assert!(talk(&mut m, "u1", Some("Lobby"), 2).is_err());
        talk(&mut m, "u1", Some("Cameras"), 2).unwrap();
        assert_eq!(m[0].talk.as_deref(), Some("Cameras"));
        talk(&mut m, "u1", None, 3).unwrap();
        assert_eq!(m[0].talk, None);
    }

    #[test]
    fn silent_phones_drop_off() {
        let mut m = Vec::new();
        join(&mut m, "u1", "Sam", &s(&["All"]), 0).unwrap();
        join(&mut m, "u2", "Jo", &s(&["All"]), 40_000).unwrap();
        assert!(prune(&mut m, STALE_MS));
        assert_eq!(m.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["u2"]);
        assert!(!prune(&mut m, STALE_MS + 1), "Jo checked in recently");
    }

    // The booth relays set-up messages between phones; it must not become a
    // way for anyone to message a phone that isn't on comms.
    #[test]
    fn set_up_messages_only_pass_between_members() {
        let mut m = Vec::new();
        join(&mut m, "u1", "Sam", &s(&["All"]), 0).unwrap();
        let d = json!({ "sdp": "x" });
        assert!(may_signal(&m, "u1", "u2", &d).is_err(), "u2 isn't on comms");
        join(&mut m, "u2", "Jo", &s(&["All"]), 0).unwrap();
        assert!(may_signal(&m, "u1", "u2", &d).is_ok());
        assert!(may_signal(&m, "u3", "u2", &d).is_err(), "u3 isn't on comms");
        assert!(may_signal(&m, "u1", "u1", &d).is_err());
        let big = json!({ "sdp": "x".repeat(MAX_SIGNAL) });
        assert!(may_signal(&m, "u1", "u2", &big).is_err());
    }

    #[test]
    fn comms_has_a_ceiling() {
        let mut m = Vec::new();
        for i in 0..MAX_MEMBERS {
            join(&mut m, &format!("u{i}"), "x", &s(&["All"]), 0).unwrap();
        }
        assert!(join(&mut m, "late", "x", &s(&["All"]), 0).is_err());
        assert!(join(&mut m, "u0", "x", &s(&["All"]), 1).is_ok(), "someone already on can still check in");
    }
}
