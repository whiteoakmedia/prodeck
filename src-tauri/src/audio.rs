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

/// Bilinear transform of one analog biquad into the digital domain.
/// Coefficient arrays are [s^0, s^1, s^2].
///
/// `f_ref` prewarps the mapping so this section's own characteristic frequency
/// lands where the analog prototype put it. Without it the transform squeezes
/// the top of the spectrum: the 12.2 kHz pole pair of both weighting curves
/// came out low enough to put 8 kHz 0.7 dB off at 44.1 kHz, and worse above.
/// Every section gets prewarped at its own poles, so each is exact where it
/// does its work.
fn bilinear(b: [f64; 3], a: [f64; 3], fs: f64, f_ref: f64) -> Biquad {
    use std::f64::consts::PI;
    let w0 = 2.0 * PI * f_ref;
    let k = w0 / (PI * f_ref / fs).tan();
    let kk = k * k;
    let nb0 = b[2] * kk + b[1] * k + b[0];
    let nb1 = -2.0 * b[2] * kk + 2.0 * b[0];
    let nb2 = b[2] * kk - b[1] * k + b[0];
    let na0 = a[2] * kk + a[1] * k + a[0];
    let na1 = -2.0 * a[2] * kk + 2.0 * a[0];
    let na2 = a[2] * kk - a[1] * k + a[0];
    Biquad::new(nb0 / na0, nb1 / na0, nb2 / na0, na1 / na0, na2 / na0)
}

/// |H(e^jw)| of a biquad cascade at `f` Hz. Used to normalise the weighting
/// curves to exactly 0 dB at 1 kHz, which the analog prototypes are not —
/// and which the bilinear transform shifts slightly besides, differently at
/// 44.1k and 48k. Measuring and dividing is self-correcting; a hard-coded
/// gain constant would be a little wrong at every rate but one.
fn cascade_gain(filters: &[Biquad], fs: f64, f: f64) -> f64 {
    use std::f64::consts::PI;
    let w = 2.0 * PI * f / fs;
    let (cw, sw) = (w.cos(), w.sin());
    let (c2w, s2w) = ((2.0 * w).cos(), (2.0 * w).sin());
    let mut mag = 1.0;
    for q in filters {
        // e^-jw = cos w - j sin w
        let nr = q.b0 + q.b1 * cw + q.b2 * c2w;
        let ni = -(q.b1 * sw + q.b2 * s2w);
        let dr = 1.0 + q.a1 * cw + q.a2 * c2w;
        let di = -(q.a1 * sw + q.a2 * s2w);
        mag *= ((nr * nr + ni * ni) / (dr * dr + di * di)).sqrt();
    }
    mag
}

// IEC 61672 pole frequencies, shared by both curves.
const W_F1: f64 = 20.598997;
const W_F2: f64 = 107.65265;
const W_F3: f64 = 737.86223;
const W_F4: f64 = 12194.217;

fn scaled(mut filters: Vec<Biquad>, fs: f64) -> Vec<Biquad> {
    let g = cascade_gain(&filters, fs, 1000.0);
    if g > 0.0 {
        let f = &mut filters[0];
        f.b0 /= g;
        f.b1 /= g;
        f.b2 /= g;
    }
    filters
}

/// A-weighting: what hearing-damage limits, noise ordinances and handheld
/// meters all speak. Models the ear at quiet levels, so it discards most of
/// the low end — −26 dB at 63 Hz, −39 dB at 31.5 Hz.
fn a_weighting(fs: f64) -> Vec<Biquad> {
    use std::f64::consts::PI;
    let (w1, w2, w3, w4) = (
        2.0 * PI * W_F1,
        2.0 * PI * W_F2,
        2.0 * PI * W_F3,
        2.0 * PI * W_F4,
    );
    scaled(
        vec![
            // s^2 / (s + w1)^2
            bilinear([0.0, 0.0, 1.0], [w1 * w1, 2.0 * w1, 1.0], fs, W_F1),
            // s^2 / ((s + w2)(s + w3)) — prewarped at the geometric mean of
            // its two poles, which is where the section actually bends.
            bilinear([0.0, 0.0, 1.0], [w2 * w3, w2 + w3, 1.0], fs, (W_F2 * W_F3).sqrt()),
            // w4^2 / (s + w4)^2
            bilinear([w4 * w4, 0.0, 0.0], [w4 * w4, 2.0 * w4, 1.0], fs, W_F4),
        ],
        fs,
    )
}

/// C-weighting: nearly flat across the band, so it keeps the low-frequency
/// energy A throws away. On its own it is not a safety number; measured
/// alongside A it is a mix diagnostic, because the gap between the two is the
/// size of the bottom end.
fn c_weighting(fs: f64) -> Vec<Biquad> {
    use std::f64::consts::PI;
    let (w1, w4) = (2.0 * PI * W_F1, 2.0 * PI * W_F4);
    scaled(
        vec![
            bilinear([0.0, 0.0, 1.0], [w1 * w1, 2.0 * w1, 1.0], fs, W_F1),
            bilinear([w4 * w4, 0.0, 0.0], [w4 * w4, 2.0 * w4, 1.0], fs, W_F4),
        ],
        fs,
    )
}

/// Which curve the SPL readout is measured through.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FreqWeight {
    /// Unweighted. Honest, and comparable to nothing.
    Z,
    A,
    C,
}

impl FreqWeight {
    pub fn parse(s: &str) -> FreqWeight {
        match s.trim().to_ascii_lowercase().as_str() {
            "z" | "none" | "flat" => FreqWeight::Z,
            "c" => FreqWeight::C,
            // A is the default on purpose: it is the only one of the three
            // that can be compared to a published limit.
            _ => FreqWeight::A,
        }
    }
}

/// Runs both weighting curves over the mono measurement mix, so the A reading,
/// the C reading and the gap between them are all available at once.
struct Weighter {
    a: Vec<Biquad>,
    c: Vec<Biquad>,
}

impl Weighter {
    fn new(fs: f64) -> Self {
        Self { a: a_weighting(fs), c: c_weighting(fs) }
    }
    #[inline]
    fn process(&mut self, x: f64) -> (f64, f64) {
        let mut a = x;
        for q in self.a.iter_mut() {
            a = q.process(a);
        }
        let mut c = x;
        for q in self.c.iter_mut() {
            c = q.process(c);
        }
        (a, c)
    }
}

/// Exponential time weighting, the way a sound level meter does it (IEC 61672).
///
/// ProDeck used to report the plain RMS of each ~83 ms emit window, restarted
/// from zero every time. On a steady source that number still moves several dB
/// from window to window, because 83 ms of pink noise is a small sample of a
/// random signal — so the booth's reading visibly swayed while the handheld
/// meter beside it sat still, and calibrating one against the other came down
/// to which instant you happened to read. That is how a calibration figure
/// ends up 20 dB from where it belongs.
///
/// A real meter integrates with a single-pole filter on the MEAN SQUARE (not on
/// dB, which would weight quiet moments far too heavily). Two standard time
/// constants: Slow, 1 s, what rooms and music are normally measured on, and
/// Fast, 125 ms.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TimeWeight {
    Fast,
    Slow,
}

impl TimeWeight {
    pub fn tau_secs(self) -> f64 {
        match self {
            TimeWeight::Fast => 0.125,
            TimeWeight::Slow => 1.0,
        }
    }
    pub fn parse(s: &str) -> TimeWeight {
        if s.eq_ignore_ascii_case("fast") { TimeWeight::Fast } else { TimeWeight::Slow }
    }
}

/// Running mean-square with exponential decay.
#[derive(Debug)]
pub struct WeightedLevel {
    ms: f64,
    primed: bool,
}

impl WeightedLevel {
    pub fn new() -> Self {
        Self { ms: 0.0, primed: false }
    }

    /// Fold in one window's mean square, measured over `dt` seconds.
    /// Returns the weighted RMS (linear, 0..1).
    pub fn push(&mut self, mean_square: f64, dt: f64, w: TimeWeight) -> f64 {
        // First window seeds the average outright. Without this the meter
        // climbs from silence for a second after capture starts, which reads
        // as a fault to anyone watching.
        if !self.primed {
            self.ms = mean_square;
            self.primed = true;
        } else {
            let alpha = 1.0 - (-dt / w.tau_secs()).exp();
            self.ms += (mean_square - self.ms) * alpha;
        }
        self.ms.max(0.0).sqrt()
    }
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
    /// The playback rig's click and guide channels (Auto-Follow), raw, at
    /// the device rate; drained by the beat tracker and the guide listener.
    pub click: Mutex<Vec<f32>>,
    pub guide: Mutex<Vec<f32>>,
    /// Autopilot's speech mics (lapel, MC), raw, for the speech meter and the
    /// feedback guard.
    pub lapel: Mutex<Vec<f32>>,
    pub mc: Mutex<Vec<f32>>,
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
            click: Mutex::new(Vec::new()),
            guide: Mutex::new(Vec::new()),
            lapel: Mutex::new(Vec::new()),
            mc: Mutex::new(Vec::new()),
            analysis: Mutex::new(Vec::new()),
            device_name: Mutex::new(None),
            overflow_tx,
        }
    }

    pub fn drain_click(&self) -> (Vec<f32>, u32) {
        let mut buf = self.click.lock().unwrap_or_else(|p| p.into_inner());
        (std::mem::take(&mut *buf), self.sample_rate.load(Ordering::Relaxed))
    }
    pub fn drain_speech(&self, lapel: bool) -> (Vec<f32>, u32) {
        let m = if lapel { &self.lapel } else { &self.mc };
        let mut buf = m.lock().unwrap_or_else(|p| p.into_inner());
        (std::mem::take(&mut *buf), self.sample_rate.load(Ordering::Relaxed))
    }
    pub fn drain_guide(&self) -> (Vec<f32>, u32) {
        let mut buf = self.guide.lock().unwrap_or_else(|p| p.into_inner());
        (std::mem::take(&mut *buf), self.sample_rate.load(Ordering::Relaxed))
    }

    /// Take everything captured so far (used by the transcription window).
    pub fn drain(&self) -> (Vec<f32>, u32) {
        let mut buf = self.mono.lock().unwrap_or_else(|p| p.into_inner());
        let out = std::mem::take(&mut *buf);
        (out, self.sample_rate.load(Ordering::Relaxed))
    }
}

pub type AudioState = Arc<AudioInner>;

/// Every CoreAudio device query in this process goes through here.
///
/// Why: on 2026-09-23 the booth came up frozen after a relaunch — window
/// painted, gateway port listening but never accepting, PP/PCO never
/// connected. `sample` showed the main thread parked in
/// `list_audio_inputs → cpal input_devices → AudioComponentInstanceNew →
/// mach_msg` waiting on coreaudiod, while the Settings page had *also* just
/// kicked off `start_audio_capture`, whose `find_device` walks the same
/// AudioUnit instantiation on another thread. AudioToolbox instantiates
/// components on a serial queue and the second caller waits "Synchronously";
/// with the main thread being one of the two callers, the process deadlocks.
/// Every Tauri IPC reply then queues behind the dead main thread, the tokio
/// workers block on those replies, and the web gateway's accept loop starves.
///
/// Fix, in three parts: (1) one mutex so device enumeration never runs
/// concurrently with itself; (2) run it on a blocking thread, never on the
/// main thread; (3) a hard timeout — if CoreAudio is wedged we return an
/// error and leak the stuck thread instead of taking the app down with it.
/// One CoreAudio query in flight at a time — but a query that has overrun
/// the timeout is treated as ABANDONED, not as holding the lock. On
/// 2026-09-23 the Dante Virtual Soundcard restarted while ProDeck was
/// enumerating devices; that one HAL call never returned, and with a plain
/// mutex every later audio call (including the meter's own start) queued
/// behind it forever. The wedged thread can't be cancelled, but nothing else
/// has to wait for it.
static IN_FLIGHT: Mutex<Option<(std::time::Instant, &'static str)>> = Mutex::new(None);
/// When the audio system last failed to answer, for the error text.
static STALLED_SINCE: Mutex<Option<std::time::Instant>> = Mutex::new(None);
/// Queries we gave up waiting for that are still running. Each one is a
/// blocked thread we cannot reclaim; past a handful we stop making more and
/// fail fast, so a wedged audio system can't drain tokio's blocking pool.
static ABANDONED: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
const MAX_ABANDONED: usize = 4;
const COREAUDIO_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);

fn claim(what: &'static str) -> Result<std::time::Instant, &'static str> {
    let mut g = IN_FLIGHT.lock().unwrap_or_else(|p| p.into_inner());
    match *g {
        Some((started, prev)) if started.elapsed() < COREAUDIO_TIMEOUT => Err(prev),
        _ => {
            let now = std::time::Instant::now();
            *g = Some((now, what));
            Ok(now)
        }
    }
}

fn release(mine: std::time::Instant) {
    let mut g = IN_FLIGHT.lock().unwrap_or_else(|p| p.into_inner());
    if matches!(*g, Some((started, _)) if started == mine) {
        *g = None;
    }
}

async fn coreaudio<T: Send + 'static>(
    what: &'static str,
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    use std::sync::atomic::Ordering::SeqCst;
    let stuck = ABANDONED.load(SeqCst);
    if stuck >= MAX_ABANDONED {
        return Err(format!(
            "{what}: the audio system is not answering ({stuck} calls still stuck). Restart the audio interface (Dante Virtual Soundcard) or ProDeck."
        ));
    }
    let job = tokio::task::spawn_blocking(move || {
        // Wait our turn for up to the timeout, then run. A previous query that
        // is past the timeout is abandoned and we go ahead beside it.
        let deadline = std::time::Instant::now() + COREAUDIO_TIMEOUT;
        let mine = loop {
            match claim(what) {
                Ok(t) => break t,
                Err(_) if std::time::Instant::now() < deadline => std::thread::sleep(std::time::Duration::from_millis(50)),
                Err(prev) => return Err(format!("{what}: still waiting on {prev}")),
            }
        };
        let out = f();
        release(mine);
        if mine.elapsed() >= COREAUDIO_TIMEOUT {
            // We were written off; the caller has long since been told no.
            ABANDONED.fetch_sub(1, SeqCst);
        }
        *STALLED_SINCE.lock().unwrap_or_else(|p| p.into_inner()) = None;
        Ok(out)
    });
    match tokio::time::timeout(COREAUDIO_TIMEOUT, job).await {
        Ok(Ok(Ok(v))) => Ok(v),
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(e)) => Err(format!("{what}: audio worker panicked: {e}")),
        Err(_) => {
            ABANDONED.fetch_add(1, SeqCst);
            let mut st = STALLED_SINCE.lock().unwrap_or_else(|p| p.into_inner());
            let since = st.get_or_insert_with(std::time::Instant::now).elapsed().as_secs();
            eprintln!("[audio] {what}: CoreAudio did not answer within {COREAUDIO_TIMEOUT:?} (stalled {since}s) — abandoning that call");
            Err(format!(
                "{what}: the audio system did not respond for {}s. ProDeck will keep trying; if it stays off, check the audio interface (Dante Virtual Soundcard) and Audio MIDI Setup.",
                COREAUDIO_TIMEOUT.as_secs()
            ))
        }
    }
}

#[tauri::command]
pub async fn list_audio_inputs() -> Result<Vec<String>, String> {
    coreaudio("list_audio_inputs", || {
        let host = cpal::default_host();
        let mut names = Vec::new();
        if let Ok(devices) = host.input_devices() {
            for d in devices {
                if let Ok(name) = d.name() {
                    names.push(name);
                }
            }
        }
        names
    })
    .await
}

#[tauri::command]
pub async fn default_audio_input() -> Option<String> {
    coreaudio("default_audio_input", || {
        cpal::default_host()
            .default_input_device()
            .and_then(|d| d.name().ok())
    })
    .await
    .ok()
    .flatten()
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
pub async fn start_audio_capture(
    device: Option<String>,
    state: tauri::State<'_, AudioState>,
    settings: tauri::State<'_, SettingsState>,
    app: AppHandle,
) -> Result<(), String> {
    // Device lookup + default config are the CoreAudio calls that can stall;
    // see `coreaudio()`. Opening the stream itself happens on the capture
    // thread below, which was never on the main thread.
    let (dev, config) = coreaudio("start_audio_capture", move || {
        let dev = find_device(&device).ok_or_else(|| "No matching input device".to_string())?;
        let config = dev
            .default_input_config()
            .map_err(|e| format!("input config: {e}"))?;
        Ok::<_, String>((dev, config))
    })
    .await??;

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
    let (click_idx, guide_idx, lapel_idx, mc_idx) = {
        let s = settings.lock().unwrap_or_else(|p| p.into_inner());
        let one = |c: u32| (c as usize).checked_sub(1).filter(|&i| i < channels);
        (one(s.follow_click_channel), one(s.follow_guide_channel), one(s.autopilot_lapel_audio), one(s.autopilot_mc_audio))
    };
    let (measure_idx, overflow_idx, caption_idx) = {
        let s = settings.lock().unwrap_or_else(|p| p.into_inner());
        // What Follow/captions hear: their own channels, else the Listen feed
        // (a board mix), else the measurement mix (room mics — worst for words).
        let cap = if !s.caption_channels.is_empty() { &s.caption_channels } else { &s.audio_overflow_channels };
        (
            Arc::new(to_idx(&s.audio_measure_channels)),
            Arc::new(to_idx(&s.audio_overflow_channels)),
            Arc::new(to_idx(cap)),
        )
    };
    let overflow_tx = state.overflow_tx.clone();
    let (weighting, freq_weighting) = {
        let g = settings.lock().unwrap_or_else(|p| p.into_inner());
        (
            TimeWeight::parse(&g.spl_time_weighting),
            FreqWeight::parse(&g.spl_freq_weighting),
        )
    };

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
        // The number the SPL readout and the service reports are built on —
        // one per curve, because A and C are both wanted at once: A is the
        // reading that compares to a published limit, and the gap between them
        // is the size of the low end, which A alone cannot show.
        let mut weighted = WeightedLevel::new();
        let mut weighted_a = WeightedLevel::new();
        let mut weighted_c = WeightedLevel::new();
        let mut weighter = Weighter::new(sample_rate as f64);
        let mut sumsq_a: f64 = 0.0;
        let mut sumsq_c: f64 = 0.0;
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
                let caption_idx = caption_idx.clone();
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
                        let mut caption: Vec<f32> = Vec::with_capacity(if caption_idx.is_empty() { 0 } else { frames });
                        let mut click_s: Vec<f32> = Vec::with_capacity(if click_idx.is_some() { frames } else { 0 });
                        let mut guide_s: Vec<f32> = Vec::with_capacity(if guide_idx.is_some() { frames } else { 0 });
                        let mut lapel_s: Vec<f32> = Vec::with_capacity(if lapel_idx.is_some() { frames } else { 0 });
                        let mut mc_s: Vec<f32> = Vec::with_capacity(if mc_idx.is_some() { frames } else { 0 });
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
                            // Both weighting curves run over the same mono
                            // measurement mix the unweighted level uses.
                            let (wa, wc) = weighter.process(s as f64);
                            sumsq_a += wa * wa;
                            sumsq_c += wc * wc;
                            if s.abs() > emit_peak {
                                emit_peak = s.abs();
                            }
                            if let Some(r) = meter.push(s as f64) {
                                lufs_out = Some(r);
                            }
                            chunk.push(s);
                            if let Some(i) = click_idx {
                                click_s.push(f32::from_sample(data[base + i]));
                            }
                            if let Some(i) = guide_idx {
                                guide_s.push(f32::from_sample(data[base + i]));
                            }
                            if let Some(i) = lapel_idx {
                                lapel_s.push(f32::from_sample(data[base + i]));
                            }
                            if let Some(i) = mc_idx {
                                mc_s.push(f32::from_sample(data[base + i]));
                            }
                            if !caption_idx.is_empty() {
                                let mut acc = 0.0f32;
                                for &i in caption_idx.iter() {
                                    acc += f32::from_sample(data[base + i]);
                                }
                                caption.push(acc / caption_idx.len() as f32);
                            }
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
                            buf.extend_from_slice(if caption_idx.is_empty() { &chunk } else { &caption });
                            let cap = sr * 30;
                            if buf.len() > cap {
                                let excess = buf.len() - cap;
                                buf.drain(0..excess);
                            }
                        }
                        for (dst, src) in [(&inner_cb.click, &click_s), (&inner_cb.guide, &guide_s), (&inner_cb.lapel, &lapel_s), (&inner_cb.mc, &mc_s)] {
                            if src.is_empty() {
                                continue;
                            }
                            let mut b = dst.lock().unwrap_or_else(|p| p.into_inner());
                            b.extend_from_slice(src);
                            let cap = sr * 30;
                            if b.len() > cap {
                                let excess = b.len() - cap;
                                b.drain(0..excess);
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
                            let mean_square = (emit_sumsq / emit_frames as f32) as f64;
                            let rms = (mean_square as f32).sqrt();
                            // Time-weighted, so the SPL figure behaves like the
                            // handheld meter it gets calibrated against instead
                            // of swaying several dB on a steady source.
                            let dt = emit_frames as f64 / sr as f64;
                            let n = emit_frames as f64;
                            let slow_z = weighted.push(mean_square, dt, weighting) as f32;
                            let slow_a = weighted_a.push(sumsq_a / n, dt, weighting) as f32;
                            let slow_c = weighted_c.push(sumsq_c / n, dt, weighting) as f32;
                            let slow = match freq_weighting {
                                FreqWeight::Z => slow_z,
                                FreqWeight::A => slow_a,
                                FreqWeight::C => slow_c,
                            };
                            // Latest level for pull-style readers (the Stream
                            // Deck SPL key polls the gateway; it can't ride
                            // the event stream).
                            LAST_RMS_BITS.store(slow.min(1.0).to_bits(), std::sync::atomic::Ordering::Relaxed);
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
                                        // Unweighted, for bar meters that should
                                        // move with the music.
                                        "rms": rms.min(1.0),
                                        // Time-weighted through the configured
                                        // curve; what SPL, tracking and the
                                        // alerts read.
                                        "slow": slow.min(1.0),
                                        // Both curves, always, so the readout
                                        // can show C-A without a second pass.
                                        "slowA": slow_a.min(1.0),
                                        "slowC": slow_c.min(1.0),
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
                            sumsq_a = 0.0;
                            sumsq_c = 0.0;
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
pub async fn audio_input_channels(device: Option<String>) -> u16 {
    coreaudio("audio_input_channels", move || {
        find_device(&device)
            .and_then(|d| d.default_input_config().ok())
            .map(|c| c.channels())
            .unwrap_or(0)
    })
    .await
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

#[cfg(test)]
mod weighting_tests {
    use super::{TimeWeight, WeightedLevel};

    /// How far the meter has travelled toward a step input after `windows`
    /// emit windows of 1/12 s each.
    fn step_response(w: TimeWeight, windows: usize) -> f64 {
        let mut m = WeightedLevel::new();
        let dt = 1.0 / 12.0;
        // Seed at silence, then step to full scale, so the first window does
        // not simply prime the average at the target.
        m.push(0.0, dt, w);
        let mut rms = 0.0;
        for _ in 0..windows {
            rms = m.push(1.0, dt, w);
        }
        rms
    }

    #[test]
    fn slow_is_one_second_and_fast_is_125ms() {
        // IEC 61672's two standard time constants. If these drift, every SPL
        // calibration in the field silently becomes wrong.
        assert_eq!(TimeWeight::Slow.tau_secs(), 1.0);
        assert_eq!(TimeWeight::Fast.tau_secs(), 0.125);
    }

    #[test]
    fn one_time_constant_reaches_most_of_the_way() {
        // A single-pole filter covers 1 - 1/e (63.2%) of a step in one tau.
        // Mean square, so the RMS reading is the square root of that.
        let ms_expected = 1.0 - (-1.0f64).exp();
        let slow = step_response(TimeWeight::Slow, 12); // 1 s
        assert!((slow - ms_expected.sqrt()).abs() < 0.02, "slow {slow}");
        let fast = step_response(TimeWeight::Fast, 2); // ~167 ms
        assert!(fast > slow, "fast must react sooner: fast {fast} slow {slow}");
    }

    #[test]
    fn a_steady_source_reads_steady() {
        // The actual complaint: a stable source swaying several dB. Feed it
        // window-to-window variation of the size 83 ms of pink noise really
        // produces and check the reading barely moves.
        let mut m = WeightedLevel::new();
        let dt = 1.0 / 12.0;
        let target = 0.01f64; // mean square of a steady tone
        let mut raw_db: Vec<f64> = vec![];
        let mut weighted_db: Vec<f64> = vec![];
        // Deterministic wobble of +/-40% in mean square == +/-1.5 dB raw.
        for i in 0..120 {
            let wobble = 1.0 + 0.4 * ((i as f64) * 1.7).sin();
            let ms = target * wobble;
            raw_db.push(10.0 * ms.log10());
            let r = m.push(ms, dt, TimeWeight::Slow);
            if i > 24 {
                weighted_db.push(20.0 * r.log10());
            }
        }
        let spread = |v: &[f64]| v.iter().cloned().fold(f64::MIN, f64::max)
            - v.iter().cloned().fold(f64::MAX, f64::min);
        let raw = spread(&raw_db);
        let smooth = spread(&weighted_db);
        assert!(raw > 2.5, "the raw window should swing: {raw:.2} dB");
        assert!(smooth < 1.0, "weighted should be steady: {smooth:.2} dB");
    }

    #[test]
    fn it_starts_at_the_real_level_not_at_silence() {
        // Seeding matters: without it the meter climbs out of silence for a
        // second after capture starts, which reads as a dead feed.
        let mut m = WeightedLevel::new();
        let first = m.push(0.25, 1.0 / 12.0, TimeWeight::Slow);
        assert!((first - 0.5).abs() < 1e-9, "first reading {first}");
    }

    #[test]
    fn unknown_weighting_names_fall_back_to_slow() {
        assert_eq!(TimeWeight::parse("fast"), TimeWeight::Fast);
        assert_eq!(TimeWeight::parse("Fast"), TimeWeight::Fast);
        assert_eq!(TimeWeight::parse("slow"), TimeWeight::Slow);
        assert_eq!(TimeWeight::parse(""), TimeWeight::Slow);
        assert_eq!(TimeWeight::parse("nonsense"), TimeWeight::Slow);
    }
}

#[cfg(test)]
mod weighting_curve_tests {
    use super::{a_weighting, c_weighting, cascade_gain};

    fn db(filters: &[super::Biquad], fs: f64, f: f64) -> f64 {
        20.0 * cascade_gain(filters, fs, f).log10()
    }

    /// The published IEC 61672 A- and C-weighting tables. If the filter design
    /// drifts, every SPL number ProDeck reports drifts with it — silently,
    /// because a weighted reading looks exactly as plausible as a correct one.
    ///
    /// Tolerances here are what this design actually achieves, not the
    /// standard's class-1 allowance, so a regression is caught while still
    /// well inside spec. Accuracy is 0.16 dB or better everywhere below 2 kHz
    /// at both 44.1 and 48 kHz; it loosens above that and falls apart near
    /// Nyquist (16 kHz reads several dB low), which is inherent to designing
    /// these curves by bilinear transform and irrelevant to a broadband SPL
    /// reading — a worship mix has almost no energy up there, and what there
    /// is, A-weighting is discarding anyway.
    #[test]
    fn a_weighting_matches_the_standard() {
        for fs in [44100.0, 48000.0] {
            let f = a_weighting(fs);
            for (hz, want, tol) in [
                (31.5, -39.4, 0.25),
                (63.0, -26.2, 0.15),
                (125.0, -16.1, 0.2),
                (250.0, -8.6, 0.2),
                (500.0, -3.2, 0.15),
                (1000.0, 0.0, 0.02),
                (2000.0, 1.2, 0.15),
                (4000.0, 1.0, 0.4),
                // Class 1 allows +1.5/-2.5 dB here; we are inside 0.8.
                (8000.0, -1.1, 0.9),
            ] {
                let got = db(&f, fs, hz);
                assert!(
                    (got - want).abs() < tol,
                    "A at {hz} Hz / {fs}: got {got:.2} dB, table says {want} (±{tol})"
                );
            }
        }
    }

    #[test]
    fn c_weighting_matches_the_standard() {
        for fs in [44100.0, 48000.0] {
            let f = c_weighting(fs);
            for (hz, want, tol) in [
                (31.5, -3.0, 0.15),
                (63.0, -0.8, 0.15),
                (125.0, -0.2, 0.05),
                (1000.0, 0.0, 0.02),
                (4000.0, -0.8, 0.4),
                (8000.0, -3.0, 0.9),
            ] {
                let got = db(&f, fs, hz);
                assert!(
                    (got - want).abs() < tol,
                    "C at {hz} Hz / {fs}: got {got:.2} dB, table says {want} (±{tol})"
                );
            }
        }
    }

    /// The whole reason C is measured alongside A: it keeps the bottom end.
    /// A kick drum's fundamental reads ~25 dB lower through A than through C,
    /// which is why a bass-heavy mix can look fine on an A-weighted meter.
    #[test]
    fn c_minus_a_is_the_size_of_the_bottom_end() {
        let fs = 48000.0;
        let (a, c) = (a_weighting(fs), c_weighting(fs));
        let spread = db(&c, fs, 63.0) - db(&a, fs, 63.0);
        assert!(spread > 24.0, "C-A at 63 Hz should be large, got {spread:.1} dB");
        // And essentially nothing where both are flat.
        let mid = db(&c, fs, 1000.0) - db(&a, fs, 1000.0);
        assert!(mid.abs() < 0.1, "C-A at 1 kHz should vanish, got {mid:.2} dB");
    }

    #[test]
    fn both_curves_are_unity_at_the_reference_frequency() {
        // A weighting curve that is not 0 dB at 1 kHz shifts every reading by
        // a constant, which calibration would silently absorb and then be
        // wrong by the same amount at every other frequency.
        for fs in [44100.0, 48000.0] {
            assert!((cascade_gain(&a_weighting(fs), fs, 1000.0) - 1.0).abs() < 0.001);
            assert!((cascade_gain(&c_weighting(fs), fs, 1000.0) - 1.0).abs() < 0.001);
        }
    }
}
