//! Backup & restore: one JSON bundle of everything ProDeck knows.
//! Includes settings.json — and therefore every secret — by design: this is
//! how a church moves to a new Mac or recovers a dead one. The UI says so.
//!
//! Keeping the list correct is the whole job. The first version was written
//! from memory and silently omitted routing.json and every position guide,
//! while listing two files nothing writes — a backup that looks fine and
//! quietly loses data is worse than no backup. `bundle_from`/`restore_into`
//! take the directory as an argument so a round trip can actually be tested.

use base64::Engine;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::STANDARD;

/// Flat JSON files in the data directory. Verified against what the app
/// actually writes — if you add a new `config_dir().join("x.json")` anywhere,
/// add it here too, or a restore will lose it.
const FILES: &[&str] = &[
    "settings.json",   // every connection setting and secret
    "dashboards.json", // layouts
    "pco.json",        // mic assignments, key/leader overrides, plan links
    "identity.json",   // crew accounts, PINs, PCO links
    "checkin.json",
    "schedules.json",  // call-time pages
    "checklists.json",
    "reports.json",
    "tracking.json",
    "avantis.json",  // desk scene labels + softkeys
    "push.json",     // phone push subscriptions
    "routing.json",  // the Routing page's signal chains
    "ga4-key.json",  // Google service-account key
];

/// Position guides live in their own folder: an index plus the uploaded files.
/// These are the PDFs/images volunteers actually open, so a restore that drops
/// them isn't a restore.
const POSFILES_DIR: &str = "position-files";
/// Bundles are pasted around and mailed; don't let one grow without bound.
/// Anything skipped is named in the bundle rather than silently dropped.
const POSFILES_BUDGET: usize = 40 * 1024 * 1024;

/// A file name from a bundle is only ever written if it's a plain name — no
/// separators, no traversal. A corrupt or hostile bundle must not be able to
/// write outside the data directory.
fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0')
}

pub(crate) fn bundle_from(dir: &Path) -> Result<Value, String> {
    let mut files = Map::new();
    for name in FILES {
        let p = dir.join(name);
        if !p.is_file() {
            continue;
        }
        let txt = std::fs::read_to_string(&p).map_err(|e| format!("{name}: {e}"))?;
        // Parsed JSON when it parses (so a bundle is readable), else raw text.
        let v = serde_json::from_str::<Value>(&txt).unwrap_or(Value::String(txt));
        files.insert(name.to_string(), v);
    }

    // Position guides: base64, within a budget.
    let mut pos = Map::new();
    let mut skipped: Vec<String> = Vec::new();
    let pdir = dir.join(POSFILES_DIR);
    if pdir.is_dir() {
        let mut used = 0usize;
        let mut entries: Vec<PathBuf> = std::fs::read_dir(&pdir)
            .map_err(|e| e.to_string())?
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_file())
            .collect();
        entries.sort(); // deterministic bundles
        for p in entries {
            let Some(name) = p.file_name().and_then(|n| n.to_str()) else { continue };
            if !safe_name(name) {
                continue;
            }
            let bytes = std::fs::read(&p).map_err(|e| format!("{name}: {e}"))?;
            if used + bytes.len() > POSFILES_BUDGET {
                skipped.push(name.to_string());
                continue;
            }
            used += bytes.len();
            pos.insert(name.to_string(), Value::String(B64.encode(&bytes)));
        }
    }

    Ok(json!({
        "prodeck_backup": 1,
        "created": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
        "host": String::from_utf8_lossy(
            &std::process::Command::new("hostname").output().map(|o| o.stdout).unwrap_or_default()
        ).trim().to_string(),
        "files": files,
        "positionFiles": pos,
        // Named, not silently dropped, so a restore can say what's missing.
        "positionFilesSkipped": skipped,
    }))
}

pub(crate) fn restore_into(dir: &Path, text: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("not a ProDeck backup: {e}"))?;
    if v.get("prodeck_backup").and_then(|x| x.as_u64()) != Some(1) {
        return Err("not a ProDeck backup file".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    let mut restored: Vec<String> = Vec::new();
    if let Some(files) = v.get("files").and_then(|f| f.as_object()) {
        for (name, content) in files {
            // Only names we own — never write an arbitrary path from a bundle.
            if !FILES.contains(&name.as_str()) {
                continue;
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
    }

    let mut pos_restored = 0usize;
    if let Some(pos) = v.get("positionFiles").and_then(|f| f.as_object()) {
        let pdir = dir.join(POSFILES_DIR);
        std::fs::create_dir_all(&pdir).map_err(|e| e.to_string())?;
        for (name, b64) in pos {
            if !safe_name(name) {
                continue;
            }
            let Some(s) = b64.as_str() else { continue };
            let bytes = B64.decode(s).map_err(|e| format!("{name}: {e}"))?;
            let p = pdir.join(name);
            if p.exists() {
                let _ = std::fs::copy(&p, pdir.join(format!("{name}.pre-restore")));
            }
            // Write via temp + rename so a half-written guide never replaces a
            // good one. (rename over an existing file is fine here because the
            // copy above already preserved it.)
            let tmp = pdir.join(format!("{name}.tmp"));
            std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, &p).map_err(|e| e.to_string())?;
            pos_restored += 1;
        }
    }

    crate::diag::log(format!(
        "[backup] restored {} files, {pos_restored} position guides",
        restored.len()
    ));
    Ok(json!({ "restored": restored, "positionFiles": pos_restored }))
}

/// Write the bundle to ~/Desktop and reveal it. Returns the path.
#[tauri::command]
pub fn backup_export(app: AppHandle) -> Result<String, String> {
    let dir = crate::settings::data_dir();
    let b = bundle_from(&dir)?;
    let desk = dirs::desktop_dir().or_else(dirs::home_dir).ok_or("no home directory")?;
    let secs = b["created"].as_u64().unwrap_or(0);
    let (y, m, d) = civil_from_days((secs / 86_400) as i64);
    let path = desk.join(format!("ProDeck-backup-{y:04}{m:02}{d:02}.json"));
    let txt = serde_json::to_string_pretty(&b).map_err(|e| e.to_string())?;
    std::fs::write(&path, txt).map_err(|e| e.to_string())?;
    let _ = app.opener().reveal_item_in_dir(&path);
    crate::diag::log(format!("[backup] exported {}", path.display()));
    Ok(path.display().to_string())
}

/// Restore from bundle text. Every replaced file is first copied to
/// `<name>.pre-restore`; the caller relaunches so modules reload from disk.
#[tauri::command]
pub fn backup_import(text: String) -> Result<Value, String> {
    restore_into(&crate::settings::data_dir(), &text)
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Unique per call. Tests run as threads in ONE process, so the pid is
    /// shared and a timestamp alone can collide — two tests then share a
    /// directory and one's cleanup deletes the other's files mid-run.
    fn tmp() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        let p = std::env::temp_dir().join(format!(
            "prodeck-backup-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn every_data_file_survives_a_round_trip() {
        let src = tmp();
        // One representative of each thing a booth owns.
        std::fs::write(src.join("settings.json"), r#"{"web_password":"hunter2","pp_host":"10.0.0.5"}"#).unwrap();
        std::fs::write(src.join("dashboards.json"), r#"[{"id":"a","name":"FOH","widgets":[]}]"#).unwrap();
        std::fs::write(src.join("identity.json"), r#"{"users":[{"id":"u1","name":"Sam"}]}"#).unwrap();
        std::fs::write(src.join("routing.json"), r#"{"chains":[{"from":"mic","to":"desk"}]}"#).unwrap();
        std::fs::write(src.join("reports.json"), r#"{"saved":[1,2,3]}"#).unwrap();
        let pdir = src.join(POSFILES_DIR);
        std::fs::create_dir_all(&pdir).unwrap();
        std::fs::write(pdir.join("index.json"), r#"{"files":[{"id":"abc","name":"Camera 1.pdf"}]}"#).unwrap();
        std::fs::write(pdir.join("abc"), [0x25, 0x50, 0x44, 0x46, 0x00, 0xFF]).unwrap(); // "%PDF" + binary

        let bundle = bundle_from(&src).unwrap();
        let text = serde_json::to_string(&bundle).unwrap();

        let dst = tmp();
        let out = restore_into(&dst, &text).unwrap();
        let restored: Vec<String> = serde_json::from_value(out["restored"].clone()).unwrap();

        // Routing was silently missing from the original list — this is the
        // regression guard.
        assert!(restored.contains(&"routing.json".to_string()), "routing.json must be backed up");
        for f in ["settings.json", "dashboards.json", "identity.json", "reports.json"] {
            assert!(restored.contains(&f.to_string()), "{f} missing from restore");
            // Compare as JSON, not text: a round trip through serde reorders
            // object keys, which is not a change in the data.
            let a: Value = serde_json::from_str(&std::fs::read_to_string(src.join(f)).unwrap()).unwrap();
            let b: Value = serde_json::from_str(&std::fs::read_to_string(dst.join(f)).unwrap()).unwrap();
            assert_eq!(a, b, "{f} changed across the round trip");
        }
        // Position guides come back byte-for-byte, binary included.
        assert_eq!(out["positionFiles"], 2);
        assert_eq!(
            std::fs::read(src.join(POSFILES_DIR).join("abc")).unwrap(),
            std::fs::read(dst.join(POSFILES_DIR).join("abc")).unwrap(),
            "a position guide must survive as bytes, not text",
        );
        assert!(dst.join(POSFILES_DIR).join("index.json").is_file());

        std::fs::remove_dir_all(&src).ok();
        std::fs::remove_dir_all(&dst).ok();
    }

    #[test]
    fn secrets_are_included_because_that_is_the_point() {
        let src = tmp();
        std::fs::write(src.join("settings.json"), r#"{"pco_secret":"s3cret"}"#).unwrap();
        let b = bundle_from(&src).unwrap();
        assert_eq!(b["files"]["settings.json"]["pco_secret"], "s3cret");
        std::fs::remove_dir_all(&src).ok();
    }

    #[test]
    fn a_restore_never_writes_outside_the_data_directory() {
        let dst = tmp();
        let evil = json!({
            "prodeck_backup": 1,
            "files": { "../../etc/passwd": "pwned", "settings.json": {"ok": true} },
            "positionFiles": { "../escape": B64.encode(b"pwned"), "../../x": B64.encode(b"pwned") },
        });
        let out = restore_into(&dst, &evil.to_string()).unwrap();
        let restored: Vec<String> = serde_json::from_value(out["restored"].clone()).unwrap();
        assert_eq!(restored, vec!["settings.json"], "only known file names may be written");
        assert_eq!(out["positionFiles"], 0, "traversal names must be refused");
        assert!(!dst.parent().unwrap().join("escape").exists());
        std::fs::remove_dir_all(&dst).ok();
    }

    #[test]
    fn the_previous_copy_is_kept_before_being_replaced() {
        let dst = tmp();
        std::fs::write(dst.join("dashboards.json"), r#"{"mine":true}"#).unwrap();
        let b = json!({ "prodeck_backup": 1, "files": { "dashboards.json": {"theirs": true} } });
        restore_into(&dst, &b.to_string()).unwrap();
        let kept = std::fs::read_to_string(dst.join("dashboards.json.pre-restore")).unwrap();
        assert!(kept.contains("mine"), "the file being replaced must be preserved");
        assert!(std::fs::read_to_string(dst.join("dashboards.json")).unwrap().contains("theirs"));
        std::fs::remove_dir_all(&dst).ok();
    }

    #[test]
    fn junk_is_refused_rather_than_half_applied() {
        let dst = tmp();
        assert!(restore_into(&dst, "not json at all").is_err());
        assert!(restore_into(&dst, r#"{"some":"json","but":"not ours"}"#).is_err());
        // A bundle with no files section is valid but a no-op, not a crash.
        let out = restore_into(&dst, r#"{"prodeck_backup":1}"#).unwrap();
        assert_eq!(out["restored"].as_array().unwrap().len(), 0);
        std::fs::remove_dir_all(&dst).ok();
    }

    #[test]
    fn an_empty_data_directory_produces_a_valid_empty_bundle() {
        let src = tmp();
        let b = bundle_from(&src).unwrap();
        assert_eq!(b["prodeck_backup"], 1);
        assert_eq!(b["files"].as_object().unwrap().len(), 0);
        std::fs::remove_dir_all(&src).ok();
    }
}
