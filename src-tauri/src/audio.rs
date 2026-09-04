use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Sample;
use rustfft::{num_complex::Complex, FftPlanner};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use crate::settings::SettingsState;
use tauri::{AppHandle, Emitter};

/// Most recent RMS level (f32 bits) + when it was measured, for pull-style
/// readers like the Stream Deck's SPL key. Zeroed meaning: never measured.
static LAST_RMS_BITS: AtomicU32 = AtomicU32::new(0);
static LAST_RMS_MS: AtomicU64 = AtomicU64::new(0);

/// Latest measured level as dBFS, or None when the engine isn't running
/// (no reading in the last 3 s). -80 floor keeps the math finite.
pub fn last_dbfs() -> Option<f64> {
    let ms = LAST_RMS_MS.load(Ordering::Relaxed);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    if ms == 0 || now.saturating_sub(ms) > 3000 {
        return None;
    }
    let rms = f32::from_bits(LAST_RMS_BITS.load(Ordering::Relaxed)) as f64;
    Some((20.0 * rms.max(1e-4).log10()).max(-80.0))
}
use tokio::sync::broadcast;

const ANALYSIS_LEN: usize = 8192;
const FFT_SIZE: usize = 2048;
const RTA_BANDS: usize = 28;

// ---------------------------------------------------------------------------
// Broadcast loudness (ITU-R BS.1770 K-weighting + gated integrated loudness).
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

impl Biquad {
    fn new(b0: f64, b1: f64, b2: f64, a1: f64, a2: f64) -> Self {
        Self { b0, b1, b2, a1, a2, x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 }
    }
    #[inline]
    fn process(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

// K-weighting pre-filter (high shelf) + RLB high-pass, derived for the actual
// sample rate via the bilinear transform (so it's correct at 44.1k, 48k, etc.).
fn kweight_filters(fs: f64) -> (Biquad, Biquad) {
    use std::f64::consts::PI;
    // Stage 1 — high shelf.
    let f0 = 1681.9744509555319;
    let g = 3.999843853973347;
    let q = 0.7071752369554193;
    let k = (PI * f0 / fs).tan();
    let vh = 10f64.powf(g / 20.0);
    let vb = vh.powf(0.4996667741545416);
    let a0 = 1.0 + k / q + k * k;
    let pre = Biquad::new(
        (vh + vb * k / q + k * k) / a0,
        2.0 * (k * k - vh) / a0,
        (vh - vb * k / q + k * k) / a0,
        2.0 * (k * k - 1.0) / a0,
        (1.0 - k / q + k * k) / a0,
    );
    // Stage 2 — RLB high-pass.
    let f0 = 38.13547087602444;
    let q = 0.5003270373238773;
    let k = (PI * f0 / fs).tan();
    let denom = 1.0 + k / q + k * k;
    let rlb = Biquad::new(
        1.0,
        -2.0,
        1.0,
        2.0 * (k * k - 1.0) / denom,
        (1.0 - k / q + k * k) / denom,
    );
    (pre, rlb)
}

struct LufsReading {
    momentary: f64,
    short: f64,
    integrated: f64,
    peak_db: f64,
}

struct LoudnessMeter {
    pre: Biquad,
    rlb: Biquad,
    block_size: usize, // samples per 100ms block
    acc: f64,
    n: usize,
    short: VecDeque<f64>, // mean-square per 100ms block, last 3s (30 blocks)
    integ: Vec<f64>,      // mean-square per block since start (for gated integrated)
    peak: f64,            // sample peak (abs) within the current emit window
    blocks: u64,
    integ_cache: f64,
}

impl LoudnessMeter {
    fn new(fs: u32) -> Self {
        let (pre, rlb) = kweight_filters(fs as f64);
        Self {
            pre,
            rlb,
            block_size: (fs as usize / 10).max(1),
            acc: 0.0,
            n: 0,
            short: VecDeque::with_capacity(32),
            integ: Vec::new(),
            peak: 0.0,
            blocks: 0,
            integ_cache: -120.0,
        }
    }

    #[inline]
    fn lufs_of(z: f64) -> f64 {
        if z <= 0.0 {
            -120.0
        } else {
            -0.691 + 10.0 * z.log10()
        }
    }

    // Feed one mono sample; returns a reading when a 100ms block completes.
    fn push(&mut self, raw: f64) -> Option<LufsReading> {
        let a = raw.abs();
        if a > self.peak {
            self.peak = a;
        }
        let w = self.rlb.process(self.pre.process(raw));
        self.acc += w * w;
        self.n += 1;
        if self.n < self.block_size {
            return None;
        }
        let ms = self.acc / self.n as f64;
        self.acc = 0.0;
        self.n = 0;
        self.short.push_back(ms);
        while self.short.len() > 30 {
            self.short.pop_front();
        }
        self.integ.push(ms);
        if self.integ.len() > 72_000 {
            self.integ.remove(0); // cap ~2h of history
        }
        self.blocks += 1;
        // Recompute the (expensive) gated integrated value about once a second.
        if self.blocks % 10 == 0 {
            self.integ_cache = self.integrated();
        }
        let mom: f64 = self.short.iter().rev().take(4).copied().sum();
        let mom_n = self.short.len().min(4).max(1);
        let short_sum: f64 = self.short.iter().copied().sum();
        let short_n = self.short.len().max(1);
        let peak_db = if self.peak > 0.0 {
            20.0 * self.peak.log10()
        } else {
            -120.0
        };
        self.peak = 0.0;
        Some(LufsReading {
            momentary: Self::lufs_of(mom / mom_n as f64),
            short: Self::lufs_of(short_sum / short_n as f64),
            integrated: self.integ_cache,
            peak_db,
        })
    }

    // Two-stage gating per BS.1770 (approximated on 100ms blocks).
    fn integrated(&self) -> f64 {
        if self.integ.is_empty() {
            return -120.0;
        }
        let abs_gate: Vec<f64> = self
            .integ
            .iter()
            .copied()
            .filter(|&z| Self::lufs_of(z) > -70.0)
            .collect();
        if abs_gate.is_empty() {
            return -120.0;
        }
        let mean_abs = abs_gate.iter().sum::<f64>() / abs_gate.len() as f64;
        let rel = Self::lufs_of(mean_abs) - 10.0;
        let gated: Vec<f64> = abs_gate
            .into_iter()
            .filter(|&z| Self::lufs_of(z) > rel)
            .collect();
        if gated.is_empty() {
            return Self::lufs_of(mean_abs);
        }
        Self::lufs_of(gated.iter().sum::<f64>() / gated.len() as f64)
    }
}

pub struct AudioInner {
    pub running: AtomicBool,
    pub sample_rate: AtomicU32,
    /// Channel count of the active input device (0 when idle).
    pub channels: AtomicU32,
    /// Device-rate mono samples, drained by the transcription engine.
    pub mono: Mutex<Vec<f32>>,
    /// Rolling window of recent samples for spectrum analysis (not drained).
    pub analysis: Mutex<Vec<f32>>,
    pub device_name: Mutex<Option<String>>,
    /// Overflow / "Listen" stream: device-rate mono i16 PCM chunks mixed from the
    /// configured overflow channels. Subscribed to by the web /api/listen stream.
    pub overflow_tx: broadcast::Sender<Vec<i16>>,
}

impl AudioInner {
    pub fn new() -> Self {
        let (overflow_tx, _) = broadcast::channel(64);
        Self {
            running: AtomicBool::new(false),
            sample_rate: AtomicU32::new(0),
            channels: AtomicU32::new(0),
            mono: Mutex::new(Vec::new()),
            analysis: Mutex::new(Vec::new()),
            device_name: Mutex::new(None),
            overflow_tx,
        }
    }

    /// Take everything captured so far (used by the transcription window).
    pub fn drain(&self) -> (Vec<f32>, u32) {
        let mut buf = self.mono.lock().unwrap_or_else(|p| p.into_inner());
        let out = std::mem::take(&mut *buf);
        (out, self.sample_rate.load(Ordering::Relaxed))
    }
}

pub type AudioState = Arc<AudioInner>;

#[tauri::command]
pub fn list_audio_inputs() -> Result<Vec<String>, String> {
    let host = cpal::default_host();
    let mut names = Vec::new();
    if let Ok(devices) = host.input_devices() {
        for d in devices {
            if let Ok(name) = d.name() {
                names.push(name);
            }
        }
    }
    Ok(names)
}

#[tauri::command]
pub fn default_audio_input() -> Option<String> {
    cpal::default_host()
        .default_input_device()
        .and_then(|d| d.name().ok())
}

fn find_device(name: &Option<String>) -> Option<cpal::Device> {
    let host = cpal::default_host();
    match name {
        Some(n) => host
            .input_devices()
            .ok()?
            .find(|d| d.name().map(|dn| &dn == n).unwrap_or(false))
            .or_else(|| host.default_input_device()),
        None => host.default_input_device(),
    }
}

#[tauri::command]
pub fn start_audio_capture(
    device: Option<String>,
    state: tauri::State<'_, AudioState>,
    settings: tauri::State<'_, SettingsState>,
    app: AppHandle,
) -> Result<(), String> {
    let dev = find_device(&device).ok_or_else(|| "No matching input device".to_string())?;
    let config = dev
        .default_input_config()
        .map_err(|e| format!("input config: {e}"))?;

    // Stop any prior capture.
    state.running.store(false, Ordering::Release);
    std::thread::sleep(std::time::Duration::from_millis(80));

    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    state.sample_rate.store(sample_rate, Ordering::Relaxed);
    state.channels.store(channels as u32, Ordering::Relaxed);
    state.mono.lock().unwrap_or_else(|p| p.into_inner()).clear();
    state.analysis.lock().unwrap_or_else(|p| p.into_inner()).clear();
    *state.device_name.lock().unwrap_or_else(|p| p.into_inner()) = dev.name().ok();
    state.running.store(true, Ordering::Release);

    // Channel routing for multi-channel (Dante) inputs: settings hold 1-based
    // channel numbers; map to 0-based indices clamped to the device. Empty
    // measurement = mix all channels (legacy single-feed behaviour).
    let to_idx = |chs: &[u32]| -> Vec<usize> {
        chs.iter()
            .filter_map(|c| (*c as usize).checked_sub(1))
            .filter(|&i| i < channels)
            .collect()
    };
    let (measure_idx, overflow_idx) = {
        let s = settings.lock().unwrap_or_else(|p| p.into_inner());
        (
            Arc::new(to_idx(&s.audio_measure_channels)),
            Arc::new(to_idx(&s.audio_overflow_channels)),
        )
    };
    let overflow_tx = state.overflow_tx.clone();

    let inner = state.inner().clone();
    let app2 = app.clone();
    let sample_format = config.sample_format();
    let stream_config: cpal::StreamConfig = config.into();

    std::thread::spawn(move || {
        let err_app = app2.clone();
        let err_fn = move |e: cpal::StreamError| {
            err_app.emit("audio:error", e.to_string()).ok();
        };

        let inner_cb = inner.clone();
        let app_cb = app2.clone();
        let mut emit_frames: usize = 0;
        let mut emit_sumsq: f32 = 0.0;
        let mut emit_peak: f32 = 0.0;
        // Per-channel peak over the emit window — lets the channel-routing UI
        // show which inputs actually carry signal.
        let mut chan_peak: Vec<f32> = vec![0.0; channels.max(1)];

        macro_rules! handle {
            ($t:ty) => {{
                let inner_cb = inner_cb.clone();
                let app_cb = app_cb.clone();
                let measure_idx = measure_idx.clone();
                let overflow_idx = overflow_idx.clone();
                let overflow_tx = overflow_tx.clone();
                let mut meter = LoudnessMeter::new(sample_rate);
                dev.build_input_stream(
                    &stream_config,
                    move |data: &[$t], _| {
                        if !inner_cb.running.load(Ordering::Acquire) {
                            return;
                        }
                        let frames = data.len() / channels.max(1);
                        let mut chunk: Vec<f32> = Vec::with_capacity(frames);
                        let mut overflow_pcm: Vec<i16> =
                            Vec::with_capacity(if overflow_idx.is_empty() { 0 } else { frames });
                        let mut lufs_out: Option<LufsReading> = None;
                        for f in 0..frames {
                            let base = f * channels;
                            // Per-channel peak (for the routing meter).
                            for c in 0..channels {
                                let v = f32::from_sample(data[base + c]).abs();
                                if v > chan_peak[c] {
                                    chan_peak[c] = v;
                                }
                            }
                            // Measurement mono mix: configured channels, or all
                            // channels when none are configured (legacy).
                            let s = if measure_idx.is_empty() {
                                let mut acc = 0.0f32;
                                for c in 0..channels {
                                    acc += f32::from_sample(data[base + c]);
                                }
                                acc / channels as f32
                            } else {
                                let mut acc = 0.0f32;
                                for &i in measure_idx.iter() {
                                    acc += f32::from_sample(data[base + i]);
                                }
                                acc / measure_idx.len() as f32
                            };
                            emit_sumsq += s * s;
                            if s.abs() > emit_peak {
                                emit_peak = s.abs();
                            }
                            if let Some(r) = meter.push(s as f64) {
                                lufs_out = Some(r);
                            }
                            chunk.push(s);
                            // Overflow mono mix → i16 for the Listen stream.
                            if !overflow_idx.is_empty() {
                                let mut acc = 0.0f32;
                                for &i in overflow_idx.iter() {
                                    acc += f32::from_sample(data[base + i]);
                                }
                                // +18 dB makeup gain: the console's monitor feed
                                // sits well below full scale, which made Listen
                                // whisper-quiet on phones. tanh soft-clips the
                                // peaks — a loud band saturates smoothly instead
                                // of hard-wrapping, which is what lets the gain
                                // sit this high on a monitoring feed.
                                const OVERFLOW_GAIN: f32 = 8.0;
                                let o = (acc / overflow_idx.len() as f32 * OVERFLOW_GAIN).tanh();
                                overflow_pcm.push((o * 32767.0) as i16);
                            }
                        }
                        if !overflow_pcm.is_empty() {
                            let _ = overflow_tx.send(overflow_pcm);
                        }
                        let sr = inner_cb.sample_rate.load(Ordering::Relaxed).max(1) as usize;
                        {
                            // Long buffer for transcription (drained elsewhere).
                            let mut buf = inner_cb.mono.lock().unwrap_or_else(|p| p.into_inner());
                            buf.extend_from_slice(&chunk);
                            let cap = sr * 30;
                            if buf.len() > cap {
                                let excess = buf.len() - cap;
                                buf.drain(0..excess);
                            }
                        }
                        {
                            // Short rolling window for the RTA/spectrum.
                            let mut an = inner_cb.analysis.lock().unwrap_or_else(|p| p.into_inner());
                            an.extend_from_slice(&chunk);
                            if an.len() > ANALYSIS_LEN {
                                let excess = an.len() - ANALYSIS_LEN;
                                an.drain(0..excess);
                            }
                        }
                        // Emit a metered level ~12x/sec to keep store churn low.
                        emit_frames += frames;
                        if emit_frames >= sr / 12 {
                            let rms = (emit_sumsq / emit_frames as f32).sqrt();
                            // Latest level for pull-style readers (the Stream
                            // Deck SPL key polls the gateway; it can't ride
                            // the event stream).
                            LAST_RMS_BITS.store(rms.min(1.0).to_bits(), std::sync::atomic::Ordering::Relaxed);
                            LAST_RMS_MS.store(
                                std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .map(|d| d.as_millis() as u64)
                                    .unwrap_or(0),
                                std::sync::atomic::Ordering::Relaxed,
                            );
                            app_cb
                                .emit(
                                    "audio:level",
                                    serde_json::json!({
                                        "rms": rms.min(1.0),
                                        "peak": emit_peak.min(1.0)
                                    }),
                                )
                                .ok();
                            // Per-channel peaks (clamped 0..1) for the routing meter.
                            let chans: Vec<f32> =
                                chan_peak.iter().map(|p| p.min(1.0)).collect();
                            app_cb.emit("audio:channels", &chans).ok();
                            emit_frames = 0;
                            emit_sumsq = 0.0;
                            emit_peak = 0.0;
                            for p in chan_peak.iter_mut() {
                                *p = 0.0;
                            }
                        }
                        if let Some(r) = lufs_out {
                            app_cb
                                .emit(
                                    "audio:lufs",
                                    serde_json::json!({
                                        "m": r.momentary,
                                        "s": r.short,
                                        "i": r.integrated,
                                        "peak": r.peak_db,
                                    }),
                                )
                                .ok();
                        }
                    },
                    err_fn,
                    None,
                )
            }};
        }

        let stream = match sample_format {
            cpal::SampleFormat::F32 => handle!(f32),
            cpal::SampleFormat::I16 => handle!(i16),
            cpal::SampleFormat::U16 => handle!(u16),
            other => {
                app2.emit("audio:error", format!("unsupported sample format {other:?}"))
                    .ok();
                return;
            }
        };

        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                app2.emit("audio:error", e.to_string()).ok();
                return;
            }
        };
        if let Err(e) = stream.play() {
            app2.emit("audio:error", e.to_string()).ok();
            return;
        }
        app2.emit("audio:started", sample_rate).ok();

        while inner.running.load(Ordering::Acquire) {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        drop(stream);
        app2.emit("audio:stopped", ()).ok();
    });

    // Spectrum analyzer thread (FFT -> log bands), runs while capturing.
    {
        let inner = state.inner().clone();
        let app = app.clone();
        std::thread::spawn(move || rta_loop(inner, app));
    }

    Ok(())
}

#[tauri::command]
pub fn stop_audio_capture(state: tauri::State<'_, AudioState>) {
    state.running.store(false, Ordering::Release);
}

/// Number of input channels the given device exposes — used by the channel
/// routing UI (e.g. an 8-channel Dante input).
#[tauri::command]
pub fn audio_input_channels(device: Option<String>) -> u16 {
    find_device(&device)
        .and_then(|d| d.default_input_config().ok())
        .map(|c| c.channels())
        .unwrap_or(0)
}

/// Continuously analyze the rolling window and emit ~28 log-spaced band levels.
fn rta_loop(inner: Arc<AudioInner>, app: AppHandle) {
    let n = FFT_SIZE;
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n);
    // Hann window.
    let window: Vec<f32> = (0..n)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (n as f32 - 1.0)).cos())
        .collect();

    while inner.running.load(Ordering::Acquire) {
        std::thread::sleep(std::time::Duration::from_millis(66));
        let sr = inner.sample_rate.load(Ordering::Relaxed);
        if sr == 0 {
            continue;
        }
        let samples: Vec<f32> = {
            let an = inner.analysis.lock().unwrap_or_else(|p| p.into_inner());
            if an.len() < n {
                continue;
            }
            an[an.len() - n..].to_vec()
        };
        let mut buf: Vec<Complex<f32>> = (0..n)
            .map(|i| Complex {
                re: samples[i] * window[i],
                im: 0.0,
            })
            .collect();
        fft.process(&mut buf);
        let bands = compute_bands(&buf, n, sr);
        app.emit("audio:rta", bands).ok();
    }
}

fn compute_bands(buf: &[Complex<f32>], n: usize, sr: u32) -> Vec<f32> {
    let f_min = 31.5f32;
    let f_max = (sr as f32 / 2.0).min(16000.0).max(f_min * 2.0);
    let half = n / 2;
    let bin_hz = sr as f32 / n as f32;
    let mut out = Vec::with_capacity(RTA_BANDS);
    for b in 0..RTA_BANDS {
        let lo = f_min * (f_max / f_min).powf(b as f32 / RTA_BANDS as f32);
        let hi = f_min * (f_max / f_min).powf((b + 1) as f32 / RTA_BANDS as f32);
        let k0 = ((lo / bin_hz).floor() as usize).max(1);
        let k1 = ((hi / bin_hz).ceil() as usize).min(half - 1).max(k0);
        let mut sum = 0.0f32;
        let mut cnt = 0usize;
        for k in k0..=k1 {
            sum += buf[k].norm();
            cnt += 1;
        }
        let mag = if cnt > 0 { sum / cnt as f32 } else { 0.0 };
        let db = 20.0 * (mag / (n as f32 / 2.0) + 1e-9).log10();
        out.push(db);
    }
    out
}
