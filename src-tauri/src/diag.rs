//! Diagnostics: an in-memory log ring, a redacted support bundle, and the
//! "Report a problem" hand-off to GitHub. Nothing here ever includes a
//! secret — the bundle is meant to be pasted into a public issue.

use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const RING: usize = 400;
static LOG: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();

fn ring() -> &'static Mutex<VecDeque<String>> {
    LOG.get_or_init(|| Mutex::new(VecDeque::with_capacity(RING)))
}

/// Record one line (also echoed to stderr, so terminal runs still see it).
pub fn log(line: impl Into<String>) {
    let line = line.into();
    eprintln!("{line}");
    let stamp = chrono_like_now();
    let mut r = ring().lock().unwrap_or_else(|p| p.into_inner());
    if r.len() >= RING {
        r.pop_front();
    }
    r.push_back(format!("{stamp} {line}"));
}

pub fn recent(n: usize) -> Vec<String> {
    let r = ring().lock().unwrap_or_else(|p| p.into_inner());
    r.iter().rev().take(n).rev().cloned().collect()
}

/// "HH:MM:SS" local-ish without pulling in chrono: seconds since midnight UTC.
fn chrono_like_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let s = secs % 86_400;
    format!("{:02}:{:02}:{:02}Z", s / 3600, (s / 60) % 60, s % 60)
}

/// Any settings field whose NAME smells like a credential is replaced by a
/// presence marker. Field names are what the bundle needs (is it set?), the
/// values never are.
fn redact_settings(v: &mut Value) {
    let Some(obj) = v.as_object_mut() else { return };
    let secret = |k: &str| {
        let k = k.to_ascii_lowercase();
        k.contains("password")
            || k.contains("secret")
            || k.contains("token")
            || k.contains("api_key")
            || k.contains("private")
            || k.ends_with("_key")
            || k.contains("key_path")
            || k == "pin"
    };
    for (k, val) in obj.iter_mut() {
        if secret(k) {
            let set = match val {
                Value::String(s) => !s.is_empty(),
                Value::Null => false,
                _ => true,
            };
            *val = Value::String(if set { "(set)".into() } else { "(unset)".into() });
        }
    }
}

/// OS name/version for the support bundle, per platform. Kept in one place so
/// a report from any machine has the same shape.
fn os_facts() -> Value {
    #[cfg(target_os = "macos")]
    {
        json!({
            "os": "macOS",
            "version": sh("/usr/bin/sw_vers", &["-productVersion"]),
            "build": sh("/usr/bin/sw_vers", &["-buildVersion"]),
            "arch": std::env::consts::ARCH,
            "hostname": sh("/bin/hostname", &["-s"]),
        })
    }
    #[cfg(windows)]
    {
        json!({
            "os": "Windows",
            "version": sh("cmd", &["/c", "ver"]),
            "build": "",
            "arch": std::env::consts::ARCH,
            "hostname": std::env::var("COMPUTERNAME").unwrap_or_default(),
        })
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        json!({
            "os": std::env::consts::OS,
            "version": "",
            "build": "",
            "arch": std::env::consts::ARCH,
            "hostname": sh("hostname", &[]),
        })
    }
}

fn sh(cmd: &str, args: &[&str]) -> String {
    std::process::Command::new(cmd)
        .args(args)
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Build the support bundle. `client` is whatever the frontend knows that the
/// backend doesn't (connection lights, page, browser/desktop) — passed in as
/// JSON and included verbatim, so keep it non-secret on the calling side.
#[tauri::command]
pub fn diag_bundle(client: Value, app: AppHandle) -> Result<String, String> {
    let settings_state = app.state::<crate::settings::SettingsState>();
    let mut settings = {
        let s = settings_state.lock().unwrap_or_else(|p| p.into_inner());
        serde_json::to_value(&*s).map_err(|e| e.to_string())?
    };
    redact_settings(&mut settings);

    let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default();
    let keep = crate::keepalive::status_value(&app);
    let bundle = json!({
        "prodeck": {
            "version": app.package_info().version.to_string(),
            "exe": exe,
            "data_dir": crate::settings::data_dir_display(),
        },
        "system": os_facts(),
        "keepalive": keep,
        "client": client,
        "settings": settings,
        "recent_log": recent(120),
    });
    Ok(serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())?)
}

/// Open a pre-filled GitHub issue. The bundle itself is too long for a URL,
/// so the body carries the summary + a short system line and asks the user to
/// paste the bundle (the frontend has already put it on the clipboard).
#[tauri::command]
pub fn diag_open_issue(repo: String, title: String, summary: String, system_line: String, app: AppHandle) -> Result<(), String> {
    let body = format!(
        "**What happened**\n{summary}\n\n**System**\n{system_line}\n\n**Diagnostics**\n<details><summary>Paste the bundle here (it is on your clipboard — Cmd-V below; secrets are already redacted)</summary>\n\n```json\n\n```\n</details>\n"
    );
    let url = format!(
        "https://github.com/{}/issues/new?title={}&body={}",
        repo.trim_matches('/'),
        urlencoding::encode(&title),
        urlencoding::encode(&body)
    );
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Recent log lines for the Settings → Logs view.
#[tauri::command]
pub fn diag_recent_log(n: Option<usize>) -> Vec<String> {
    recent(n.unwrap_or(200))
}

/// Open the bundled Adopter's Guide at a section (offline), falling back to
/// the published copy when the resource isn't found (e.g. `tauri dev`).
#[tauri::command]
pub fn help_open(section: Option<String>, app: AppHandle) -> Result<(), String> {
    let anchor = section.map(|s| format!("#{}", s.trim_start_matches('#'))).unwrap_or_default();
    let local = app
        .path()
        .resolve("docs/ADOPTERS_GUIDE.html", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|p| p.exists());
    let url = match local {
        Some(p) => format!("file://{}{}", p.display(), anchor),
        None => format!("https://whiteoakmedia.github.io/prodeck/ADOPTERS_GUIDE.html{anchor}"),
    };
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}
