//! "Keep ProDeck running": start at login, relaunch after a crash, and don't
//! let the machine fall asleep mid-service. A booth computer has to survive
//! unattended; the DMG install used to get none of this.
//!
//! Two platform implementations behind one API:
//!   * macOS — a per-user LaunchAgent plus `caffeinate` bound to our own pid.
//!   * Windows — an HKCU Run entry plus SetThreadExecutionState.
//!
//! ⚠️ The Windows path has never been compiled or run. Cross-compiling from
//! macOS stops at a C dependency that needs the MSVC toolchain, so it cannot
//! even be type-checked here. Treat it as a starting point that needs a
//! Windows machine, not as working code. macOS is unaffected either way: every
//! platform call is behind #[cfg].

use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub const LABEL: &str = "com.prodeck.watchdog";

/// What the sleep guard holds onto. macOS keeps the `caffeinate` child so it
/// dies with us; Windows just flips a thread flag, so there is nothing to hold.
#[cfg(target_os = "macos")]
pub type AwakeGuard = std::process::Child;
#[cfg(not(target_os = "macos"))]
pub type AwakeGuard = ();

pub struct KeepAwake(pub Mutex<Option<AwakeGuard>>);

fn current_exe() -> String {
    std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default()
}

// ===========================================================================
// macOS
// ===========================================================================
#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    /// Where a booth install must live for the watchdog to have a stable path.
    pub const INSTALL_HINT: &str = "Move ProDeck to your Applications folder first — the watchdog needs a permanent path to relaunch.";

    pub fn in_install_dir(exe: &str) -> bool {
        exe.starts_with("/Applications/")
    }

    pub fn under_supervisor() -> bool {
        std::os::unix::process::parent_id() == 1
    }

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

    /// The program the installed job points at, if any.
    pub fn installed_program() -> Option<String> {
        let txt = std::fs::read_to_string(plist_path()?).ok()?;
        let i = txt.find("<key>ProgramArguments</key>")?;
        let rest = &txt[i..];
        let s = rest.find("<string>")? + "<string>".len();
        let e = rest[s..].find("</string>")? + s;
        Some(rest[s..e].to_string())
    }

    pub fn install(exe: &str) -> Result<(), String> {
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
        if !under_supervisor() {
            let domain = format!("gui/{}", uid());
            let p = path.to_str().unwrap_or("");
            let _ = launchctl(&["bootout", &domain, p]);
            launchctl(&["bootstrap", &domain, p])
                .or_else(|e| if e.contains("already") { Ok(()) } else { Err(e) })?;
            // RunAtLoad started a second copy; keep the one the user is looking at.
            kill_other_instances();
        }
        Ok(())
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

    pub fn uninstall() -> Result<(), String> {
        let path = plist_path().ok_or("no home directory")?;
        let _ = launchctl(&["bootout", &format!("gui/{}/{LABEL}", uid())]);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn relaunch() -> Result<(), String> {
        let path = plist_path().ok_or("no home directory")?;
        if !path.exists() {
            return Err("Turn on Keep ProDeck running first.".into());
        }
        let domain = format!("gui/{}", uid());
        let _ = launchctl(&["bootstrap", &domain, path.to_str().unwrap_or("")]);
        launchctl(&["kickstart", "-k", &format!("{domain}/{LABEL}")])
    }

    /// `caffeinate -is -w <our pid>` blocks idle and system sleep for exactly as
    /// long as this process lives, and dies with it — nothing left behind.
    /// Display sleep is deliberately still allowed; a booth screen may dim.
    pub fn wake_on(slot: &mut Option<AwakeGuard>) {
        if slot.is_some() {
            return;
        }
        match Command::new("/usr/bin/caffeinate")
            .args(["-is", "-w", &std::process::id().to_string()])
            .spawn()
        {
            Ok(child) => {
                *slot = Some(child);
                crate::diag::log("[keepalive] sleep guard on");
            }
            Err(e) => crate::diag::log(format!("[keepalive] caffeinate failed: {e}")),
        }
    }

    pub fn wake_off(slot: &mut Option<AwakeGuard>) {
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
            crate::diag::log("[keepalive] sleep guard off");
        }
    }
}

// ===========================================================================
// Windows  — WRITTEN BUT NEVER COMPILED. See the module note above.
// ===========================================================================
#[cfg(windows)]
mod platform {
    use super::*;
    use std::process::Command;

    pub const INSTALL_HINT: &str =
        "Move ProDeck to Program Files (or another permanent folder) first — the watchdog needs a path that won't move.";

    /// On Windows there is no single blessed install directory the way
    /// /Applications is on macOS, so the only thing that actually matters is
    /// that the path is stable. Downloads and temp folders are not.
    pub fn in_install_dir(exe: &str) -> bool {
        let low = exe.to_ascii_lowercase();
        !(low.contains("\\downloads\\") || low.contains("\\temp\\") || low.contains("\\appdata\\local\\temp"))
    }

    /// Windows has no launchd equivalent that supervises a GUI app, so a Run
    /// entry gives start-at-login but NOT crash-relaunch. The UI is told this
    /// via `supervises` so it can't promise something Windows won't do.
    pub fn under_supervisor() -> bool {
        false
    }

    const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

    fn reg(args: &[&str]) -> Result<String, String> {
        let out = Command::new("reg").args(args).output().map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).to_string())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }

    pub fn installed_program() -> Option<String> {
        let out = reg(&["query", RUN_KEY, "/v", "ProDeck"]).ok()?;
        // `reg query` prints:  ProDeck    REG_SZ    "C:\...\ProDeck.exe"
        let line = out.lines().find(|l| l.contains("ProDeck"))?;
        let val = line.split("REG_SZ").nth(1)?.trim();
        Some(val.trim_matches('"').to_string())
    }

    pub fn install(exe: &str) -> Result<(), String> {
        reg(&["add", RUN_KEY, "/v", "ProDeck", "/t", "REG_SZ", "/d", exe, "/f"]).map(|_| ())
    }

    pub fn uninstall() -> Result<(), String> {
        match reg(&["delete", RUN_KEY, "/v", "ProDeck", "/f"]) {
            Ok(_) => Ok(()),
            // Deleting something that isn't there is the desired end state.
            Err(e) if e.to_lowercase().contains("unable to find") => Ok(()),
            Err(e) => Err(e),
        }
    }

    pub fn relaunch() -> Result<(), String> {
        Err("On Windows, quit and reopen ProDeck to restart it.".into())
    }

    // SetThreadExecutionState keeps the machine awake for as long as this
    // thread holds the flag, and Windows clears it automatically when the
    // process exits — the same "nothing left behind" property as caffeinate.
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;

    #[link(name = "kernel32")]
    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }

    pub fn wake_on(slot: &mut Option<AwakeGuard>) {
        if slot.is_some() {
            return;
        }
        // SAFETY: a documented kernel32 call taking a bitflag and returning the
        // previous state. No pointers, no allocation.
        let prev = unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
        if prev == 0 {
            crate::diag::log("[keepalive] SetThreadExecutionState failed");
            return;
        }
        *slot = Some(());
        crate::diag::log("[keepalive] sleep guard on");
    }

    pub fn wake_off(slot: &mut Option<AwakeGuard>) {
        if slot.take().is_some() {
            // SAFETY: as above — clears our request, restoring normal sleep.
            unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
            crate::diag::log("[keepalive] sleep guard off");
        }
    }
}

// ===========================================================================
// Anything else (Linux, etc.): compile, and say honestly that it does nothing.
// ===========================================================================
#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use super::*;
    pub const INSTALL_HINT: &str = "Keeping ProDeck running isn't supported on this platform yet.";
    pub fn in_install_dir(_exe: &str) -> bool {
        false
    }
    pub fn under_supervisor() -> bool {
        false
    }
    pub fn installed_program() -> Option<String> {
        None
    }
    pub fn install(_exe: &str) -> Result<(), String> {
        Err(INSTALL_HINT.into())
    }
    pub fn uninstall() -> Result<(), String> {
        Ok(())
    }
    pub fn relaunch() -> Result<(), String> {
        Err(INSTALL_HINT.into())
    }
    pub fn wake_on(_slot: &mut Option<AwakeGuard>) {}
    pub fn wake_off(_slot: &mut Option<AwakeGuard>) {}
}

// ===========================================================================
// Shared API
// ===========================================================================

pub fn status_value(app: &AppHandle) -> Value {
    let exe = current_exe();
    let installed = platform::installed_program();
    let awake = app
        .try_state::<KeepAwake>()
        .map(|k| k.0.lock().unwrap_or_else(|p| p.into_inner()).is_some())
        .unwrap_or(false);
    json!({
        "installed": installed.is_some(),
        "program": installed,
        "matchesCurrent": installed.as_deref() == Some(exe.as_str()),
        "underLaunchd": platform::under_supervisor(),
        "inApplications": platform::in_install_dir(&exe),
        "exe": exe,
        "keepAwake": awake,
        // Whether this platform can relaunch after a CRASH, or only start at
        // login. macOS can; a Windows Run key cannot, and the UI must not
        // claim otherwise.
        "supervises": cfg!(target_os = "macos"),
        "installHint": platform::INSTALL_HINT,
    })
}

#[tauri::command]
pub fn keepalive_status(app: AppHandle) -> Value {
    status_value(&app)
}

#[tauri::command]
pub fn keepalive_install(app: AppHandle) -> Result<Value, String> {
    let exe = current_exe();
    if !platform::in_install_dir(&exe) {
        return Err(platform::INSTALL_HINT.into());
    }
    platform::install(&exe)?;
    crate::diag::log(format!("[keepalive] installed for {exe}"));
    Ok(status_value(&app))
}

#[tauri::command]
pub fn keepalive_uninstall(app: AppHandle) -> Result<Value, String> {
    platform::uninstall()?;
    crate::diag::log("[keepalive] removed");
    Ok(status_value(&app))
}

/// Hand this process to the supervisor now, so it owns the app from here.
#[tauri::command]
pub fn keepalive_relaunch(app: AppHandle) -> Result<(), String> {
    platform::relaunch()?;
    crate::diag::log("[keepalive] relaunching under the watchdog");
    let _ = app;
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(400));
        std::process::exit(0);
    });
    Ok(())
}

pub fn set_keep_awake(app: &AppHandle, on: bool) {
    let Some(state) = app.try_state::<KeepAwake>() else { return };
    let mut g = state.0.lock().unwrap_or_else(|p| p.into_inner());
    if on {
        platform::wake_on(&mut g);
    } else {
        platform::wake_off(&mut g);
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
