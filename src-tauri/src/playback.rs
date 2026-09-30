//! Soundcheck playback: a recorded service played back out of an audio device
//! (Dante Virtual Soundcard), each track on the output channel the console's
//! Virtual SoundCheck expects, so the band can be mixed without the band.
//!
//! Nothing here touches the console or Dante. What reaches the desk is decided
//! by the Dante subscriptions a person applies from the patch sheet; until
//! then these outputs go nowhere. The sheet itself is worked out in the front
//! end (lib/soundcheckSheet.ts) from what the recorder and the show file know.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// Frames per block from the reader thread to the audio callback.
const BLOCK: usize = 2048;
/// Blocks queued ahead of the callback (~1.4 s at 48 kHz): room for a slow disk.
const QUEUE: usize = 32;

struct Player {
    stop: Arc<AtomicBool>,
    /// Frames played since `from`.
    played: Arc<AtomicU64>,
    from_frame: u64,
    sr: u32,
    dir: String,
    device: String,
    done: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
    /// Peak per output channel since the last status (0..1).
    peaks: Arc<Mutex<Vec<f32>>>,
}

#[derive(Default)]
pub struct PlayState(Mutex<Option<Player>>);

/// One track of a recorded session.
#[derive(Clone)]
struct Track {
    n: u32,
    name: String,
    file: PathBuf,
}

/// "09 Kick IN.wav" → (9, "Kick IN").
fn parse_track_file(name: &str) -> Option<(u32, String)> {
    let stem = name.strip_suffix(".wav")?;
    let (num, rest) = stem.split_once(' ')?;
    let n: u32 = num.parse().ok()?;
    Some((n, rest.trim().to_string()))
}

/// The session's tracks: from session.json when there is one, else the WAV
/// files themselves (older sessions, and one cut short by a lost drive).
fn tracks_of(dir: &Path) -> (Vec<Track>, Value) {
    let session: Value = std::fs::read_to_string(dir.join("session.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if let Some((n, tname)) = parse_track_file(&name) {
                out.push(Track { n, name: tname, file: e.path() });
            }
        }
    }
    out.sort_by_key(|t| t.n);
    (out, session)
}

fn markers_of(dir: &Path, session: &Value) -> Vec<Value> {
    if let Some(m) = session["markers"].as_array() {
        return m.clone();
    }
    // markers.csv: "seconds,text"
    std::fs::read_to_string(dir.join("markers.csv"))
        .ok()
        .map(|t| {
            t.lines()
                .skip(1)
                .filter_map(|l| {
                    let (a, b) = l.split_once(',')?;
                    Some(json!({ "t": a.trim().parse::<f64>().ok()?, "text": b.trim().trim_matches('"') }))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// A recorded session, ready to play: its tracks, length, markers, and the
/// routing saved when it was recorded (null for sessions before that existed).
#[tauri::command]
pub fn playback_session(dir: String) -> Result<Value, String> {
    let d = PathBuf::from(&dir);
    let (tracks, session) = tracks_of(&d);
    if tracks.is_empty() {
        return Err("No tracks in this folder.".into());
    }
    let first = hound::WavReader::open(&tracks[0].file).map_err(|e| format!("{}: {e}", tracks[0].name))?;
    let spec = first.spec();
    let frames = first.duration();
    Ok(json!({
        "dir": dir,
        "label": session["label"].as_str().unwrap_or_else(|| d.file_name().and_then(|n| n.to_str()).unwrap_or("")),
        "sampleRate": spec.sample_rate,
        "seconds": frames as f64 / spec.sample_rate.max(1) as f64,
        "tracks": tracks.iter().map(|t| json!({ "n": t.n, "name": t.name })).collect::<Vec<_>>(),
        "markers": markers_of(&d, &session),
        "routing": session["routing"].clone(),
    }))
}

/// Output devices and how many channels each has.
#[tauri::command]
pub fn playback_outputs() -> Vec<Value> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let mut out = vec![];
    if let Ok(devs) = host.output_devices() {
        for d in devs {
            let Ok(name) = d.name() else { continue };
            let ch = d.supported_output_configs().ok().map(|cs| cs.map(|c| c.channels()).max().unwrap_or(0)).unwrap_or(0);
            if ch > 0 {
                out.push(json!({ "name": name, "channels": ch }));
            }
        }
    }
    out
}

/// Read every routed track from `from_frame`, interleave into the output's
/// channel layout, and queue blocks for the audio callback.
fn reader_loop(tracks: Vec<(Track, usize)>, out_ch: usize, from_frame: u64, tx: std::sync::mpsc::SyncSender<Vec<f32>>, stop: Arc<AtomicBool>, error: Arc<Mutex<Option<String>>>) {
    let mut readers = vec![];
    for (t, out) in tracks {
        match hound::WavReader::open(&t.file) {
            Ok(mut r) => {
                let spec = r.spec();
                if r.seek(from_frame.min(r.duration() as u64) as u32).is_err() {
                    *error.lock().unwrap_or_else(|p| p.into_inner()) = Some(format!("{}: couldn't seek", t.name));
                    continue;
                }
                readers.push((r, spec, out, t.name));
            }
            Err(e) => *error.lock().unwrap_or_else(|p| p.into_inner()) = Some(format!("{}: {e}", t.name)),
        }
    }
    loop {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        let mut block = vec![0f32; BLOCK * out_ch];
        let mut longest = 0usize;
        for (r, spec, out, _) in readers.iter_mut() {
            let mut i = 0usize;
            match spec.sample_format {
                hound::SampleFormat::Int => {
                    let scale = 1.0 / (1u64 << (spec.bits_per_sample - 1)) as f32;
                    for s in r.samples::<i32>().take(BLOCK) {
                        block[i * out_ch + *out] = s.unwrap_or(0) as f32 * scale;
                        i += 1;
                    }
                }
                hound::SampleFormat::Float => {
                    for s in r.samples::<f32>().take(BLOCK) {
                        block[i * out_ch + *out] = s.unwrap_or(0.0);
                        i += 1;
                    }
                }
            }
            longest = longest.max(i);
        }
        if longest == 0 {
            return; // every track has ended
        }
        block.truncate(longest * out_ch);
        // Blocking send: the callback pulls at the device's pace.
        loop {
            match tx.try_send(block) {
                Ok(()) => break,
                Err(std::sync::mpsc::TrySendError::Full(b)) => {
                    if stop.load(Ordering::Relaxed) {
                        return;
                    }
                    block = b;
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
                Err(std::sync::mpsc::TrySendError::Disconnected(_)) => return,
            }
        }
    }
}

struct Feed {
    rx: Receiver<Vec<f32>>,
    cur: Vec<f32>,
    at: usize,
    finished: bool,
}

impl Feed {
    /// Fill one callback's buffer (interleaved, `ch` channels); silence on an
    /// underrun or after the end. Returns frames of real audio written.
    fn fill(&mut self, out: &mut [f32], ch: usize, peaks: &Mutex<Vec<f32>>) -> usize {
        let mut written = 0;
        let mut i = 0;
        let mut pk = peaks.lock().unwrap_or_else(|p| p.into_inner());
        while i < out.len() {
            if self.at >= self.cur.len() {
                match self.rx.try_recv() {
                    Ok(b) => {
                        self.cur = b;
                        self.at = 0;
                    }
                    Err(std::sync::mpsc::TryRecvError::Empty) => break,
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                        self.finished = true;
                        break;
                    }
                }
            }
            let n = (out.len() - i).min(self.cur.len() - self.at);
            out[i..i + n].copy_from_slice(&self.cur[self.at..self.at + n]);
            for (k, v) in out[i..i + n].iter().enumerate() {
                let c = (i + k) % ch;
                if v.abs() > pk[c] {
                    pk[c] = v.abs();
                }
            }
            self.at += n;
            i += n;
            written += n;
        }
        for v in out[i..].iter_mut() {
            *v = 0.0;
        }
        written / ch.max(1)
    }
}

/// Play `dir` out of `device`, track number → output channel (1-based), from
/// `from` seconds. Replaces whatever was playing.
#[tauri::command]
pub fn playback_start(app: AppHandle, dir: String, device: String, routes: HashMap<String, u32>, from: f64) -> Result<Value, String> {
    stop_player(&app);
    let (player, out_ch) = open_player(&dir, &device, &routes, from)?;
    *app.state::<PlayState>().0.lock().unwrap_or_else(|p| p.into_inner()) = Some(player);
    spawn_status(app.clone());
    Ok(json!({ "playing": true, "outputs": out_ch }))
}

/// Open the device and start the reader and the stream. The caller owns the
/// Player: dropping it without setting `stop` leaves it playing to the end.
fn open_player(dir: &str, device: &str, routes: &HashMap<String, u32>, from: f64) -> Result<(Player, usize), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    let (dir, device) = (dir.to_string(), device.to_string());
    let d = PathBuf::from(&dir);
    let (tracks, _) = tracks_of(&d);
    let first = tracks.first().ok_or("No tracks in this folder.")?;
    let sr = hound::WavReader::open(&first.file).map_err(|e| e.to_string())?.spec().sample_rate;

    let host = cpal::default_host();
    let dev = host.output_devices().ok().and_then(|mut it| it.find(|x| x.name().map(|n| n == device).unwrap_or(false))).ok_or_else(|| format!("“{device}” isn't connected"))?;
    // The device's widest configuration at the recording's rate.
    let cfg = dev
        .supported_output_configs()
        .map_err(|e| e.to_string())?
        .filter(|c| c.min_sample_rate().0 <= sr && c.max_sample_rate().0 >= sr && c.sample_format() == cpal::SampleFormat::F32)
        .max_by_key(|c| c.channels())
        .map(|c| c.with_sample_rate(cpal::SampleRate(sr)))
        .ok_or_else(|| format!("“{device}” can't play {} kHz audio. Set it to {} kHz to match the recording.", sr as f64 / 1000.0, sr as f64 / 1000.0))?;
    let out_ch = cfg.channels() as usize;

    let mut routed = vec![];
    for t in &tracks {
        if let Some(&o) = routes.get(&t.n.to_string()) {
            if o == 0 {
                continue;
            }
            if o as usize > out_ch {
                return Err(format!("{} is set to output {o}, but “{device}” has {out_ch} outputs.", t.name));
            }
            routed.push((t.clone(), o as usize - 1));
        }
    }
    if routed.is_empty() {
        return Err("No tracks are routed to an output.".into());
    }

    let from_frame = (from.max(0.0) * sr as f64) as u64;
    let stop = Arc::new(AtomicBool::new(false));
    let played = Arc::new(AtomicU64::new(0));
    let done = Arc::new(AtomicBool::new(false));
    let error = Arc::new(Mutex::new(None));
    let peaks = Arc::new(Mutex::new(vec![0f32; out_ch]));
    let (tx, rx) = sync_channel::<Vec<f32>>(QUEUE);
    {
        let (stop, error) = (stop.clone(), error.clone());
        std::thread::Builder::new().name("playback-reader".into()).spawn(move || reader_loop(routed, out_ch, from_frame, tx, stop, error)).map_err(|e| e.to_string())?;
    }

    // The stream lives on its own thread (cpal streams aren't Send on macOS).
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    {
        let (stop, played, done, peaks, error) = (stop.clone(), played.clone(), done.clone(), peaks.clone(), error.clone());
        let sc: cpal::StreamConfig = cfg.into();
        std::thread::Builder::new()
            .name("playback-output".into())
            .spawn(move || {
                let mut feed = Feed { rx, cur: vec![], at: 0, finished: false };
                let (played2, done2, peaks2) = (played.clone(), done.clone(), peaks.clone());
                let stream = dev.build_output_stream(
                    &sc,
                    move |data: &mut [f32], _| {
                        let n = feed.fill(data, out_ch, &peaks2);
                        played2.fetch_add(n as u64, Ordering::Relaxed);
                        if feed.finished {
                            done2.store(true, Ordering::Relaxed);
                        }
                    },
                    move |e| *error.lock().unwrap_or_else(|p| p.into_inner()) = Some(e.to_string()),
                    None,
                );
                let stream = match stream {
                    Ok(s) => s,
                    Err(e) => {
                        let _ = ready_tx.send(Err(format!("couldn't open “{}”: {e}", device_name_of(&dev))));
                        return;
                    }
                };
                if let Err(e) = stream.play() {
                    let _ = ready_tx.send(Err(e.to_string()));
                    return;
                }
                let _ = ready_tx.send(Ok(()));
                while !stop.load(Ordering::Relaxed) && !done.load(Ordering::Relaxed) {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                // As in the recorder: pause before drop, or macOS may keep it running.
                let _ = stream.pause();
                drop(stream);
                let _ = peaks;
            })
            .map_err(|e| e.to_string())?;
    }
    match ready_rx.recv_timeout(std::time::Duration::from_secs(8)) {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            stop.store(true, Ordering::Relaxed);
            return Err(e);
        }
        Err(_) => {
            stop.store(true, Ordering::Relaxed);
            return Err(format!("“{device}” didn't start"));
        }
    }

    Ok((Player { stop, played, from_frame, sr, dir, device, done, error, peaks }, out_ch))
}

fn device_name_of(d: &cpal::Device) -> String {
    use cpal::traits::DeviceTrait;
    d.name().unwrap_or_default()
}

fn position(p: &Player) -> f64 {
    (p.from_frame + p.played.load(Ordering::Relaxed)) as f64 / p.sr.max(1) as f64
}

fn status_of(p: Option<&Player>) -> Value {
    match p {
        None => json!({ "playing": false }),
        Some(p) => {
            let mut pk = p.peaks.lock().unwrap_or_else(|x| x.into_inner());
            let levels: Vec<f32> = pk.iter().map(|&v| if v > 1e-6 { ((20.0 * v.log10()) * 10.0).round() / 10.0 } else { -120.0 }).collect();
            for v in pk.iter_mut() {
                *v = 0.0;
            }
            json!({
                "playing": !p.done.load(Ordering::Relaxed),
                "secs": position(p),
                "dir": p.dir,
                "device": p.device,
                "levels": levels,
                "error": p.error.lock().unwrap_or_else(|x| x.into_inner()).clone(),
            })
        }
    }
}

/// Position and output levels, a few times a second, until it stops.
fn spawn_status(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(200));
        let st = app.state::<PlayState>();
        let g = st.0.lock().unwrap_or_else(|p| p.into_inner());
        let Some(p) = g.as_ref() else { return };
        if p.stop.load(Ordering::Relaxed) {
            return;
        }
        let v = status_of(Some(p));
        let finished = p.done.load(Ordering::Relaxed);
        drop(g);
        let _ = app.emit("playback:status", v);
        if finished {
            return;
        }
    });
}

/// Stop, and say where it stopped (so Play carries on from there).
fn stop_player(app: &AppHandle) -> Option<f64> {
    let p = app.state::<PlayState>().0.lock().unwrap_or_else(|p| p.into_inner()).take()?;
    p.stop.store(true, Ordering::Relaxed);
    Some(position(&p))
}

#[tauri::command]
pub fn playback_stop(app: AppHandle) -> Value {
    let at = stop_player(&app);
    let _ = app.emit("playback:status", json!({ "playing": false, "secs": at }));
    json!({ "playing": false, "secs": at })
}

#[tauri::command]
pub fn playback_status(app: AppHandle) -> Value {
    let st = app.state::<PlayState>();
    let g = st.0.lock().unwrap_or_else(|p| p.into_inner());
    status_of(g.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real CoreAudio, real device: plays two seconds of digital SILENCE (so
    /// nothing is heard) and checks the device pulled the frames.
    /// PRODECK_PLAY_DEVICE="Mac mini Speakers" cargo test --lib playback::tests::plays_to_a_device -- --ignored --nocapture
    #[test]
    #[ignore]
    fn plays_to_a_device() {
        println!("outputs: {:?}", playback_outputs());
        let Ok(device) = std::env::var("PRODECK_PLAY_DEVICE") else { return };
        let dir = std::env::temp_dir().join(format!("prodeck-play-dev-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let spec = hound::WavSpec { channels: 1, sample_rate: 48000, bits_per_sample: 24, sample_format: hound::SampleFormat::Int };
        let mut w = hound::WavWriter::create(dir.join("01 Silence.wav"), spec).unwrap();
        for _ in 0..(48000 * 3) {
            w.write_sample(0i32).unwrap();
        }
        w.finalize().unwrap();
        let routes: HashMap<String, u32> = [("1".to_string(), 1u32)].into();
        let (p, out_ch) = open_player(dir.to_str().unwrap(), &device, &routes, 0.5).unwrap();
        std::thread::sleep(std::time::Duration::from_secs(2));
        let at = position(&p);
        p.stop.store(true, Ordering::Relaxed);
        println!("{device}: {out_ch} outputs, played to {at:.2} s, error {:?}", p.error.lock().unwrap());
        assert!(at > 1.5 && at < 3.0, "position {at}");
        std::thread::sleep(std::time::Duration::from_millis(400));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_track_numbers_from_file_names() {
        assert_eq!(parse_track_file("09 Kick IN.wav"), Some((9, "Kick IN".into())));
        assert_eq!(parse_track_file("11 Tracks 24.wav"), Some((11, "Tracks 24".into())));
        assert_eq!(parse_track_file("session.json"), None);
        assert_eq!(parse_track_file("Reaper.rpp"), None);
    }

    #[test]
    fn plays_tracks_on_their_outputs_in_order() {
        // Two mono tracks → a 4-channel output: track A on out 2, B on out 4.
        let dir = std::env::temp_dir().join(format!("prodeck-play-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let spec = hound::WavSpec { channels: 1, sample_rate: 48000, bits_per_sample: 24, sample_format: hound::SampleFormat::Int };
        for (name, v) in [("01 A.wav", 4_194_304i32), ("02 B.wav", -2_097_152i32)] {
            let mut w = hound::WavWriter::create(dir.join(name), spec).unwrap();
            for _ in 0..3000 {
                w.write_sample(v).unwrap();
            }
            w.finalize().unwrap();
        }
        let (tracks, _) = tracks_of(&dir);
        assert_eq!(tracks.len(), 2);
        let (tx, rx) = sync_channel(QUEUE);
        let stop = Arc::new(AtomicBool::new(false));
        let err = Arc::new(Mutex::new(None));
        reader_loop(vec![(tracks[0].clone(), 1), (tracks[1].clone(), 3)], 4, 1000, tx, stop, err.clone());
        let blocks: Vec<Vec<f32>> = rx.try_iter().collect();
        let all: Vec<f32> = blocks.concat();
        assert_eq!(all.len(), 2000 * 4, "seeked past the first 1000 frames");
        assert!((all[1] - 0.5).abs() < 1e-6 && (all[3] + 0.25).abs() < 1e-6);
        assert_eq!(all[0], 0.0);
        assert!(err.lock().unwrap().is_none());

        // The callback side: fills, meters, and reports the end.
        let (tx, rx) = sync_channel(QUEUE);
        tx.send(vec![0.5, 0.0, 0.0, 0.0]).unwrap();
        drop(tx);
        let mut feed = Feed { rx, cur: vec![], at: 0, finished: false };
        let peaks = Mutex::new(vec![0f32; 4]);
        let mut out = vec![9.0f32; 8];
        assert_eq!(feed.fill(&mut out, 4, &peaks), 1);
        assert_eq!(&out[4..], &[0.0, 0.0, 0.0, 0.0]);
        assert_eq!(peaks.lock().unwrap()[0], 0.5);
        feed.fill(&mut out, 4, &peaks);
        assert!(feed.finished);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
