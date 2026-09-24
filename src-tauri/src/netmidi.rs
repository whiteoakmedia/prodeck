//! Keeps the key-send rtpMIDI session connected.
//!
//! Song Key → Waves goes out a macOS Network MIDI session ("Network Lyrics")
//! to an rtpMIDI peer on the Waves PC. macOS forgets that connection whenever
//! either machine restarts, and until someone opens Audio MIDI Setup and
//! presses Connect the key changes go nowhere. This watches the session the
//! key-send port belongs to, remembers the peers it has seen connected, and
//! reconnects them when they drop — the same property Audio MIDI Setup
//! writes (`apple.midirtp.session` → `peers`).
//!
//! Peers are learned, not configured: the first time the session is seen
//! healthy its peers are saved to `netmidi-peers.json`. Order of boot doesn't
//! matter — if the Waves PC comes up later, the next tick connects it.

use serde_json::json;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

static STATUS: Mutex<Option<serde_json::Value>> = Mutex::new(None);

const TICK: Duration = Duration::from_secs(20);

#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]
struct Peer {
    name: String,
    address: String,
}

fn peers_path() -> std::path::PathBuf {
    crate::settings::data_dir().join("netmidi-peers.json")
}

fn load_remembered() -> std::collections::BTreeMap<String, Vec<Peer>> {
    std::fs::read(peers_path())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_remembered(m: &std::collections::BTreeMap<String, Vec<Peer>>) {
    if let Ok(b) = serde_json::to_vec_pretty(m) {
        let tmp = peers_path().with_extension("json.tmp");
        if std::fs::write(&tmp, b).is_ok() {
            let _ = std::fs::rename(tmp, peers_path());
        }
    }
}

/// "Network Lyrics" → "Lyrics". Only Network MIDI ports are ours to keep.
fn session_of(port: &str) -> Option<&str> {
    port.strip_prefix("Network ").map(str::trim).filter(|s| !s.is_empty())
}

fn healthy(state: &str) -> bool {
    matches!(state, "running" | "connected")
}

#[tauri::command]
pub fn netmidi_status() -> serde_json::Value {
    STATUS.lock().unwrap_or_else(|p| p.into_inner()).clone().unwrap_or(serde_json::Value::Null)
}

pub fn spawn_keeper(app: AppHandle) {
    std::thread::Builder::new()
        .name("netmidi-keeper".into())
        .spawn(move || {
            let mut remembered = load_remembered();
            let mut bad_ticks = 0u32;
            let mut repairs = 0u32;
            let mut last_repair: Option<u64> = None;
            loop {
                let (port, extra) = {
                    let st = app.state::<crate::settings::SettingsState>();
                    let s = st.lock().unwrap_or_else(|p| p.into_inner());
                    (s.keysend_midi_port.clone(), s.follow_midi_port.clone())
                };
                // Auto-Follow's MIDI Clock session is kept the same way,
                // quietly (its status isn't shown on the key strip).
                if let Some(sess) = extra.as_deref().and_then(session_of) {
                    keep_quiet(sess, &mut remembered);
                }
                let Some(session) = port.as_deref().and_then(session_of).map(str::to_string) else {
                    *STATUS.lock().unwrap_or_else(|p| p.into_inner()) = None;
                    std::thread::sleep(TICK);
                    continue;
                };
                match sys::read_session(&session) {
                    Some(mut sess) => {
                        let peers = sys::peers_of(&sess);
                        let ok: Vec<Peer> = peers
                            .iter()
                            .filter(|(_, _, st)| healthy(st))
                            .map(|(n, a, _)| Peer { name: n.clone(), address: a.clone() })
                            .collect();
                        let want = remembered.get(&session).cloned().unwrap_or_default();
                        if !ok.is_empty() {
                            bad_ticks = 0;
                            if want != ok {
                                remembered.insert(session.clone(), ok);
                                save_remembered(&remembered);
                            }
                        } else if !want.is_empty() {
                            bad_ticks += 1;
                            // Nobody connected: ask again. A peer stuck in some
                            // other state gets one more tick to settle first,
                            // then is cleared and re-added.
                            if peers.is_empty() || bad_ticks >= 2 {
                                if !peers.is_empty() {
                                    sys::set_peers(&session, &mut sess, &[]);
                                    std::thread::sleep(Duration::from_secs(1));
                                }
                                if sys::set_peers(&session, &mut sess, &want) {
                                    repairs += 1;
                                    last_repair = Some(now_ms());
                                    eprintln!(
                                        "[netmidi] session {session}: reconnecting {}",
                                        want.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(", ")
                                    );
                                }
                                bad_ticks = 0;
                            }
                        }
                        let peers = sys::read_session(&session).map(|s| sys::peers_of(&s)).unwrap_or(peers);
                        let connected = peers.iter().any(|(_, _, st)| healthy(st));
                        let changed = STATUS
                            .lock()
                            .unwrap_or_else(|p| p.into_inner())
                            .as_ref()
                            .and_then(|v| v.get("connected"))
                            .and_then(|v| v.as_bool())
                            != Some(connected);
                        *STATUS.lock().unwrap_or_else(|p| p.into_inner()) = Some(json!({
                            "session": session,
                            "peers": peers.iter().map(|(n, _, st)| json!({ "name": n, "state": st })).collect::<Vec<_>>(),
                            "connected": connected,
                            "remembered": remembered.get(&session).map(|v| v.iter().map(|p| p.name.clone()).collect::<Vec<_>>()).unwrap_or_default(),
                            "repairs": repairs,
                            "lastRepairAt": last_repair,
                        }));
                        if changed {
                            crate::midi::keysend_rtp_changed(&app);
                        }
                    }
                    None => {
                        *STATUS.lock().unwrap_or_else(|p| p.into_inner()) =
                            Some(json!({ "session": session, "error": "no such Network MIDI session" }));
                    }
                }
                std::thread::sleep(TICK);
            }
        })
        .ok();
}

/// Learn/repair one session without touching STATUS (for sessions other than
/// the key-send one).
fn keep_quiet(session: &str, remembered: &mut std::collections::BTreeMap<String, Vec<Peer>>) {
    let Some(mut sess) = sys::read_session(session) else { return };
    let peers = sys::peers_of(&sess);
    let ok: Vec<Peer> = peers.iter().filter(|(_, _, st)| healthy(st)).map(|(n, a, _)| Peer { name: n.clone(), address: a.clone() }).collect();
    let want = remembered.get(session).cloned().unwrap_or_default();
    if !ok.is_empty() {
        // Remember everyone who's connected (a peer that's merely offline
        // today is kept from before).
        let mut merged = want.clone();
        for p in ok {
            if !merged.contains(&p) {
                merged.push(p);
            }
        }
        if merged != want {
            remembered.insert(session.to_string(), merged);
            save_remembered(remembered);
        }
    } else if !want.is_empty() && peers.is_empty() && sys::set_peers(session, &mut sess, &want) {
        eprintln!("[netmidi] session {session}: reconnecting");
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(target_os = "macos")]
mod sys {
    use super::Peer;
    use core_foundation_sys::base::{kCFAllocatorDefault, CFRelease, CFTypeRef};
    use core_foundation_sys::data::{CFDataCreate, CFDataGetBytePtr, CFDataGetLength};
    use core_foundation_sys::dictionary::CFDictionaryRef;
    use core_foundation_sys::propertylist::{
        kCFPropertyListImmutable, kCFPropertyListXMLFormat_v1_0, CFPropertyListCreateData, CFPropertyListCreateWithData,
    };
    use core_foundation_sys::string::{kCFStringEncodingUTF8, CFStringCreateWithBytes, CFStringGetCString, CFStringRef};
    use coremidi_sys::*;

    const SESSION_KEY: &str = "apple.midirtp.session";
    const DRIVER: &str = "com.apple.AppleMIDINetworkDriver";

    fn cfstr(s: &str) -> CFStringRef {
        unsafe { CFStringCreateWithBytes(kCFAllocatorDefault, s.as_ptr(), s.len() as _, kCFStringEncodingUTF8, 0) }
    }

    fn string_prop(obj: MIDIObjectRef, key: CFStringRef) -> Option<String> {
        unsafe {
            let mut out: CFStringRef = std::ptr::null();
            if MIDIObjectGetStringProperty(obj, key, &mut out) != 0 || out.is_null() {
                return None;
            }
            let mut buf = [0i8; 256];
            let ok = CFStringGetCString(out, buf.as_mut_ptr(), buf.len() as _, kCFStringEncodingUTF8);
            CFRelease(out as CFTypeRef);
            (ok != 0).then(|| std::ffi::CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned())
        }
    }

    /// The entity of the Network MIDI device whose name is `session`.
    fn entity(session: &str) -> Option<MIDIEntityRef> {
        unsafe {
            for i in 0..MIDIGetNumberOfDevices() {
                let dev = MIDIGetDevice(i);
                if string_prop(dev, kMIDIPropertyDriverOwner).as_deref() != Some(DRIVER) {
                    continue;
                }
                for j in 0..MIDIDeviceGetNumberOfEntities(dev) {
                    let e = MIDIDeviceGetEntity(dev, j);
                    if string_prop(e, kMIDIPropertyName).as_deref() == Some(session) {
                        return Some(e);
                    }
                }
            }
            None
        }
    }

    /// The session dictionary, round-tripped through XML so it can be read and
    /// edited as a plist value.
    pub fn read_session(session: &str) -> Option<plist::Dictionary> {
        let e = entity(session)?;
        unsafe {
            let key = cfstr(SESSION_KEY);
            let mut dict: CFDictionaryRef = std::ptr::null();
            let st = MIDIObjectGetDictionaryProperty(e, key, &mut dict);
            CFRelease(key as CFTypeRef);
            if st != 0 || dict.is_null() {
                return None;
            }
            let data = CFPropertyListCreateData(
                kCFAllocatorDefault,
                dict as _,
                kCFPropertyListXMLFormat_v1_0,
                0,
                std::ptr::null_mut(),
            );
            CFRelease(dict as CFTypeRef);
            if data.is_null() {
                return None;
            }
            let bytes = std::slice::from_raw_parts(CFDataGetBytePtr(data), CFDataGetLength(data) as usize).to_vec();
            CFRelease(data as CFTypeRef);
            plist::Value::from_reader_xml(&bytes[..]).ok()?.into_dictionary()
        }
    }

    /// (name, address, state) for each peer.
    pub fn peers_of(sess: &plist::Dictionary) -> Vec<(String, String, String)> {
        let s = |d: &plist::Dictionary, k: &str| d.get(k).and_then(|v| v.as_string()).unwrap_or("").to_string();
        sess.get("peers")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|p| p.as_dictionary())
                    .map(|d| (s(d, "name"), s(d, "address"), s(d, "state")))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn set_peers(session: &str, sess: &mut plist::Dictionary, peers: &[Peer]) -> bool {
        let Some(e) = entity(session) else { return false };
        let arr: Vec<plist::Value> = peers
            .iter()
            .map(|p| {
                let mut d = plist::Dictionary::new();
                d.insert("name".into(), p.name.clone().into());
                d.insert("address".into(), p.address.clone().into());
                plist::Value::Dictionary(d)
            })
            .collect();
        sess.insert("peers".into(), plist::Value::Array(arr));
        let mut xml = Vec::new();
        if plist::Value::Dictionary(sess.clone()).to_writer_xml(&mut xml).is_err() {
            return false;
        }
        unsafe {
            let data = CFDataCreate(kCFAllocatorDefault, xml.as_ptr(), xml.len() as _);
            let dict = CFPropertyListCreateWithData(
                kCFAllocatorDefault,
                data,
                kCFPropertyListImmutable,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            );
            CFRelease(data as CFTypeRef);
            if dict.is_null() {
                return false;
            }
            let key = cfstr(SESSION_KEY);
            let st = MIDIObjectSetDictionaryProperty(e, key, dict as CFDictionaryRef);
            CFRelease(key as CFTypeRef);
            CFRelease(dict);
            st == 0
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod sys {
    use super::Peer;
    pub fn read_session(_: &str) -> Option<plist::Dictionary> {
        None
    }
    pub fn peers_of(_: &plist::Dictionary) -> Vec<(String, String, String)> {
        Vec::new()
    }
    pub fn set_peers(_: &str, _: &mut plist::Dictionary, _: &[Peer]) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_network_ports_have_a_session() {
        assert_eq!(session_of("Network Lyrics"), Some("Lyrics"));
        assert_eq!(session_of("Network RTP Session 4"), Some("RTP Session 4"));
        assert_eq!(session_of("IAC Driver Bus 1"), None);
        assert_eq!(session_of("Network "), None);
    }

    /// Touches the real CoreMIDI network driver: reads "Lyrics", connects the
    /// spare "RTP Session 4" to the given address, then clears it again.
    /// `NETMIDI_PEER=172.16.0.139:5004 cargo test --lib netmidi -- --ignored`
    #[test]
    #[ignore]
    fn live_round_trip() {
        let addr = std::env::var("NETMIDI_PEER").expect("NETMIDI_PEER");
        let lyr = sys::read_session("Lyrics").expect("Lyrics session");
        println!("Lyrics peers: {:?}", sys::peers_of(&lyr));
        let mut s4 = sys::read_session("RTP Session 4").expect("spare session");
        assert!(sys::set_peers("RTP Session 4", &mut s4, &[Peer { name: "Axis_One".into(), address: addr }]));
        std::thread::sleep(Duration::from_secs(4));
        let after = sys::peers_of(&sys::read_session("RTP Session 4").unwrap());
        println!("RTP Session 4 after connect: {after:?}");
        assert!(after.iter().any(|(_, _, st)| healthy(st)));
        assert!(sys::set_peers("RTP Session 4", &mut s4, &[]));
    }
}
