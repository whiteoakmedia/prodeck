// Gemini-powered smart matching for Auto-Follow. The desktop app sends the
// (noisy) live transcript plus a short list of candidate slides and asks Gemini
// Flash to pick which one the vocalist is on right now. This is *text-only* —
// no audio ever leaves the machine — and it gracefully degrades: if the key is
// missing, the network is down, or Gemini errors, the frontend falls back to
// the local token matcher so Auto-Follow keeps working offline.

use crate::settings::SettingsState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Mutex;
use std::time::Duration;

const ENDPOINT: &str = "https://generativelanguage.googleapis.com/v1beta/models";
// Tried in order; the first that responds is cached so we don't re-probe every
// window. Keeps the feature working as Google rotates which models are GA.
const MODELS: &[&str] = &["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"];

static WORKING_MODEL: Mutex<Option<String>> = Mutex::new(None);

/// One candidate slide the frontend asks Gemini to choose among. The frontend
/// narrows the full slide index to a short list (cheap local scoring) before
/// asking Gemini to make the fine-grained pick.
#[derive(Debug, Clone, Deserialize)]
pub struct GCandidate {
    pub song: String,
    pub section: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GMatch {
    /// Index into the candidates list, or -1 if none fit.
    pub choice: i64,
    pub confidence: f64,
}

fn api_key(settings: &SettingsState) -> Result<String, String> {
    let s = settings.lock().unwrap_or_else(|p| p.into_inner());
    match s.gemini_api_key.clone() {
        Some(k) if !k.trim().is_empty() => Ok(k.trim().to_string()),
        _ => Err("Gemini API key not set (add it in Settings)".into()),
    }
}

/// Returns Err((retriable, message)). `retriable` means "try the next model"
/// (e.g. this model id isn't available); a non-retriable error (bad key, quota)
/// stops the loop immediately.
async fn try_generate(
    client: &reqwest::Client,
    key: &str,
    model: &str,
    body: &serde_json::Value,
) -> Result<String, (bool, String)> {
    let url = format!("{ENDPOINT}/{model}:generateContent");
    let resp = client
        .post(&url)
        // Key travels in a header, never in the URL/query string.
        .header("x-goog-api-key", key)
        .json(body)
        .send()
        .await
        .map_err(|e| (true, e.to_string()))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let snippet: String = text.chars().take(300).collect();
        // 404 = model not found → try another model. Others are fatal.
        let retriable = status.as_u16() == 404;
        return Err((retriable, format!("Gemini {}: {}", status, snippet)));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| (false, e.to_string()))?;
    let out = v
        .get("candidates")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.as_array())
        .and_then(|a| a.first())
        .and_then(|p| p.get("text"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());
    match out {
        Some(s) => Ok(s),
        None => Err((
            false,
            format!(
                "Gemini returned no text: {}",
                text.chars().take(200).collect::<String>()
            ),
        )),
    }
}

async fn generate(key: &str, prompt: &str, json_out: bool) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    let mut gen_cfg = json!({ "temperature": 0 });
    if json_out {
        gen_cfg["responseMimeType"] = json!("application/json");
    }
    let body = json!({
        "contents": [{ "parts": [{ "text": prompt }] }],
        "generationConfig": gen_cfg,
    });

    // Prefer the last-known-good model, then the rest of the list.
    let cached = WORKING_MODEL.lock().unwrap_or_else(|p| p.into_inner()).clone();
    let mut order: Vec<String> = Vec::new();
    if let Some(m) = cached {
        order.push(m);
    }
    for m in MODELS {
        if !order.iter().any(|x| x == m) {
            order.push((*m).to_string());
        }
    }

    let mut last_err = String::from("no model available");
    for model in &order {
        match try_generate(&client, key, model, &body).await {
            Ok(txt) => {
                *WORKING_MODEL.lock().unwrap_or_else(|p| p.into_inner()) = Some(model.clone());
                return Ok(txt);
            }
            Err((retriable, e)) => {
                last_err = e;
                if !retriable {
                    break;
                }
            }
        }
    }
    Err(last_err)
}

/// Strip markdown fences and isolate the JSON object Gemini returned.
fn extract_json(s: &str) -> &str {
    let t = s
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    if let (Some(a), Some(b)) = (t.find('{'), t.rfind('}')) {
        if b >= a {
            return &t[a..=b];
        }
    }
    t
}

/// Ask Gemini which candidate slide the vocalist is on right now.
/// Core implementation (takes a plain `&SettingsState`) so both the Tauri
/// command and the LAN web proxy can call it.
pub(crate) async fn pick_slide_core(
    settings: &SettingsState,
    transcript: String,
    candidates: Vec<GCandidate>,
) -> Result<GMatch, String> {
    let key = api_key(settings)?;
    if candidates.is_empty() {
        return Ok(GMatch {
            choice: -1,
            confidence: 0.0,
        });
    }
    let mut list = String::new();
    for (i, c) in candidates.iter().enumerate() {
        let lyric: String = c.text.chars().take(220).collect();
        let section = if c.section.is_empty() {
            String::new()
        } else {
            format!(" \u{2014} {}", c.section)
        };
        list.push_str(&format!(
            "{}. [{}{}] {}\n",
            i,
            c.song,
            section,
            lyric.replace('\n', " / ")
        ));
    }
    let prompt = format!(
        "You are assisting a live worship slide operator. A vocalist is singing right now. \
Below is a noisy speech-to-text transcript of the last few seconds — it often contains \
mishearings, so match by sound and meaning, not exact spelling. Then a numbered list of \
candidate slides (song, section, lyrics). Choose the ONE slide the vocalist is most likely \
singing RIGHT NOW. If a later line of the song fits as well as an earlier one, prefer the \
later line so the slides keep pace. If none of the candidates fit, choose -1.\n\n\
Transcript: \"{}\"\n\nCandidates:\n{}\n\
Respond with ONLY a JSON object, no prose: {{\"choice\": <candidate number or -1>, \"confidence\": <0.0 to 1.0>}}",
        transcript.replace('"', "'"),
        list
    );
    let raw = generate(&key, &prompt, true).await?;
    let js = extract_json(&raw);
    let parsed: serde_json::Value = serde_json::from_str(js).map_err(|e| {
        format!(
            "parse error: {e} (got: {})",
            raw.chars().take(120).collect::<String>()
        )
    })?;
    let mut choice = parsed.get("choice").and_then(|x| x.as_i64()).unwrap_or(-1);
    let confidence = parsed
        .get("confidence")
        .and_then(|x| x.as_f64())
        .unwrap_or(0.0)
        .clamp(0.0, 1.0);
    // Guard against an out-of-range index.
    if choice < 0 || (choice as usize) >= candidates.len() {
        choice = -1;
    }
    Ok(GMatch { choice, confidence })
}

/// Validate the key + connectivity (core impl).
pub(crate) async fn test_core(settings: &SettingsState) -> Result<String, String> {
    let key = api_key(settings)?;
    let out = generate(&key, "Reply with exactly: OK", false).await?;
    let model = WORKING_MODEL
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_else(|| "?".into());
    Ok(format!(
        "{} (model: {})",
        out.trim().chars().take(40).collect::<String>(),
        model
    ))
}

// ---- Tauri command wrappers (desktop) ------------------------------------

/// Ask Gemini which candidate slide the vocalist is on right now.
#[tauri::command]
pub async fn gemini_pick_slide(
    transcript: String,
    candidates: Vec<GCandidate>,
    settings: tauri::State<'_, SettingsState>,
) -> Result<GMatch, String> {
    pick_slide_core(settings.inner(), transcript, candidates).await
}

/// Validate the key + connectivity from the Settings page.
#[tauri::command]
pub async fn gemini_test(settings: tauri::State<'_, SettingsState>) -> Result<String, String> {
    test_core(settings.inner()).await
}
