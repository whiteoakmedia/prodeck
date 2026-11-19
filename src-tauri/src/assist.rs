// "Ask ProDeck" — the troubleshooter's model calls, proxied through the booth.
//
// The agent loop (tools, prompt, the walk) lives in the frontend, where the
// routing engine is. This module does the three things only the booth can:
// hold the API key, make the outbound call, and keep the log. Phones call
// `assist_complete` over the gateway; the key never leaves this process.
//
// Spec: design/TROUBLESHOOTER.md.

use crate::settings::{config_dir, SettingsState};
use serde_json::{json, Value};
use std::io::Write;
use std::sync::Mutex;
use std::time::Duration;

const ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2026-10-21";
pub const DEFAULT_MODEL: &str = "claude-opus-5-5";
/// Claude Opus 5.5 always thinks before it answers, and thinking counts
/// against this, so it needs room; 1,500 cut answers off.
const MAX_OUTPUT_TOKENS: u64 = 8000;
/// Lets Claude re-run a declined request on a model its safety routing
/// picks, inside the same call, instead of the volunteer getting nothing.
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

/// The model to call. Empty = the default. The Settings picker used to offer
/// last generation's models; a church that picked one gets its successor
/// (same tier, same intent), so nobody is left on a retired model.
pub(crate) fn effective_model(saved: &str) -> String {
    match saved.trim() {
        "" => DEFAULT_MODEL.to_string(),
        "claude-sonnet-5" => "claude-sonnet-5-5".to_string(),
        "claude-opus-5" => "claude-opus-5-5".to_string(),
        "claude-haiku-4-5-20251001" | "claude-haiku-4-5" => "claude-haiku-5-5".to_string(),
        other => other.to_string(),
    }
}

/// Server-side refusal fallback is offered on these models (not Haiku).
fn takes_fallbacks(model: &str) -> bool {
    ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-fable-5-2"].contains(&model)
}

/// Models that take `output_config.effort`.
fn takes_effort(model: &str) -> bool {
    model.starts_with("claude-opus-5") || model.starts_with("claude-sonnet-5") || model.starts_with("claude-fable-5") || model == "claude-haiku-5-5"
}
/// Knowledge is prompt text; a runaway folder must not become a runaway bill.
const KNOWLEDGE_CAP_CHARS: usize = 200_000;

static USAGE: Mutex<Option<(String, u32)>> = Mutex::new(None); // (YYYY-MM, calls)

pub(crate) fn month_key() -> String {
    // Local-date month is good enough for a cap; no chrono dependency needed.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    // Civil-from-days (Howard Hinnant), year and month only.
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}")
}

fn usage_path() -> std::path::PathBuf {
    config_dir().join("assist-usage.json")
}
fn log_path() -> std::path::PathBuf {
    config_dir().join("assist-log.jsonl")
}
pub(crate) fn knowledge_dir() -> std::path::PathBuf {
    config_dir().join("knowledge")
}

fn load_usage() -> (String, u32) {
    let mut g = USAGE.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(u) = g.clone() {
        return u;
    }
    let u = std::fs::read_to_string(usage_path())
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| Some((v.get("month")?.as_str()?.to_string(), v.get("calls")?.as_u64()? as u32)))
        .unwrap_or((month_key(), 0));
    *g = Some(u.clone());
    u
}

fn bump_usage() -> u32 {
    let (m, n) = load_usage();
    let now = month_key();
    let next = if m == now { (now.clone(), n + 1) } else { (now.clone(), 1) };
    *USAGE.lock().unwrap_or_else(|p| p.into_inner()) = Some(next.clone());
    let _ = std::fs::write(usage_path(), json!({ "month": next.0, "calls": next.1 }).to_string());
    next.1
}

pub(crate) fn key_model_cap(settings: &SettingsState) -> Result<(String, String, u32, bool, String), String> {
    let s = settings.lock().unwrap_or_else(|p| p.into_inner());
    let key = match s.assist_api_key.clone() {
        Some(k) if !k.trim().is_empty() => k.trim().to_string(),
        _ => return Err("The troubleshooter isn't set up: add an Anthropic API key in Settings → Troubleshooter.".into()),
    };
    let model = effective_model(&s.assist_model);
    Ok((key, model, s.assist_monthly_cap, s.assist_members, s.assist_workspace_id.trim().to_string()))
}

/// Configured? Which model? How much used? Safe for any tier (no secret).
pub(crate) fn status_core(settings: &SettingsState) -> Value {
    let (configured, model, cap, members) = {
        let s = settings.lock().unwrap_or_else(|p| p.into_inner());
        (
            s.assist_api_key.as_deref().map(|k| !k.trim().is_empty()).unwrap_or(false),
            effective_model(&s.assist_model),
            s.assist_monthly_cap,
            s.assist_members,
        )
    };
    let (m, n) = load_usage();
    let used = if m == month_key() { n } else { 0 };
    let files: Vec<String> = std::fs::read_dir(knowledge_dir())
        .map(|rd| {
            let mut v: Vec<String> = rd
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| n.to_lowercase().ends_with(".md"))
                .collect();
            v.sort();
            v
        })
        .unwrap_or_default();
    json!({
        "configured": configured,
        "model": model,
        "members": members,
        "usedThisMonth": used,
        "monthlyCap": cap,
        "knowledgeFiles": files,
        "knowledgeDir": knowledge_dir().to_string_lossy(),
    })
}

/// The church's own dossier: every .md in <data>/knowledge, sorted by name.
pub(crate) fn knowledge_core() -> Vec<Value> {
    let mut out = Vec::new();
    let mut total = 0usize;
    let Ok(rd) = std::fs::read_dir(knowledge_dir()) else { return out };
    let mut names: Vec<std::path::PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().map(|x| x == "md").unwrap_or(false)).collect();
    names.sort();
    for p in names {
        let Ok(text) = std::fs::read_to_string(&p) else { continue };
        let take = KNOWLEDGE_CAP_CHARS.saturating_sub(total);
        if take == 0 {
            break;
        }
        let text: String = text.chars().take(take).collect();
        total += text.len();
        out.push(json!({ "name": p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), "text": text }));
    }
    out
}

pub(crate) fn readable_error(status: u16, body: &str) -> String {
    let msg = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("error")?.get("message")?.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| body.chars().take(200).collect());
    match status {
        401 | 403 => format!("The Anthropic key was rejected ({status}). Check it in Settings → Troubleshooter."),
        429 => "Anthropic is rate-limiting this key right now. Try again in a minute.".into(),
        529 => "Anthropic is overloaded right now. Try again in a minute.".into(),
        400 if msg.contains("workspace") => "This key belongs to the whole account, so Anthropic needs the workspace ID too. Paste it in Settings → Troubleshooter (console.anthropic.com → Settings → Workspaces), or use a key created inside a workspace.".into(),
        400 => format!("The request was refused: {msg}"),
        _ => format!("Anthropic returned {status}: {msg}"),
    }
}

/// One Messages API call. `body` is the frontend's request (system, messages,
/// tools, tool_choice); the booth sets the model, caps max_tokens, adds the
/// key, enforces the monthly cap, and logs the exchange.
pub(crate) async fn complete_core(settings: &SettingsState, mut body: Value, who: &str) -> Result<Value, String> {
    let (key, model, cap, _members, workspace) = key_model_cap(settings)?;
    let (m, n) = load_usage();
    if cap > 0 && m == month_key() && n >= cap {
        return Err(format!("The troubleshooter has used its {cap} calls for this month. Raise the cap in Settings → Troubleshooter."));
    }
    let obj = body.as_object_mut().ok_or("request must be an object")?;
    obj.insert("model".into(), json!(model));
    let max = obj.get("max_tokens").and_then(|v| v.as_u64()).unwrap_or(MAX_OUTPUT_TOKENS).min(MAX_OUTPUT_TOKENS);
    obj.insert("max_tokens".into(), json!(max));
    obj.remove("stream");
    // Retired on this API version; the frontend never sends them, but a
    // stray one must not turn every question into an error.
    for k in ["temperature", "top_p", "top_k"] {
        obj.remove(k);
    }
    // Medium: a volunteer is waiting at the desk. Deep enough to walk the
    // routing, quick enough to answer in seconds.
    if takes_effort(&model) && !obj.contains_key("output_config") {
        obj.insert("output_config".into(), json!({ "effort": "medium" }));
    }
    let fallbacks = takes_fallbacks(&model);
    if fallbacks {
        obj.insert("fallbacks".into(), json!("default"));
    }

    let client = reqwest::Client::builder().timeout(Duration::from_secs(75)).build().map_err(|e| e.to_string())?;
    let mut req = client
        .post(ENDPOINT)
        .header("x-api-key", &key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json");
    if !workspace.is_empty() {
        req = req.header("anthropic-workspace-id", &workspace);
    }
    if fallbacks {
        req = req.header("anthropic-beta", FALLBACK_BETA);
    }
    let resp = req
        .json(&body)
        .send()
        .await
        .map_err(|e| if e.is_timeout() { "Anthropic didn't answer in time. Try again.".to_string() } else { format!("Couldn't reach Anthropic: {e}") })?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if status >= 400 {
        return Err(readable_error(status, &text));
    }
    let out: Value = serde_json::from_str(&text).map_err(|e| format!("bad reply from Anthropic: {e}"))?;
    let calls = bump_usage();

    // Log: who asked, the last user text, what came back (text + tool calls),
    // tokens. One JSON line per call so the file is greppable.
    let last_user = body
        .get("messages")
        .and_then(|m| m.as_array())
        .and_then(|a| a.iter().rev().find(|m| m.get("role").and_then(|r| r.as_str()) == Some("user")))
        .map(|m| match m.get("content") {
            Some(Value::String(s)) => s.chars().take(400).collect::<String>(),
            Some(Value::Array(parts)) => parts
                .iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()).map(|t| t.chars().take(200).collect::<String>()).or_else(|| p.get("type").and_then(|t| t.as_str()).map(|t| format!("<{t}>"))))
                .collect::<Vec<_>>()
                .join(" | "),
            _ => String::new(),
        })
        .unwrap_or_default();
    let reply: Vec<String> = out
        .get("content")
        .and_then(|c| c.as_array())
        .map(|a| {
            a.iter()
                .map(|b| match b.get("type").and_then(|t| t.as_str()) {
                    Some("text") => b.get("text").and_then(|t| t.as_str()).unwrap_or("").chars().take(600).collect(),
                    Some("tool_use") => format!("<tool {}({})>", b.get("name").and_then(|t| t.as_str()).unwrap_or("?"), b.get("input").map(|i| i.to_string()).unwrap_or_default().chars().take(120).collect::<String>()),
                    _ => String::new(),
                })
                .collect()
        })
        .unwrap_or_default();
    let line = json!({
        "at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
        "who": who,
        "model": model,
        "user": last_user,
        "reply": reply,
        "usage": out.get("usage").cloned().unwrap_or(Value::Null),
        "callsThisMonth": calls,
    });
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log_path()) {
        let _ = writeln!(f, "{line}");
    }
    Ok(out)
}

/// Last N log lines, newest first — for Settings → Troubleshooter.
pub(crate) fn log_tail_core(n: usize) -> Vec<Value> {
    let Ok(text) = std::fs::read_to_string(log_path()) else { return Vec::new() };
    let mut out: Vec<Value> = text.lines().rev().take(n).filter_map(|l| serde_json::from_str(l).ok()).collect();
    out.truncate(n);
    out
}

// ---- Tauri commands (desktop) ---------------------------------------------

#[tauri::command]
pub async fn assist_complete(body: Value, settings: tauri::State<'_, SettingsState>) -> Result<Value, String> {
    complete_core(settings.inner(), body, "booth").await
}

#[tauri::command]
pub fn assist_status(settings: tauri::State<'_, SettingsState>) -> Value {
    status_core(settings.inner())
}

#[tauri::command]
pub fn load_knowledge() -> Vec<Value> {
    knowledge_core()
}

#[tauri::command]
pub fn assist_log_tail(n: Option<usize>) -> Vec<Value> {
    log_tail_core(n.unwrap_or(50).min(500))
}

/// Make sure the knowledge folder exists (with a README) and return its path,
/// so Settings can send the person there.
#[tauri::command]
pub fn assist_knowledge_dir() -> Result<String, String> {
    let dir = knowledge_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let readme = dir.join("README.md");
    if !readme.exists() {
        let _ = std::fs::write(
            &readme,
            "# Knowledge for the troubleshooter\n\nEvery `.md` file in this folder is read, in name order, into the\ntroubleshooter's context on every question. Put here what a new sound tech\nwould need to know about YOUR building: the machines and their addresses,\nwhich scenes are safe to recall during a service, which outputs feed what,\nknown oddities and their explanations. Plain markdown. Keep it factual —\nthe model is told to use only what is written here and on the routing map.\n\nThis file is an example; replace or delete it.\n",
        );
    }
    Ok(dir.to_string_lossy().to_string())
}

#[cfg(test)]
mod model_tests {
    use super::*;

    #[test]
    fn old_picker_choices_move_to_their_successors() {
        assert_eq!(effective_model(""), "claude-opus-5-5");
        assert_eq!(effective_model("claude-sonnet-5"), "claude-sonnet-5-5");
        assert_eq!(effective_model("claude-opus-5"), "claude-opus-5-5");
        assert_eq!(effective_model("claude-haiku-4-5-20251001"), "claude-haiku-5-5");
        assert_eq!(effective_model("claude-opus-5-5"), "claude-opus-5-5");
    }

    #[test]
    fn effort_and_fallbacks_only_where_the_model_takes_them() {
        assert!(takes_effort("claude-opus-5-5") && takes_fallbacks("claude-opus-5-5"));
        assert!(takes_effort("claude-sonnet-5-5") && takes_fallbacks("claude-sonnet-5-5"));
        assert!(takes_effort("claude-haiku-5-5") && !takes_fallbacks("claude-haiku-5-5"));
        assert!(!takes_effort("claude-haiku-4-5") && !takes_fallbacks("claude-haiku-4-5"));
    }
}
