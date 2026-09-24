//! The playback rig's click, turned into beats (Auto-Follow).
//!
//! A click track is the easiest signal in the building to read: sharp
//! transients on a silent channel. Each one becomes a `follow:beat` event with
//! its wall-clock time, strength and a pitch proxy (zero crossings) — a
//! MultiTracks click accents the downbeat with a higher click, which is how
//! Follow knows where the bar starts. Tempo and bar logic live in the
//! frontend engine (testable there); this only finds the clicks.

pub struct Onset {
    /// Sample index since the detector started.
    pub at: u64,
    pub strength: f32,
    /// Zero crossings per millisecond in the 15 ms after the onset.
    pub zcr: f32,
}

pub struct ClickDetector {
    sr: u32,
    block: usize,
    prev_x: f32,
    acc: f32,
    in_block: usize,
    n: u64,
    noise: f32,
    peak: f32,
    above: bool,
    last_onset: Option<u64>,
    /// Samples after a fresh onset still being measured: (onset, buffer).
    pending: Option<(u64, f32, Vec<f32>)>,
}

impl ClickDetector {
    pub fn new(sr: u32) -> Self {
        Self {
            sr,
            block: (sr as usize / 500).max(1), // 2 ms
            prev_x: 0.0,
            acc: 0.0,
            in_block: 0,
            n: 0,
            noise: 1e-4,
            peak: 0.0,
            above: false,
            last_onset: None,
            pending: None,
        }
    }

    pub fn push(&mut self, xs: &[f32]) -> Vec<Onset> {
        let mut out = Vec::new();
        let feat_len = self.sr as usize * 15 / 1000;
        for &x in xs {
            // Finish measuring a pending onset's timbre.
            if let Some((at, strength, buf)) = self.pending.as_mut() {
                buf.push(x);
                if buf.len() >= feat_len {
                    let zc = buf.windows(2).filter(|w| (w[0] >= 0.0) != (w[1] >= 0.0)).count() as f32;
                    out.push(Onset { at: *at, strength: *strength, zcr: zc / 15.0 });
                    self.pending = None;
                }
            }
            // First difference = a crude high-pass: clicks light up, hum doesn't.
            let y = (x - self.prev_x).abs();
            self.prev_x = x;
            self.acc = self.acc.max(y);
            self.in_block += 1;
            self.n += 1;
            if self.in_block < self.block {
                continue;
            }
            let env = self.acc;
            self.acc = 0.0;
            self.in_block = 0;
            // Peak decays over ~2 s; the noise floor follows quiet blocks.
            self.peak = (self.peak * 0.998).max(env);
            let thr = (self.noise * 6.0).max(self.peak * 0.3).max(0.002);
            let refractory = self.sr as u64 / 8; // 125 ms
            let is_above = env > thr;
            if is_above && !self.above && self.last_onset.map(|l| self.n - l > refractory).unwrap_or(true) {
                self.last_onset = Some(self.n);
                let at = self.n.saturating_sub(self.block as u64);
                self.pending = Some((at, env, Vec::with_capacity(feat_len)));
            }
            if !is_above {
                self.noise = self.noise * 0.995 + env * 0.005;
            }
            self.above = is_above;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn click(sr: u32, hz: f32, ms: f32) -> Vec<f32> {
        let n = (sr as f32 * ms / 1000.0) as usize;
        (0..n)
            .map(|i| {
                let t = i as f32 / sr as f32;
                (2.0 * std::f32::consts::PI * hz * t).sin() * (-t * 300.0).exp() * 0.5
            })
            .collect()
    }

    #[test]
    fn finds_each_click_and_tells_the_accent() {
        let sr = 48000;
        let beat = (sr as f32 * 0.5) as usize; // 120 BPM
        let mut sig = vec![0f32; beat * 8];
        for b in 0..8 {
            let hz = if b % 4 == 0 { 2000.0 } else { 1000.0 };
            for (k, v) in click(sr, hz, 30.0).into_iter().enumerate() {
                sig[b * beat + 1000 + k] += v;
            }
        }
        let mut d = ClickDetector::new(sr);
        let mut on = Vec::new();
        for chunk in sig.chunks(512) {
            on.extend(d.push(chunk));
        }
        assert_eq!(on.len(), 8, "one onset per click");
        let gap = (on[1].at - on[0].at) as f32 / sr as f32;
        assert!((gap - 0.5).abs() < 0.01, "0.5 s apart: {gap}");
        assert!(on[0].zcr > on[1].zcr * 1.5, "downbeat click is higher: {} vs {}", on[0].zcr, on[1].zcr);
        assert!(on[4].zcr > on[5].zcr * 1.5);
    }

    /// Prints the onsets of a real file: `CLICK_WAV=... cargo test --lib real_click -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_click() {
        let path = std::env::var("CLICK_WAV").expect("CLICK_WAV");
        let mut r = hound::WavReader::open(path).unwrap();
        let sr = r.spec().sample_rate;
        let xs: Vec<f32> = r.samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect();
        let mut d = ClickDetector::new(sr);
        let on = d.push(&xs);
        println!("{} onsets", on.len());
        if let Ok(out) = std::env::var("CLICK_JSON") {
            let v: Vec<serde_json::Value> = on.iter().map(|o| serde_json::json!({ "t": (o.at as f64 * 1000.0 / sr as f64).round(), "strength": o.strength, "zcr": o.zcr })).collect();
            std::fs::write(out, serde_json::to_string(&v).unwrap()).unwrap();
        }
        for o in on.iter().take(40) {
            println!("{:8.3}s  str {:.3}  zcr {:.2}", o.at as f32 / sr as f32, o.strength, o.zcr);
        }
    }
}
