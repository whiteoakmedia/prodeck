//! Is macOS blocking ProDeck from the local network?
//!
//! Since Sequoia, macOS gates an app's access to the LAN behind a privacy
//! permission, and a booth Mac that loses it fails in a way that reads as
//! anything but a permission problem: Planning Center keeps working, the
//! crew gateway on localhost keeps working, and only the things that matter in
//! the room — ProPresenter, the sound desk, the kiosks — go dark. The app's own
//! error for that was "no response (unreachable / firewalled)", which sends
//! whoever is on shift to hunt through router and firewall settings for a
//! problem that is one toggle in System Settings.
//!
//! It cost a full afternoon here before anyone thought to look, and it will
//! recur: macOS keys the permission to the app bundle, so replacing ProDeck can
//! land it in the list again switched off. A booth that updates on a Saturday
//! discovers this at 7am on Sunday.
//!
//! The give-away is the SHAPE of the failure, which nothing else produces:
//! the internet is reachable and every address on the local network is not.
//! That is what this measures, so ProDeck can name the actual problem and open
//! the actual settings pane instead of describing a firewall.

use crate::settings::SettingsState;
use serde::Serialize;
use std::time::Duration;
use tokio::net::TcpStream;

/// Plenty for a machine on the same switch; short enough that a full report
/// costs a couple of seconds even when everything is dead.
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Serialize, Clone, Debug)]
pub struct Target {
    pub label: String,
    pub addr: String,
    pub reachable: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct LocalNetworkReport {
    pub internet_ok: bool,
    pub lan: Vec<Target>,
    /// True when at least one LAN address answered.
    pub lan_ok: bool,
    /// The diagnosis: the internet is fine, we had somewhere on the LAN to try,
    /// and nothing on the LAN answered at all.
    pub likely_blocked: bool,
    /// Whether this platform has such a permission to lose.
    pub gated_platform: bool,
}

async fn can_connect(addr: &str) -> bool {
    matches!(
        tokio::time::timeout(PROBE_TIMEOUT, TcpStream::connect(addr)).await,
        Ok(Ok(_))
    )
}

/// Every LAN address this booth is configured to talk to, so the verdict
/// doesn't rest on one device that might simply be switched off.
fn lan_targets(settings: &SettingsState) -> Vec<(String, String)> {
    let s = settings.lock().unwrap_or_else(|p| p.into_inner());
    let mut out = Vec::new();
    if !s.pp_host.trim().is_empty() {
        out.push(("ProPresenter".into(), format!("{}:{}", s.pp_host.trim(), s.pp_port)));
    }
    if s.avantis_enabled && !s.avantis_host.trim().is_empty() {
        out.push(("Sound desk".into(), format!("{}:{}", s.avantis_host.trim(), s.avantis_port)));
    }
    out
}

pub async fn report(settings: &SettingsState) -> LocalNetworkReport {
    // Two well-known hosts rather than one: a single unlucky outage must not
    // read as "the internet is down", which would suppress the diagnosis.
    let internet_ok = can_connect("api.planningcenteronline.com:443").await
        || can_connect("github.com:443").await;

    let mut lan = Vec::new();
    for (label, addr) in lan_targets(settings) {
        let reachable = can_connect(&addr).await;
        lan.push(Target { label, addr, reachable });
    }
    let lan_ok = lan.iter().any(|t| t.reachable);
    let gated_platform = cfg!(target_os = "macos");
    LocalNetworkReport {
        likely_blocked: gated_platform && internet_ok && !lan_ok && !lan.is_empty(),
        internet_ok,
        lan_ok,
        lan,
        gated_platform,
    }
}

#[tauri::command]
pub async fn diag_local_network(
    settings: tauri::State<'_, SettingsState>,
) -> Result<LocalNetworkReport, String> {
    Ok(report(settings.inner()).await)
}

/// Open the exact System Settings pane, because "Privacy & Security → Local
/// Network" is four levels down a list nobody scrolls.
#[tauri::command]
pub fn open_local_network_settings(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri_plugin_opener::OpenerExt;
        return app
            .opener()
            .open_url(
                "x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork",
                None::<&str>,
            )
            .map_err(|e| e.to_string());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Only macOS gates local network access this way.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::{LocalNetworkReport, Target};

    fn verdict(internet: bool, lan: &[bool], macos: bool) -> bool {
        let lan: Vec<Target> = lan
            .iter()
            .map(|r| Target { label: "x".into(), addr: "h:1".into(), reachable: *r })
            .collect();
        let lan_ok = lan.iter().any(|t| t.reachable);
        LocalNetworkReport {
            likely_blocked: macos && internet && !lan_ok && !lan.is_empty(),
            internet_ok: internet,
            lan_ok,
            lan,
            gated_platform: macos,
        }
        .likely_blocked
    }

    #[test]
    fn the_signature_is_internet_up_and_the_whole_lan_down() {
        // The failure this exists to name.
        assert!(verdict(true, &[false, false], true));
    }

    #[test]
    fn one_device_being_off_is_not_a_permission_problem() {
        // ProPresenter quit, desk still answering: ordinary, say nothing.
        assert!(!verdict(true, &[false, true], true));
    }

    #[test]
    fn a_dead_uplink_is_not_a_permission_problem() {
        // Whole network out — the LAN failing tells us nothing about
        // permissions, and blaming macOS would send someone the wrong way.
        assert!(!verdict(false, &[false, false], true));
    }

    #[test]
    fn nothing_configured_means_no_verdict() {
        assert!(!verdict(true, &[], true));
    }

    #[test]
    fn only_macos_gates_this() {
        assert!(!verdict(true, &[false, false], false));
    }
}

/// How phones and kiosks on the church network reach this computer.
#[derive(Serialize, Clone, Debug)]
pub struct LanAddress {
    /// The name other devices can look up, e.g. "Booth-Mac.local".
    pub host: String,
    /// This computer's IPv4 addresses, for devices that can't look up
    /// ".local" names (some Android TVs, older Windows).
    pub ips: Vec<String>,
}

/// The ".local" name for this computer.
///
/// The settings' device name comes from `hostname`, and when the router hands
/// out its own domain that reads "Mac.localdomain", which ProDeck turned into
/// "Mac.localdomain.local": a link no device could open, so kiosk mode and
/// browser access "never loaded". macOS's LocalHostName is the real Bonjour
/// name; elsewhere, the first label of the host name.
fn bonjour_host(fallback: &str) -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(o) = crate::diag::command("/usr/sbin/scutil").args(["--get", "LocalHostName"]).output() {
            let name = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if o.status.success() && !name.is_empty() {
                return format!("{name}.local");
            }
        }
    }
    host_label(fallback)
}

/// "Mac.localdomain" → "Mac.local"; "Booth.local" → "Booth.local".
pub(crate) fn host_label(name: &str) -> String {
    let first = name.trim().split('.').next().unwrap_or("").trim();
    format!("{}.local", if first.is_empty() { "this-computer" } else { first })
}

#[tauri::command]
pub fn lan_address(settings: tauri::State<'_, SettingsState>) -> LanAddress {
    let device = settings.lock().unwrap_or_else(|p| p.into_inner()).device_name.clone();
    let ips = crate::dante::local_ips()
        .into_iter()
        // Self-assigned addresses (no DHCP) aren't reachable from the Wi-Fi.
        .filter(|ip| !ip.starts_with("169.254."))
        .collect();
    LanAddress { host: bonjour_host(&device), ips }
}

#[cfg(test)]
mod lan_address_tests {
    #[test]
    fn makes_a_dot_local_name_from_whatever_hostname_says() {
        assert_eq!(super::host_label("Mac.localdomain"), "Mac.local");
        assert_eq!(super::host_label("Booth-Mac.local"), "Booth-Mac.local");
        assert_eq!(super::host_label("BOOTH-PC"), "BOOTH-PC.local");
        assert_eq!(super::host_label(""), "this-computer.local");
    }
}
