//! The weekly stream report's recorder: one row a second of the stream mix
//! (the input channels in `stream_report_channels`) whenever it carries
//! sound — loudness (BS.1770, 1 s blocks), sample peak, L/R correlation, and
//! nine octave bands relative to the whole. Rows go to
//! `<config>/stream-report/<id>.json`; the Analytics page does the judging
//! (src/lib/streamReport.ts), so the numbers can be re-read as it learns.
//!
//! A session starts with the first second of sound and ends after 20 minutes
//! of silence; a relaunch inside that window picks the session back up.
//! Sessions with under 10 minutes of sound are thrown away (a line check).

use crate::audio::{kweight_filters, AudioState, Biquad};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

/// Octave centres — the same bands the reference mix was measured in.
pub const BANDS: [f64; 9] = [60.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 12000.0];
const SOUND_LUFS: f64 = -60.0;
const END_AFTER_S: u64 = 20 * 60;
const MIN_SOUND_S: usize = 10 * 60;

fn dir() -> std::path::PathBuf {
    let d = crate::settings::config_dir().join("stream-report");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn now_s() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// RBJ band-pass, constant 0 dB peak, one octave wide.
fn octave(fs: f64, f: f64) -> Biquad {
    let w0 = 2.0 * std::f64::consts::PI * f / fs;
    let (sn, cs) = (w0.sin(), w0.cos());
    let alpha = sn * ((2f64.ln() / 2.0) * 1.0 * w0 / sn).sinh();
    let a0 = 1.0 + alpha;
    Biquad::new(alpha / a0, 0.0, -alpha / a0, -2.0 * cs / a0, (1.0 - alpha) / a0)
}

struct Filters {
    fs: u32,
    kl: (Biquad, Biquad),
    kr: (Biquad, Biquad),
    bands: Vec<Biquad>,
}
impl Filters {
    fn new(fs: u32) -> Self {
        let f = fs as f64;
        Self { fs, kl: kweight_filters(f), kr: kweight_filters(f), bands: BANDS.iter().filter(|&&b| b < f * 0.45).map(|&b| octave(f, b)).collect() }
    }
}

/// One second's measurements from interleaved L/R samples.
#[derive(Default)]
struct Acc {
    n: usize,
    kl: f64,
    kr: f64,
    lr: f64,
    ll: f64,
    rr: f64,
    mid: f64,
    peak: f32,
    bands: [f64; 9],
}
impl Acc {
    fn push(&mut self, f: &mut Filters, xs: &[f32]) {
        for p in xs.chunks_exact(2) {
            let (l, r) = (p[0] as f64, p[1] as f64);
            let yl = f.kl.1.process(f.kl.0.process(l));
            let yr = f.kr.1.process(f.kr.0.process(r));
            self.kl += yl * yl;
            self.kr += yr * yr;
            self.lr += l * r;
            self.ll += l * l;
            self.rr += r * r;
            let m = 0.5 * (l + r);
            self.mid += m * m;
            for (i, b) in f.bands.iter_mut().enumerate() {
                let y = b.process(m);
                self.bands[i] += y * y;
            }
            self.peak = self.peak.max(p[0].abs()).max(p[1].abs());
            self.n += 1;
        }
    }
    /// [t, lufs, peak dBFS, corr, band dB relative to the whole ×9]
    fn row(&self, t: u64, nb: usize) -> Vec<f64> {
        let n = self.n.max(1) as f64;
        let r1 = |x: f64| (x * 10.0).round() / 10.0;
        let lufs = -0.691 + 10.0 * ((self.kl + self.kr) / n).max(1e-12).log10();
        let peak = 20.0 * (self.peak as f64).max(1e-9).log10();
        let corr = if self.ll > 0.0 && self.rr > 0.0 { self.lr / (self.ll * self.rr).sqrt() } else { 1.0 };
        let mut row = vec![t as f64, r1(lufs), r1(peak), (corr * 1000.0).round() / 1000.0];
        for i in 0..9 {
            row.push(if i < nb && self.mid > 0.0 { r1(10.0 * (self.bands[i] / self.mid).max(1e-12).log10()) } else { -99.0 });
        }
        row
    }
}

struct Session {
    id: String,
    start: u64,
    rows: Vec<Vec<f64>>,
    last_sound: u64,
    offset_db: f32,
}

fn session_value(s: &Session) -> Value {
    json!({ "id": s.id, "start": s.start, "bands": BANDS, "offsetDb": s.offset_db, "cols": ["t", "lufs", "peak", "corr", "b60", "b125", "b250", "b500", "b1k", "b2k", "b4k", "b8k", "b12k"], "rows": s.rows })
}

fn sound_secs(s: &Session) -> usize {
    s.rows.iter().filter(|r| r[1] > SOUND_LUFS).count()
}

fn write(s: &Session) {
    let d = dir();
    let body = session_value(s).to_string();
    let tmp = d.join(format!("{}.json.tmp", s.id));
    if std::fs::write(&tmp, body).is_ok() {
        let _ = std::fs::rename(&tmp, d.join(format!("{}.json", s.id)));
    }
    let end = s.rows.last().map(|r| r[0] as u64).unwrap_or(s.start);
    let meta = json!({ "id": s.id, "start": s.start, "end": end, "soundSecs": sound_secs(s) });
    let tmp = d.join(format!("{}.meta.tmp", s.id));
    if std::fs::write(&tmp, meta.to_string()).is_ok() {
        let _ = std::fs::rename(&tmp, d.join(format!("{}.meta", s.id)));
    }
}

fn finish(s: Session) {
    if sound_secs(&s) < MIN_SOUND_S {
        let d = dir();
        let _ = std::fs::remove_file(d.join(format!("{}.json", s.id)));
        let _ = std::fs::remove_file(d.join(format!("{}.meta", s.id)));
        return;
    }
    write(&s);
}

/// A session that ended inside the last 20 minutes (the app relaunched mid-service).
fn resume() -> Option<Session> {
    let d = dir();
    let mut metas: Vec<Value> = std::fs::read_dir(&d)
        .ok()?
        .flatten()
        .filter(|e| e.path().extension().map(|x| x == "meta").unwrap_or(false))
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .filter_map(|t| serde_json::from_str(&t).ok())
        .collect();
    metas.sort_by_key(|m| m["end"].as_u64().unwrap_or(0));
    let m = metas.pop()?;
    if now_s().saturating_sub(m["end"].as_u64()?) > END_AFTER_S {
        return None;
    }
    let id = m["id"].as_str()?.to_string();
    let v: Value = serde_json::from_str(&std::fs::read_to_string(d.join(format!("{id}.json"))).ok()?).ok()?;
    let rows: Vec<Vec<f64>> = serde_json::from_value(v["rows"].clone()).ok()?;
    let last_sound = rows.iter().rev().find(|r| r[1] > SOUND_LUFS).map(|r| r[0] as u64).unwrap_or(0);
    Some(Session { id, start: v["start"].as_u64()?, rows, last_sound, offset_db: v["offsetDb"].as_f64().unwrap_or(0.0) as f32 })
}

pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("stream-report".into())
        .spawn(move || {
            let mut filters: Option<Filters> = None;
            let mut acc = Acc::default();
            let mut session = resume();
            let mut last_write = now_s();
            loop {
                std::thread::sleep(std::time::Duration::from_millis(250));
                let (on, offset) = {
                    let st = app.state::<crate::settings::SettingsState>();
                    let s = st.lock().unwrap_or_else(|p| p.into_inner());
                    (s.stream_report_on && !s.stream_report_channels.is_empty(), s.stream_report_offset_db)
                };
                let audio = app.state::<AudioState>().inner().clone();
                let (xs, sr) = audio.drain_stream();
                let now = now_s();
                if on && sr > 0 && !xs.is_empty() {
                    if filters.as_ref().map(|f| f.fs != sr).unwrap_or(true) {
                        filters = Some(Filters::new(sr));
                        acc = Acc::default();
                    }
                    let f = filters.as_mut().unwrap();
                    acc.push(f, &xs);
                    if acc.n >= sr as usize {
                        let row = acc.row(now, f.bands.len());
                        acc = Acc::default();
                        let sound = row[1] > SOUND_LUFS;
                        if session.is_none() && sound {
                            let id = format!("s{now}");
                            session = Some(Session { id, start: now, rows: Vec::new(), last_sound: now, offset_db: offset });
                        }
                        if let Some(s) = session.as_mut() {
                            if sound {
                                s.last_sound = now;
                            }
                            s.offset_db = offset;
                            s.rows.push(row);
                        }
                    }
                }
                // Silence (or no feed at all) for 20 minutes ends the session.
                if session.as_ref().map(|s| now.saturating_sub(s.last_sound) > END_AFTER_S).unwrap_or(false) {
                    // Drop the trailing silence so the timeline ends with the service.
                    let mut s = session.take().unwrap();
                    let last = s.last_sound;
                    s.rows.retain(|r| (r[0] as u64) <= last + 5);
                    finish(s);
                } else if now - last_write >= 60 {
                    last_write = now;
                    if let Some(s) = session.as_ref() {
                        if sound_secs(s) >= 60 {
                            write(s);
                        }
                    }
                }
            }
        })
        .ok();
}

#[tauri::command]
pub fn stream_reports_list() -> Vec<Value> {
    let mut out: Vec<Value> = std::fs::read_dir(dir())
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().extension().map(|x| x == "meta").unwrap_or(false))
                .filter_map(|e| std::fs::read_to_string(e.path()).ok())
                .filter_map(|t| serde_json::from_str::<Value>(&t).ok())
                .collect()
        })
        .unwrap_or_default();
    out.sort_by_key(|m| std::cmp::Reverse(m["start"].as_u64().unwrap_or(0)));
    out
}

#[tauri::command]
pub fn stream_report_get(id: String) -> Result<Value, String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("bad id".into());
    }
    let t = std::fs::read_to_string(dir().join(format!("{id}.json"))).map_err(|e| e.to_string())?;
    serde_json::from_str(&t).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tone_lands_in_its_band_and_a_mono_feed_reads_as_one() {
        let fs = 48_000u32;
        let mut f = Filters::new(fs);
        let mut a = Acc::default();
        let xs: Vec<f32> = (0..fs as usize).flat_map(|i| {
            let v = 0.1 * (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / fs as f32).sin();
            [v, v]
        }).collect();
        a.push(&mut f, &xs);
        let row = a.row(0, f.bands.len());
        assert!((row[3] - 1.0).abs() < 0.001, "corr {}", row[3]);
        assert!(row[8] > -1.0, "1k band {}", row[8]); // nearly all of it
        assert!(row[4] < -15.0 && row[12] < -15.0, "60 Hz {} / 12 kHz {}", row[4], row[12]);
        // A -20 dBFS sine: about -20 + 0.7 (K-weighting at 1 kHz) + 3 (two channels) − 3 (sine RMS) LUFS.
        assert!((row[1] - (-20.0 - 0.691 + 0.0)).abs() < 1.5, "lufs {}", row[1]);
    }
}
