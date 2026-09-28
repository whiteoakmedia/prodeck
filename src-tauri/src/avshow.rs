//! The Avantis patch, read from a show-file export.
//!
//! The console's network protocols don't expose its I/O patch (the MIDI/TCP
//! one on 51325 has names, faders, mutes and scenes; the Director one on
//! 51321 wants a login handshake that isn't documented). A show exported to
//! USB does carry it: `Show/Scenes/StageBoxScene65535.tar.gz` (the current
//! state) holds a "Channel Mapper" section — a run of 3-byte entries
//! `[port, socket_hi, socket_lo]`, 0-based sockets. Verified against the
//! booth's known patch (22 Sep 2026 export): entries 0–95 are input channels
//! 1–96 (Kick IN ← SLink 1, Click ← Dante 15, AG WL ← Dante 44, FOH TB ←
//! Local 10 …). 96–191 and 192–287 look like the insert A / B points (codes
//! 0x22 / 0x24, socket = the channel's own slot unless re-patched) — shown
//! raw, not confirmed. What follows is the output side; its layout isn't
//! decoded yet, so it's kept raw for comparison between exports.
//!
//! A watcher looks for new exports in Downloads, Desktop, Documents and on
//! any USB drive, every minute, and logs what changed since the last one.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

const INPUTS: usize = 96;

fn data_path() -> PathBuf {
    crate::settings::config_dir().join("avantis-patch.json")
}

/// Port names for the codes seen and confirmed on the booth's console.
pub fn port_name(code: u8) -> Option<&'static str> {
    match code {
        0x00 => Some("Local"),
        0x01 => Some("I/O Port 1 (Dante)"),
        0x03 => Some("SLink"),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub port: u8,
    pub socket: u16, // 0-based
}
impl Entry {
    fn none(&self) -> bool {
        self.port == 0x11
    }
    fn describe(&self) -> String {
        if self.none() {
            return "—".into();
        }
        match port_name(self.port) {
            Some(n) => format!("{n} {}", self.socket + 1),
            None => format!("port 0x{:02x} socket {}", self.port, self.socket + 1),
        }
    }
}

/// The Channel Mapper entries from a StageBoxScene .dat.
pub fn mapper(dat: &[u8]) -> Option<Vec<Entry>> {
    let label = b"Channel Mapper\x00";
    let s = dat.windows(label.len()).position(|w| w == label)? + label.len();
    let end_label = b"Output Socket Polarity";
    let e = dat[s..].windows(end_label.len()).position(|w| w == end_label).map(|i| s + i).unwrap_or(dat.len().min(s + 6000));
    let body = &dat[s..e];
    // One header byte, then 3-byte entries (a 2-byte trailer before the next label).
    Some(body.get(1..)?.chunks_exact(3).map(|c| Entry { port: c[0], socket: u16::from_be_bytes([c[1], c[2]]) }).collect())
}

fn run(cmd: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    let o = std::process::Command::new(cmd).args(args).output().map_err(|e| e.to_string())?;
    if !o.status.success() {
        return Err(String::from_utf8_lossy(&o.stderr).trim().to_string());
    }
    Ok(o.stdout)
}

/// Is this .tar.gz an Avantis show export?
fn is_show(p: &Path) -> bool {
    let Ok(list) = run("/usr/bin/tar", &["-tzf", &p.to_string_lossy()]) else { return false };
    String::from_utf8_lossy(&list).lines().any(|l| l.trim_start_matches("./").ends_with("Show/Scenes/StageBoxScene65535.tar.gz"))
}

/// Unpack the current-state scene from an export and read its patch.
pub fn read_show(p: &Path) -> Result<Value, String> {
    let tmp = std::env::temp_dir().join(format!("prodeck-avshow-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let list = run("/usr/bin/tar", &["-tzf", &p.to_string_lossy()])?;
    let member = String::from_utf8_lossy(&list)
        .lines()
        .find(|l| l.ends_with("Show/Scenes/StageBoxScene65535.tar.gz"))
        .ok_or("not an Avantis show export")?
        .to_string();
    run("/usr/bin/tar", &["-xzf", &p.to_string_lossy(), "-C", &tmp.to_string_lossy(), &member])?;
    let inner = tmp.join(&member);
    run("/usr/bin/tar", &["-xzf", &inner.to_string_lossy(), "-C", &tmp.to_string_lossy()])?;
    let dat = std::fs::read(tmp.join("StageBoxScene65535.dat")).map_err(|e| format!("scene file: {e}"))?;
    let _ = std::fs::remove_dir_all(&tmp);
    let m = mapper(&dat).ok_or("no Channel Mapper in this show (a different console or firmware?)")?;
    if m.len() < INPUTS * 3 {
        return Err("Channel Mapper shorter than expected".into());
    }
    let rows = |from: usize| -> Vec<Value> {
        (0..INPUTS)
            .map(|i| {
                let e = &m[from + i];
                json!({ "ch": i + 1, "port": e.port, "socket": if e.none() { Value::Null } else { json!(e.socket + 1) }, "text": e.describe() })
            })
            .collect()
    };
    let mtime = std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    Ok(json!({
        "file": p,
        "exportedAt": mtime,
        "inputs": rows(0),
        "insertA": rows(INPUTS),
        "insertB": rows(INPUTS * 2),
        // Not decoded yet: kept so the next export can be compared entry by entry.
        "rest": m[INPUTS * 3..].iter().map(|e| format!("{:02x}{:04x}", e.port, e.socket)).collect::<Vec<_>>(),
    }))
}

/// What changed between two parsed patches, in words.
pub fn diff(old: &Value, new: &Value, names: &dyn Fn(usize) -> String) -> Vec<String> {
    let mut out = vec![];
    for (key, what) in [("inputs", "input"), ("insertA", "insert A return"), ("insertB", "insert B return")] {
        let (Some(a), Some(b)) = (old[key].as_array(), new[key].as_array()) else { continue };
        for (x, y) in a.iter().zip(b.iter()) {
            if x["text"] != y["text"] {
                let ch = y["ch"].as_u64().unwrap_or(0) as usize;
                out.push(format!("Ch {ch} {}: {what} {} → {}", names(ch), x["text"].as_str().unwrap_or("?"), y["text"].as_str().unwrap_or("?")));
            }
        }
    }
    if let (Some(a), Some(b)) = (old["rest"].as_array(), new["rest"].as_array()) {
        let n = a.iter().zip(b.iter()).filter(|(x, y)| x != y).count();
        if n > 0 {
            out.push(format!("{n} output-side patch entries changed (not decoded yet)"));
        }
    }
    out
}

fn candidates() -> Vec<PathBuf> {
    let home = PathBuf::from(std::env::var("HOME").unwrap_or_default());
    let mut dirs = vec![home.join("Downloads"), home.join("Desktop"), home.join("Documents")];
    if let Ok(rd) = std::fs::read_dir("/Volumes") {
        for e in rd.flatten() {
            let p = e.path();
            dirs.push(p.clone());
            // Consoles export into a folder on the stick.
            if let Ok(sub) = std::fs::read_dir(&p) {
                dirs.extend(sub.flatten().map(|s| s.path()).filter(|s| s.is_dir()).take(40));
            }
        }
    }
    let mut out = vec![];
    for d in dirs {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let small = e.metadata().map(|m| m.len() < 40_000_000).unwrap_or(false);
            if small && p.to_string_lossy().ends_with(".tar.gz") {
                out.push(p);
            }
        }
    }
    out
}

fn mtime(p: &Path) -> u64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

fn channel_names(app: &AppHandle) -> std::collections::HashMap<usize, String> {
    use tauri::Manager;
    let mut m = std::collections::HashMap::new();
    if let Some(st) = app.try_state::<crate::avantis::AvantisState>() {
        let v = crate::avantis::snapshot(st.inner());
        if let Some(names) = v["names"].as_object() {
            for (id, n) in names {
                if let Some(ch) = id.strip_prefix("input:").and_then(|x| x.parse::<usize>().ok()) {
                    m.insert(ch, n.as_str().unwrap_or("").to_string());
                }
            }
        }
    }
    m
}

/// Check for a newer export; parse, compare, remember, tell the app.
pub fn scan(app: &AppHandle) -> Option<Value> {
    let prev: Value = std::fs::read_to_string(data_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    let seen = prev["exportedAt"].as_u64().unwrap_or(0);
    let mut newest: Option<(u64, PathBuf)> = None;
    for p in candidates() {
        let t = mtime(&p);
        if t > seen && newest.as_ref().map(|(n, _)| t > *n).unwrap_or(true) && is_show(&p) {
            newest = Some((t, p));
        }
    }
    let (_, path) = newest?;
    let now = match read_show(&path) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[avshow] {}: {e}", path.display());
            return None;
        }
    };
    let names = channel_names(app);
    let changes = if prev.is_null() { vec![] } else { diff(&prev, &now, &|ch| names.get(&ch).cloned().unwrap_or_default()) };
    let mut stored = now.clone();
    stored["changes"] = json!(changes);
    let tmp = data_path().with_extension("json.tmp");
    if std::fs::write(&tmp, stored.to_string()).is_ok() {
        let _ = std::fs::rename(&tmp, data_path());
    }
    for c in &changes {
        crate::follow::follow_debug_log(json!({ "kind": "routing", "source": "avantis-show", "text": c }));
    }
    write_dossier(&stored, &names);
    app.emit("routing:avantis_patch", &stored).ok();
    Some(stored)
}

/// The notes Claude reads about this booth, if they exist here.
fn write_dossier(v: &Value, names: &std::collections::HashMap<usize, String>) {
    let home = PathBuf::from(std::env::var("HOME").unwrap_or_default());
    let dir = home.join(".prodeck/system");
    if !dir.is_dir() {
        return;
    }
    let mut s = format!(
        "# Avantis input patch — from the show export {}\n\nWritten by ProDeck (avshow.rs) whenever a newer export appears. Output patch not decoded yet.\n\n| ch | name | input | insert A return | insert B return |\n|---|---|---|---|---|\n",
        v["file"].as_str().unwrap_or("")
    );
    for i in 0..INPUTS {
        let t = |k: &str| v[k][i]["text"].as_str().unwrap_or("—").to_string();
        if t("inputs") == "—" && t("insertA") == "—" && t("insertB") == "—" {
            continue;
        }
        s += &format!("| {} | {} | {} | {} | {} |\n", i + 1, names.get(&(i + 1)).map(|x| x.as_str()).unwrap_or(""), t("inputs"), t("insertA"), t("insertB"));
    }
    if let Some(ch) = v["changes"].as_array().filter(|c| !c.is_empty()) {
        s += "\n## Changed since the previous export\n\n";
        for c in ch {
            s += &format!("- {}\n", c.as_str().unwrap_or(""));
        }
    }
    let _ = std::fs::write(dir.join("CONSOLE_PATCH.md"), s);
}

pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("avantis-show".into())
        .spawn(move || loop {
            scan(&app);
            std::thread::sleep(std::time::Duration::from_secs(60));
        })
        .ok();
}

#[tauri::command]
pub fn avantis_patch_get() -> Value {
    std::fs::read_to_string(data_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_channel_mapper() {
        // "Channel Mapper\0", a header byte, then entries.
        let mut dat = b"xxChannel Mapper\x00\x02".to_vec();
        dat.extend([0x03, 0, 0, 0x03, 0, 6, 0x01, 0, 14, 0x11, 0, 0, 0x00, 0, 9]);
        dat.extend(b"\x01\xa8Output Socket Polarity");
        let m = mapper(&dat).unwrap();
        assert_eq!(m.len(), 5);
        assert_eq!(m[0].describe(), "SLink 1"); // Kick IN
        assert_eq!(m[1].describe(), "SLink 7"); // Kick Out
        assert_eq!(m[2].describe(), "I/O Port 1 (Dante) 15"); // Click
        assert_eq!(m[3].describe(), "—");
        assert_eq!(m[4].describe(), "Local 10"); // FOH TB
    }

    #[test]
    fn says_what_changed() {
        let a = json!({ "inputs": [{ "ch": 10, "text": "SLink 14" }], "insertA": [], "insertB": [], "rest": ["110000"] });
        let b = json!({ "inputs": [{ "ch": 10, "text": "SLink 15" }], "insertA": [], "insertB": [], "rest": ["010005"] });
        let c = diff(&a, &b, &|_| "Bass".into());
        assert_eq!(c, vec!["Ch 10 Bass: input SLink 14 → SLink 15".to_string(), "1 output-side patch entries changed (not decoded yet)".to_string()]);
    }

    #[test]
    #[ignore] // needs the booth's export: cargo test --lib avshow -- --ignored --nocapture
    fn reads_the_booth_export() {
        let p = PathBuf::from(std::env::var("HOME").unwrap()).join("Downloads/ztg092226.tar.gz");
        if !p.exists() {
            return;
        }
        let v = read_show(&p).unwrap();
        let t = |k: &str, i: usize| v[k][i]["text"].as_str().unwrap().to_string();
        for i in [0, 1, 2, 9, 22, 23, 24, 31, 36] {
            println!("ch {} input {} | insA {} | insB {}", i + 1, t("inputs", i), t("insertA", i), t("insertB", i));
        }
        assert_eq!(t("inputs", 0), "SLink 1");
        assert_eq!(t("inputs", 22), "I/O Port 1 (Dante) 15");
        assert_eq!(t("inputs", 31), "Local 10");
    }
}
