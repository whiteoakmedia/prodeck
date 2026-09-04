import { useAlerts } from "../alertsStore";
import { useProDeck } from "../store";
import { EXPLAIN } from "../components/HealthStrip";
import { Icon } from "../components/Icon";
import { IS_WEB } from "../lib/tauri";

/**
 * Setup & status — the self-service page that keeps a downloaded copy from
 * becoming a support inbox. One row per connection: live status, plain-English
 * meaning, the one thing to try when it's not green, and a jump to where it's
 * configured. A confused operator comes here instead of emailing anyone.
 */

const DONE_KEY = "prodeck.setupDone";
const LABEL: Record<string, string> = {
  ok: "Connected",
  idle: "Not set up",
  warn: "Attention",
  bad: "Problem",
};

export function Setup({ onNavigate }: { onNavigate: (p: string) => void }) {
  const { subsystems } = useAlerts();
  const { connected } = useProDeck();

  const rows = subsystems.filter((s) => !(s.key === "cam" && s.detail === "none"));
  const greens = rows.filter((s) => s.state === "ok").length;

  const rerun = () => {
    try {
      localStorage.removeItem(DONE_KEY);
    } catch {
      /* private mode — nothing to clear */
    }
    // The walkthrough self-gates on a fresh (unconfigured) install, so on a
    // configured booth this button is a no-op by design; send them to the
    // relevant page instead.
    onNavigate("propresenter");
  };

  return (
    <div className="page setup-page">
      <header className="page-head">
        <h1>Setup</h1>
        <span className="page-sub">
          {greens}/{rows.length} connected
        </span>
      </header>

      {!IS_WEB && (
        <div className="call setup-intro">
          <p>
            ProDeck is the hub — it only shows what your other tools tell it. Each
            row below is one connection: green means it's working, anything else
            says exactly what to do. Nothing here is required; set up what you use
            and ignore the rest.
          </p>
        </div>
      )}

      <div className="setup-list">
        {rows.map((s) => {
          const info = EXPLAIN[s.key];
          if (!info) return null;
          const fix = info.fix[s.state] ?? s.detail;
          return (
            <div key={s.key} className={`setup-row ${s.state}`}>
              <span className={`hl-dot ${s.state}`} />
              <div className="setup-row-body">
                <div className="setup-row-head">
                  <strong>{info.name}</strong>
                  <span className={`setup-badge ${s.state}`}>{LABEL[s.state] ?? s.state}</span>
                </div>
                <p className="muted small">{info.what}</p>
                {s.state !== "ok" && <p className="small setup-fix">{fix}</p>}
              </div>
              {info.page && s.state !== "ok" && (
                <button className="btn small" onClick={() => onNavigate(info.page!)}>
                  {s.state === "idle" ? "Set up" : "Fix"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="setup-more">
        <h3>Add the rest</h3>
        <div className="setup-cards">
          <button className="setup-card" onClick={() => onNavigate("settings")}>
            <Icon name="settings" size={18} />
            <span className="setup-card-t">Browser access &amp; crew</span>
            <span className="setup-card-d">
              Dashboards on phones and kiosks, crew approvals, passwords.
            </span>
          </button>
          <button className="setup-card" onClick={() => onNavigate("settings")}>
            <Icon name="mic" size={18} />
            <span className="setup-card-t">Audio, console &amp; MIDI</span>
            <span className="setup-card-d">
              SPL metering, the Avantis mirror, song-key send — each its own card.
            </span>
          </button>
          <button className="setup-card" onClick={() => onNavigate("report")}>
            <Icon name="report" size={18} />
            <span className="setup-card-t">Live viewers &amp; reports</span>
            <span className="setup-card-d">
              GA4 watch-page count and per-service timing / SPL reports.
            </span>
          </button>
          <button className="setup-card" onClick={rerun}>
            <Icon name="checklist" size={18} />
            <span className="setup-card-t">Re-run the walkthrough</span>
            <span className="setup-card-d">
              The three-step first-run guide for the core connections.
            </span>
          </button>
        </div>
      </div>

      <p className="setup-foot muted small">
        The full phased guide — tap discs, kiosks, your own domain, booth-off
        resilience — is <code>docs/ADOPTERS_GUIDE.html</code> in the ProDeck
        download.{" "}
        {!connected && "Start by connecting ProPresenter above."}
      </p>
    </div>
  );
}
