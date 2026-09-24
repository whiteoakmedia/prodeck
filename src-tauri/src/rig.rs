//! Auto-Follow's ears on the playback rig: the click and the guide.
//!
//! Runs while Follow is listening, if Settings names the channels:
//! - click → `follow:beat` { t, strength, zcr } per click (beat.rs finds them);
//! - guide → `follow:cue` { text, t0, t1, words } per spoken cue ("Verse 2",
//!   "Chorus", "1, 2, 3, 4"). The guide channel is silent between cues, so a
//!   cue is sent to Whisper the moment the voice stops — not on a fixed
//!   window — which is what makes it early enough to act on. It uses its own
//!   tiny Whisper on the CPU, so a lyric window on the GPU never delays a cue.

use crate::audio::AudioState;
use crate::transcription::TranscriptionState;
use std::sync::atomic::Ordering;
use std::sync::atomic::AtomicBool;
use tauri::{AppHandle, Emitter};

/// The guide has a voice on it (or a cue is being read): the lyric listener
/// skips its turn so the cue gets the GPU at once. A cue waited 4.9 s behind
/// lyric windows in the first live test.
pub static GUIDE_BUSY: AtomicBool = AtomicBool::new(false);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Start the rig listeners for the life of the app, from Settings (changing
/// the channels or the MIDI port needs a restart, like the audio input).
pub fn spawn_always(app: AppHandle) {
    use tauri::Manager;
    let (bin, click, guide, midi) = {
        let st = app.state::<crate::settings::SettingsState>();
        let s = st.lock().unwrap_or_else(|p| p.into_inner());
        (s.whisper_bin.clone().unwrap_or_default(), s.follow_click_channel > 0, s.follow_guide_channel > 0, s.follow_midi_port.clone())
    };
    let audio = app.state::<AudioState>().inner().clone();
    let running: TranscriptionState = std::sync::Arc::new(crate::transcription::TranscriptionInner::new());
    running.running.store(true, Ordering::Release);
    spawn(app, audio, running, bin, click, guide, midi);
}

pub fn spawn(app: AppHandle, audio: AudioState, running: TranscriptionState, bin: String, click: bool, guide: bool, midi_port: Option<String>) {
    if let Some(port) = midi_port.filter(|p| !p.trim().is_empty()) {
        let app = app.clone();
        let running = running.clone();
        std::thread::Builder::new().name("follow-midi".into()).spawn(move || midi_clock_loop(app, running, port)).ok();
    }
    if click {
        let app = app.clone();
        let audio = audio.clone();
        let running = running.clone();
        std::thread::Builder::new()
            .name("follow-click".into())
            .spawn(move || {
                audio.drain_click();
                let mut det: Option<(u32, crate::beat::ClickDetector)> = None;
                let mut total: u64 = 0;
                while running.running.load(Ordering::Acquire) {
                    std::thread::sleep(std::time::Duration::from_millis(40));
                    let (xs, sr) = audio.drain_click();
                    let t = now_ms();
                    if sr == 0 || xs.is_empty() {
                        continue;
                    }
                    if det.as_ref().map(|(s, _)| *s != sr).unwrap_or(true) {
                        det = Some((sr, crate::beat::ClickDetector::new(sr)));
                        total = 0;
                    }
                    let d = &mut det.as_mut().unwrap().1;
                    total += xs.len() as u64;
                    for o in d.push(&xs) {
                        let back_ms = (total.saturating_sub(o.at)) as f64 * 1000.0 / sr as f64;
                        let at = t.saturating_sub(back_ms as u64);
                        app.emit("follow:beat", serde_json::json!({ "t": at, "strength": o.strength, "zcr": o.zcr })).ok();
                    }
                }
            })
            .ok();
    }
    if guide {
        tauri::async_runtime::spawn(guide_loop(app, audio, running, bin));
    }
}

/// Words a guide track says, to steer Whisper toward them.
const CUE_PROMPT: &str = "Intro. Verse 1. Verse 2. Verse 3. Pre-chorus. Chorus. Bridge. Tag. Instrumental. Turnaround. Interlude. Refrain. Vamp. Outro. Ending. Breakdown. Build. All in. 1, 2, 3, 4.";

async fn guide_loop(app: AppHandle, audio: AudioState, running: TranscriptionState, bin: String) {
    let models = crate::settings::data_dir().join("models");
    // tiny.en on the CPU: a guide cue is one clean word or two, and the GPU
    // belongs to the lyric model — sharing it, cues waited up to 6 s.
    let model = ["ggml-tiny.en.bin", "ggml-base.en.bin", "ggml-small.en-q5_1.bin"]
        .iter()
        .map(|n| models.join(n))
        .find(|p| p.exists());
    let Some(model) = model else { return };
    let model = model.to_string_lossy().to_string();
    let Some(sbin) = crate::transcription::server_bin(&bin) else { return };
    let Some(port) = std::net::TcpListener::bind("127.0.0.1:0").ok().and_then(|l| l.local_addr().ok()).map(|a| a.port()) else { return };
    let mut cmd = tokio::process::Command::new(&sbin);
    cmd.args(["-m", &model, "-l", "en", "-t", "4", "--host", "127.0.0.1", "-nf", "-bs", "1", "-bo", "1", "-ac", "256", "-ng"])
        .args(["--port", &port.to_string(), "--inference-path", "/prodeck-guide"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let Ok(mut child) = cmd.spawn() else { return };
    let client = match reqwest::Client::builder().timeout(std::time::Duration::from_secs(6)).build() {
        Ok(c) => c,
        Err(_) => return,
    };
    for _ in 0..60 {
        if client.get(format!("http://127.0.0.1:{port}/")).send().await.is_ok() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }

    audio.drain_guide();
    let mut vad = Vad::default();
    let mut buf: Vec<f32> = Vec::new(); // device-rate samples since `buf_t0`
    let mut buf_t0: u64 = now_ms();
    while running.running.load(Ordering::Acquire) {
        tokio::time::sleep(std::time::Duration::from_millis(60)).await;
        let (xs, sr) = audio.drain_guide();
        let t = now_ms();
        if sr == 0 || xs.is_empty() {
            continue;
        }
        if buf.is_empty() {
            buf_t0 = t.saturating_sub(xs.len() as u64 * 1000 / sr as u64);
        }
        buf.extend_from_slice(&xs);
        // Keep at most 6 s when nobody is talking.
        let frame = (sr / 50) as usize; // 20 ms
        let seg = vad.feed(&buf, frame, sr);
        GUIDE_BUSY.store(vad.speaking() || seg.is_some(), Ordering::Release);
        if let Some((a, b)) = seg {
            let pre = (sr as usize / 5).min(a); // 200 ms before the voice
            let seg = &buf[a - pre..b.min(buf.len())];
            let t0 = buf_t0 + ((a - pre) as u64 * 1000 / sr as u64);
            let wav16 = crate::transcription::resample_to_16k(seg, sr);
            if let Ok(h) = crate::transcription::infer_server_at(&client, port, "/prodeck-guide", &wav16, CUE_PROMPT).await {
                let text = crate::transcription::clean_whisper_text(&h.text);
                if !text.is_empty() {
                    let words: Vec<serde_json::Value> = h
                        .words
                        .iter()
                        .map(|w| {
                            serde_json::json!({
                                "w": w["w"],
                                "t0": t0 + (w["t0"].as_f64().unwrap_or(0.0) * 1000.0) as u64,
                                "t1": t0 + (w["t1"].as_f64().unwrap_or(0.0) * 1000.0) as u64,
                            })
                        })
                        .collect();
                    let t1 = t0 + (seg.len() as u64 * 1000 / sr as u64);
                    app.emit("follow:cue", serde_json::json!({ "text": text, "t0": t0, "t1": t1, "words": words, "ms": now_ms() - t })).ok();
                }
            }
            GUIDE_BUSY.store(false, Ordering::Release);
            // Drop what's been handled.
            let cut = b.min(buf.len());
            buf.drain(..cut);
            buf_t0 += cut as u64 * 1000 / sr as u64;
            vad.reset();
        } else if !vad.speaking() && buf.len() > sr as usize * 6 {
            let cut = buf.len() - sr as usize;
            buf.drain(..cut);
            buf_t0 += cut as u64 * 1000 / sr as u64;
            vad.reset();
        }
    }
    let _ = child.kill().await;
}

/// Voice on/off on a mostly silent channel: a segment starts when a 20 ms
/// frame rises 12 dB over the floor, ends after 200 ms quiet or 2.5 s long.
#[derive(Default)]
struct Vad {
    pos: usize,
    floor: f32,
    start: Option<usize>,
    quiet_frames: usize,
}
impl Vad {
    fn reset(&mut self) {
        self.pos = 0;
        self.start = None;
        self.quiet_frames = 0;
    }
    fn speaking(&self) -> bool {
        self.start.is_some()
    }
    /// Returns (start, end) sample indices of a finished segment.
    fn feed(&mut self, buf: &[f32], frame: usize, sr: u32) -> Option<(usize, usize)> {
        if self.floor == 0.0 {
            self.floor = 1e-4;
        }
        while self.pos + frame <= buf.len() {
            let f = &buf[self.pos..self.pos + frame];
            let rms = (f.iter().map(|v| v * v).sum::<f32>() / frame as f32).sqrt();
            let thr = (self.floor * 4.0).max(0.0018); // +12 dB, ≥ -55 dBFS
            let loud = rms > thr;
            match self.start {
                None => {
                    if loud {
                        self.start = Some(self.pos);
                        self.quiet_frames = 0;
                    } else {
                        self.floor = self.floor * 0.98 + rms * 0.02;
                    }
                }
                Some(s) => {
                    self.quiet_frames = if loud { 0 } else { self.quiet_frames + 1 };
                    let len = self.pos + frame - s;
                    if self.quiet_frames * frame >= sr as usize / 5 || len >= sr as usize * 5 / 2 {
                        let end = self.pos + frame;
                        self.pos += frame;
                        return Some((s, end));
                    }
                }
            }
            self.pos += frame;
        }
        None
    }
}


/// Playback's MIDI Clock: 24 pulses a beat, Start when a song starts. Each
/// beat goes out as `follow:mbeat` { t, beat (since Start, or null), bpm };
/// Start/Stop as `follow:mstart` / `follow:mstop`. Exact where the audio click
/// is an estimate — and when network MIDI drops, the audio click carries on.
fn midi_clock_loop(app: AppHandle, running: TranscriptionState, port_name: String) {
    use std::sync::{Arc, Mutex};
    struct Clock {
        pulses: Option<u64>, // since Start; None until a Start is seen
        count: u64,          // pulses since we started listening
        stamps: std::collections::VecDeque<u64>,
    }
    let st = Arc::new(Mutex::new(Clock { pulses: None, count: 0, stamps: Default::default() }));
    while running.running.load(Ordering::Acquire) {
        let Ok(mut input) = midir::MidiInput::new("ProDeck-follow") else { return };
        // midir drops timing messages unless told otherwise.
        input.ignore(midir::Ignore::None);
        let port = input.ports().into_iter().find(|p| input.port_name(p).map(|n| n == port_name).unwrap_or(false));
        let Some(port) = port else {
            std::thread::sleep(std::time::Duration::from_secs(5));
            continue;
        };
        let st2 = st.clone();
        let app2 = app.clone();
        let conn = input.connect(
            &port,
            "prodeck-follow",
            move |_, msg, _| {
                let t = now_ms();
                let mut c = st2.lock().unwrap_or_else(|p| p.into_inner());
                match msg.first().copied() {
                    Some(0xF8) => {
                        c.count += 1;
                        if let Some(p) = c.pulses.as_mut() {
                            *p += 1;
                        }
                        c.stamps.push_back(t);
                        if c.stamps.len() > 97 {
                            c.stamps.pop_front();
                        }
                        let on_beat = match c.pulses {
                            Some(p) => p % 24 == 0,
                            None => c.count % 24 == 0,
                        };
                        if on_beat && c.stamps.len() >= 25 {
                            let n = c.stamps.len() as f64 - 1.0;
                            let span = (c.stamps.back().unwrap() - c.stamps.front().unwrap()) as f64;
                            let bpm = if span > 0.0 { 60_000.0 * n / 24.0 / span } else { 0.0 };
                            let beat = c.pulses.map(|p| p / 24);
                            app2.emit("follow:mbeat", serde_json::json!({ "t": t, "beat": beat, "bpm": bpm })).ok();
                        }
                    }
                    Some(0xFA) => {
                        c.pulses = Some(0);
                        app2.emit("follow:mstart", serde_json::json!({ "t": t })).ok();
                        app2.emit("follow:mbeat", serde_json::json!({ "t": t, "beat": 0, "bpm": null })).ok();
                    }
                    Some(0xFB) => {}
                    Some(0xFC) => {
                        c.pulses = None;
                        app2.emit("follow:mstop", serde_json::json!({ "t": t })).ok();
                    }
                    // Song Position Pointer: sixteenths since the top.
                    Some(0xF2) if msg.len() >= 3 => {
                        let sixteenths = (msg[1] as u64) | ((msg[2] as u64) << 7);
                        c.pulses = Some(sixteenths * 6);
                    }
                    _ => {}
                }
            },
            (),
        );
        let Ok(conn) = conn else {
            std::thread::sleep(std::time::Duration::from_secs(5));
            continue;
        };
        // Hold the connection while listening; re-open if the port vanishes.
        while running.running.load(Ordering::Acquire) {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let still = midir::MidiInput::new("ProDeck-follow-check")
                .map(|i| i.ports().iter().any(|p| i.port_name(p).map(|n| n == port_name).unwrap_or(false)))
                .unwrap_or(true);
            if !still {
                break;
            }
        }
        drop(conn);
    }
}
