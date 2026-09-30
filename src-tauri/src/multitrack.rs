//! Multitrack recording: every input channel of the audio device (the Dante
//! Virtual Soundcard on the booth — 64 of them) to its own 24-bit WAV, named
//! from `multitrack_names`, with markers.
//!
//! The audio callback only hands its interleaved block to a bounded queue
//! (never waits: a full queue drops the block and counts it). A writer
//! thread splits it into per-channel files and refreshes every header every
//! 10 s, so a crash or a pulled drive leaves playable files. If the drive
//! fails mid-service the writer carries on into a "(continued)" folder on
//! the internal disk instead of losing the rest. At the end: silent tracks
//! (unsubscribed Dante channels are digital zero) are removed, and a marker
//! list, a Reaper project and a MIDI marker file are written beside them.

use crate::audio::AudioState;
use crate::settings::SettingsState;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// ~5 s of 64-channel audio at a 512-frame buffer (the callback never waits).
const QUEUE_BLOCKS: usize = 480;
const MIN_FREE_START_GB: f64 = 20.0;
const MIN_FREE_GB: f64 = 5.0;
const MAX_HOURS: f64 = 8.0;
/// Below this peak for the whole session a track is silence (−80 dBFS).
const SILENT_PEAK: f32 = 1e-4;

struct Active {
    id: String,
    dir: PathBuf,
    label: String,
    start_epoch: u64,
    sr: u32,
    channels: usize,
    names: Vec<String>,
    frames: Arc<AtomicU64>,
    markers: Arc<Mutex<Vec<(f64, String)>>>,
    stop: Arc<AtomicBool>,
    fell_back: Option<String>,
    /// Where each input came from when recording started (this Mac's Dante
    /// receive subscriptions, and the typed sources), for the soundcheck
    /// patch sheet: routing changes, and the sheet must match the tracks.
    routing: Value,
}

#[derive(Default)]
pub struct RecState {
    active: Mutex<Option<Active>>,
    /// The last finished session (for the UI and the deck).
    last: Mutex<Value>,
    /// What the writer is doing right now (for the deck-state readout).
    live: Mutex<Value>,
}

fn now_s() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Local wall-clock time: (year, month, day, hour, minute).
pub(crate) fn local_tm(t: u64) -> (i32, i32, i32, i32, i32) {
    unsafe {
        let tt = t as libc::time_t;
        let mut tm: libc::tm = std::mem::zeroed();
        #[cfg(unix)]
        libc::localtime_r(&tt, &mut tm);
        #[cfg(windows)]
        libc::localtime_s(&mut tm, &tt);
        (tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min)
    }
}
/// "2026-09-27" in local time.
fn local_date(t: u64) -> String {
    let (y, mo, d, _, _) = local_tm(t);
    format!("{y:04}-{mo:02}-{d:02}")
}
/// "0915" in local time.
fn local_hm(t: u64) -> String {
    let (_, _, _, h, mi) = local_tm(t);
    format!("{h:02}{mi:02}")
}

/// A session's folder: "2026-09-25 Men's Conference"; a second recording
/// of the same service that day gets its start time ("… 1930").
fn session_dir(root: &Path, t: u64, label: &str) -> PathBuf {
    let base = format!("{} {}", local_date(t), label);
    let first = root.join(&base);
    if !first.exists() {
        return first;
    }
    let mut dir = root.join(format!("{base} {}", local_hm(t)));
    let mut k = 2;
    while dir.exists() {
        dir = root.join(format!("{base} {} {k}", local_hm(t)));
        k += 1;
    }
    dir
}

#[cfg(unix)]
fn statvfs(p: &Path) -> Option<libc::statvfs> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(p.as_os_str().as_bytes()).ok()?;
    unsafe {
        let mut s: libc::statvfs = std::mem::zeroed();
        (libc::statvfs(c.as_ptr(), &mut s) == 0).then_some(s)
    }
}
#[cfg(unix)]
fn free_gb(p: &Path) -> Option<f64> {
    statvfs(p).map(|s| s.f_bavail as f64 * s.f_frsize as f64 / 1e9)
}
#[cfg(unix)]
fn total_gb(p: &Path) -> Option<f64> {
    statvfs(p).map(|s| s.f_blocks as f64 * s.f_frsize as f64 / 1e9)
}
/// (available to us, total) bytes on the volume holding `p`.
#[cfg(windows)]
fn disk_space(p: &Path) -> Option<(u64, u64)> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(dir: *const u16, avail: *mut u64, total: *mut u64, free: *mut u64) -> i32;
    }
    let w: Vec<u16> = p.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let (mut avail, mut total, mut free) = (0u64, 0u64, 0u64);
    (unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut avail, &mut total, &mut free) } != 0).then_some((avail, total))
}
#[cfg(windows)]
fn free_gb(p: &Path) -> Option<f64> {
    disk_space(p).map(|(a, _)| a as f64 / 1e9)
}
#[cfg(windows)]
fn total_gb(p: &Path) -> Option<f64> {
    disk_space(p).map(|(_, t)| t as f64 / 1e9)
}
#[cfg(unix)]
fn writable(p: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(p.as_os_str().as_bytes()).map(|c| unsafe { libc::access(c.as_ptr(), libc::W_OK) == 0 }).unwrap_or(false)
}
#[cfg(windows)]
fn writable(p: &Path) -> bool {
    std::fs::metadata(p).map(|m| !m.permissions().readonly()).unwrap_or(false)
}

/// 64 files plus the app's sockets can pass macOS's default 256 open files.
#[cfg(unix)]
fn raise_fd_limit() {
    unsafe {
        let mut r: libc::rlimit = std::mem::zeroed();
        if libc::getrlimit(libc::RLIMIT_NOFILE, &mut r) == 0 && r.rlim_cur < 4096 {
            r.rlim_cur = 4096.min(r.rlim_max);
            libc::setrlimit(libc::RLIMIT_NOFILE, &r);
        }
    }
}
#[cfg(windows)]
fn raise_fd_limit() {}

fn internal_root() -> PathBuf {
    dirs::home_dir().unwrap_or_else(std::env::temp_dir).join("Music").join("ProDeck Recordings")
}

/// Where recordings go: `<volume>/ProDeck Recordings`, or the internal
/// Music folder. A chosen drive that isn't plugged in falls back to internal.
fn root_for(volume: &str) -> (PathBuf, Option<String>) {
    if volume.is_empty() {
        return (internal_root(), None);
    }
    let v = Path::new(volume);
    if v.is_dir() && writable(v) {
        (v.join("ProDeck Recordings"), None)
    } else {
        let name = v.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| volume.to_string());
        (internal_root(), Some(format!("{name} isn't connected — recording to this Mac instead")))
    }
}

fn clean(s: &str) -> String {
    let t: String = s.chars().map(|c| if matches!(c, '/' | ':' | '\\' | '"' | '*' | '?' | '<' | '>' | '|') { '-' } else { c }).collect();
    t.trim().chars().take(60).collect()
}

fn track_file(i: usize, name: &str) -> String {
    format!("{:02} {}.wav", i + 1, clean(name))
}

type Writer = hound::WavWriter<std::io::BufWriter<std::fs::File>>;

fn open_writers(dir: &Path, names: &[String], sr: u32) -> std::io::Result<Vec<Writer>> {
    std::fs::create_dir_all(dir)?;
    let spec = hound::WavSpec { channels: 1, sample_rate: sr, bits_per_sample: 24, sample_format: hound::SampleFormat::Int };
    names
        .iter()
        .enumerate()
        .map(|(i, n)| hound::WavWriter::create(dir.join(track_file(i, n)), spec).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))
        .collect()
}

struct WriterOut {
    dirs: Vec<PathBuf>,
    peaks: Vec<f32>,
    error: Option<String>,
}

#[allow(clippy::too_many_arguments)]
fn writer_loop(app: AppHandle, rx: Receiver<Vec<f32>>, mut writers: Vec<Writer>, dir: PathBuf, names: Vec<String>, sr: u32, frames: Arc<AtomicU64>, stop: Arc<AtomicBool>, id: String) -> WriterOut {
    let ch = writers.len();
    let mut peaks = vec![0f32; ch];
    let mut recent = vec![0f32; ch];
    let mut dirs = vec![dir.clone()];
    let mut error: Option<String> = None;
    let mut last_flush = std::time::Instant::now();
    let mut last_status = std::time::Instant::now();
    let mut stopping = false;
    let audio = app.state::<AudioState>().inner().clone();
    loop {
        match rx.recv_timeout(std::time::Duration::from_millis(200)) {
            Ok(block) => {
                if block.len() % ch != 0 {
                    error = Some("the audio device changed channel count — recording stopped".into());
                    break;
                }
                let mut failed = false;
                for fr in block.chunks_exact(ch) {
                    for (c, &s) in fr.iter().enumerate() {
                        let a = s.abs();
                        if a > peaks[c] {
                            peaks[c] = a;
                        }
                        if a > recent[c] {
                            recent[c] = a;
                        }
                        let v = (s.clamp(-1.0, 1.0) * 8_388_607.0) as i32;
                        if writers[c].write_sample(v).is_err() {
                            failed = true;
                        }
                    }
                }
                frames.fetch_add((block.len() / ch) as u64, Ordering::Relaxed);
                if failed {
                    // The drive went away (or filled): carry on on this Mac.
                    let cont = internal_root().join(format!("{} (continued)", dir.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()));
                    match open_writers(&cont, &names, sr) {
                        Ok(w) => {
                            let old = std::mem::replace(&mut writers, w);
                            for w in old {
                                let _ = w.finalize();
                            }
                            error = Some(format!("Writing to {} failed — continued on this Mac in {}", dir.display(), cont.display()));
                            app.emit("multitrack:error", error.clone()).ok();
                            dirs.push(cont);
                        }
                        Err(e) => {
                            error = Some(format!("Recording stopped: the drive failed and this Mac couldn't take over ({e})"));
                            break;
                        }
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if stop.load(Ordering::Relaxed) {
                    break;
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if last_flush.elapsed().as_secs() >= 10 {
            last_flush = std::time::Instant::now();
            for w in writers.iter_mut() {
                let _ = w.flush(); // rewrites the header: the file plays as far as it got
            }
        }
        if last_status.elapsed().as_millis() >= 1000 {
            last_status = std::time::Instant::now();
            let cur = dirs.last().unwrap();
            let secs = frames.load(Ordering::Relaxed) as f64 / sr as f64;
            let free = free_gb(cur).unwrap_or(0.0);
            let signal = recent.iter().filter(|&&p| p > 0.001).count();
            let levels: Vec<f32> = recent.iter().map(|&p| ((20.0 * p.max(1e-6).log10()) * 10.0).round() / 10.0).collect();
            for p in recent.iter_mut() {
                *p = 0.0;
            }
            let dropped = audio.rec_dropped.load(Ordering::Relaxed);
            let v = json!({
                "recording": true, "id": id, "dir": cur, "secs": secs, "channels": ch, "withSignal": signal,
                "freeGb": (free * 10.0).round() / 10.0,
                "hoursLeft": (free / (ch as f64 * sr as f64 * 3.0 * 3600.0 / 1e9) * 10.0).round() / 10.0,
                "dropped": dropped, "levels": levels, "error": error,
            });
            *app.state::<RecState>().live.lock().unwrap_or_else(|p| p.into_inner()) = v.clone();
            app.emit("multitrack:status", v).ok();
            if !stopping && (free < MIN_FREE_GB || secs > MAX_HOURS * 3600.0) {
                stopping = true;
                let why = if free < MIN_FREE_GB { "the drive is nearly full" } else { "it reached the 8-hour limit" };
                error = Some(format!("Recording stopped: {why}"));
                app.emit("multitrack:error", error.clone()).ok();
                let a = app.clone();
                std::thread::spawn(move || {
                    let _ = stop_core(&a);
                });
            }
        }
    }
    for w in writers {
        let _ = w.finalize();
    }
    WriterOut { dirs, peaks, error }
}

/// Reaper project: every kept track, lined up at 0, with the markers.
fn write_rpp(dir: &Path, label: &str, sr: u32, secs: f64, tracks: &[(usize, String)], markers: &[(f64, String)]) {
    let q = |s: &str| s.replace('"', "'");
    let mut s = format!("<REAPER_PROJECT 0.1 \"6.0\" 0\n  SAMPLERATE {sr} 0 0\n");
    for (i, (t, m)) in markers.iter().enumerate() {
        s += &format!("  MARKER {} {:.3} \"{}\" 0\n", i + 1, t, q(m));
    }
    for (i, name) in tracks {
        s += &format!(
            "  <TRACK\n    NAME \"{}\"\n    <ITEM\n      POSITION 0\n      LENGTH {:.3}\n      NAME \"{}\"\n      <SOURCE WAVE\n        FILE \"{}\"\n      >\n    >\n  >\n",
            q(name),
            secs,
            q(name),
            q(&track_file(*i, name))
        );
    }
    s += ">\n";
    let _ = std::fs::write(dir.join(format!("{}.RPP", clean(label))), s);
}

/// Standard MIDI file with only marker events (120 BPM, so 960 ticks = 1 s):
/// drag into Logic or any DAW to get the service's markers on its timeline.
fn write_marker_midi(dir: &Path, markers: &[(f64, String)]) {
    fn vlq(mut v: u32, out: &mut Vec<u8>) {
        let mut b = vec![(v & 0x7f) as u8];
        v >>= 7;
        while v > 0 {
            b.push(((v & 0x7f) as u8) | 0x80);
            v >>= 7;
        }
        b.reverse();
        out.extend(b);
    }
    let mut trk: Vec<u8> = vec![0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]; // 500 000 µs per quarter
    let mut last = 0u32;
    for (t, m) in markers {
        let tick = (t * 960.0) as u32;
        vlq(tick.saturating_sub(last), &mut trk);
        last = tick;
        let bytes: Vec<u8> = m.bytes().take(120).collect();
        trk.extend([0xff, 0x06]);
        vlq(bytes.len() as u32, &mut trk);
        trk.extend(bytes);
    }
    trk.extend([0x00, 0xff, 0x2f, 0x00]);
    let mut f: Vec<u8> = b"MThd".to_vec();
    f.extend([0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0]); // format 0, 1 track, 480 ticks/quarter
    f.extend(b"MTrk");
    f.extend((trk.len() as u32).to_be_bytes());
    f.extend(trk);
    let _ = std::fs::write(dir.join("Markers.mid"), f);
}

fn finish(app: &AppHandle, a: Active, out: WriterOut, drop_silent: bool) -> Value {
    let secs = a.frames.load(Ordering::Relaxed) as f64 / a.sr as f64;
    let markers = a.markers.lock().unwrap_or_else(|p| p.into_inner()).clone();
    let mut kept: Vec<(usize, String)> = Vec::new();
    let mut removed = 0;
    for (i, n) in a.names.iter().enumerate() {
        let silent = out.peaks.get(i).copied().unwrap_or(0.0) < SILENT_PEAK;
        if silent && drop_silent {
            for d in &out.dirs {
                let _ = std::fs::remove_file(d.join(track_file(i, n)));
            }
            removed += 1;
        } else {
            kept.push((i, n.clone()));
        }
    }
    let dropped = app.state::<AudioState>().rec_dropped.load(Ordering::Relaxed);
    for d in &out.dirs {
        let mut csv = String::from("seconds,time,marker\n");
        for (t, m) in &markers {
            csv += &format!("{:.2},{:02}:{:02}:{:02},\"{}\"\n", t, (*t as u64) / 3600, (*t as u64 / 60) % 60, (*t as u64) % 60, m.replace('"', "'"));
        }
        let _ = std::fs::write(d.join("markers.csv"), csv);
        write_rpp(d, &a.label, a.sr, secs, &kept, &markers);
        write_marker_midi(d, &markers);
        let session = json!({
            "id": a.id, "label": a.label, "start": a.start_epoch, "sampleRate": a.sr, "bits": 24, "seconds": secs, "inputs": a.channels,
            "tracks": kept.iter().map(|(i, n)| json!({ "input": i + 1, "name": n, "file": track_file(*i, n), "peakDb": 20.0 * out.peaks[*i].max(1e-9).log10() })).collect::<Vec<_>>(),
            "silentRemoved": removed, "markers": markers.iter().map(|(t, m)| json!({ "t": t, "text": m })).collect::<Vec<_>>(),
            "droppedBlocks": dropped, "folders": out.dirs, "note": out.error.clone().or(a.fell_back.clone()),
            "routing": a.routing,
        });
        let _ = std::fs::write(d.join("session.json"), serde_json::to_string_pretty(&session).unwrap_or_default());
    }
    let v = json!({
        "recording": false, "id": a.id, "label": a.label, "dir": a.dir, "folders": out.dirs, "secs": secs,
        "tracks": kept.len(), "silentRemoved": removed, "markers": markers.len(), "dropped": dropped,
        "note": out.error.or(a.fell_back),
    });
    *app.state::<RecState>().last.lock().unwrap_or_else(|p| p.into_inner()) = v.clone();
    *app.state::<RecState>().live.lock().unwrap_or_else(|p| p.into_inner()) = json!({ "recording": false });
    app.emit("multitrack:status", v.clone()).ok();
    v
}

/// Record from a device other than ProDeck's audio input (a console's USB
/// audio, an interface): open it on its own thread — never on the caller's,
/// CoreAudio device calls have frozen this app from the main thread before —
/// and hand its blocks to the same queue. Returns (sample rate, channels);
/// the stream lives until `stop` is set.
fn open_device_stream(name: String, tx: std::sync::mpsc::SyncSender<Vec<f32>>, stop: Arc<AtomicBool>, audio: AudioState) -> Result<(u32, usize), String> {
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(u32, usize), String>>();
    std::thread::Builder::new()
        .name("multitrack-input".into())
        .spawn(move || {
            use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
            use cpal::Sample;
            let host = cpal::default_host();
            let Some(dev) = host.input_devices().ok().and_then(|mut it| it.find(|d| d.name().map(|n| n == name).unwrap_or(false))) else {
                let _ = ready_tx.send(Err(format!("“{name}” isn't connected")));
                return;
            };
            let cfg = match dev.default_input_config() {
                Ok(c) => c,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("“{name}”: {e}")));
                    return;
                }
            };
            let (sr, ch) = (cfg.sample_rate().0, cfg.channels() as usize);
            let sc: cpal::StreamConfig = cfg.clone().into();
            macro_rules! build {
                ($t:ty) => {{
                    let tx = tx.clone();
                    let audio = audio.clone();
                    dev.build_input_stream(
                        &sc,
                        move |data: &[$t], _| {
                            let block: Vec<f32> = data.iter().map(|&x| f32::from_sample(x)).collect();
                            if let Err(std::sync::mpsc::TrySendError::Full(_)) = tx.try_send(block) {
                                audio.rec_dropped.fetch_add(1, Ordering::Relaxed);
                            }
                        },
                        |e| eprintln!("[multitrack] input error: {e}"),
                        None,
                    )
                }};
            }
            let stream = match cfg.sample_format() {
                cpal::SampleFormat::F32 => build!(f32),
                cpal::SampleFormat::I16 => build!(i16),
                cpal::SampleFormat::I32 => build!(i32),
                cpal::SampleFormat::U16 => build!(u16),
                f => {
                    let _ = ready_tx.send(Err(format!("“{name}” uses {f:?} samples, which ProDeck can't record yet")));
                    return;
                }
            };
            let stream = match stream {
                Ok(s) => s,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("couldn't open “{name}”: {e}")));
                    return;
                }
            };
            if let Err(e) = stream.play() {
                let _ = ready_tx.send(Err(format!("couldn't start “{name}”: {e}")));
                return;
            }
            let _ = ready_tx.send(Ok((sr, ch)));
            drop(tx); // only the stream's clones keep the queue open
            while !stop.load(Ordering::Relaxed) {
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            // Pause first: on macOS dropping a cpal stream alone doesn't always
            // stop the device (something inside keeps it alive), and a recorder
            // that keeps feeding after Stop would never finish.
            let _ = stream.pause();
            drop(stream);
        })
        .map_err(|e| e.to_string())?;
    ready_rx.recv_timeout(std::time::Duration::from_secs(8)).map_err(|_| "the audio device didn't answer in 8 s".to_string())?
}

pub fn start_core(app: &AppHandle, label: &str) -> Result<Value, String> {
    let st = app.state::<RecState>();
    let mut guard = st.active.lock().unwrap_or_else(|p| p.into_inner());
    if guard.is_some() {
        return Err("already recording".into());
    }
    let audio = app.state::<AudioState>().inner().clone();
    let (volume, names_map, drop_silent, device, typed_sources) = {
        let s = app.state::<SettingsState>();
        let s = s.lock().unwrap_or_else(|p| p.into_inner());
        (s.multitrack_volume.clone(), s.multitrack_names.clone(), s.multitrack_drop_silent, s.multitrack_device.clone().filter(|d| !d.trim().is_empty()), s.multitrack_sources.clone())
    };
    // A separate device (a console's USB audio) unless it's the one already open.
    let current = audio.device_name.lock().unwrap_or_else(|p| p.into_inner()).clone();
    let own_device = device.filter(|d| Some(d) != current.as_ref() || !audio.running.load(Ordering::Acquire));
    let (tx, rx) = sync_channel::<Vec<f32>>(QUEUE_BLOCKS);
    let stop = Arc::new(AtomicBool::new(false));
    audio.rec_dropped.store(0, Ordering::Relaxed);
    let (sr, ch) = match &own_device {
        Some(name) => open_device_stream(name.clone(), tx.clone(), stop.clone(), audio.clone())?,
        None => {
            let sr = audio.sample_rate.load(Ordering::Relaxed);
            let ch = audio.channels.load(Ordering::Relaxed) as usize;
            if !audio.running.load(Ordering::Acquire) || sr == 0 || ch == 0 {
                return Err("audio input isn't running — start it in Settings → Audio, or pick a device to record from".into());
            }
            (sr, ch)
        }
    };
    let (root, fell_back) = root_for(&volume);
    let _ = std::fs::create_dir_all(&root);
    let free = free_gb(&root).unwrap_or(0.0);
    if free < MIN_FREE_START_GB {
        return Err(format!("only {free:.0} GB free on {} — needs at least {MIN_FREE_START_GB:.0} GB", root.display()));
    }
    raise_fd_limit();
    let start_epoch = now_s();
    let label = if label.trim().is_empty() { "Recording".to_string() } else { clean(label) };
    let dir = session_dir(&root, start_epoch, &label);
    let names: Vec<String> = (1..=ch).map(|i| names_map.get(&i.to_string()).filter(|s| !s.trim().is_empty()).cloned().unwrap_or_else(|| format!("In {i:02}"))).collect();
    let writers = match open_writers(&dir, &names, sr) {
        Ok(w) => w,
        Err(e) => {
            stop.store(true, Ordering::Relaxed);
            return Err(format!("couldn't create files in {}: {e}", dir.display()));
        }
    };
    if own_device.is_none() {
        *audio.rec.lock().unwrap_or_else(|p| p.into_inner()) = Some(tx);
    } else {
        drop(tx); // the device thread holds the sender
    }
    let frames = Arc::new(AtomicU64::new(0));
    let id = format!("r{start_epoch}");
    let a = Active {
        id: id.clone(),
        dir: dir.clone(),
        label: label.clone(),
        start_epoch,
        sr,
        channels: ch,
        names: names.clone(),
        frames: frames.clone(),
        markers: Arc::new(Mutex::new(Vec::new())),
        stop: stop.clone(),
        fell_back: fell_back.clone(),
        routing: {
            // Dante only describes ProDeck's own input (the Virtual Soundcard);
            // a console over USB has no subscriptions to record.
            let dante = app.state::<crate::dante::DanteState>().0.lock().unwrap_or_else(|p| p.into_inner()).clone();
            let local = dante["localName"].as_str().unwrap_or("").to_string();
            let rx = if own_device.is_none() {
                dante["devices"].as_array().and_then(|ds| ds.iter().find(|d| d["name"].as_str() == Some(local.as_str()))).map(|d| d["rx"].clone()).unwrap_or(Value::Null)
            } else {
                Value::Null
            };
            json!({ "device": own_device.clone(), "localName": local, "danteRx": rx, "sources": typed_sources })
        },
    };
    let app2 = app.clone();
    let (dir2, names2, frames2, stop2, id2) = (dir.clone(), names.clone(), frames, stop, id.clone());
    std::thread::Builder::new()
        .name("multitrack-writer".into())
        .spawn(move || {
            let out = writer_loop(app2.clone(), rx, writers, dir2, names2, sr, frames2, stop2, id2);
            // The session ends here, whoever asked (a key, auto-stop, disk guard).
            let a = app2.state::<RecState>().active.lock().unwrap_or_else(|p| p.into_inner()).take();
            *app2.state::<AudioState>().rec.lock().unwrap_or_else(|p| p.into_inner()) = None;
            if let Some(a) = a {
                finish(&app2, a, out, drop_silent);
            }
        })
        .map_err(|e| e.to_string())?;
    *guard = Some(a);
    if let Some(w) = &fell_back {
        app.emit("multitrack:error", Some(w.clone())).ok();
    }
    Ok(json!({ "recording": true, "id": id, "dir": dir, "channels": ch, "sampleRate": sr, "note": fell_back }))
}

pub fn stop_core(app: &AppHandle) -> Result<Value, String> {
    let st = app.state::<RecState>();
    let g = st.active.lock().unwrap_or_else(|p| p.into_inner());
    let a = g.as_ref().ok_or("not recording")?;
    a.stop.store(true, Ordering::Relaxed);
    let dir = a.dir.clone();
    drop(g);
    // Close the queue: the writer drains what's left, finalizes, tidies up.
    *app.state::<AudioState>().rec.lock().unwrap_or_else(|p| p.into_inner()) = None;
    Ok(json!({ "stopping": true, "dir": dir }))
}

pub fn marker_core(app: &AppHandle, text: &str) -> Result<f64, String> {
    let st = app.state::<RecState>();
    let g = st.active.lock().unwrap_or_else(|p| p.into_inner());
    let a = g.as_ref().ok_or("not recording")?;
    let t = a.frames.load(Ordering::Relaxed) as f64 / a.sr as f64;
    a.markers.lock().unwrap_or_else(|p| p.into_inner()).push((t, text.trim().chars().take(120).collect()));
    Ok(t)
}

pub fn toggle_core(app: &AppHandle, label: &str) -> Result<Value, String> {
    let on = app.state::<RecState>().active.lock().unwrap_or_else(|p| p.into_inner()).is_some();
    if on {
        stop_core(app)
    } else {
        start_core(app, label)
    }
}

/// For the deck readout: recording, seconds, tracks with signal.
pub fn deck_state(app: &AppHandle) -> Value {
    let st = app.state::<RecState>();
    let on = st.active.lock().unwrap_or_else(|p| p.into_inner()).is_some();
    if !on {
        return json!({ "on": false });
    }
    let v = st.live.lock().unwrap_or_else(|p| p.into_inner()).clone();
    let secs = v["secs"].as_f64().unwrap_or(0.0) as u64;
    json!({ "on": true, "secs": secs, "clock": format!("{}:{:02}:{:02}", secs / 3600, (secs / 60) % 60, secs % 60), "withSignal": v["withSignal"], "freeGb": v["freeGb"], "error": v["error"] })
}

/// Each channel's peak in dBFS over interleaved blocks (−120 for silence).
fn peaks_db(blocks: &[Vec<f32>], ch: usize) -> Vec<f32> {
    let mut peak = vec![0f32; ch];
    for b in blocks {
        for (i, x) in b.iter().enumerate() {
            let a = x.abs();
            if a > peak[i % ch] {
                peak[i % ch] = a;
            }
        }
    }
    peak.iter().map(|&p| if p > 1e-6 { ((20.0 * p.log10()) * 10.0).round() / 10.0 } else { -120.0 }).collect()
}

/// Listen to a device for a moment and report each channel's peak, without
/// recording anything: the setup wizard's signal check for a device that
/// isn't ProDeck's own audio input (a console's USB audio).
#[tauri::command]
pub async fn multitrack_probe(app: AppHandle, device: String, ms: Option<u64>) -> Result<Value, String> {
    if app.state::<RecState>().active.lock().unwrap_or_else(|p| p.into_inner()).is_some() {
        return Err("A recording is running. Its meters are on the Recording page.".into());
    }
    let audio = app.state::<AudioState>().inner().clone();
    let ms = ms.unwrap_or(1500).clamp(300, 4000);
    tauri::async_runtime::spawn_blocking(move || {
        let (tx, rx) = sync_channel::<Vec<f32>>(QUEUE_BLOCKS);
        let stop = Arc::new(AtomicBool::new(false));
        let (sr, ch) = open_device_stream(device, tx, stop.clone(), audio)?;
        let t0 = std::time::Instant::now();
        let mut blocks = vec![];
        while t0.elapsed().as_millis() < ms as u128 {
            if let Ok(b) = rx.recv_timeout(std::time::Duration::from_millis(200)) {
                blocks.push(b);
            }
        }
        stop.store(true, Ordering::Relaxed);
        Ok(json!({ "sampleRate": sr, "channels": ch, "peaks": peaks_db(&blocks, ch.max(1)) }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn multitrack_start(app: AppHandle, label: String) -> Result<Value, String> {
    start_core(&app, &label)
}
#[tauri::command]
pub fn multitrack_stop(app: AppHandle) -> Result<Value, String> {
    stop_core(&app)
}
#[tauri::command]
pub fn multitrack_marker(app: AppHandle, text: String) -> Result<f64, String> {
    marker_core(&app, &text)
}
#[tauri::command]
pub fn multitrack_status(app: AppHandle) -> Value {
    let st = app.state::<RecState>();
    let on = st.active.lock().unwrap_or_else(|p| p.into_inner()).is_some();
    json!({
        "recording": on,
        "live": if on { st.live.lock().unwrap_or_else(|p| p.into_inner()).clone() } else { Value::Null },
        "last": st.last.lock().unwrap_or_else(|p| p.into_inner()).clone(),
    })
}

/// This Mac and every mounted drive we could record to, with free space.
#[tauri::command]
pub fn multitrack_volumes() -> Vec<Value> {
    let mut out = vec![];
    let home = internal_root();
    let probe = home.parent().map(|p| p.to_path_buf()).unwrap_or(home.clone());
    out.push(json!({ "path": "", "name": "This Mac (internal)", "internal": true, "folder": home, "freeGb": free_gb(&probe), "totalGb": total_gb(&probe), "writable": true }));
    for (p, name) in external_volumes() {
        if !writable(&p) {
            continue; // Time Machine backups, read-only images
        }
        out.push(json!({ "path": p, "name": name, "internal": false, "folder": p.join("ProDeck Recordings"), "freeGb": free_gb(&p), "totalGb": total_gb(&p), "writable": true }));
    }
    out
}

/// Mounted drives other than the system disk.
#[cfg(unix)]
fn external_volumes() -> Vec<(PathBuf, String)> {
    use std::os::unix::fs::MetadataExt;
    let mut out = vec![];
    let root_dev = std::fs::metadata("/").map(|m| m.dev()).ok();
    if let Ok(rd) = std::fs::read_dir("/Volumes") {
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.starts_with("com.apple") {
                continue;
            }
            let Ok(md) = std::fs::metadata(&p) else { continue };
            if !md.is_dir() || Some(md.dev()) == root_dev {
                continue; // "Macintosh HD" is the internal disk again
            }
            out.push((p, name));
        }
    }
    out
}
/// Drive letters other than the system drive.
#[cfg(windows)]
fn external_volumes() -> Vec<(PathBuf, String)> {
    let sys = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_ascii_uppercase();
    (b'D'..=b'Z')
        .map(|c| format!("{}:", c as char))
        .filter(|d| *d != sys)
        .map(|d| (PathBuf::from(format!("{d}\\")), d))
        .filter(|(p, _)| p.is_dir())
        .collect()
}

/// Recorded sessions on this Mac and the chosen drive, newest first.
#[tauri::command]
pub fn multitrack_sessions(app: AppHandle) -> Vec<Value> {
    let v = app.state::<SettingsState>().lock().unwrap_or_else(|p| p.into_inner()).multitrack_volume.clone();
    let mut roots = vec![internal_root()];
    let (r, _) = root_for(&v);
    if !roots.contains(&r) {
        roots.push(r);
    }
    let mut out: Vec<Value> = vec![];
    for root in roots {
        let Ok(rd) = std::fs::read_dir(&root) else { continue };
        for e in rd.flatten() {
            let d = e.path();
            let Ok(t) = std::fs::read_to_string(d.join("session.json")) else { continue };
            let Ok(s) = serde_json::from_str::<Value>(&t) else { continue };
            out.push(json!({
                "dir": d, "folder": e.file_name().to_string_lossy(), "label": s["label"], "start": s["start"],
                "seconds": s["seconds"], "tracks": s["tracks"].as_array().map(|a| a.len()).unwrap_or(0),
                "markers": s["markers"].as_array().map(|a| a.len()).unwrap_or(0), "note": s["note"],
            }));
        }
    }
    out.sort_by_key(|s| std::cmp::Reverse(s["start"].as_u64().unwrap_or(0)));
    out.truncate(50);
    out
}

/// Open a session folder in Finder (only folders the recorder made).
#[tauri::command]
pub fn multitrack_open(dir: String) -> Result<(), String> {
    let p = PathBuf::from(&dir);
    if !p.join("session.json").exists() {
        return Err("not a recording folder".into());
    }
    std::process::Command::new("open").arg(&p).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Open the recordings folder (the last session's, else the root) in Finder.
#[tauri::command]
pub fn multitrack_reveal(app: AppHandle) -> Result<(), String> {
    let last = app.state::<RecState>().last.lock().unwrap_or_else(|p| p.into_inner()).clone();
    let dir = last["dir"].as_str().map(PathBuf::from).filter(|p| p.exists()).unwrap_or_else(|| {
        let v = app.state::<SettingsState>().lock().unwrap_or_else(|p| p.into_inner()).multitrack_volume.clone();
        root_for(&v).0
    });
    let _ = std::fs::create_dir_all(&dir);
    std::process::Command::new("open").arg(&dir).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_tracks_markers_and_drops_silence() {
        let dir = std::env::temp_dir().join(format!("mt-test-{}", now_s()));
        let names = vec!["Kick IN".to_string(), "Room/L".to_string()];
        let mut w = open_writers(&dir, &names, 48_000).unwrap();
        for i in 0..4800 {
            w[0].write_sample(((i as f32 * 0.1).sin() * 4_000_000.0) as i32).unwrap();
            w[1].write_sample(0i32).unwrap();
        }
        for x in w {
            x.finalize().unwrap();
        }
        assert!(dir.join("01 Kick IN.wav").exists());
        assert!(dir.join("02 Room-L.wav").exists()); // no slashes in file names
        let r = hound::WavReader::open(dir.join("01 Kick IN.wav")).unwrap();
        assert_eq!(r.spec().bits_per_sample, 24);
        assert_eq!(r.duration(), 4800);
        write_marker_midi(&dir, &[(1.5, "Chorus".into()), (3.0, "Bridge".into())]);
        let m = std::fs::read(dir.join("Markers.mid")).unwrap();
        assert_eq!(&m[0..4], b"MThd");
        assert!(m.windows(6).any(|w| w == b"Chorus"));
        write_rpp(&dir, "Sunday", 48_000, 0.1, &[(0, "Kick IN".into())], &[(1.5, "Chorus".into())]);
        let rpp = std::fs::read_to_string(dir.join("Sunday.RPP")).unwrap();
        assert!(rpp.contains("FILE \"01 Kick IN.wav\"") && rpp.contains("MARKER 1 1.500 \"Chorus\""));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn folders_are_named_for_the_service_and_date() {
        let root = std::env::temp_dir().join(format!("mt-names-{}", now_s()));
        std::fs::create_dir_all(&root).unwrap();
        let t = now_s();
        let a = session_dir(&root, t, "Men's Conference");
        assert_eq!(a.file_name().unwrap().to_string_lossy(), format!("{} Men's Conference", local_date(t)));
        std::fs::create_dir_all(&a).unwrap();
        let b = session_dir(&root, t, "Men's Conference");
        assert_eq!(b.file_name().unwrap().to_string_lossy(), format!("{} Men's Conference {}", local_date(t), local_hm(t)));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_missing_drive_falls_back_to_this_mac() {
        let (root, note) = root_for("/Volumes/No Such Drive 123");
        assert_eq!(root, internal_root());
        assert!(note.unwrap().contains("No Such Drive 123"));
        assert_eq!(root_for("").0, internal_root());
    }

    #[test]
    fn peaks_per_channel() {
        let blocks = vec![vec![0.5, 0.0, -1.0, 0.0], vec![0.1, 0.0, 0.25, 0.0]];
        let p = peaks_db(&blocks, 2);
        assert_eq!(p, vec![0.0, -120.0]);
        let q = peaks_db(&[vec![0.5, 0.1]], 2);
        assert!((q[0] - -6.0).abs() < 0.1 && (q[1] - -20.0).abs() < 0.1);
    }

    #[test]
    #[ignore] // PRODECK_REC_DEVICE="NDI Audio" cargo test --lib multitrack::tests::device_stream -- --ignored --nocapture
    fn device_stream() {
        let Ok(name) = std::env::var("PRODECK_REC_DEVICE") else { return };
        let (tx, rx) = sync_channel::<Vec<f32>>(QUEUE_BLOCKS);
        let stop = Arc::new(AtomicBool::new(false));
        let audio: AudioState = Arc::new(crate::audio::AudioInner::new());
        let (sr, ch) = open_device_stream(name.clone(), tx, stop.clone(), audio).unwrap();
        let t0 = std::time::Instant::now();
        let mut samples = 0usize;
        while t0.elapsed().as_secs() < 2 {
            if let Ok(b) = rx.recv_timeout(std::time::Duration::from_millis(300)) {
                samples += b.len();
            }
        }
        stop.store(true, Ordering::Relaxed);
        println!("{name}: {sr} Hz × {ch} ch, {} frames in 2 s", samples / ch.max(1));
        assert!(samples / ch.max(1) > (sr as usize) / 2);
        // After stop the stream goes quiet (the writer then finishes on its
        // own: stop set + an empty queue).
        std::thread::sleep(std::time::Duration::from_millis(600));
        while rx.try_recv().is_ok() {}
        std::thread::sleep(std::time::Duration::from_millis(800));
        assert!(rx.try_recv().is_err(), "no audio should arrive after stop");
    }
}
