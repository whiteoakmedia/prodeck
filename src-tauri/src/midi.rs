use midir::{MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub struct MidiState(pub Mutex<Option<MidiInputConnection<()>>>);

impl MidiState {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

// The MIDI OUTPUT used to push the song key to a backing-track / vocal-tune rig
// (a Program Change that recalls a per-key snapshot), by port name. The
// connection is reopened for every send: when the network-MIDI session is
// rebuilt (the Waves PC reboots, the keeper re-invites it) CoreMIDI gives the
// port a new endpoint, and a connection held from before keeps "working" —
// no error — while nothing reaches the rig.
pub struct MidiOutState(pub Mutex<Option<(String, MidiOutputConnection)>>);

impl MidiOutState {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

#[tauri::command]
pub fn list_midi_outputs() -> Result<Vec<String>, String> {
    let midi_out = MidiOutput::new("ProDeck-out").map_err(|e| e.to_string())?;
    Ok(midi_out
        .ports()
        .iter()
        .filter_map(|p| midi_out.port_name(p).ok())
        .collect())
}

fn open_out(port_name: &str) -> Result<MidiOutputConnection, String> {
    let midi_out = MidiOutput::new("ProDeck-out").map_err(|e| e.to_string())?;
    let ports = midi_out.ports();
    let port = ports
        .iter()
        .find(|p| midi_out.port_name(p).map(|n| n == port_name).unwrap_or(false))
        .cloned()
        .ok_or_else(|| format!("MIDI output port \"{port_name}\" not found"))?;
    midi_out.connect(&port, "prodeck-out").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn connect_midi_out(
    port_name: String,
    state: tauri::State<'_, MidiOutState>,
) -> Result<(), String> {
    let conn = open_out(&port_name)?;
    *state.0.lock().unwrap_or_else(|p| p.into_inner()) = Some((port_name, conn));
    Ok(())
}

#[tauri::command]
pub fn disconnect_midi_out(state: tauri::State<'_, MidiOutState>) {
    *state.0.lock().unwrap_or_else(|p| p.into_inner()) = None;
}

/// Send a key (pitch class 0–11) on the MIDI output as a Program Change, plus the
/// same value as a Control Change when cc_num is 0–127 (set cc_num to -1 to skip
/// the CC). Receivers map "program N" / "CC value N" to their per-key state.
#[tauri::command]
pub fn midi_send_key(
    channel: u8,
    value: u8,
    cc_num: i32,
    state: tauri::State<'_, MidiOutState>,
) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap_or_else(|p| p.into_inner());
    let name = guard.as_ref().map(|(n, _)| n.clone()).ok_or_else(|| "No MIDI output connected".to_string())?;
    // A fresh connection to the port as it exists NOW (see MidiOutState).
    match open_out(&name) {
        Ok(c) => *guard = Some((name.clone(), c)),
        Err(e) => eprintln!("[midi] reopen {name} failed ({e}); sending on the old connection"),
    }
    let conn = &mut guard.as_mut().ok_or_else(|| "No MIDI output connected".to_string())?.1;
    // The UI speaks MIDI channels 1–16; the status-byte nibble is 0-based. Using
    // the raw number as the nibble sent everything one channel high (and 16
    // wrapped to channel 1).
    let ch = channel.clamp(1, 16) - 1;
    let v = value & 0x7F;
    conn.send(&[0xC0 | ch, v]).map_err(|e| e.to_string())?; // Program Change
    if (0..=127).contains(&cc_num) {
        conn.send(&[0xB0 | ch, cc_num as u8, v])
            .map_err(|e| e.to_string())?; // Control Change
    }
    Ok(())
}

#[tauri::command]
pub fn list_midi_inputs() -> Result<Vec<String>, String> {
    let midi_in = MidiInput::new("ProDeck").map_err(|e| e.to_string())?;
    Ok(midi_in
        .ports()
        .iter()
        .filter_map(|p| midi_in.port_name(p).ok())
        .collect())
}

#[tauri::command]
pub fn connect_midi(
    port_name: String,
    state: tauri::State<'_, MidiState>,
    app: AppHandle,
) -> Result<(), String> {
    let midi_in = MidiInput::new("ProDeck-in").map_err(|e| e.to_string())?;
    let ports = midi_in.ports();
    let port = ports
        .iter()
        .find(|p| {
            midi_in
                .port_name(p)
                .map(|n| n == port_name)
                .unwrap_or(false)
        })
        .cloned()
        .ok_or_else(|| "MIDI port not found".to_string())?;

    let app2 = app.clone();
    let conn = midi_in
        .connect(
            &port,
            "prodeck-in",
            move |_stamp, message, _| {
                let status = message.first().copied().unwrap_or(0);
                let kind = match status & 0xF0 {
                    0x90 if message.get(2).copied().unwrap_or(0) > 0 => "note_on",
                    0x90 | 0x80 => "note_off",
                    0xB0 => "cc",
                    0xC0 => "program",
                    _ => "other",
                };
                app2.emit(
                    "midi:message",
                    serde_json::json!({
                        "kind": kind,
                        // 1-based, matching how the UI (and every MIDI device
                        // label) numbers channels.
                        "channel": (status & 0x0F) + 1,
                        "data1": message.get(1).copied().unwrap_or(0),
                        "data2": message.get(2).copied().unwrap_or(0),
                        "raw": message,
                    }),
                )
                .ok();
            },
            (),
        )
        .map_err(|e| e.to_string())?;

    *state.0.lock().unwrap_or_else(|p| p.into_inner()) = Some(conn);
    app.emit("midi:connected", port_name).ok();
    Ok(())
}

#[tauri::command]
pub fn disconnect_midi(state: tauri::State<'_, MidiState>, app: AppHandle) {
    // Dropping the connection closes the port.
    *state.0.lock().unwrap_or_else(|p| p.into_inner()) = None;
    app.emit("midi:disconnected", ()).ok();
}

// ---- Song Key → rig: shared state + request relay -------------------------
//
// The key-send loop runs in the booth's frontend (it owns the MIDI/OSC
// connections). Phones and the ProPresenter page need to SEE what was sent
// and, with Control, ASK for a key. So the booth publishes its state here
// (emitted as keysend:state, forwarded to web) and a web request becomes a
// keysend:request event the booth frontend acts on through its own loop.

pub struct KeySendState(pub Mutex<serde_json::Value>);

/// "G", "C#", "Db", "Bbm", "F# major" → 0–11 (C = 0). None for anything else.
pub fn pitch_class(key: &str) -> Option<u8> {
    let mut ch = key.trim().chars();
    let base: i8 = match ch.next()?.to_ascii_uppercase() {
        'C' => 0,
        'D' => 2,
        'E' => 4,
        'F' => 5,
        'G' => 7,
        'A' => 9,
        'B' => 11,
        _ => return None,
    };
    let acc: i8 = match ch.next() {
        Some('#') | Some('♯') => 1,
        Some('b') | Some('♭') => -1,
        _ => 0,
    };
    Some((base + acc).rem_euclid(12) as u8)
}

#[tauri::command]
pub fn keysend_set_state(mut state: serde_json::Value, st: tauri::State<'_, KeySendState>, app: tauri::AppHandle) {
    // The rtpMIDI session keeper's view rides along (see netmidi.rs).
    if let Some(o) = state.as_object_mut() {
        o.insert("rtp".into(), crate::netmidi::netmidi_status());
    }
    *st.0.lock().unwrap_or_else(|p| p.into_inner()) = state.clone();
    use tauri::Emitter;
    app.emit("keysend:state", state).ok();
}

/// The keeper saw the session's connection change: refresh the published
/// state so the strip (booth and phones) shows it without waiting for a send.
pub fn keysend_rtp_changed(app: &tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    let st = app.state::<KeySendState>();
    let mut g = st.0.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(o) = g.as_object_mut() {
        o.insert("rtp".into(), crate::netmidi::netmidi_status());
        app.emit("keysend:state", g.clone()).ok();
    }
}

#[tauri::command]
pub fn keysend_state(st: tauri::State<'_, KeySendState>) -> serde_json::Value {
    st.0.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

/// A key someone asked for (a key name like "G", or "off" for the tune-off
/// scene). The booth frontend hears keysend:request and sends it.
pub fn keysend_request_core(app: &tauri::AppHandle, key: &str, who: &str) {
    use tauri::Emitter;
    app.emit("keysend:request", serde_json::json!({ "key": key, "who": who })).ok();
}

#[tauri::command]
pub fn keysend_request(key: String, app: tauri::AppHandle) {
    keysend_request_core(&app, &key, "booth");
}

#[cfg(test)]
mod tests {
    use super::pitch_class;
    #[test]
    fn keys_to_pitch_classes() {
        assert_eq!(pitch_class("C"), Some(0));
        assert_eq!(pitch_class("C#"), Some(1));
        assert_eq!(pitch_class("Db"), Some(1));
        assert_eq!(pitch_class("Bbm"), Some(10));
        assert_eq!(pitch_class("Cb"), Some(11));
        assert_eq!(pitch_class("g"), Some(7));
        assert_eq!(pitch_class("off"), None);
        assert_eq!(pitch_class(""), None);
    }
}
