// Team messaging — a production-crew intercom, deliberately not Slack.
// Messages live in a small in-memory ring (lost on restart by design), fan out
// to every surface via the "chat:message" event (desktop directly, browsers
// through the web gateway's SSE forwarder), and carry a target:
//   "team"       — crew chat, rendered in the Messages widget
//   "confidence" — takes over ConfidenceWidget instances as a big banner
//   "stage"      — record-only: the frontend also fires the existing
//                  pp_set_stage_message; this keeps an audit line in the feed
// Sender names are labels, not identities: the booth uses device_name, web
// clients pick a name stored in their browser.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const HISTORY_CAP: usize = 200;
const MAX_FROM: usize = 32;
const MAX_TEXT: usize = 500;
/// How long a confidence banner stays up unless cleared sooner.
pub const CONFIDENCE_TTL_SECS: u64 = 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMsg {
    pub id: u64,
    pub from: String,
    pub text: String,
    pub target: String, // "team" | "confidence" | "stage"
    /// Which conversation this belongs to: "team", or "role:<Role Name>".
    ///
    /// NOT a privacy boundary. Every browser's event stream authenticates with
    /// the gateway password, not a crew identity, so the booth cannot address a
    /// frame to one person — every connected phone receives every message and
    /// the channel only decides where it is FILED. Role channels are for focus
    /// at scale, not secrecy. Direct messages are deliberately absent until the
    /// event stream is identity-aware; shipping them over a broadcast would look
    /// private while being anything but.
    #[serde(default = "default_channel")]
    pub channel: String,
    pub ts: u64,        // unix millis
    /// Some("edge") when this message arrived FROM the cloud mirror (sent by
    /// a phone while the booth was off). The edge pusher must not mirror
    /// these back up — that would echo them into the cloud ring twice.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
}

fn default_channel() -> String {
    "team".to_string()
}

pub struct ChatInner {
    next_id: AtomicU64,
    history: Mutex<VecDeque<ChatMsg>>,
}

impl ChatInner {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            history: Mutex::new(VecDeque::with_capacity(HISTORY_CAP)),
        }
    }
}

pub type ChatState = Arc<ChatInner>;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Validate and canonicalise the channel a message is filed under.
///
/// Stage and confidence are BROADCASTS to hardware, not conversation — they
/// always belong to the team feed regardless of which channel was open on the
/// phone, so the caller's channel is ignored for those targets.
fn normalize_channel(target: &str, channel: &str) -> Result<String, String> {
    if target != "team" {
        return Ok("team".to_string());
    }
    let c = channel.trim();
    if c.is_empty() || c == "team" {
        return Ok("team".to_string());
    }
    let Some(role) = c.strip_prefix("role:") else {
        return Err(format!("unknown channel \"{c}\""));
    };
    let role = role.trim();
    if role.is_empty() {
        return Err("a role channel needs a role name".into());
    }
    Ok(format!("role:{}", role.chars().take(48).collect::<String>()))
}

/// Shared by the desktop command and the web gateway dispatch, so a phone and
/// the booth go through identical validation.
pub fn send_core(
    app: &AppHandle,
    chat: &ChatState,
    from: String,
    text: String,
    target: String,
    channel: String,
) -> Result<ChatMsg, String> {
    let from = from.trim().chars().take(MAX_FROM).collect::<String>();
    let text = text.trim().chars().take(MAX_TEXT).collect::<String>();
    if from.is_empty() {
        return Err("sender name is required".into());
    }
    if text.is_empty() {
        return Err("empty message".into());
    }
    if !matches!(target.as_str(), "team" | "confidence" | "stage") {
        return Err(format!("unknown target \"{target}\""));
    }
    let channel = normalize_channel(&target, &channel)?;
    let msg = ChatMsg {
        id: chat.next_id.fetch_add(1, Ordering::Relaxed),
        from,
        text,
        target,
        channel,
        ts: now_ms(),
        origin: None,
    };
    {
        let mut h = chat.history.lock().unwrap_or_else(|p| p.into_inner());
        if h.len() >= HISTORY_CAP {
            h.pop_front();
        }
        h.push_back(msg.clone());
    }
    app.emit("chat:message", &msg).ok();
    Ok(msg)
}

/// The last `n` booth-authored team messages, oldest first — what the edge
/// pusher mirrors up. Edge-ingested messages are excluded (no echo), and
/// stage/confidence broadcasts stay in the room.
pub fn recent_team(chat: &ChatState, n: usize) -> Vec<ChatMsg> {
    let h = chat.history.lock().unwrap_or_else(|p| p.into_inner());
    let mut out: Vec<ChatMsg> = h
        .iter()
        .rev()
        .filter(|m| m.target == "team" && m.origin.is_none())
        .take(n)
        .cloned()
        .collect();
    out.reverse();
    out
}

/// Insert a message the cloud mirror handed down (sent from a phone while
/// the booth was off). Keeps the sender's name and original timestamp, and
/// fans out through the normal chat:message event so every surface —
/// desktop panel, kiosk, phones on the booth SSE — sees it once.
pub fn ingest_edge(
    app: &AppHandle,
    chat: &ChatState,
    from: String,
    text: String,
    channel: String,
    ts: u64,
) {
    let from = from.trim().chars().take(MAX_FROM).collect::<String>();
    let text = text.trim().chars().take(MAX_TEXT).collect::<String>();
    if from.is_empty() || text.is_empty() {
        return;
    }
    let channel = normalize_channel("team", &channel).unwrap_or_else(|_| "team".into());
    let msg = ChatMsg {
        id: chat.next_id.fetch_add(1, Ordering::Relaxed),
        from,
        text,
        target: "team".into(),
        channel,
        ts: if ts > 0 { ts } else { now_ms() },
        origin: Some("edge".into()),
    };
    {
        let mut h = chat.history.lock().unwrap_or_else(|p| p.into_inner());
        if h.len() >= HISTORY_CAP {
            h.pop_front();
        }
        h.push_back(msg.clone());
    }
    app.emit("chat:message", &msg).ok();
}

pub fn clear_confidence_core(app: &AppHandle) {
    app.emit("chat:confidence_clear", json!({})).ok();
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn chat_send(
    from: String,
    text: String,
    target: String,
    channel: String,
    chat: tauri::State<'_, ChatState>,
    app: AppHandle,
) -> Result<ChatMsg, String> {
    send_core(&app, chat.inner(), from, text, target, channel)
}

#[tauri::command]
pub fn chat_history(chat: tauri::State<'_, ChatState>) -> Vec<ChatMsg> {
    chat.history
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .iter()
        .cloned()
        .collect()
}

#[tauri::command]
pub fn chat_clear_confidence(app: AppHandle) {
    clear_confidence_core(&app);
}

#[cfg(test)]
mod tests {
    use super::{normalize_channel, recent_team, ChatInner, ChatMsg};
    use std::sync::Arc;

    fn msg(id: u64, target: &str, origin: Option<&str>) -> ChatMsg {
        ChatMsg {
            id,
            from: "T".into(),
            text: "x".into(),
            target: target.into(),
            channel: "team".into(),
            ts: id,
            origin: origin.map(String::from),
        }
    }

    #[test]
    fn mirror_excludes_edge_ingested_and_broadcasts() {
        // The edge pusher must never mirror a cloud-ingested message back up
        // (echo = duplicates in the cloud ring) nor stage/confidence
        // broadcasts (they are room hardware events, not conversation).
        let chat = Arc::new(ChatInner::new());
        {
            let mut h = chat.history.lock().unwrap();
            h.push_back(msg(1, "team", None));
            h.push_back(msg(2, "team", Some("edge")));
            h.push_back(msg(3, "stage", None));
            h.push_back(msg(4, "team", None));
        }
        let up = recent_team(&chat, 50);
        assert_eq!(up.iter().map(|m| m.id).collect::<Vec<_>>(), vec![1, 4]);
    }

    #[test]
    fn mirror_keeps_the_newest_n_in_order() {
        let chat = Arc::new(ChatInner::new());
        {
            let mut h = chat.history.lock().unwrap();
            for i in 1..=10 {
                h.push_back(msg(i, "team", None));
            }
        }
        let up = recent_team(&chat, 3);
        assert_eq!(up.iter().map(|m| m.id).collect::<Vec<_>>(), vec![8, 9, 10]);
    }

    #[test]
    fn team_and_blank_both_mean_the_team_feed() {
        assert_eq!(normalize_channel("team", "team").unwrap(), "team");
        assert_eq!(normalize_channel("team", "").unwrap(), "team");
        assert_eq!(normalize_channel("team", "  ").unwrap(), "team");
    }

    #[test]
    fn role_channels_are_trimmed_and_kept() {
        assert_eq!(normalize_channel("team", "role:Camera").unwrap(), "role:Camera");
        assert_eq!(normalize_channel("team", " role: Audio A2 ").unwrap(), "role:Audio A2");
    }

    #[test]
    fn a_role_channel_needs_a_role() {
        assert!(normalize_channel("team", "role:").is_err());
        assert!(normalize_channel("team", "role:   ").is_err());
    }

    #[test]
    fn unknown_channel_shapes_are_rejected() {
        assert!(normalize_channel("team", "dm:zach").is_err());
        assert!(normalize_channel("team", "Camera").is_err());
    }

    #[test]
    fn long_role_names_are_capped() {
        let long = "x".repeat(200);
        let got = normalize_channel("team", &format!("role:{long}")).unwrap();
        assert_eq!(got, format!("role:{}", "x".repeat(48)));
    }

    #[test]
    fn hardware_broadcasts_always_file_to_team() {
        // A phone with the Camera channel open sending to stage must not bury
        // the record in a role channel — it is a booth-wide event.
        assert_eq!(normalize_channel("stage", "role:Camera").unwrap(), "team");
        assert_eq!(normalize_channel("confidence", "role:Camera").unwrap(), "team");
        // ...and an invalid channel can't fail a valid broadcast.
        assert_eq!(normalize_channel("stage", "dm:zach").unwrap(), "team");
    }
}
