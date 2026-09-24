use crate::audio::AudioState;
use crate::settings::SettingsState;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub struct TranscriptionInner {
    pub running: AtomicBool,
    /// Lyrics Follow expects next — Whisper's decoder prompt.
    pub prompt: std::sync::Mutex<String>,
}

pub type TranscriptionState = Arc<TranscriptionInner>;

impl TranscriptionInner {
    pub fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
            prompt: std::sync::Mutex::new(String::new()),
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
        && resolve_model(&s).is_some();
    TranscriptionConfig {
        configured,
        whisper_bin: s.whisper_bin.clone(),
        whisper_model: resolve_model(&s),
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

/// Follow's listener. whisper-server keeps the model loaded (a CLI run per
/// window reloads ~600 MB each time); every HOP it hears the last WINDOW of
/// audio, so windows overlap and a line is recognised ~1–3 s after it is
/// sung instead of 3–7 s. Each window goes out as `caption:heard` with its
/// wall-clock span and Whisper's own confidence, which is how Follow tells
/// a sung line from the model "hearing" words in a guitar solo. Every other
/// window (no overlap) also goes out as `caption:line` for the lower third.
const WINDOW_MS: u64 = 4000;
const HOP_MS: u64 = 2000;
/// A marker path so a whisper-server orphaned by a crash can be found and
/// stopped on the next start (it would otherwise hold ~1 GB forever).
const INFERENCE_PATH: &str = "/prodeck-inference";
/// Below this (≈ -66 dBFS) a window is silence. It used to be -50, which
/// threw away every window of the booth's quiet stream-mix feed.
const QUIET_RMS: f32 = 0.0005;
/// Each window is brought up to about -20 dBFS before Whisper hears it.
const TARGET_RMS: f32 = 0.1;

/// The whole listening session as one 16 kHz WAV (<data>/follow-debug/
/// session-<ms>.wav), so a rehearsal can be replayed through the engine
/// exactly. Capped at 45 minutes; the newest six sessions are kept.
struct SessionRec {
    w: hound::WavWriter<std::io::BufWriter<std::fs::File>>,
    n: usize,
}
impl SessionRec {
    const CAP: usize = 16_000 * 60 * 45;
    fn start(dir: &std::path::Path) -> Option<Self> {
        let mut old: Vec<_> = std::fs::read_dir(dir)
            .ok()?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.file_name().map(|n| n.to_string_lossy().starts_with("session-")).unwrap_or(false))
            .collect();
        old.sort();
        while old.len() >= 6 {
            let _ = std::fs::remove_file(old.remove(0));
        }
        let spec = hound::WavSpec { channels: 1, sample_rate: 16000, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
        let w = hound::WavWriter::create(dir.join(format!("session-{}.wav", now_ms())), spec).ok()?;
        Some(Self { w, n: 0 })
    }
    fn push(&mut self, xs: &[f32]) -> bool {
        for &x in xs {
            let _ = self.w.write_sample((x.clamp(-1.0, 1.0) * 32767.0) as i16);
        }
        self.n += xs.len();
        if self.n % (16_000 * 10) < xs.len() {
            let _ = self.w.flush(); // readable mid-session
        }
        self.n < Self::CAP
    }
}

/// What Follow heard, kept for a look afterwards: the last 60 windows (two
/// minutes) as WAVs plus one JSON line per window, in <data>/follow-debug.
struct DebugRing {
    dir: std::path::PathBuf,
}
impl DebugRing {
    fn new() -> Self {
        let dir = crate::settings::config_dir().join("follow-debug");
        let _ = std::fs::create_dir_all(&dir);
        let log = dir.join("heard.jsonl");
        // Keep the log from growing forever: start over past ~1 MB.
        if std::fs::metadata(&log).map(|m| m.len() > 1_000_000).unwrap_or(false) {
            let _ = std::fs::rename(&log, dir.join("heard.prev.jsonl"));
        }
        Self { dir }
    }
    fn log(&self, n: u64, window: Option<&[f32]>, mut line: serde_json::Value) {
        use std::io::Write;
        let slot = format!("w{:02}.wav", n % 60);
        if let Some(w) = window {
            if let Ok(b) = wav_bytes(w) {
                let _ = std::fs::write(self.dir.join(&slot), b);
            }
            line["wav"] = serde_json::json!(slot);
        }
        line["n"] = serde_json::json!(n);
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(self.dir.join("heard.jsonl")) {
            let _ = writeln!(f, "{line}");
        }
    }
}

fn resolve_model(s: &crate::settings::Settings) -> Option<String> {
    s.whisper_model
        .clone()
        .filter(|m| std::path::Path::new(m).exists())
        .or_else(crate::settings::detect_whisper_model)
}

/// whisper.cpp's DTW alignment-head preset for a model file, if it has one.
pub(crate) fn dtw_preset(model: &str) -> Option<&'static str> {
    let m = model.to_lowercase();
    [
        ("large-v3-turbo", "large.v3.turbo"),
        ("large-v3", "large.v3"),
        ("large-v2", "large.v2"),
        ("medium.en", "medium.en"),
        ("small.en", "small.en"),
        ("base.en", "base.en"),
        ("tiny.en", "tiny.en"),
        ("medium", "medium"),
        ("small", "small"),
        ("base", "base"),
    ]
    .iter()
    .find(|(k, _)| m.contains(k))
    .map(|(_, v)| *v)
}

pub(crate) fn server_bin(cli: &str) -> Option<String> {
    let p = std::path::Path::new(cli).with_file_name("whisper-server");
    p.exists().then(|| p.to_string_lossy().to_string())
}

fn free_port() -> Option<u16> {
    std::net::TcpListener::bind("127.0.0.1:0").ok()?.local_addr().ok().map(|a| a.port())
}

#[tauri::command]
pub fn transcription_set_prompt(text: String, state: tauri::State<'_, TranscriptionState>) {
    // Whisper's prompt window is ~224 tokens; keep it well inside that.
    let t: String = text.chars().take(600).collect();
    *state.prompt.lock().unwrap_or_else(|p| p.into_inner()) = t;
}

#[tauri::command]
pub fn start_transcription(
    state: tauri::State<'_, TranscriptionState>,
    audio: tauri::State<'_, AudioState>,
    settings: tauri::State<'_, SettingsState>,
    app: AppHandle,
) -> Result<(), String> {
    let (bin, model, actx, rig_click, rig_guide, rig_midi) = {
        let s = settings.lock().unwrap_or_else(|p| p.into_inner());
        (s.whisper_bin.clone(), resolve_model(&s), s.whisper_audio_ctx, s.follow_click_channel > 0, s.follow_guide_channel > 0, s.follow_midi_port.clone())
    };
    let bin = bin.ok_or("Whisper isn't installed (set its path in Settings)")?;
    let model = model.ok_or("No Whisper model found (Settings → Captions, or put one in ProDeck/models)")?;
    if !std::path::Path::new(&bin).exists() {
        return Err(format!("Whisper binary not found at {bin}"));
    }
    if state.running.swap(true, Ordering::AcqRel) {
        return Ok(()); // already listening
    }
    app.emit("caption:status", "loading").ok();

    let running = state.inner().clone();
    let audio = audio.inner().clone();
    let app2 = app.clone();

    // A synchronous command runs with no Tokio runtime entered; Tauri's
    // spawner targets the managed runtime from any thread.
    tauri::async_runtime::spawn(async move {
        let mut server: Option<(tokio::process::Child, u16)> = None;
        if let Some(sbin) = server_bin(&bin) {
            let _ = std::process::Command::new("/usr/bin/pkill").args(["-f", "/prodeck-(inference|guide)"]).status();
            if let Some(port) = free_port() {
                let mut cmd = tokio::process::Command::new(&sbin);
                // Timestamps on: Follow places every word on the clock (per-word
                // times come back in verbose_json).
                cmd.args(["-m", &model, "-l", "en", "-t", "4", "--host", "127.0.0.1"])
                    // Greedy, no temperature fallback: same words on sung lyrics in
                    // testing, and no 5–7 s windows when Whisper doubts itself.
                    .args(["-nf", "-bs", "1", "-bo", "1"])
                    .args(["--port", &port.to_string(), "--inference-path", INFERENCE_PATH])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .kill_on_drop(true);
                if actx > 0 {
                    cmd.args(["-ac", &actx.to_string()]);
                }
                // Accurate per-word times (DTW alignment): Whisper's plain word
                // times were off by up to two seconds, which is the difference
                // between on time and late. Needs flash attention off.
                if let Some(preset) = dtw_preset(&model) {
                    cmd.args(["-nfa", "--dtw", preset]);
                }
                match cmd.spawn() {
                    Ok(child) => server = Some((child, port)),
                    Err(e) => crate::diag::log(format!("[follow] whisper-server failed to start: {e}")),
                }
            }
        }
        let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(10)).build().ok();
        if let (Some((_, port)), Some(c)) = (&server, &client) {
            // Model load: a second or two for turbo; give it 30.
            for _ in 0..60 {
                if c.get(format!("http://127.0.0.1:{port}/")).send().await.is_ok() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        }
        app2.emit("caption:status", "listening").ok();
        // The rig listeners (click, guide, MIDI Clock) run for the life of the
        // app now (rig::spawn_always), shared by Follow and the automix.
        let _ = (rig_click, rig_guide, rig_midi);

        // The last WINDOW of audio at the device's own rate; each hop it is
        // filtered and brought down to 16 kHz whole (a stateless resample, so
        // the anti-alias filter never has a seam).
        let mut ring: std::collections::VecDeque<f32> = std::collections::VecDeque::new();
        let mut n: u64 = 0;
        let debug = DebugRing::new();
        let mut session = SessionRec::start(&debug.dir);
        audio.drain(); // start fresh, not with 30 s of backlog
        while running.running.load(Ordering::Acquire) {
            tokio::time::sleep(std::time::Duration::from_millis(HOP_MS)).await;
            if !running.running.load(Ordering::Acquire) {
                break;
            }
            let (samples, sr) = audio.drain();
            let end = now_ms();
            if sr == 0 {
                continue;
            }
            if let Some(rec) = session.as_mut() {
                if !rec.push(&resample_to_16k(&samples, sr)) {
                    session = None; // hit the length cap
                }
            }
            ring.extend(samples.iter().copied());
            let keep = (sr as u64 * WINDOW_MS / 1000) as usize;
            while ring.len() > keep {
                ring.pop_front();
            }
            if ring.len() < (sr as usize * 3) / 2 {
                continue;
            }
            n += 1;
            let raw: Vec<f32> = ring.iter().copied().collect();
            let mut window = resample_to_16k(&raw, sr);
            let start = end.saturating_sub(window.len() as u64 / 16);
            let rms = (window.iter().map(|v| v * v).sum::<f32>() / window.len() as f32).sqrt();
            let db = 20.0 * rms.max(1e-9).log10();
            if rms < QUIET_RMS {
                // Nothing to hear. Say so — Follow's song lock uses silence
                // to know a song has ended.
                app2.emit("caption:heard", serde_json::json!({ "text": "", "start": start, "end": end, "quiet": true, "db": db })).ok();
                debug.log(n, None, serde_json::json!({ "start": start, "end": end, "db": db, "quiet": true }));
                continue;
            }
            // The board's feed to this Mac sits far below full scale (-55 dBFS
            // on the stream mix, 24 Sep). Bring each window up to a normal
            // speaking level, never past the peak.
            let peak = window.iter().fold(0f32, |m, v| m.max(v.abs()));
            let gain = (TARGET_RMS / rms).min(0.9 / peak.max(1e-9)).max(1.0);
            for v in window.iter_mut() {
                *v *= gain;
            }
            if crate::rig::GUIDE_BUSY.load(Ordering::Acquire) {
                continue; // the guide is talking: its cue goes first
            }
            let prompt = running.prompt.lock().unwrap_or_else(|p| p.into_inner()).clone();
            let t0 = now_ms();
            let heard = match (&server, &client) {
                (Some((_, port)), Some(c)) => infer_server(c, *port, &window, &prompt).await,
                _ => infer_cli(&bin, &model, &window).await,
            };
            match heard {
                Ok(h) => {
                    let text = clean_whisper_text(&h.text);
                    app2.emit(
                        "caption:heard",
                        serde_json::json!({
                            "text": text, "start": start, "end": end, "ms": now_ms() - t0,
                            "words": h.words.iter().map(|w| serde_json::json!({
                                "w": w["w"],
                                "t0": start + (w["t0"].as_f64().unwrap_or(0.0) * 1000.0) as u64,
                                "t1": start + (w["t1"].as_f64().unwrap_or(0.0) * 1000.0) as u64,
                                "p": w["p"],
                            })).collect::<Vec<_>>(),
                            "langP": h.lang_p, "logprob": h.logprob, "noSpeech": h.no_speech,
                        }),
                    )
                    .ok();
                    debug.log(
                        n,
                        Some(&window),
                        serde_json::json!({ "start": start, "end": end, "db": db, "gainDb": 20.0 * gain.log10(), "text": text, "langP": h.lang_p, "logprob": h.logprob, "ms": now_ms() - t0 }),
                    );
                    let sung = h.lang_p.map(|p| p >= 0.5).unwrap_or(true);
                    if n % 2 == 0 && sung && !text.is_empty() {
                        emit_caption(&app2, &text);
                    }
                }
                Err(e) => {
                    app2.emit("caption:status", format!("whisper error: {e}")).ok();
                }
            }
        }
        if let Some((mut child, _)) = server {
            let _ = child.kill().await;
        }
        app2.emit("caption:status", "stopped").ok();
    });

    Ok(())
}

pub(crate) struct Heard {
    pub text: String,
    /// Words with times in seconds into the window, merged from sub-word tokens.
    pub words: Vec<serde_json::Value>,
    pub lang_p: Option<f64>,
    pub logprob: Option<f64>,
    pub no_speech: Option<f64>,
}

/// Whisper splits words into tokens (" Sweet" + "ly"); a token that starts
/// with a space starts a new word. Times are seconds into the window.
fn words_of(segs: &[serde_json::Value]) -> Vec<serde_json::Value> {
    let mut out: Vec<(String, f64, f64, f64)> = Vec::new();
    for s in segs {
        for w in s.get("words").and_then(|w| w.as_array()).into_iter().flatten() {
            let t = w.get("word").and_then(|x| x.as_str()).unwrap_or("");
            // t_dtw (centiseconds) when DTW is on: the token's aligned time.
            let dtw = w.get("t_dtw").and_then(|x| x.as_f64()).filter(|t| *t >= 0.0).map(|t| t / 100.0);
            let a = dtw.or_else(|| w.get("start").and_then(|x| x.as_f64())).unwrap_or(0.0);
            let b = dtw.map(|t| t + 0.15).or_else(|| w.get("end").and_then(|x| x.as_f64())).unwrap_or(a);
            let p = w.get("probability").and_then(|x| x.as_f64()).unwrap_or(0.0);
            if t.trim().is_empty() || t.trim_start().starts_with('[') {
                continue;
            }
            match out.last_mut() {
                Some(last) if !t.starts_with(' ') => {
                    last.0.push_str(t);
                    last.2 = b;
                    last.3 = last.3.min(p);
                }
                _ => out.push((t.trim().to_string(), a, b, p)),
            }
        }
    }
    out.into_iter().map(|(w, a, b, p)| serde_json::json!({ "w": w, "t0": a, "t1": b, "p": p })).collect()
}

async fn infer_server(c: &reqwest::Client, port: u16, window: &[f32], prompt: &str) -> Result<Heard, String> {
    infer_server_at(c, port, INFERENCE_PATH, window, prompt).await
}

pub(crate) async fn infer_server_at(c: &reqwest::Client, port: u16, path: &str, window: &[f32], prompt: &str) -> Result<Heard, String> {
    let wav = wav_bytes(window)?;
    let mut form = reqwest::multipart::Form::new()
        .part("file", reqwest::multipart::Part::bytes(wav).file_name("w.wav").mime_str("audio/wav").map_err(|e| e.to_string())?)
        .text("response_format", "verbose_json")
        .text("temperature", "0");
    if !prompt.trim().is_empty() {
        form = form.text("prompt", prompt.to_string());
    }
    let v: serde_json::Value = c
        .post(format!("http://127.0.0.1:{port}{path}"))
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let segs = v.get("segments").and_then(|s| s.as_array()).cloned().unwrap_or_default();
    let mean = |k: &str| {
        let xs: Vec<f64> = segs.iter().filter_map(|s| s.get(k).and_then(|x| x.as_f64())).collect();
        (!xs.is_empty()).then(|| xs.iter().sum::<f64>() / xs.len() as f64)
    };
    Ok(Heard {
        text: v.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string(),
        words: words_of(&segs),
        lang_p: v.get("detected_language_probability").and_then(|x| x.as_f64()),
        logprob: mean("avg_logprob"),
        no_speech: mean("no_speech_prob"),
    })
}

/// No whisper-server next to the CLI: one CLI run per window (slower —
/// the model reloads every time — but it works).
async fn infer_cli(bin: &str, model: &str, window: &[f32]) -> Result<Heard, String> {
    let path = write_wav(window)?;
    let out = tokio::process::Command::new(bin)
        .args(["-m", model, "-f", path.to_string_lossy().as_ref(), "-l", "en", "-nt", "-np"])
        .output()
        .await;
    let _ = std::fs::remove_file(&path);
    let out = out.map_err(|e| e.to_string())?;
    Ok(Heard { text: String::from_utf8_lossy(&out.stdout).to_string(), words: Vec::new(), lang_p: None, logprob: None, no_speech: None })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn stop_transcription(state: tauri::State<'_, TranscriptionState>, app: AppHandle) {
    state.running.store(false, Ordering::Release);
    app.emit("caption:status", "stopped").ok();
}

/// Device rate → 16 kHz for Whisper, with a proper low-pass first. Plain
/// interpolation from 48 kHz folds everything above 8 kHz (cymbals, hi-hat,
/// sibilance) back into the vocal band as noise.
pub(crate) fn resample_to_16k(input: &[f32], sr: u32) -> Vec<f32> {
    if sr == 16000 || input.is_empty() {
        return input.to_vec();
    }
    const HALF: isize = 32; // 65 taps
    let step = sr as f64 / 16000.0; // input samples per output sample
    let cutoff = 7200.0 / sr as f64; // cycles per input sample (below Nyquist of 8 kHz)
    let taps: Vec<f32> = (-HALF..=HALF)
        .map(|k| {
            let x = k as f64;
            let sinc = if k == 0 { 2.0 * cutoff } else { (2.0 * std::f64::consts::PI * cutoff * x).sin() / (std::f64::consts::PI * x) };
            let w = 0.54 + 0.46 * (std::f64::consts::PI * x / HALF as f64).cos(); // Hamming
            (sinc * w) as f32
        })
        .collect();
    let norm: f32 = taps.iter().sum();
    let out_len = (input.len() as f64 / step) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let c = (i as f64 * step).round() as isize;
        let mut acc = 0f32;
        for (j, t) in taps.iter().enumerate() {
            let idx = c + j as isize - HALF;
            if idx >= 0 && (idx as usize) < input.len() {
                acc += t * input[idx as usize];
            }
        }
        out.push(acc / norm);
    }
    out
}

fn wav_bytes(samples: &[f32]) -> Result<Vec<u8>, String> {
    let spec = hound::WavSpec { channels: 1, sample_rate: 16000, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut cur = std::io::Cursor::new(Vec::with_capacity(samples.len() * 2 + 44));
    {
        let mut w = hound::WavWriter::new(&mut cur, spec).map_err(|e| e.to_string())?;
        for &s in samples {
            w.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16).map_err(|e| e.to_string())?;
        }
        w.finalize().map_err(|e| e.to_string())?;
    }
    Ok(cur.into_inner())
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
pub(crate) fn clean_whisper_text(raw: &str) -> String {
    let mut out = String::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Drop pure annotation lines like "[BLANK_AUDIO]" or "(music)".
        let is_annotation = (line.starts_with('[') && line.ends_with(']'))
            || (line.starts_with('(') && line.ends_with(')'))
            || (line.starts_with('*') && line.ends_with('*'));
        if is_annotation {
            continue;
        }
        // Music glyphs and the words Whisper writes for an instrumental.
        let line = line.replace(['♪', '♫', '¶', '#'], " ");
        let line = line.trim();
        if line.is_empty() || matches!(line.trim_end_matches('.').to_lowercase().as_str(), "music" | "upbeat music" | "..." | "") {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(line);
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::resample_to_16k;
    fn tone(hz: f32, sr: u32, secs: f32) -> Vec<f32> {
        (0..(sr as f32 * secs) as usize).map(|i| (2.0 * std::f32::consts::PI * hz * i as f32 / sr as f32).sin()).collect()
    }
    fn rms(x: &[f32]) -> f32 {
        let x = &x[200..x.len() - 200];
        (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
    }
    #[test]
    fn keeps_the_voice_band_and_drops_what_would_alias() {
        let voice = resample_to_16k(&tone(1000.0, 48000, 1.0), 48000);
        assert_eq!(voice.len(), 16000);
        assert!((rms(&voice) - 0.707).abs() < 0.03, "1 kHz passes: {}", rms(&voice));
        // 12 kHz would fold to 4 kHz with plain interpolation.
        let cymbal = resample_to_16k(&tone(12000.0, 48000, 1.0), 48000);
        assert!(rms(&cymbal) < 0.02, "12 kHz is filtered out: {}", rms(&cymbal));
        // 44.1 kHz devices too.
        assert!((rms(&resample_to_16k(&tone(1000.0, 44100, 1.0), 44100)) - 0.707).abs() < 0.03);
    }
}
