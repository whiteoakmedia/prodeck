// FFI structs mirror the C ABI; many fields are written by C but unread in Rust.
#![allow(dead_code)]

// Real NDI receive pipeline: dynamically load libndi, discover sources via NDI
// find, receive low-bandwidth video, decode BGRX -> JPEG, and serve MJPEG (plus
// single-frame snapshots) over a local HTTP port that the UI renders in an <img>.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::{c_char, c_void, CStr, CString};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------- FFI types

#[repr(C)]
struct NdiSourceC {
    p_ndi_name: *const c_char,
    p_url_address: *const c_char,
}

#[repr(C)]
struct NdiFindCreateC {
    show_local_sources: bool,
    p_groups: *const c_char,
    p_extra_ips: *const c_char,
}

#[repr(C)]
struct NdiRecvCreateV3C {
    source_to_connect_to: NdiSourceC,
    color_format: i32,
    bandwidth: i32,
    allow_video_fields: bool,
    p_ndi_recv_name: *const c_char,
}

#[repr(C)]
struct NdiVideoFrameC {
    xres: i32,
    yres: i32,
    four_cc: i32,
    frame_rate_n: i32,
    frame_rate_d: i32,
    picture_aspect_ratio: f32,
    frame_format_type: i32,
    timecode: i64,
    p_data: *mut u8,
    line_stride_in_bytes: i32,
    p_metadata: *const c_char,
    timestamp: i64,
}

type FnInit = unsafe extern "C" fn() -> bool;
type FnFindCreate = unsafe extern "C" fn(*const NdiFindCreateC) -> *mut c_void;
type FnFindWait = unsafe extern "C" fn(*mut c_void, u32) -> bool;
type FnFindGet = unsafe extern "C" fn(*mut c_void, *mut u32) -> *const NdiSourceC;
type FnFindDestroy = unsafe extern "C" fn(*mut c_void);
type FnRecvCreate = unsafe extern "C" fn(*const NdiRecvCreateV3C) -> *mut c_void;
type FnRecvCapture =
    unsafe extern "C" fn(*mut c_void, *mut NdiVideoFrameC, *mut c_void, *mut c_void, u32) -> i32;
type FnRecvFreeVideo = unsafe extern "C" fn(*mut c_void, *const NdiVideoFrameC);
type FnRecvDestroy = unsafe extern "C" fn(*mut c_void);

struct NdiLib {
    _lib: libloading::Library,
    find_create: FnFindCreate,
    find_wait: FnFindWait,
    find_get: FnFindGet,
    find_destroy: FnFindDestroy,
    recv_create: FnRecvCreate,
    recv_capture: FnRecvCapture,
    recv_free_video: FnRecvFreeVideo,
    recv_destroy: FnRecvDestroy,
}
// Function pointers + a leaked Library are safe to share across threads.
unsafe impl Send for NdiLib {}
unsafe impl Sync for NdiLib {}

static NDI: OnceLock<Option<NdiLib>> = OnceLock::new();

fn ndi() -> Option<&'static NdiLib> {
    NDI.get_or_init(|| unsafe { load_ndi() }).as_ref()
}

unsafe fn load_ndi() -> Option<NdiLib> {
    // Own-copy fallback lives in the app's data dir so ProDeck has no
    // dependency on any other app bundle being installed.
    let own = dirs::data_dir()
        .map(|d| d.join("ProDeck/ndi-lib/libndi.dylib"))
        .and_then(|p| p.to_str().map(|s| s.to_string()))
        .unwrap_or_default();
    let candidates = [
        "/Library/NDI SDK for Apple/lib/macOS/libndi.dylib",
        own.as_str(),
        "/usr/local/lib/libndi.dylib",
        "libndi.dylib",
    ];
    for path in candidates {
        if path.is_empty() {
            continue;
        }
        let lib = match libloading::Library::new(path) {
            Ok(l) => l,
            Err(_) => continue,
        };
        // Copy each function pointer out of its Symbol (releasing the borrow of
        // `lib`) so we can move `lib` into the struct afterwards.
        macro_rules! load {
            ($t:ty, $name:expr) => {
                match lib.get::<$t>($name) {
                    Ok(s) => *s,
                    Err(_) => continue,
                }
            };
        }
        let init: FnInit = load!(FnInit, b"NDIlib_initialize\0");
        let find_create: FnFindCreate = load!(FnFindCreate, b"NDIlib_find_create_v2\0");
        let find_wait: FnFindWait = load!(FnFindWait, b"NDIlib_find_wait_for_sources\0");
        let find_get: FnFindGet = load!(FnFindGet, b"NDIlib_find_get_current_sources\0");
        let find_destroy: FnFindDestroy = load!(FnFindDestroy, b"NDIlib_find_destroy\0");
        let recv_create: FnRecvCreate = load!(FnRecvCreate, b"NDIlib_recv_create_v3\0");
        let recv_capture: FnRecvCapture = load!(FnRecvCapture, b"NDIlib_recv_capture_v2\0");
        let recv_free_video: FnRecvFreeVideo = load!(FnRecvFreeVideo, b"NDIlib_recv_free_video_v2\0");
        let recv_destroy: FnRecvDestroy = load!(FnRecvDestroy, b"NDIlib_recv_destroy\0");
        if !init() {
            continue;
        }
        return Some(NdiLib {
            _lib: lib,
            find_create,
            find_wait,
            find_get,
            find_destroy,
            recv_create,
            recv_capture,
            recv_free_video,
            recv_destroy,
        });
    }
    None
}

unsafe fn cstr(p: *const c_char) -> String {
    if p.is_null() {
        String::new()
    } else {
        CStr::from_ptr(p).to_string_lossy().into_owned()
    }
}

// ---------------------------------------------------------------- Discovery

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NdiSource {
    pub name: String,
    pub url_address: String,
}

fn discover_ndi() -> Vec<NdiSource> {
    let ndi = match ndi() {
        Some(n) => n,
        None => return Vec::new(),
    };
    unsafe {
        let create = NdiFindCreateC {
            show_local_sources: true,
            p_groups: ptr::null(),
            p_extra_ips: ptr::null(),
        };
        let finder = (ndi.find_create)(&create);
        if finder.is_null() {
            return Vec::new();
        }
        (ndi.find_wait)(finder, 1500);
        let mut n: u32 = 0;
        let arr = (ndi.find_get)(finder, &mut n);
        let mut out = Vec::new();
        if !arr.is_null() {
            for i in 0..n as isize {
                let s = &*arr.offset(i);
                out.push(NdiSource {
                    name: cstr(s.p_ndi_name),
                    url_address: cstr(s.p_url_address),
                });
            }
        }
        (ndi.find_destroy)(finder);
        out
    }
}

// ---------------------------------------------------------------- State

pub struct Receiver {
    pub running: Arc<AtomicBool>,
    pub port: u16,
    /// How many consumers (widgets, multiview tiles, phone viewers) asked for
    /// this source. The receiver is only torn down when the LAST one stops —
    /// without this, any single consumer unmounting killed the feed for
    /// everyone else watching the same camera.
    pub refs: u32,
}

pub struct NdiManager {
    pub receivers: HashMap<String, Receiver>,
}

impl NdiManager {
    pub fn new() -> Self {
        Self {
            receivers: HashMap::new(),
        }
    }
}

pub type NdiState = Arc<tokio::sync::Mutex<NdiManager>>;

type FrameSlot = Arc<Mutex<Option<Arc<Vec<u8>>>>>;

// ---------------------------------------------------------------- Commands

#[tauri::command]
pub async fn ndi_discover_sources(app: AppHandle) -> Result<Vec<NdiSource>, String> {
    if ndi().is_some() {
        let sources = tokio::task::spawn_blocking(discover_ndi)
            .await
            .map_err(|e| e.to_string())?;
        let _ = app.emit("ndi:sources", &sources);
        return Ok(sources);
    }
    // Fallback: mDNS browse if the NDI runtime isn't present.
    mdns_discover(&app).await
}

async fn mdns_discover(app: &AppHandle) -> Result<Vec<NdiSource>, String> {
    use mdns_sd::{ServiceDaemon, ServiceEvent};
    let mdns = ServiceDaemon::new().map_err(|e| e.to_string())?;
    let receiver = mdns.browse("_ndi._tcp.local.").map_err(|e| e.to_string())?;
    let found: Arc<tokio::sync::Mutex<Vec<NdiSource>>> =
        Arc::new(tokio::sync::Mutex::new(Vec::new()));
    let found_clone = found.clone();
    let _ = tokio::time::timeout(Duration::from_secs(3), async {
        while let Ok(event) = receiver.recv_async().await {
            if let ServiceEvent::ServiceResolved(info) = event {
                found_clone.lock().await.push(NdiSource {
                    name: info.get_fullname().to_string(),
                    url_address: info
                        .get_addresses()
                        .iter()
                        .next()
                        .map(|a| format!("{}:{}", a, info.get_port()))
                        .unwrap_or_default(),
                });
            }
        }
    })
    .await;
    let sources = found.lock().await.clone();
    let _ = app.emit("ndi:sources", &sources);
    Ok(sources)
}

#[tauri::command]
pub async fn ndi_start_receiver(
    source_name: String,
    state: tauri::State<'_, NdiState>,
    app: AppHandle,
) -> Result<u16, String> {
    start_receiver(source_name, state.inner(), &app).await
}

// Core, callable from the web gateway (which holds the Arc directly).
pub(crate) async fn start_receiver(
    source_name: String,
    state: &NdiState,
    app: &AppHandle,
) -> Result<u16, String> {
    if ndi().is_none() {
        return Err("NDI runtime not found — install NDI Tools or the NDI SDK.".into());
    }
    let mut mgr = state.lock().await;
    if let Some(r) = mgr.receivers.get_mut(&source_name) {
        // A receiver whose capture died (source vanished, recv failed) stays in
        // the map with running=false — treat it as absent so a retry actually
        // reconnects instead of returning a dead port forever.
        if r.running.load(Ordering::Acquire) {
            r.refs += 1;
            return Ok(r.port);
        }
        mgr.receivers.remove(&source_name);
    }

    // Bind the LAN (not just loopback) so relay clients can pull this feed.
    let listener = TcpListener::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let running = Arc::new(AtomicBool::new(true));
    let latest: FrameSlot = Arc::new(Mutex::new(None));

    {
        let running = running.clone();
        let latest = latest.clone();
        let app = app.clone();
        let name = source_name.clone();
        std::thread::spawn(move || capture_loop(name, running, latest, app));
    }
    {
        let running = running.clone();
        let latest = latest.clone();
        let app = app.clone();
        std::thread::spawn(move || serve(listener, latest, running, app));
    }

    mgr.receivers
        .insert(source_name.clone(), Receiver { running, port, refs: 1 });
    app.emit(
        "ndi:stream_started",
        serde_json::json!({ "port": port, "source": source_name }),
    )
    .ok();
    Ok(port)
}

#[tauri::command]
pub async fn ndi_stop_receiver(
    source_name: Option<String>,
    state: tauri::State<'_, NdiState>,
) -> Result<(), String> {
    stop_receiver(source_name, state.inner()).await
}

pub(crate) async fn stop_receiver(
    source_name: Option<String>,
    state: &NdiState,
) -> Result<(), String> {
    let mut mgr = state.lock().await;
    match source_name {
        Some(name) => {
            // Last consumer out turns off the light; earlier stops just
            // decrement so other widgets/phones keep their feed.
            if let Some(r) = mgr.receivers.get_mut(&name) {
                r.refs = r.refs.saturating_sub(1);
                if r.refs == 0 {
                    if let Some(r) = mgr.receivers.remove(&name) {
                        r.running.store(false, Ordering::Release);
                    }
                }
            }
        }
        None => {
            for (_, r) in mgr.receivers.drain() {
                r.running.store(false, Ordering::Release);
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- Capture

fn capture_loop(source_name: String, running: Arc<AtomicBool>, latest: FrameSlot, app: AppHandle) {
    let ndi = match ndi() {
        Some(n) => n,
        None => {
            running.store(false, Ordering::Release);
            return;
        }
    };

    // Resolve the source descriptor (name + url) via NDI find. On failure, mark
    // the receiver dead so start_receiver treats the map entry as stale and a
    // retry reconnects (instead of returning this dead port forever).
    let (name_c, url_c) = match find_source(ndi, &source_name) {
        Some(v) => v,
        None => {
            app.emit("ndi:error", format!("NDI source not found: {source_name}"))
                .ok();
            running.store(false, Ordering::Release);
            return;
        }
    };
    let recv_name = CString::new("ProDeck").unwrap_or_default();

    let recv = unsafe {
        let create = NdiRecvCreateV3C {
            source_to_connect_to: NdiSourceC {
                p_ndi_name: name_c.as_ptr(),
                p_url_address: url_c.as_ptr(),
            },
            color_format: 0, // BGRX_BGRA
            bandwidth: 0,     // lowest (proxy resolution)
            allow_video_fields: false,
            p_ndi_recv_name: recv_name.as_ptr(),
        };
        (ndi.recv_create)(&create)
    };
    if recv.is_null() {
        app.emit("ndi:error", "NDI receiver could not be created").ok();
        running.store(false, Ordering::Release);
        return;
    }
    // name_c / url_c kept alive below until the thread ends; NDI has copied them.

    // Health heartbeat: count frames per second and emit alive/fps so the UI can
    // detect a dead feed (camera unplugged, sender crashed, network drop).
    let mut frames: u32 = 0;
    let mut last_emit = Instant::now();

    while running.load(Ordering::Acquire) {
        let mut video: NdiVideoFrameC = unsafe { std::mem::zeroed() };
        let ft = unsafe {
            (ndi.recv_capture)(recv, &mut video, ptr::null_mut(), ptr::null_mut(), 200)
        };
        if ft == 1 {
            // video frame
            if !video.p_data.is_null() && video.xres > 0 && video.yres > 0 {
                frames += 1;
                let w = video.xres as usize;
                let h = video.yres as usize;
                let stride = if video.line_stride_in_bytes > 0 {
                    video.line_stride_in_bytes as usize
                } else {
                    w * 4
                };
                let data = unsafe { std::slice::from_raw_parts(video.p_data, stride * h) };
                if let Some(jpeg) = encode_jpeg_bgrx(data, w, h, stride) {
                    *latest.lock().unwrap_or_else(|p| p.into_inner()) = Some(Arc::new(jpeg));
                }
            }
            unsafe { (ndi.recv_free_video)(recv, &video) };
        }
        // ft == 0 (no frame / timeout) or other types: just loop.

        if last_emit.elapsed() >= Duration::from_millis(1000) {
            app.emit(
                "ndi:status",
                serde_json::json!({
                    "source": source_name,
                    "alive": frames > 0,
                    "fps": frames,
                    "stopped": false,
                }),
            )
            .ok();
            frames = 0;
            last_emit = Instant::now();
        }
    }

    unsafe { (ndi.recv_destroy)(recv) };
    // Final status so the UI knows this was an intentional stop (no alarm).
    app.emit(
        "ndi:status",
        serde_json::json!({
            "source": source_name,
            "alive": false,
            "fps": 0,
            "stopped": true,
        }),
    )
    .ok();
    drop(name_c);
    drop(url_c);
}

fn find_source(ndi: &NdiLib, name: &str) -> Option<(CString, CString)> {
    unsafe {
        let create = NdiFindCreateC {
            show_local_sources: true,
            p_groups: ptr::null(),
            p_extra_ips: ptr::null(),
        };
        let finder = (ndi.find_create)(&create);
        if finder.is_null() {
            return None;
        }
        (ndi.find_wait)(finder, 2500);
        let mut n: u32 = 0;
        let arr = (ndi.find_get)(finder, &mut n);
        let mut result = None;
        if !arr.is_null() {
            for i in 0..n as isize {
                let s = &*arr.offset(i);
                let nm = cstr(s.p_ndi_name);
                if nm == name || nm.contains(name) || name.contains(&nm) {
                    let url = cstr(s.p_url_address);
                    result = Some((
                        CString::new(nm).unwrap_or_default(),
                        CString::new(url).unwrap_or_default(),
                    ));
                    break;
                }
            }
        }
        (ndi.find_destroy)(finder);
        result
    }
}

fn encode_jpeg_bgrx(data: &[u8], w: usize, h: usize, stride: usize) -> Option<Vec<u8>> {
    let mut rgb = vec![0u8; w * h * 3];
    for y in 0..h {
        let row = y * stride;
        if row + w * 4 > data.len() {
            break;
        }
        for x in 0..w {
            let p = row + x * 4;
            let o = (y * w + x) * 3;
            rgb[o] = data[p + 2]; // R
            rgb[o + 1] = data[p + 1]; // G
            rgb[o + 2] = data[p]; // B
        }
    }
    let img = image::RgbImage::from_raw(w as u32, h as u32, rgb)?;
    let img = if w > 960 {
        let nh = ((h * 960) / w) as u32;
        image::imageops::resize(&img, 960, nh.max(1), image::imageops::FilterType::Triangle)
    } else {
        img
    };
    let mut buf = Vec::new();
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 72);
    enc.encode_image(&img).ok()?;
    Some(buf)
}

// ---------------------------------------------------------------- HTTP server

fn serve(listener: TcpListener, latest: FrameSlot, running: Arc<AtomicBool>, app: AppHandle) {
    listener.set_nonblocking(true).ok();
    while running.load(Ordering::Acquire) {
        match listener.accept() {
            Ok((stream, _)) => {
                let latest = latest.clone();
                let running = running.clone();
                let app = app.clone();
                std::thread::spawn(move || handle_conn(stream, latest, running, app));
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => break,
        }
    }
}

fn handle_conn(mut stream: TcpStream, latest: FrameSlot, running: Arc<AtomicBool>, app: AppHandle) {
    let mut buf = [0u8; 1024];
    let n = stream.read(&mut buf).unwrap_or(0);
    let req = String::from_utf8_lossy(&buf[..n]);

    // These ports bind 0.0.0.0 (phones/relay pull feeds over the LAN), so gate
    // them like every other stream: the booth's own UI arrives via loopback and
    // passes; anything remote must present the web-gateway token. Without this,
    // anyone on the LAN could watch every camera by port-scanning the booth.
    let local = stream
        .peer_addr()
        .map(|a| a.ip().is_loopback())
        .unwrap_or(false);
    if !local {
        let token = req
            .split_once("token=")
            .map(|(_, t)| {
                let t = t.split(&['&', ' ', '\r', '\n'][..]).next().unwrap_or("");
                urlencoding::decode(t).map(|c| c.into_owned()).unwrap_or_default()
            })
            .unwrap_or_default();
        let pw = app
            .try_state::<crate::settings::SettingsState>()
            .map(|s| s.lock().unwrap_or_else(|p| p.into_inner()).web_password.clone())
            .unwrap_or_default();
        if pw.is_empty() || token != pw {
            let _ = stream.write_all(
                b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
            return;
        }
    }

    let single = req.contains("frame.jpg") || req.contains("snapshot");

    if single {
        let frame = latest.lock().unwrap_or_else(|p| p.into_inner()).clone();
        match frame {
            Some(j) => {
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    j.len()
                );
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(&j);
            }
            None => {
                let _ = stream.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            }
        }
        return;
    }

    // MJPEG multipart stream.
    if stream
        .write_all(b"HTTP/1.1 200 OK\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: multipart/x-mixed-replace; boundary=ndiframe\r\n\r\n")
        .is_err()
    {
        return;
    }
    while running.load(Ordering::Acquire) {
        let frame = latest.lock().unwrap_or_else(|p| p.into_inner()).clone();
        if let Some(j) = frame {
            let header = format!(
                "--ndiframe\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n",
                j.len()
            );
            if stream.write_all(header.as_bytes()).is_err()
                || stream.write_all(&j).is_err()
                || stream.write_all(b"\r\n").is_err()
            {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(66)); // ~15 fps
    }
}

