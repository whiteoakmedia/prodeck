use crate::audio::AudioState;
use crate::settings::SettingsState;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub struct TranscriptionInner {
    pub running: AtomicBool,
}

pub type TranscriptionState = Arc<TranscriptionInner>;

impl TranscriptionInner {
    pub fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
        }
    }
}

#[derive(serde::Serialize, Clone)]
pub struct TranscriptionConfig {
    pub configured: bool,
    pub whisper_bin: Option<String>,
    pub whisper_model: Option<String>,
}

#[tauri::command]
pub fn transcription_status(settings: tauri::State<'_, SettingsState>) -> TranscriptionConfig {
    let s = settings.lock().unwrap_or_else(|p| p.into_inner());
    let configured = s
        .whisper_bin
        .as_ref()
        .map(|p| std::path::Path::new(p).exists())
        .unwrap_or(false)
        && s.whisper_model
            .as_ref()
            .map(|p| std::path::Path::new(p).exists())
            .unwrap_or(false);
    TranscriptionConfig {
        configured,
        whisper_bin: s.whisper_bin.clone(),
        whisper_model: s.whisper_model.clone(),
    }
}

/// Manually push a caption line (useful for testing the lower-third without a
/// transcription engine installed).
#[tauri::command]
pub fn inject_caption(text: String, app: AppHandle) {
    emit_caption(&app, &text);
}

fn emit_caption(app: &AppHandle, text: &str) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    app.emit(
        "caption:line",
        serde_json::json!({ "text": text, "ts": ts }),
    )
    .ok();
}

#[tauri::command]
pub fn start_transcription(
    state: tauri::State<'_, TranscriptionState>,
    audio: tauri::State<'_, AudioState>,
    settings: tauri::State<'_, SettingsState>,
    app: AppHandle,
) -> Result<(), String> {
    let (bin, model) = {
        let s = settings.lock().unwrap_or_else(|p| p.into_inner());
        (s.whisper_bin.clone(), s.whisper_model.clone())
    };
    let bin = bin.ok_or("Whisper binary not configured (set it in Settings)")?;
    let model = model.ok_or("Whisper model not configured (set it in Settings)")?;
    if !std::path::Path::new(&bin).exists() {
        return Err(format!("Whisper binary not found at {bin}"));
    }
    if !std::path::Path::new(&model).exists() {
        return Err(format!("Whisper model not found at {model}"));
    }

    state.running.store(true, Ordering::Release);
    app.emit("caption:status", "listening").ok();

    let running = state.inner().clone();
    let audio = audio.inner().clone();
    let app2 = app.clone();

    // NOTE: this is a *synchronous* Tauri command, so it runs on the IPC thread
    // with no Tokio runtime entered. `tokio::spawn` would panic ("must be called
    // from the context of a Tokio runtime") and abort the whole app. Tauri's
    // own spawner targets the managed runtime from any thread, and the future
    // still runs on Tokio (so tokio::time / tokio::process inside it work).
    tauri::async_runtime::spawn(async move {
        // Length of each transcription window, in seconds.
        const WINDOW_SECS: u64 = 5;
        while running.running.load(Ordering::Acquire) {
            tokio::time::sleep(std::time::Duration::from_secs(WINDOW_SECS)).await;
            if !running.running.load(Ordering::Acquire) {
                break;
            }
            let (samples, sr) = audio.drain();
            if sr == 0 || samples.len() < (sr as usize) {
                // Less than ~1s of audio captured; skip this window.
                continue;
            }
            let pcm16 = resample_to_16k(&samples, sr);
            let wav_path = match write_wav(&pcm16) {
                Ok(p) => p,
                Err(e) => {
                    app2.emit("caption:status", format!("wav error: {e}")).ok();
                    continue;
                }
            };

            let output = tokio::process::Command::new(&bin)
                .args([
                    "-m",
                    &model,
                    "-f",
                    wav_path.to_string_lossy().as_ref(),
                    "-l",
                    "en",
                    "-nt",
                    "-np",
                ])
                .output()
                .await;
            let _ = std::fs::remove_file(&wav_path);

            match output {
                Ok(out) => {
                    let text = String::from_utf8_lossy(&out.stdout);
                    let cleaned = clean_whisper_text(&text);
                    if !cleaned.is_empty() {
                        emit_caption(&app2, &cleaned);
                    }
                }
                Err(e) => {
                    app2.emit("caption:status", format!("whisper error: {e}")).ok();
                }
            }
        }
        app2.emit("caption:status", "stopped").ok();
    });

    Ok(())
}

#[tauri::command]
pub fn stop_transcription(state: tauri::State<'_, TranscriptionState>, app: AppHandle) {
    state.running.store(false, Ordering::Release);
    app.emit("caption:status", "stopped").ok();
}

fn resample_to_16k(input: &[f32], sr: u32) -> Vec<f32> {
    if sr == 16000 {
        return input.to_vec();
    }
    let ratio = 16000f64 / sr as f64;
    let out_len = (input.len() as f64 * ratio) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 / ratio;
        let i0 = src.floor() as usize;
        let frac = (src - i0 as f64) as f32;
        let s0 = input.get(i0).copied().unwrap_or(0.0);
        let s1 = input.get(i0 + 1).copied().unwrap_or(s0);
        out.push(s0 + (s1 - s0) * frac);
    }
    out
}

fn write_wav(samples: &[f32]) -> Result<std::path::PathBuf, String> {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("prodeck_cap_{ts}.wav"));
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&path, spec).map_err(|e| e.to_string())?;
    for &s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
        writer.write_sample(v).map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())?;
    Ok(path)
}

/// whisper.cpp emits bracketed non-speech markers and stray whitespace; strip
/// them so only clean caption text reaches the UI.
fn clean_whisper_text(raw: &str) -> String {
    let mut out = String::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Drop pure annotation lines like "[BLANK_AUDIO]" or "(music)".
        let is_annotation = (line.starts_with('[') && line.ends_with(']'))
            || (line.starts_with('(') && line.ends_with(')'));
        if is_annotation {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(line);
    }
    out.trim().to_string()
}
