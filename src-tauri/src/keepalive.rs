//! "Keep ProDeck running": a per-user LaunchAgent that starts the app at login
//! and relaunches it within ~10 s of any crash, plus a sleep guard. The DMG
//! install used to get neither — only scripts/setup.sh wrote these — so a
//! Sunday-morning crash or a Mac that dozed off stayed down.

use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub const LABEL: &str = "com.prodeck.watchdog";

pub struct KeepAwake(pub Mutex<Option<Child>>);

fn plist_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join("Library/LaunchAgents").join(format!("{LABEL}.plist")))
}

fn uid() -> String {
    String::from_utf8_lossy(
        &Command::new("/usr/bin/id").arg("-u").output().map(|o| o.stdout).unwrap_or_default(),
    )
    .trim()
    .to_string()
}

fn launchctl(args: &[&str]) -> Result<(), String> {
    let out = Command::new("/bin/launchctl").args(args).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// The program the installed plist points at, if any.
fn installed_program() -> Option<String> {
    let p = plist_path()?;
    let txt = std::fs::read_to_string(p).ok()?;
    let i = txt.find("<key>ProgramArguments</key>")?;
    let rest = &txt[i..];
    let s = rest.find("<string>")? + "<string>".len();
    let e = rest[s..].find("</string>")? + s;
    Some(rest[s..e].to_string())
}

fn current_exe() -> String {
    std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default()
}

pub fn status_value(app: &AppHandle) -> Value {
    let exe = current_exe();
    let installed = installed_program();
    let awake = app
        .try_state::<KeepAwake>()
        .map(|k| k.0.lock().unwrap_or_else(|p| p.into_inner()).is_some())
        .unwrap_or(false);
    json!({
        "installed": installed.is_some(),
        "program": installed,
        "matchesCurrent": installed.as_deref() == Some(exe.as_str()),
        "underLaunchd": std::os::unix::process::parent_id() == 1,
        "inApplications": exe.starts_with("/Applications/"),
        "exe": exe,
        "keepAwake": awake,
    })
}

#[tauri::command]
pub fn keepalive_status(app: AppHandle) -> Value {
    status_value(&app)
}

/// Write the LaunchAgent for THIS binary and load it. If the app is already
/// running under launchd (booth installs), this only refreshes the file.
#[tauri::command]
pub fn keepalive_install(app: AppHandle) -> Result<Value, String> {
    let exe = current_exe();
    if !exe.starts_with("/Applications/") {
        return Err("Move ProDeck to /Applications first — the watchdog needs a permanent path to relaunch.".into());
    }
    let path = plist_path().ok_or("no home directory")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- Written by ProDeck (Settings → Reliability). Starts ProDeck at login and
       relaunches it within ~10s of any crash. A deliberate Quit stays quit. -->
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>{exe}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
</dict>
</plist>
"#
    );
    std::fs::write(&path, plist).map_err(|e| e.to_string())?;
    let under_launchd = std::os::unix::process::parent_id() == 1;
    if !under_launchd {
        // Load it so login-start is armed. Because RunAtLoad is true this would
        // start a SECOND copy right now — so bootstrap disabled, then enable:
        // launchd remembers the job for next login without spawning it today.
        let domain = format!("gui/{}", uid());
        let _ = launchctl(&["bootout", &domain, path.to_str().unwrap_or("")]);
        launchctl(&["bootstrap", &domain, path.to_str().unwrap_or("")])
            .or_else(|e| if e.contains("already") { Ok(()) } else { Err(e) })?;
        // The bootstrap started a copy — but only if this process wasn't it.
        // Kill any instance that is NOT us so the user sees one window.
        kill_other_instances();
    }
    crate::diag::log(format!("[keepalive] installed {}", path.display()));
    Ok(status_value(&app))
}

fn kill_other_instances() {
    let me = std::process::id().to_string();
    if let Ok(out) = Command::new("/usr/bin/pgrep").args(["-x", "prodeck"]).output() {
        for pid in String::from_utf8_lossy(&out.stdout).split_whitespace() {
            if pid != me {
                let _ = Command::new("/bin/kill").args(["-TERM", pid]).output();
            }
        }
    }
}

/// Remove the LaunchAgent. If we're running under it, launchd would treat our
/// exit as a stop, so bootout is safe; the app keeps running for this session.
#[tauri::command]
pub fn keepalive_uninstall(app: AppHandle) -> Result<Value, String> {
    let path = plist_path().ok_or("no home directory")?;
    let domain = format!("gui/{}", uid());
    let _ = launchctl(&["bootout", &format!("{domain}/{LABEL}")]);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    crate::diag::log("[keepalive] removed");
    Ok(status_value(&app))
}

/// Hand this process over to the watchdog now: kickstart the job (which
/// launches a fresh copy under launchd) and exit. Requires the plist.
#[tauri::command]
pub fn keepalive_relaunch(app: AppHandle) -> Result<(), String> {
    let path = plist_path().ok_or("no home directory")?;
    if !path.exists() {
        return Err("Turn on Keep ProDeck running first.".into());
    }
    let domain = format!("gui/{}", uid());
    let _ = launchctl(&["bootstrap", &domain, path.to_str().unwrap_or("")]);
    launchctl(&["kickstart", "-k", &format!("{domain}/{LABEL}")])?;
    crate::diag::log("[keepalive] relaunching under launchd");
    let _ = app;
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(400));
        std::process::exit(0);
    });
    Ok(())
}

/// Sleep guard: `caffeinate -is -w <our pid>` prevents idle/system sleep for
/// as long as this process lives, and dies with it — no LaunchAgent, nothing
/// left behind. Display sleep is allowed (a booth screen can dim).
pub fn set_keep_awake(app: &AppHandle, on: bool) {
    let Some(state) = app.try_state::<KeepAwake>() else { return };
    let mut g = state.0.lock().unwrap_or_else(|p| p.into_inner());
    if on {
        if g.is_some() {
            return;
        }
        match Command::new("/usr/bin/caffeinate")
            .args(["-is", "-w", &std::process::id().to_string()])
            .spawn()
        {
            Ok(child) => {
                *g = Some(child);
                crate::diag::log("[keepalive] sleep guard on");
            }
            Err(e) => crate::diag::log(format!("[keepalive] caffeinate failed: {e}")),
        }
    } else if let Some(mut child) = g.take() {
        let _ = child.kill();
        let _ = child.wait();
        crate::diag::log("[keepalive] sleep guard off");
    }
}

#[tauri::command]
pub fn keep_awake_set(on: bool, app: AppHandle) -> Result<Value, String> {
    set_keep_awake(&app, on);
    {
        let st = app.state::<crate::settings::SettingsState>();
        let to_save = {
            let mut s = st.lock().unwrap_or_else(|p| p.into_inner());
            s.keep_awake = on;
            s.clone()
        };
        crate::settings::save(&to_save)?;
    }
    Ok(status_value(&app))
}
