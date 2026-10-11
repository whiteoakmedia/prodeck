//! Church Online Platform: the booth's summary of what's happening online.
//!
//! The booth window fetches ChOP's current service and polls the church's
//! webhook inbox on White Oak's relay (src/lib/chop.ts, feedback-edge/src/
//! chop.ts), works out the totals, and hands them here. This only keeps the
//! latest copy and announces it as `chop:state`, which the web gateway passes
//! to phones and kiosks (and replays to one that connects later).

use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub struct ChopState(pub Mutex<Value>);

#[tauri::command]
pub fn chop_set_state(state: Value, st: tauri::State<'_, ChopState>, app: AppHandle) {
    *st.0.lock().unwrap_or_else(|p| p.into_inner()) = state.clone();
    app.emit("chop:state", state).ok();
}

#[tauri::command]
pub fn chop_get_state(st: tauri::State<'_, ChopState>) -> Value {
    st.0.lock().unwrap_or_else(|p| p.into_inner()).clone()
}
