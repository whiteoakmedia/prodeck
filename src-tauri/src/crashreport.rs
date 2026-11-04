//! Crash and error reports to White Oak Media (Sentry).
//!
//! On by default, off with Settings → Help & support → "Send crash reports".
//! The client is created once at launch whenever a DSN exists, and every event
//! is checked against `ENABLED` on its way out, so the switch works both ways
//! without a restart.
//!
//! What a report carries: the error or panic, its stack, the ProDeck version,
//! the OS and the recent log lines Sentry collects as breadcrumbs. What it
//! never carries: the computer's name, an IP address, settings, passwords,
//! plan contents or anyone's name (see `scrub`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// White Oak Media's ProDeck project. A DSN only allows sending reports in,
/// so it is safe in public source. Its host is White Oak's feedback Worker,
/// which passes reports on to Sentry: church content filters block sentry.io
/// itself (some do), and would otherwise swallow every report. A build can point elsewhere (or nowhere,
/// with an empty value) through PRODECK_SENTRY_DSN at compile time.
const OFFICIAL_DSN: &str =
    "https://79aebd1fda6a14652e119fabfa555f91@prodeck-feedback.taplink-edge.workers.dev/4512215209869312";

static ENABLED: AtomicBool = AtomicBool::new(false);

pub fn dsn() -> &'static str {
    option_env!("PRODECK_SENTRY_DSN").unwrap_or(OFFICIAL_DSN)
}

/// Follow the Settings switch. Called at launch and on every settings save.
pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
}

/// Start the client. Keep the guard alive for the life of the app: dropping it
/// flushes what is queued. `None` in development builds and when no DSN is set.
pub fn init(enabled: bool) -> Option<sentry::ClientInitGuard> {
    set_enabled(enabled);
    let dsn = dsn();
    if dsn.is_empty() || cfg!(debug_assertions) {
        return None;
    }
    let mut opts = sentry::ClientOptions::default();
    opts.release = Some(format!("prodeck@{}", env!("CARGO_PKG_VERSION")).into());
    opts.environment = Some("production".into());
    opts.send_default_pii = false;
    opts.server_name = None;
    opts.attach_stacktrace = true;
    opts.before_send = Some(Arc::new(scrub));
    opts.before_breadcrumb = Some(Arc::new(|b| if ENABLED.load(Ordering::Relaxed) { Some(b) } else { None }));
    let guard = sentry::init((dsn, opts));
    sentry::configure_scope(|s| s.set_tag("side", "app"));
    // Release builds ship without symbols, so a panic arrives as a wall of
    // <unknown> frames (PRODECK-8). The panic's own file and line still say
    // where it happened: tag the event with them before Sentry's hook sends it.
    let sentry_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(loc) = info.location() {
            let at = format!("{}:{}", short_path(loc.file()), loc.line());
            sentry::configure_scope(|s| s.set_tag("panic.at", at));
        }
        sentry_hook(info);
    }));
    Some(guard)
}

/// A panic location without the build machine's folders: our own files are
/// already relative ("src/web.rs"); a dependency's path runs through the
/// builder's cargo registry, so keep only "crate-1.2.3/src/file.rs".
fn short_path(file: &str) -> String {
    let parts: Vec<&str> = file.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    match parts.iter().rposition(|p| *p == "src") {
        Some(i) if i > 0 && parts.len() > 3 => parts[i - 1..].join("/"),
        _ => parts.join("/"),
    }
}

/// The last word on every event: drop it when reports are off, and strip
/// anything that identifies the church or a person.
fn scrub(mut e: sentry::protocol::Event<'static>) -> Option<sentry::protocol::Event<'static>> {
    if !ENABLED.load(Ordering::Relaxed) {
        return None;
    }
    e.server_name = None;
    e.user = None;
    e.request = None;
    // The device context names the machine on some platforms.
    if let Some(sentry::protocol::Context::Device(d)) = e.contexts.get_mut("device") {
        d.name = None;
    }
    let home = dirs_home();
    let clean = |s: &mut String| {
        if let Some(h) = &home {
            if !h.is_empty() && s.contains(h.as_str()) {
                *s = s.replace(h.as_str(), "~");
            }
        }
    };
    if let Some(m) = e.message.as_mut() {
        clean(m);
    }
    for ex in e.exception.values.iter_mut() {
        if let Some(v) = ex.value.as_mut() {
            clean(v);
        }
    }
    Some(e)
}

/// The home folder holds the user's login name; reports show "~" instead.
fn dirs_home() -> Option<String> {
    std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).ok()
}

/// Front-end errors from the web views arrive through the JS SDK directly;
/// this is only for Rust-side failures worth knowing about that don't panic.
pub fn report(msg: &str) {
    if ENABLED.load(Ordering::Relaxed) {
        sentry::capture_message(msg, sentry::Level::Error);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panic_locations_drop_the_build_machines_folders() {
        assert_eq!(short_path("src/web.rs"), "src/web.rs");
        assert_eq!(
            short_path("/Users/someone/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/mdns-sd-0.21.5/src/dns_parser.rs"),
            "mdns-sd-0.21.5/src/dns_parser.rs"
        );
        assert_eq!(
            short_path(r"C:\Users\runneradmin\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\tokio-1.40.0\src\runtime\task.rs"),
            "tokio-1.40.0/src/runtime/task.rs"
        );
    }

    // One test, not two: they share the global switch, and tests run in parallel.
    #[test]
    fn scrub_follows_the_switch_and_strips_identity() {
        let mut e = sentry::protocol::Event::new();
        e.server_name = Some("Church-Booth".into());
        e.user = Some(sentry::User { username: Some("booth".into()), ..Default::default() });
        let home = dirs_home().unwrap_or_default();
        e.message = Some(format!("could not open {home}/Music/x.wav"));
        set_enabled(false);
        assert!(scrub(e.clone()).is_none());
        set_enabled(true);
        let out = scrub(e).expect("kept when on");
        assert!(out.server_name.is_none());
        assert!(out.user.is_none());
        if !home.is_empty() {
            assert_eq!(out.message.as_deref(), Some("could not open ~/Music/x.wav"));
        }
    }
}
