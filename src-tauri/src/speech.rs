//! Autopilot's ears on the speech mics (lapel, MC): a speech meter and a
//! feedback guard, from their pre-fader feeds.
//!
//! Every 100 ms per mic: `autopilot:speech` { mic, db } (RMS dBFS of the last
//! 100 ms). Feedback — one tone standing far above the rest of the spectrum,
//! at the same pitch for 400 ms and not fading — raises `autopilot:ring`
//! { mic, hz, db } (at most every 3 s). Speech doesn't do that: a voice's
//! harmonics move, and there are many of them.

use crate::audio::AudioState;
use rustfft::{num_complex::Complex, FftPlanner};
use tauri::{AppHandle, Emitter, Manager};

const N: usize = 4096;

struct Ring {
    buf: std::collections::VecDeque<f32>,
    hit: Option<(usize, u32, f32)>, // (bin, frames, last peak dB)
    last_alarm: u64,
    median: f32,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("autopilot-speech".into())
        .spawn(move || {
            let mut planner = FftPlanner::<f32>::new();
            let fft = planner.plan_fft_forward(N);
            let hann: Vec<f32> = (0..N).map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / N as f32).cos()).collect();
            let mut rings = [
                Ring { buf: Default::default(), hit: None, last_alarm: 0, median: 0.0 },
                Ring { buf: Default::default(), hit: None, last_alarm: 0, median: 0.0 },
            ];
            loop {
                std::thread::sleep(std::time::Duration::from_millis(100));
                let on = {
                    let st = app.state::<crate::settings::SettingsState>();
                    let s = st.lock().unwrap_or_else(|p| p.into_inner());
                    s.autopilot_speech
                };
                let audio = app.state::<AudioState>().inner().clone();
                for (k, mic) in ["lapel", "mc"].iter().enumerate() {
                    let (xs, sr) = audio.drain_speech(k == 0);
                    if !on || sr == 0 || xs.is_empty() {
                        continue;
                    }
                    let rms = (xs.iter().map(|v| v * v).sum::<f32>() / xs.len() as f32).sqrt();
                    let db = 20.0 * rms.max(1e-9).log10();
                    app.emit("autopilot:speech", serde_json::json!({ "mic": mic, "db": db })).ok();
                    let r = &mut rings[k];
                    r.buf.extend(xs.iter().copied());
                    while r.buf.len() > N {
                        r.buf.pop_front();
                    }
                    if r.buf.len() < N || db < -45.0 {
                        r.hit = None;
                        continue;
                    }
                    let bin_hz = sr as f32 / N as f32;
                    detect(r, &fft, &hann, sr);
                    if let Some((b, n, p)) = r.hit {
                        let t = now_ms();
                        if n >= 4 && t - r.last_alarm > 3000 {
                            r.last_alarm = t;
                            app.emit("autopilot:ring", serde_json::json!({ "mic": mic, "hz": (b as f32 * bin_hz).round(), "db": p - r.median })).ok();
                        }
                    }
                }
            }
        })
        .ok();
}

/// One analysis frame over the ring's last N samples: updates `r.hit` with a
/// candidate ringing bin (same bin ±2, not fading, prominent and isolated).
fn detect(r: &mut Ring, fft: &std::sync::Arc<dyn rustfft::Fft<f32>>, hann: &[f32], sr: u32) {
    let mut spec: Vec<Complex<f32>> = r.buf.iter().zip(hann).map(|(x, w)| Complex::new(x * w, 0.0)).collect();
    fft.process(&mut spec);
    let bin_hz = sr as f32 / N as f32;
    let lo = (150.0 / bin_hz) as usize;
    let hi = ((10_000.0 / bin_hz) as usize).min(N / 2 - 1);
    let mags: Vec<f32> = spec[lo..hi].iter().map(|c| 20.0 * (c.norm() + 1e-9).log10()).collect();
    let (pk_i, pk) = mags.iter().enumerate().fold((0, f32::MIN), |a, (i, &m)| if m > a.1 { (i, m) } else { a });
    let mut sorted = mags.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = sorted[sorted.len() / 2];
    let second = mags.iter().enumerate().filter(|(i, _)| (*i as isize - pk_i as isize).abs() > 3).map(|(_, &m)| m).fold(f32::MIN, f32::max);
    let prominent = pk - median >= 30.0 && pk - second >= 12.0;
    let bin = pk_i + lo;
    r.hit = match (prominent, r.hit) {
        (true, Some((b, n, last))) if (b as isize - bin as isize).abs() <= 2 && pk >= last - 1.5 => Some((bin, n + 1, pk)),
        (true, _) => Some((bin, 1, pk)),
        _ => None,
    };
    r.median = median;
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(xs: &[f32], sr: u32) -> Vec<f32> {
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(N);
        let hann: Vec<f32> = (0..N).map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / N as f32).cos()).collect();
        let mut r = Ring { buf: Default::default(), hit: None, last_alarm: 0, median: 0.0 };
        let hop = sr as usize / 10;
        let mut alarms = Vec::new();
        for (k, chunk) in xs.chunks(hop).enumerate() {
            r.buf.extend(chunk.iter().copied());
            while r.buf.len() > N {
                r.buf.pop_front();
            }
            let rms = (chunk.iter().map(|v| v * v).sum::<f32>() / chunk.len() as f32).sqrt();
            if r.buf.len() < N || 20.0 * rms.max(1e-9).log10() < -45.0 {
                r.hit = None;
                continue;
            }
            detect(&mut r, &fft, &hann, sr);
            if let Some((b, n, _)) = r.hit {
                let t = 10_000 + k as u64 * 100;
                if n >= 4 && t - r.last_alarm > 3000 {
                    r.last_alarm = t;
                    alarms.push(b as f32 * sr as f32 / N as f32);
                }
            }
        }
        alarms
    }
    #[test]
    fn a_ringing_tone_is_caught_within_half_a_second() {
        let sr = 48000;
        // Speech-ish noise, then a 2.5 kHz tone swelling in on top of it.
        let mut seed = 1u32;
        let xs: Vec<f32> = (0..sr as usize * 2)
            .map(|i| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let noise = ((seed >> 8) as f32 / (1u32 << 24) as f32 - 0.5) * 0.05;
                let t = i as f32 / sr as f32;
                let tone = if t > 1.0 { 0.3 * ((t - 1.0) * 2.0).min(1.0) * (2.0 * std::f32::consts::PI * 2500.0 * t).sin() } else { 0.0 };
                noise + tone
            })
            .collect();
        let a = run(&xs, sr);
        assert_eq!(a.len(), 1, "one alarm: {a:?}");
        assert!((a[0] - 2500.0).abs() < 30.0);
    }
    /// `VOICE_WAV=... cargo test --lib voice_is_not_feedback -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn voice_is_not_feedback() {
        let path = std::env::var("VOICE_WAV").expect("VOICE_WAV");
        let mut rd = hound::WavReader::open(path).unwrap();
        let sr = rd.spec().sample_rate;
        let xs: Vec<f32> = rd.samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect();
        let a = run(&xs, sr);
        println!("false alarms: {} {:?}", a.len(), a);
    }
}
