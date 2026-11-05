import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScreenMessage } from "../components/ScreenMessage";
import { startListen, stopListen } from "../lib/listen";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { useProDeck } from "../store";
import { WIDGET_MAP } from "../widgets/registry";
import { loadDashboards, type Dashboard as Dash } from "../lib/dashboards";
import { kioskFit, MIN_TILE_ZOOM, nextTileZoom, type Box } from "../lib/kioskFit";

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
  // When even the shortest readable rows don't fit (a 12-row dashboard on a
  // TV), the whole layout is scaled down evenly instead of running off the
  // bottom (lib/kioskFit.ts).
  const [vh, setVh] = useState(() => window.innerHeight);
  const [vw, setVw] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => {
      setVh(window.innerHeight);
      setVw(window.innerWidth);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // ?safe=1: keep clear of the edges a TV crops (overscan), about 3% each side.
  const safe = useMemo(() => new URLSearchParams(location.search).get("safe") === "1", []);
  const safeX = safe ? Math.round(vw * 0.03) : 0;
  const safeY = safe ? Math.round(vh * 0.035) : 0;
  const dashForFit = dashboards.find((d) => d.name.toLowerCase() === name.toLowerCase());
  const fit = useMemo(() => {
    const rows = Math.max(1, ...(dashForFit?.widgets ?? []).map((w) => w.y + w.h));
    const pad = 14 * 2 + (connected ? 0 : 52); // page padding (+ the offline banner)
    return kioskFit({ vw: vw - 28 - 2 * safeX, vh, rows, reserved: pad + 2 * safeY });
  }, [vh, vw, dashForFit, connected, safeX, safeY]);
  const rowHeight = fit.rowHeight;

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
    <div className="kiosk" style={safe ? { padding: `${14 + safeY}px ${14 + safeX}px` } : undefined}>
      <ScreenMessage dashboard={dash?.name ?? name} />
      {!connected && (
        <div className="kiosk-ppbanner">ProPresenter is offline. Its tiles wait until it&apos;s back.</div>
      )}
      <div
        className="kiosk-canvas"
        style={fit.scale < 1 ? { width: fit.width, transform: `scale(${fit.scale})`, transformOrigin: "top left" } : undefined}
      >
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
              <KioskTileBody>
                <Comp widget={w} editing={false} update={() => {}} />
              </KioskTileBody>
            </div>
          );
        })}
      </Grid>
      </div>
    </div>
  );
}

// How often a shrunken tile tries its full size again (its content may have
// got shorter), and the least time between checks while its content changes
// (a clock or a meter changes every second).
const TILE_REGROW_MS = 30_000;
const TILE_CHECK_MS = 1_000;

/** The room a tile's content takes, at whatever zoom it's drawn at now. A
 *  list inside it that scrolls counts by how far it runs over, except one
 *  marked data-kiosk-scrolls, which keeps its live item in view instead. */
function usedBox(body: HTMLElement, avail: Box, padX: number, padY: number): Box {
  let w = Math.max(avail.w, body.scrollWidth - padX);
  let h = Math.max(avail.h, body.scrollHeight - padY);
  for (const el of body.querySelectorAll<HTMLElement>("*")) {
    if (el.clientHeight === 0 || el.closest("[data-kiosk-scrolls]")) continue;
    if (el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1) continue;
    const cs = getComputedStyle(el);
    if (!/auto|scroll/.test(cs.overflowX + cs.overflowY)) continue;
    w = Math.max(w, (avail.w * el.scrollWidth) / Math.max(1, el.clientWidth));
    h = Math.max(h, (avail.h * el.scrollHeight) / Math.max(1, el.clientHeight));
  }
  return { w, h };
}

/** Lists that scroll on purpose (Show Flow): keep the live item in the middle. */
function centreLive(body: HTMLElement) {
  for (const list of body.querySelectorAll<HTMLElement>("[data-kiosk-scrolls]")) {
    const live = list.querySelector<HTMLElement>(".live");
    if (!live || list.scrollHeight <= list.clientHeight) continue;
    const box = list.getBoundingClientRect();
    const item = live.getBoundingClientRect();
    if (box.height === 0) continue;
    // Screen pixels to the list's own (it may be zoomed and the canvas scaled).
    const k = list.clientHeight / box.height;
    const off = (item.top - box.top - (box.height - item.height) / 2) * k;
    if (Math.abs(off) > 2) list.scrollTop += off;
  }
}

/**
 * One tile on a kiosk or TV. Nobody can scroll a TV, so a tile whose content
 * is bigger than its box draws it smaller until it fits (lib/kioskFit,
 * nextTileZoom), and lists that scroll on purpose follow the live item.
 */
function KioskTileBody({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const body = ref.current;
    if (!body) return;
    let zoom = 1;
    let lastCheck = 0;
    let pending: ReturnType<typeof setTimeout> | undefined;

    const measure = () => {
      const cs = getComputedStyle(body);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const avail = { w: body.clientWidth - padX, h: body.clientHeight - padY };
      return { avail, used: usedBox(body, avail, padX, padY) };
    };
    const setZoom = (root: HTMLElement, z: number) => {
      zoom = z;
      root.style.zoom = z === 1 ? "" : String(z);
    };
    // From full size down, all before the next paint, so nothing flickers.
    const fit = () => {
      const root = body.firstElementChild as HTMLElement | null;
      if (!root) return;
      setZoom(root, 1);
      for (let i = 0; i < 6; i++) {
        const { avail, used } = measure();
        const next = nextTileZoom(zoom, avail, used);
        if (next === zoom) break;
        setZoom(root, next);
        if (next <= MIN_TILE_ZOOM) break;
      }
      centreLive(body);
    };
    // Content changed: only refit if it no longer fits at the zoom it's at.
    const check = () => {
      pending = undefined;
      lastCheck = Date.now();
      const { avail, used } = measure();
      if (zoom > MIN_TILE_ZOOM && nextTileZoom(zoom, avail, used) !== zoom) fit();
      else centreLive(body);
    };
    const schedule = () => {
      if (pending) return;
      pending = setTimeout(check, Math.max(0, TILE_CHECK_MS - (Date.now() - lastCheck)));
    };

    fit();
    const ro = new ResizeObserver(() => fit());
    ro.observe(body);
    const mo = new MutationObserver(schedule);
    mo.observe(body, { childList: true, subtree: true, characterData: true });
    const regrow = setInterval(() => zoom < 1 && fit(), TILE_REGROW_MS);
    return () => {
      ro.disconnect();
      mo.disconnect();
      clearInterval(regrow);
      if (pending) clearTimeout(pending);
    };
  }, []);
  return (
    <div className="widget-body" ref={ref}>
      {children}
    </div>
  );
}
