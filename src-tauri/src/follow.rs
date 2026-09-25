// Auto-Follow's booth-side pieces (design/AUTOFOLLOW.md): the model call it
// makes when the local listener can't decide, and the learned clock's file.
//
// The model call shares the troubleshooter's Anthropic key and workspace but
// not its budget: Follow has its own model (Haiku by default — it is asked
// "which slide is this?", not to reason) and its own monthly cap, so a busy
// Sunday of lyrics can't eat the troubleshooter's calls or the reverse.

use crate::settings::{config_dir, SettingsState};
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;

const ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
pub const DEFAULT_MODEL: &str = "claude-haiku-4-5";
const MAX_OUTPUT_TOKENS: u64 = 200;

static USAGE: Mutex<Option<(String, u32)>> = Mutex::new(None);

fn usage_path() -> std::path::PathBuf {
    config_dir().join("follow-usage.json")
}
fn timing_path() -> std::path::PathBuf {
    config_dir().join("follow-timing.json")
}

fn usage() -> (String, u32) {
    let mut g = USAGE.lock().unwrap_or_else(|p| p.into_inner());
    if g.is_none() {
        *g = std::fs::read_to_string(usage_path())
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| Some((v.get("month")?.as_str()?.to_string(), v.get("calls")?.as_u64()? as u32)));
    }
    let now = crate::assist::month_key();
    match g.clone() {
        Some((m, n)) if m == now => (m, n),
        _ => (now, 0),
    }
}

fn bump() {
    let (m, n) = usage();
    *USAGE.lock().unwrap_or_else(|p| p.into_inner()) = Some((m.clone(), n + 1));
    let _ = std::fs::write(usage_path(), json!({ "month": m, "calls": n + 1 }).to_string());
}

#[tauri::command]
pub async fn follow_complete(mut body: Value, settings: tauri::State<'_, SettingsState>) -> Result<Value, String> {
    let (key, _, _, _, workspace) = crate::assist::key_model_cap(settings.inner())?;
    let (model, cap) = {
        let s = settings.lock().unwrap_or_else(|p| p.into_inner());
        (if s.follow_model.trim().is_empty() { DEFAULT_MODEL.to_string() } else { s.follow_model.trim().to_string() }, s.follow_monthly_cap)
    };
    let (_, used) = usage();
    if cap > 0 && used >= cap {
        return Err(format!("Follow has used its {cap} model calls this month"));
    }
    let obj = body.as_object_mut().ok_or("request must be an object")?;
    obj.insert("model".into(), json!(model));
    let max = obj.get("max_tokens").and_then(|v| v.as_u64()).unwrap_or(MAX_OUTPUT_TOKENS).min(MAX_OUTPUT_TOKENS);
    obj.insert("max_tokens".into(), json!(max));
    obj.remove("stream");
    obj.remove("tools");
    let client = reqwest::Client::builder().timeout(Duration::from_secs(8)).build().map_err(|e| e.to_string())?;
    let mut req = client
        .post(ENDPOINT)
        .header("x-api-key", &key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json");
    if !workspace.is_empty() {
        req = req.header("anthropic-workspace-id", &workspace);
    }
    let resp = req.json(&body).send().await.map_err(|e| format!("Couldn't reach Anthropic: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if status >= 400 {
        return Err(crate::assist::readable_error(status, &text));
    }
    bump();
    serde_json::from_str(&text).map_err(|e| format!("bad reply from Anthropic: {e}"))
}

#[tauri::command]
pub fn follow_status(settings: tauri::State<'_, SettingsState>) -> Value {
    let s = settings.lock().unwrap_or_else(|p| p.into_inner());
    let (_, used) = usage();
    json!({
        "modelReady": s.assist_api_key.as_deref().map(|k| !k.trim().is_empty()).unwrap_or(false),
        "model": if s.follow_model.trim().is_empty() { DEFAULT_MODEL } else { s.follow_model.trim() },
        "usedThisMonth": used,
        "monthlyCap": s.follow_monthly_cap,
    })
}

#[tauri::command]
pub fn follow_timing_load() -> Value {
    std::fs::read_to_string(timing_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}))
}

#[tauri::command]
pub fn follow_timing_save(timing: Value) -> Result<(), String> {
    let tmp = timing_path().with_extension("json.tmp");
    std::fs::write(&tmp, timing.to_string()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, timing_path()).map_err(|e| e.to_string())
}

fn debug_dir() -> std::path::PathBuf {
    let d = config_dir().join("follow-debug");
    let _ = std::fs::create_dir_all(&d);
    d
}

/// One line of what Follow saw and did (armed, ProPresenter moved, Follow
/// moved or would have) — the ground truth a replay is scored against.
#[tauri::command]
pub fn follow_debug_log(line: Value) {
    use std::io::Write;
    let mut line = line;
    if let Some(o) = line.as_object_mut() {
        o.entry("at").or_insert(json!(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(debug_dir().join("events.jsonl")) {
        let _ = writeln!(f, "{line}");
    }
}

fn automix_path() -> std::path::PathBuf {
    config_dir().join("automix.json")
}

/// The automix's memory per song: where each section starts (beats from
/// Playback's Start) and the operator's chorus levels.
#[tauri::command]
pub fn automix_store_load() -> Value {
    std::fs::read_to_string(automix_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({ "maps": {}, "homes": {} }))
}

#[tauri::command]
pub fn automix_store_save(store: Value) -> Result<(), String> {
    let tmp = automix_path().with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&store).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, automix_path()).map_err(|e| e.to_string())
}
