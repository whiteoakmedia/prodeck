// Position files — reference material attached to a Planning Center position:
// a wiring diagram, a scene-layout PDF, a one-page cheat sheet.
//
// Same rule as position guides: whoever is scheduled to the position this week
// sees the files on their phone, everyone else sees nothing. The booth owns
// them, so a phone can only read.
//
// Blobs are stored by generated id, never by the uploaded filename — an
// operator pasting "../../settings.json" as a name must not be able to reach
// outside the store, and two people attaching "checklist.pdf" to different
// positions must not collide. The original name is kept as a display label
// only, and is never used to build a path.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// Per-file cap. Big enough for a scanned PDF, small enough that a volunteer on
/// cellular in the car park isn't waiting on a 60MB download.
const MAX_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PosFile {
    pub id: String,
    /// PCO position this belongs to, matched loosely on the phone just like
    /// guides ("Camera" covers "Camera 1").
    pub position: String,
    /// Original filename — shown to the volunteer, never used as a path.
    pub name: String,
    pub mime: String,
    pub size: u64,
    pub added_ms: u64,
}

#[derive(Default)]
pub struct PosFilesInner {
    index: Mutex<Vec<PosFile>>,
}

pub type PosFilesState = Arc<PosFilesInner>;

fn dir() -> PathBuf {
    let mut d = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    d.push("ProDeck");
    d.push("position-files");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn index_path() -> PathBuf {
    dir().join("index.json")
}

fn blob_path(id: &str) -> PathBuf {
    dir().join(id)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl PosFilesInner {
    pub fn load() -> Self {
        let index = std::fs::read_to_string(index_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self { index: Mutex::new(index) }
    }

    fn persist(&self, list: &[PosFile]) {
        if let Ok(json) = serde_json::to_string_pretty(list) {
            let tmp = index_path().with_extension("json.tmp");
            if std::fs::write(&tmp, json).is_ok() {
                let _ = std::fs::rename(&tmp, index_path());
            }
        }
    }
}

/// Reject anything that isn't a plain generated id. The read route takes the id
/// straight from the URL, so this is the boundary that keeps `/api/file/..%2f..`
/// from turning into an arbitrary file read.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub fn list_core(state: &PosFilesState) -> Vec<PosFile> {
    state.index.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

pub fn add_core(
    app: &AppHandle,
    state: &PosFilesState,
    position: String,
    name: String,
    mime: String,
    data_b64: String,
) -> Result<PosFile, String> {
    let position = position.trim().chars().take(64).collect::<String>();
    if position.is_empty() {
        return Err("pick a position first".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_b64.as_bytes())
        .map_err(|_| "that file didn't upload cleanly — try again".to_string())?;
    if bytes.is_empty() {
        return Err("that file is empty".into());
    }
    if bytes.len() > MAX_BYTES {
        return Err(format!(
            "that file is {:.1}MB — the limit is {}MB so phones can actually load it",
            bytes.len() as f64 / 1_048_576.0,
            MAX_BYTES / 1_048_576
        ));
    }
    // Display label only: strip any path structure so a crafted name can never
    // be mistaken for a location, and keep it to something a phone can show.
    let name = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("file")
        .trim()
        .chars()
        .take(120)
        .collect::<String>();
    let f = PosFile {
        id: uuid::Uuid::new_v4().to_string(),
        position,
        name: if name.is_empty() { "file".into() } else { name },
        mime: mime.trim().chars().take(100).collect(),
        size: bytes.len() as u64,
        added_ms: now_ms(),
    };
    std::fs::write(blob_path(&f.id), &bytes).map_err(|e| e.to_string())?;
    {
        let mut idx = state.index.lock().unwrap_or_else(|p| p.into_inner());
        idx.push(f.clone());
        state.persist(&idx);
    }
    app.emit("posfiles:changed", json!({})).ok();
    Ok(f)
}

pub fn remove_core(app: &AppHandle, state: &PosFilesState, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("no such file".into());
    }
    {
        let mut idx = state.index.lock().unwrap_or_else(|p| p.into_inner());
        let before = idx.len();
        idx.retain(|f| f.id != id);
        if idx.len() == before {
            return Err("no such file".into());
        }
        state.persist(&idx);
    }
    let _ = std::fs::remove_file(blob_path(&id));
    app.emit("posfiles:changed", json!({})).ok();
    Ok(())
}

/// Bytes + mime for the gateway's read route. `None` for anything not in the
/// index — the index is the allow-list, so an id that isn't filed is not served
/// even if a file by that name happens to exist on disk.
pub fn read_blob(state: &PosFilesState, id: &str) -> Option<(String, String, Vec<u8>)> {
    if !valid_id(id) {
        return None;
    }
    let meta = {
        let idx = state.index.lock().unwrap_or_else(|p| p.into_inner());
        idx.iter().find(|f| f.id == id).cloned()?
    };
    let bytes = std::fs::read(blob_path(id)).ok()?;
    Some((meta.mime, meta.name, bytes))
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn posfile_list(state: tauri::State<'_, PosFilesState>) -> Vec<PosFile> {
    list_core(state.inner())
}

#[tauri::command]
pub fn posfile_add(
    position: String,
    name: String,
    mime: String,
    data: String,
    state: tauri::State<'_, PosFilesState>,
    app: AppHandle,
) -> Result<PosFile, String> {
    add_core(&app, state.inner(), position, name, mime, data)
}

#[tauri::command]
pub fn posfile_remove(
    id: String,
    state: tauri::State<'_, PosFilesState>,
    app: AppHandle,
) -> Result<(), String> {
    remove_core(&app, state.inner(), id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_that_could_escape_the_store_are_refused() {
        assert!(valid_id("2f1a9c4e-0b7d-4a11-9f3e-1c2d3e4f5a6b"));
        assert!(!valid_id("../settings.json"));
        assert!(!valid_id("..%2f..%2fsettings"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id(""));
        assert!(!valid_id(&"x".repeat(65)));
    }

    #[test]
    fn an_uploaded_name_is_reduced_to_a_label() {
        // The same reduction add_core applies: no path structure survives.
        let reduce = |n: &str| n.rsplit(['/', '\\']).next().unwrap_or("file").to_string();
        assert_eq!(reduce("../../ProDeck/settings.json"), "settings.json");
        assert_eq!(reduce("C:\\notes\\cheat sheet.pdf"), "cheat sheet.pdf");
        assert_eq!(reduce("diagram.png"), "diagram.png");
    }
}
