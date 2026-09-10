import { useEffect, useMemo, useState } from "react";
import { startListen, stopListen } from "../lib/listen";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { useProDeck } from "../store";
import { WIDGET_MAP } from "../widgets/registry";
import { loadDashboards, type Dashboard as Dash } from "../lib/dashboards";

const Grid = WidthProvider(GridLayout);

// How often the kiosk re-reads dashboards.json from the host, so deliberate
// layout edits made on the booth Mac show up without anyone touching the TV.
const LAYOUT_REFRESH_MS = 60_000;
// Watchdog cadence: HEAD / every tick; 2 consecutive failures = offline.
const PING_MS = 5_000;

/**
 * Kiosk mode (?kiosk=<dashboard name>&token=<password>): a chrome-less,
 * read-only rendering of ONE dashboard for an unattended office screen (Mac
 * mini, no keyboard/mouse). No tabs, no nav, no edit affordances — the layout
 * only changes when the named dashboard is edited on the booth Mac. A
 * connection watchdog covers the "Command Center offline" case and reloads
 * the page after an outage so the screen never runs a stale frontend.
 */
export function KioskPage({ name }: { name: string }) {
  const { connected } = useProDeck();
  const [dashboards, setDashboards] = useState<Dash[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [offlineSince, setOfflineSince] = useState<number | null>(null);

  // Load the layout now and re-check periodically.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const d = (await loadDashboards().catch(() => null)) as Dash[] | null;
      if (alive && Array.isArray(d) && d.length > 0) setDashboards(d);
      if (alive) setLoaded(true);
    };
    load();
    const iv = setInterval(load, LAYOUT_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  // Fill the screen. A fixed 70px row left the bottom third of a TV empty
  // and made every widget small. Scale rows so the tallest column exactly
  // fills the viewport, and re-fit when the window changes.
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const dashForFit = dashboards.find((d) => d.name.toLowerCase() === name.toLowerCase());
  const rowHeight = useMemo(() => {
    const rows = Math.max(1, ...(dashForFit?.widgets ?? []).map((w) => w.y + w.h));
    const margin = 14;
    const pad = 14 * 2 + (connected ? 0 : 52); // page padding (+ the offline banner)
    return Math.max(44, Math.floor((vh - pad - (rows - 1) * margin) / rows));
  }, [vh, dashForFit, connected]);

  // Room audio, with no tile. `startListen(true)` owns its own hidden <audio>
  // and retries on its own; the dashboard's `audio` flag is the whole switch.
  useEffect(() => {
    if (!dashForFit?.audio) return;
    startListen(true);
    return () => stopListen();
  }, [dashForFit?.audio]);

  // Watchdog: is the booth Mac serving at all? (The SSE stream auto-retries on
  // its own; this is the user-facing signal + the recovery reload.)
  useEffect(() => {
    let alive = true;
    let fails = 0;
    let wasOffline = false;
    const iv = setInterval(async () => {
      const ctl = new AbortController();
      const timeout = setTimeout(() => ctl.abort(), PING_MS - 1000);
      try {
        const r = await fetch("/", { method: "HEAD", cache: "no-store", signal: ctl.signal });
        if (!r.ok) throw new Error(String(r.status));
        fails = 0;
        if (wasOffline) {
          // Back after an outage: full reload picks up fresh state AND a new
          // frontend if ProDeck was updated while we were dark.
          location.reload();
          return;
        }
        if (alive) setOfflineSince(null);
      } catch {
        fails++;
        if (fails >= 2 && alive) {
          wasOffline = true;
          setOfflineSince((p) => p ?? Date.now());
        }
      } finally {
        clearTimeout(timeout);
      }
    }, PING_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  const dash =
    dashboards.find((d) => d.name.toLowerCase() === name.toLowerCase()) ??
    dashboards.find((d) => d.id === name) ??
    null;

  const layout: Layout[] = (dash?.widgets ?? []).map((w) => ({
    i: w.id,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    static: true,
  }));

  if (offlineSince) {
    return (
      <div className="kiosk-splash">
        <span className="brand-mark" />
        <h1>Command Center offline</h1>
        <p>
          Reconnecting… <span className="kiosk-pulse">●</span>
        </p>
        <p className="muted">
          Last seen {new Date(offlineSince).toLocaleTimeString()}. This screen
          recovers by itself when ProDeck is back.
        </p>
      </div>
    );
  }

  if (loaded && !dash) {
    return (
      <div className="kiosk-splash">
        <h1>Dashboard “{name}” not found</h1>
        <p className="muted">
          Available: {dashboards.map((d) => d.name).join(" · ") || "none"} — fix
          the ?kiosk= name in this machine's bookmark, or create the dashboard
          on the booth Mac.
        </p>
      </div>
    );
  }

  return (
    <div className="kiosk">
      {!connected && (
        <div className="kiosk-ppbanner">ProPresenter offline — widgets are idle</div>
      )}
      <Grid
        className="layout"
        layout={layout}
        cols={12}
        rowHeight={rowHeight}
        margin={[14, 14]}
        containerPadding={[0, 0]}
        isDraggable={false}
        isResizable={false}
        compactType="vertical"
      >
        {(dash?.widgets ?? []).map((w) => {
          const def = WIDGET_MAP[w.type];
          // Name it rather than leaving a hole. Nobody can edit a kiosk, so
          // the only way anyone learns the layout references a widget this
          // build doesn't have is by reading it off the screen.
          if (!def)
            return (
              <div key={w.id} className="widget">
                <div className="widget-body widget-empty">Unknown widget: {w.type}</div>
              </div>
            );
          const Comp = def.component;
          return (
            <div key={w.id} className="widget">
              <div className="widget-bar">
                <span className="widget-title">{def.label}</span>
              </div>
              <div className="widget-body">
                <Comp widget={w} editing={false} update={() => {}} />
              </div>
            </div>
          );
        })}
      </Grid>
    </div>
  );
}
