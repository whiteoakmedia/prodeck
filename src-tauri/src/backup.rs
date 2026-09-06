//! Backup & restore: one JSON bundle of every data file ProDeck owns.
//! Includes settings.json — and therefore every secret — by design: this is
//! how a church moves to a new Mac or recovers a dead one. The UI says so.

use serde_json::{json, Map, Value};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// Data files worth carrying. Big binaries (models/, ndi-lib/) and *.bak
/// siblings are deliberately not included.
const FILES: &[&str] = &[
    "settings.json",
    "dashboards.json",
    "pco.json",
    "identity.json",
    "checkin.json",
    "schedules.json",
    "checklists.json",
    "reports.json",
    "tracking.json",
    "avantis.json",
    "push.json",
    "posfiles.json",
    "tap.json",
    "ga4-key.json",
];

fn bundle() -> Result<Value, String> {
    let dir = crate::settings::data_dir();
    let mut files = Map::new();
    for name in FILES {
        let p = dir.join(name);
        if !p.is_file() {
            continue;
        }
        let txt = std::fs::read_to_string(&p).map_err(|e| format!("{name}: {e}"))?;
        // Store parsed JSON when it parses (readable bundle), else raw text.
        let v = serde_json::from_str::<Value>(&txt).unwrap_or(Value::String(txt));
        files.insert(name.to_string(), v);
    }
    Ok(json!({
        "prodeck_backup": 1,
        "created": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
        "host": String::from_utf8_lossy(
            &std::process::Command::new("/bin/hostname").arg("-s").output().map(|o| o.stdout).unwrap_or_default()
        ).trim().to_string(),
        "files": files,
    }))
}

/// Write the bundle to ~/Desktop and reveal it in Finder. Returns the path.
#[tauri::command]
pub fn backup_export(app: AppHandle) -> Result<String, String> {
    let b = bundle()?;
    let desk = dirs::desktop_dir().or_else(dirs::home_dir).ok_or("no home directory")?;
    let secs = b["created"].as_u64().unwrap_or(0);
    // YYYYMMDD from epoch without chrono: good enough for a filename.
    let days = secs / 86_400;
    let (y, m, d) = civil_from_days(days as i64);
    let path = desk.join(format!("ProDeck-backup-{y:04}{m:02}{d:02}.json"));
    let txt = serde_json::to_string_pretty(&b).map_err(|e| e.to_string())?;
    std::fs::write(&path, txt).map_err(|e| e.to_string())?;
    let _ = app.opener().reveal_item_in_dir(&path);
    crate::diag::log(format!("[backup] exported {}", path.display()));
    Ok(path.display().to_string())
}

/// Restore from bundle text. Every file being replaced is first copied to
/// `<name>.pre-restore`, writes are atomic, and the caller relaunches the app
/// so every module reloads from disk.
#[tauri::command]
pub fn backup_import(text: String) -> Result<Value, String> {
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("not a ProDeck backup: {e}"))?;
    if v.get("prodeck_backup").and_then(|x| x.as_u64()) != Some(1) {
        return Err("not a ProDeck backup file".into());
    }
    let files = v.get("files").and_then(|f| f.as_object()).ok_or("backup has no files")?;
    let dir = crate::settings::data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut restored = Vec::new();
    for (name, content) in files {
        if !FILES.contains(&name.as_str()) {
            continue; // never write a file name we don't own
        }
        let txt = match content {
            Value::String(s) => s.clone(),
            other => serde_json::to_string_pretty(other).map_err(|e| e.to_string())?,
        };
        let p = dir.join(name);
        if p.exists() {
            let _ = std::fs::copy(&p, dir.join(format!("{name}.pre-restore")));
        }
        crate::settings::write_text_atomic(&p, &txt)?;
        restored.push(name.clone());
    }
    crate::diag::log(format!("[backup] restored {} files", restored.len()));
    Ok(json!({ "restored": restored }))
}

/// Days since 1970-01-01 → (y, m, d). Howard Hinnant's algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
