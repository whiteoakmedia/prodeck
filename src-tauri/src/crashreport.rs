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
/// itself (Cornerstone's does), and would otherwise swallow every report. A build can point elsewhere (or nowhere,
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
    Some(guard)
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
#[allow(dead_code)]
pub fn report(msg: &str) {
    if ENABLED.load(Ordering::Relaxed) {
        sentry::capture_message(msg, sentry::Level::Error);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // One test, not two: they share the global switch, and tests run in parallel.
    #[test]
    fn scrub_follows_the_switch_and_strips_identity() {
        let mut e = sentry::protocol::Event::new();
        e.server_name = Some("Cornerstone-Booth".into());
        e.user = Some(sentry::User { username: Some("zach".into()), ..Default::default() });
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
