import {
  useEffect,
  useState,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useProDeck } from "../store";
import { SlideThumb } from "../components/SlideThumb";
import {
  activePresentation,
  currentSlideIndex,
} from "../lib/status";
import { useLiveTimers } from "../lib/liveTimers";
import { useTracking } from "../trackingStore";
import {
  avantisState,
  avantisSetMute,
  avantisSetName,
  avantisSetFader,
  avantisRecallScene,
  type AvantisSnapshot,
  webWhoami,
  listAudioInputs,
  mjpegUrl,
  IS_WEB,
  KIOSK_DASH,
  getSettings,
  updateSettings,
  ndiDiscover,
  ndiStart,
  ndiStop,
  on,
  ppClearLayer,
  ppGet,
  ppTimerOp,
  startAudioCapture,
  stopAudioCapture,
  tapEdgeState,
  tapOverride,
  tapStats,
  ga4State,
  type Ga4Snapshot,
  type NdiSource,
  type TapEdgeState,
  type TapStatRow,
  PUBLIC_URL,
} from "../lib/tauri";
import type { Widget } from "../lib/dashboards";
import { usePco, fmtLen, type TeamMember , isDeclined } from "../pcoStore";
import { useAlerts } from "../alertsStore";
import { useRelay } from "../relayStore";
import { Avatar, MicCard } from "../components/PcoBits";
import { SongKeyLeader } from "../components/SongKeyLeader";
import { askConfirm, askText } from "../lib/dialogs";
import { listenSnapshot, onListen, startListen, stopListen } from "../lib/listen";
import { Icon } from "../components/Icon";
import { RtaGraph } from "../components/RtaGraph";
import { parseSlides, type Slide } from "../components/PlaylistControl";

export interface WidgetProps {
  widget: Widget;
  editing: boolean;
  update: (patch: Record<string, any>) => void;
}

// Connection group a widget belongs to — drives the grouped widget picker.
export type WidgetGroup =
  | "Mission Control"
  | "ProPresenter"
  | "Planning Center"
  | "Audio"
  | "Video"
  | "General";

export const WIDGET_GROUP_ORDER: WidgetGroup[] = [
  "Mission Control",
  "ProPresenter",
  "Planning Center",
  "Audio",
  "Video",
  "General",
];

export interface WidgetDef {
  type: string;
  label: string;
  group: WidgetGroup;
  w: number;
  h: number;
  component: ComponentType<WidgetProps>;
}

/* ----------------------------------------------------------- Widgets */

function Disconnected() {
  return <div className="widget-empty">Not connected</div>;
}

interface ScreenInfo {
  uuid: string;
  name: string;
  index: number;
  type: string;
}
const LAYER_KEYS = ["slide", "media", "video_input", "messages", "announcements", "props"];

/**
 * Slide Grid — the whole current presentation laid out as numbered cards,
 * grouped by section, with the live slide marked.
 *
 * Slide Preview answers "what is on the screen right now"; this answers "what
 * is coming in this song", which is the thing the booth actually leans over to
 * ask. Read-only on purpose: a mis-click on a dashboard during a service would
 * fire a cue, so triggering stays on the ProPresenter page.
 */
/**
 * Live Viewers — GA4 realtime active users on the Church Online watch page.
 *
 * Counts the web player only: the Facebook simulcast is invisible to GA4, so
 * the caption says so rather than letting the number read as total reach.
 */
function LiveViewersWidget() {
  const [snap, setSnap] = useState<Ga4Snapshot | null>(null);

  useEffect(() => {
    let stop = false;
    const tick = () => {
      ga4State()
        .then((s) => {
          if (!stop) setSnap(s);
        })
        .catch((e) => {
          // A swallowed error here left member-tier kiosks on "Loading…"
          // forever when the command was admin-gated. Show the refusal.
          if (!stop) setSnap({ configured: true, viewers: null, updated: null, history: [], error: String(e) });
        });
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  if (!snap) return <div className="widget-empty">Loading…</div>;
  if (!snap.configured)
    return <div className="widget-empty">Add a GA4 property and key in Settings</div>;
  if (snap.error && snap.viewers === null)
    return <div className="widget-empty lv-err">{snap.error}</div>;

  const n = snap.viewers ?? 0;
  const hist = snap.history ?? [];
  const peak = Math.max(1, ...hist.map((h) => h.viewers));
  const stale = snap.updated ? Date.now() / 1000 - snap.updated > 120 : false;

  return (
    <div className="w-liveviewers">
      <div className="metric">
        <span className={`metric-value ${n > 0 ? "is-good" : ""}`}>{n.toLocaleString()}</span>
        <span className="metric-unit">watching</span>
      </div>
      <div className="lv-spark">
        {hist.map((h, i) => (
          <span
            key={`${h.at}-${i}`}
            className="lv-bar"
            style={{ height: `${Math.max(4, (h.viewers / peak) * 100)}%` }}
            title={`${h.viewers}`}
          />
        ))}
      </div>
      <div className="metric-cap">
        {stale ? "stale — check the booth's connection" : "last 30 min · web player · Facebook not counted"}
      </div>
      {snap.error && <div className="lv-err small">{snap.error}</div>}
    </div>
  );
}

function SlideGridWidget() {
  const { connected, status } = useProDeck();
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const pres = activePresentation(status);
  const liveIdx = currentSlideIndex(status);
  const uuid = pres.uuid ?? "";

  useEffect(() => {
    if (!connected || !uuid) {
      setSlides(null);
      return;
    }
    let stale = false;
    setSlides(null);
    ppGet(`presentation/${encodeURIComponent(uuid)}`)
      .then((j) => {
        if (!stale) setSlides(parseSlides(j));
      })
      .catch(() => {
        if (!stale) setSlides([]);
      });
    return () => {
      stale = true;
    };
  }, [connected, uuid]);

  if (!connected) return <Disconnected />;
  if (!uuid) return <div className="widget-empty">Nothing live in ProPresenter</div>;
  if (slides === null) return <div className="widget-empty">Loading slides…</div>;
  if (slides.length === 0) return <div className="widget-empty">No slides in {pres.name ?? "this presentation"}</div>;

  // Group runs into sections so each gets one caps rule, matching the rundown.
  // ProPresenter groups can carry a whitespace-only name, which is not "" and
  // so slipped past the fallback and rendered as a bare colour dot.
  const sections: { name: string; color?: string; slides: Slide[] }[] = [];
  for (const sl of slides) {
    const name = sl.group.trim();
    const last = sections[sections.length - 1];
    if (last && last.name === name) last.slides.push(sl);
    else sections.push({ name, color: sl.color, slides: [sl] });
  }

  return (
    <div className="w-slidegrid">
      {sections.map((sec, i) => (
        <div className="sg-section" key={`${sec.name}-${i}`}>
          <div className="rule-cap sg-cap">
            {sec.color && <span className="sg-dot" style={{ background: sec.color }} />}
            {sec.name || "Slides"}
          </div>
          <div className="sg-cards">
            {sec.slides.map((sl) => (
              <div
                className={`sg-card ${sl.index === liveIdx ? "live" : ""}`}
                key={sl.index}
                title={sl.text}
              >
                <span className="sg-n">{sl.index + 1}</span>
                <span className="sg-text">{sl.text || <em className="faint">no text</em>}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SlidePreviewWidget({ widget, update }: WidgetProps) {
  const { connected, status } = useProDeck();
  const [screens, setScreens] = useState<ScreenInfo[]>([]);

  // Screen list rarely changes — fetch once per connection.
  useEffect(() => {
    if (!connected) {
      setScreens([]);
      return;
    }
    ppGet("status/screens")
      .then((j: any) => {
        const list: ScreenInfo[] = Array.isArray(j)
          ? j.map((x: any) => ({
              uuid: x?.id?.uuid ?? "",
              name: x?.id?.name ?? "Screen",
              index: x?.id?.index ?? 0,
              type: x?.screen_type ?? "audience",
            }))
          : [];
        setScreens(list);
      })
      .catch(() => setScreens([]));
  }, [connected]);

  if (!connected) return <Disconnected />;

  const pres = activePresentation(status);
  const idx = currentSlideIndex(status);
  const sel = widget.config.screenIndex;
  const screen = screens.find((s) => s.index === sel) ?? null;

  // Per-screen layer composition from the current look (audience screens only).
  const lookScreens = (status.currentLook as any)?.screens ?? [];
  const layerState =
    screen && screen.type === "audience" ? lookScreens[screen.index] : null;
  const slideOff = layerState ? layerState.slide === false : false;

  return (
    <div className="w-slide">
      {screens.length > 0 && (
        <select
          className="input w-screen-select"
          value={sel ?? ""}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) =>
            update({
              screenIndex: e.target.value === "" ? null : Number(e.target.value),
            })
          }
        >
          <option value="">Program — active slide</option>
          {screens.map((s) => (
            <option key={s.uuid} value={s.index}>
              {s.name} · {s.type}
            </option>
          ))}
        </select>
      )}
      <div className={`slide-thumb-wrap ${slideOff ? "dim" : ""}`}>
        <SlideThumb uuid={pres.uuid} index={idx} label="Live slide" />
        {slideOff && (
          <div className="slide-off-overlay">Slide layer off on {screen?.name}</div>
        )}
      </div>
      <div className="w-slide-meta">
        <span className="muted small">
          {screen ? screen.name : pres.name ?? "No presentation"}
        </span>
        <span className="muted small">Slide {idx !== null ? idx + 1 : "—"}</span>
      </div>
      {layerState && (
        <div className="screen-layers">
          {LAYER_KEYS.filter((k) => layerState[k]).map((k) => (
            <span key={k} className="layer-chip">
              {k.replace("_", " ")}
            </span>
          ))}
          {LAYER_KEYS.every((k) => !layerState[k]) && (
            <span className="muted small">Screen cleared</span>
          )}
        </div>
      )}
    </div>
  );
}

function TimerWidget({ widget, editing, update }: WidgetProps) {
  const { connected } = useProDeck();
  const timers = useLiveTimers();
  const selected = widget.config.timerId
    ? timers.find((t) => t.id === widget.config.timerId)
    : null;

  if (editing) {
    return (
      <div className="w-config">
        <span className="muted small">Timer</span>
        <select
          className="input"
          value={widget.config.timerId ?? ""}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => update({ timerId: e.target.value || null })}
        >
          <option value="">First active timer</option>
          {timers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (!connected) return <Disconnected />;
  if (timers.length === 0)
    return <div className="widget-empty">No active timers</div>;

  // A specific timer is featured (big + controls); otherwise show all synced
  // ProPresenter timers as a compact live list.
  if (selected) {
    return (
      <div className="w-timer">
        <span className="w-timer-name muted small">{selected.name}</span>
        <span className={`w-timer-time ${selected.state}`}>{selected.time}</span>
        <div className="w-timer-btns" onMouseDown={(e) => e.stopPropagation()}>
          <button className="btn small" onClick={() => ppTimerOp(selected.id, "start")}>
            Start
          </button>
          <button className="btn small ghost" onClick={() => ppTimerOp(selected.id, "stop")}>
            Stop
          </button>
          <button className="btn small ghost" onClick={() => ppTimerOp(selected.id, "reset")}>
            Reset
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="w-timers">
      {timers.map((t) => (
        <div key={t.id} className="w-timer-line">
          <span className="w-timer-line-name">{t.name}</span>
          <span className={`w-timer-time-sm ${t.state}`}>{t.time}</span>
        </div>
      ))}
    </div>
  );
}

function ClockWidget({ widget, update, editing }: WidgetProps) {
  const [now, setNow] = useState(new Date());
  const h24 = widget.config.h24 ?? true;
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const time = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: !h24,
  });
  const date = now.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return (
    <div className="w-clock">
      <span className="w-clock-time">{time}</span>
      <span className="muted small">{date}</span>
      {editing && (
        <button
          className="btn small ghost"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => update({ h24: !h24 })}
        >
          {h24 ? "24-hour" : "12-hour"}
        </button>
      )}
    </div>
  );
}

function VideoInputWidget({ widget, editing, update }: WidgetProps) {
  const [sources, setSources] = useState<NdiSource[]>([]);
  const [scanning, setScanning] = useState(false);
  const [port, setPort] = useState<number | null>(null);
  const source: string | null = widget.config.source ?? null;
  const relay = useRelay();
  const isClient = relay.mode === "client";

  async function scan() {
    setScanning(true);
    try {
      setSources(await ndiDiscover());
    } finally {
      setScanning(false);
    }
  }

  // Start a local NDI receiver while assigned + not editing. On a relay client
  // we don't run NDI locally — we pull the host's MJPEG feed instead.
  useEffect(() => {
    if (editing || !source || isClient) {
      setPort(null);
      return;
    }
    let cancelled = false;
    let started = false;
    ndiStart(source)
      .then((p) => {
        started = true;
        if (cancelled) {
          // Unmounted while the start was in flight — release the ref we just
          // took, or the receiver would leak with no owner.
          ndiStop(source).catch(() => {});
          return;
        }
        setPort(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      // Only release a ref we actually acquired (stop-before-start would
      // decrement someone else's).
      if (started) ndiStop(source).catch(() => {});
    };
  }, [source, editing, isClient]);

  // On a client, the available sources are whatever the host is streaming.
  const pickSources = isClient
    ? relay.ndiSources.map((n) => ({ name: n, url_address: "" }))
    : sources;

  if (editing) {
    return (
      <div className="w-config">
        <span className="muted small">NDI source</span>
        <select
          className="input"
          value={source ?? ""}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => update({ source: e.target.value || null })}
        >
          <option value="">{source ?? "Select a source"}</option>
          {pickSources.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        {isClient ? (
          <span className="muted small">Sources are provided by the relay host.</span>
        ) : (
          <button
            className="btn small"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={scan}
            disabled={scanning}
          >
            {scanning ? "Scanning…" : "Scan NDI"}
          </button>
        )}
      </div>
    );
  }

  if (!source) {
    return (
      <div className="w-video">
        <span className="muted small">No source — edit to assign</span>
      </div>
    );
  }

  const streamUrl = isClient
    ? relay.relayNdiUrl(source)
    : port
      ? mjpegUrl(port)
      : null;
  return (
    <div className="w-video">
      {streamUrl ? (
        <img className="tile-stream" src={streamUrl} alt={source} />
      ) : (
        <span className="muted small">{isClient ? "Waiting for host feed…" : "Connecting…"}</span>
      )}
      <div className="tile-overlay">
        {streamUrl && (
          <span className="tile-chip live">
            <span className="rec-dot" />
            LIVE
          </span>
        )}
        <span className="tile-chip">
          <span className="tile-chip-dot" />
          <span className="tile-name">{source}</span>
        </span>
      </div>
    </div>
  );
}

// Overflow "Listen" — plays the booth's overflow mix through a plain <audio>
// element fed a live MP3 stream (/api/listen.mp3). Using <audio> (not Web Audio)
// means iOS routes it through the media channel, so the ring/silent switch and
// volume buttons work normally. Browser-only (open the web app on a phone).
//
// Kiosk mode (unattended office screen, no inputs): the widget starts itself
// and retries forever when the stream drops — volume is the TV's job. Needs
// Chrome launched with --autoplay-policy=no-user-gesture-required (in the
// OFFICE_KIOSK.md launcher); without it we say so instead of retry-spamming.
export function ListenWidget() {
  const kiosk = KIOSK_DASH !== null;
  // The stream lives in lib/listen (a module singleton), so navigating away
  // from this widget — or unmounting the whole dashboard — never stops
  // playback. This component is just the remote control.
  const [, force] = useState(0);
  useEffect(() => onListen(() => force((n) => n + 1)), []);
  const { state, err } = listenSnapshot();

  // Kiosk: hands-free start, and the singleton resurrects the stream itself.
  useEffect(() => {
    if (!kiosk || !IS_WEB) return;
    if (listenSnapshot().state === "idle") startListen(true);
  }, [kiosk]);

  return (
    <div className="w-listen">
      <span className={`chip ${state !== "idle" ? "online" : ""}`}>
        {state === "playing" ? "listening" : state === "loading" ? "connecting…" : "off"}
      </span>
      {state === "idle" ? (
        <button className="btn primary" onClick={() => startListen(kiosk)}>
          ▶ Listen
        </button>
      ) : (
        <button className="btn danger" onClick={stopListen}>
          Stop
        </button>
      )}
      <p className="muted small">
        {kiosk
          ? "Live booth audio — always on; set loudness on the TV."
          : "Live booth audio (overflow mix) — keeps playing while you use other tabs."}
      </p>
      {err && <p className="error small">{err}</p>}
    </div>
  );
}

// TapLink: what the NFC discs currently point at, with one-tap overrides.
// Auto-follow happens in Rust (tap.rs) off the status/slide stream; this
// widget is the operator's window into it, from the booth or a phone on the
// gateway — the host proxies the edge calls so the token stays on the host.
function TapLinkWidget() {
  const { settings } = useProDeck();
  const [edge, setEdge] = useState<(TapEdgeState & { keywords?: string[] }) | null>(null);
  const [stats, setStats] = useState<TapStatRow[] | null>(null);
  const [err, setErr] = useState("");
  // Last push seen (any source). A same-keyword re-push changes nothing else
  // visible — the discs were already right — so this line is the proof that
  // the slide actually landed: "✓ prayer · just now", then the timer restarts.
  const [lastPush, setLastPush] = useState<{ state: string; at: number } | null>(null);
  const [, forceTick] = useState(0);
  const enabled = !!settings?.tap_enabled;

  // 1s ticker so "Xs ago" / "reverts in Ym" stay live between polls.
  useEffect(() => {
    if (!enabled) return;
    const iv = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [enabled]);

  // Usage counts. Slow-moving, so a much lazier poll than the state above.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      tapStats()
        .then((s) => alive && setStats(s.days))
        .catch(() => {}); // never let a stats hiccup mask the live state below
    load();
    const iv = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const refresh = () =>
      tapEdgeState()
        .then((s) => alive && (setEdge(s), setErr("")))
        .catch((e) => alive && setErr(String(e)));
    refresh();
    const iv = setInterval(refresh, 10_000);
    const subs = [
      on<{ state: string; keepalive?: boolean }>("tap:pushed", (p) => {
        // Keepalive re-asserts happen every minute while a tagged slide is
        // live — refresh the timer line but don't flash for them.
        if (!p.keepalive) setLastPush({ state: p.state, at: Date.now() });
        refresh();
      }),
      on<{ error: string }>("tap:error", (p) => setErr(`push failed: ${p.error}`)),
    ];
    return () => {
      alive = false;
      clearInterval(iv);
      subs.forEach((u) => u.then((fn) => fn()));
    };
  }, [enabled]);

  if (!enabled)
    return <div className="widget-empty">TapLink is off — enable it in Settings</div>;

  const current = edge?.state ?? "default";
  const keywords = edge?.keywords ?? [];
  const hbAge = edge?.lastHeartbeat ? Math.round((Date.now() - edge.lastHeartbeat) / 1000) : null;

  // The edge buckets taps by UTC date, so an evening tap here already counts as
  // tomorrow. Never call the newest bucket "today" — sum a window instead, and
  // let the tooltip show the dated rows.
  const since = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  const window7 = (stats ?? []).filter((r) => r.day >= since);
  const total7 = window7.reduce((n, r) => n + r.taps, 0);
  const byKeyword = new Map<string, number>();
  for (const r of window7) byKeyword.set(r.state, (byKeyword.get(r.state) ?? 0) + r.taps);
  const top = [...byKeyword.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const perDay = new Map<string, number>();
  for (const r of window7) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.taps);
  return (
    <div className="w-stage">
      <div className="w-stage-current">
        <span className={`chip ${current !== "default" ? "online" : ""}`}>{current}</span>{" "}
        {/* Volunteers read "where do the discs go", not a raw URL — the full
            link stays one hover (or one click-to-copy) away. */}
        <span
          className="muted small"
          style={{ cursor: "copy" }}
          title={edge?.destination ? `${edge.destination} — click to copy` : ""}
          onClick={() =>
            edge?.destination && navigator.clipboard?.writeText(edge.destination).catch(() => {})
          }
        >
          {(() => {
            const d = edge?.destination;
            if (!d) return "…";
            try {
              const u = new URL(d);
              return `discs → ${u.hostname}${u.pathname !== "/" ? u.pathname : ""}`;
            } catch {
              return `discs → ${d}`;
            }
          })()}
        </span>
      </div>
      {(() => {
        const fmtAgo = (t: number) => {
          const s = Math.max(0, Math.round((Date.now() - t) / 1000));
          if (s < 60) return `${s}s ago`;
          if (s < 3600) return `${Math.floor(s / 60)}m ago`;
          return `${Math.floor(s / 3600)}h ago`;
        };
        const flash = lastPush && Date.now() - lastPush.at < 8_000;
        const revertMin =
          edge?.expiresAt && current !== "default"
            ? Math.max(0, Math.ceil((edge.expiresAt - Date.now()) / 60_000))
            : null;
        if (!flash && current === "default") return null;
        return (
          <div className="muted small">
            {flash && <span className="chip online">✓ {lastPush!.state}</span>}{" "}
            {current !== "default" && edge?.setAt
              ? `set ${fmtAgo(edge.setAt)}${revertMin !== null ? ` · reverts in ${revertMin}m` : ""}`
              : flash
                ? "pushed just now"
                : ""}
          </div>
        );
      })()}
      <div className="field-row" onMouseDown={(e) => e.stopPropagation()}>
        {keywords.map((k) => (
          <button
            key={k}
            className={`btn small ${current === k ? "primary" : ""}`}
            onClick={() => tapOverride(k).catch((e) => setErr(String(e)))}
          >
            {k}
          </button>
        ))}
        <button
          className={`btn small ghost ${current === "default" ? "primary" : ""}`}
          onClick={() => tapOverride(null).catch((e) => setErr(String(e)))}
        >
          default
        </button>
      </div>
      {total7 > 0 && (
        <div
          className="muted small"
          title={[...perDay.entries()]
            .sort((a, b) => (a[0] < b[0] ? 1 : -1))
            .map(([d, n]) => `${d}: ${n} tap${n === 1 ? "" : "s"}`)
            .join("\n")
            .concat("\n\n(dates are UTC, as logged by the edge)")}
        >
          {total7} tap{total7 === 1 ? "" : "s"} · 7d — {top.map(([k, n]) => `${k} ${n}`).join(" · ")}
        </div>
      )}
      <div className="muted small">
        {err ? <span className="error">{err}</span> : hbAge !== null ? `heartbeat ${hbAge}s ago` : ""}
      </div>
    </div>
  );
}

interface CheckItem {
  text: string;
  done: boolean;
}
interface NamedList {
  name: string;
  items: CheckItem[];
}

function ChecklistWidget({ widget, update }: WidgetProps) {
  // Migrate the old single-list format; brand-new widgets start with two
  // procedure types (Startup / Shutdown).
  const lists: NamedList[] = Array.isArray(widget.config.lists)
    ? widget.config.lists
    : Array.isArray(widget.config.items)
      ? [{ name: "Checklist", items: widget.config.items }]
      : [
          { name: "Startup", items: [] },
          { name: "Shutdown", items: [] },
        ];
  const active = Math.min(Math.max(0, widget.config.active ?? 0), lists.length - 1);
  const cur = lists[active] ?? lists[0];
  const [draft, setDraft] = useState("");
  const stop = (e: ReactMouseEvent) => e.stopPropagation();

  const commit = (next: NamedList[], activeIdx = active) =>
    update({ lists: next, active: activeIdx, items: undefined });
  const setItems = (items: CheckItem[]) =>
    commit(lists.map((l, i) => (i === active ? { ...l, items } : l)));

  async function addList() {
    const name = await askText("New checklist name (e.g. Startup, Shutdown, Soundcheck)");
    if (!name?.trim()) return;
    commit([...lists, { name: name.trim(), items: [] }], lists.length);
  }
  async function renameList() {
    const name = await askText("Rename checklist", cur.name);
    if (!name?.trim()) return;
    commit(lists.map((l, i) => (i === active ? { ...l, name: name.trim() } : l)));
  }
  async function deleteList() {
    if (lists.length <= 1) return;
    if (!(await askConfirm(`Delete checklist "${cur.name}"?`, "Delete"))) return;
    const next = lists.filter((_, i) => i !== active);
    commit(next, Math.max(0, active - 1));
  }
  function resetChecks() {
    setItems(cur.items.map((x) => ({ ...x, done: false })));
  }

  const doneCount = cur.items.filter((x) => x.done).length;

  return (
    <div className="w-checklist">
      <div className="cl-tabs" onMouseDown={stop}>
        {lists.map((l, i) => (
          <button
            key={i}
            className={`cl-tab ${i === active ? "active" : ""}`}
            onClick={() => update({ active: i })}
          >
            {l.name}
          </button>
        ))}
        <button className="cl-tab add" title="New checklist type" onClick={addList}>
          +
        </button>
      </div>
      <div className="cl-bar" onMouseDown={stop}>
        <span className="cl-count muted small">
          {doneCount}/{cur.items.length} done
        </span>
        <div className="cl-actions">
          <button className="btn small ghost" onClick={resetChecks} title="Uncheck all">
            Reset
          </button>
          <button className="btn small ghost" onClick={renameList}>
            Rename
          </button>
          {lists.length > 1 && (
            <button className="btn small ghost" onClick={deleteList}>
              Delete
            </button>
          )}
        </div>
      </div>
      <div className="w-check-items">
        {cur.items.map((it, i) => (
          <label key={i} className="w-check-row" onMouseDown={stop}>
            <input
              type="checkbox"
              checked={it.done}
              onChange={() =>
                setItems(cur.items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))
              }
            />
            <span className={it.done ? "done" : ""}>{it.text}</span>
            <button
              className="w-check-del"
              onClick={() => setItems(cur.items.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </label>
        ))}
        {cur.items.length === 0 && (
          <span className="muted small" style={{ padding: "4px 6px" }}>
            No steps yet — add the first below.
          </span>
        )}
      </div>
      <div className="field-row" onMouseDown={stop}>
        <input
          className="input"
          value={draft}
          placeholder={`Add to ${cur.name}…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              setItems([...cur.items, { text: draft.trim(), done: false }]);
              setDraft("");
            }
          }}
        />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Planning Center widgets */

function PcoEmpty() {
  return <div className="widget-empty">No plan selected</div>;
}

function ShowFlowWidget() {
  const {
    items, liveItemId, selectedPlanId, liveAction, liveBusy, liveError, controller, hasControl,
    serviceTimes, selectedServiceTimeId,
  } = usePco();
  if (!selectedPlanId) return <PcoEmpty />;
  if (items.length === 0) return <div className="widget-empty">No items</div>;
  const heldByOther = !!controller?.controllerId && !hasControl;

  // Running clock time per item: service start + the sum of everything before
  // it. PCO gives durations but no per-item wall time, and "what time does the
  // sermon actually start" is the question the rundown gets asked all morning.
  const base = serviceTimes.find((t) => t.id === selectedServiceTimeId)?.ts ?? 0;
  const startAt = new Map<string, string>();
  if (base > 0) {
    let acc = 0;
    for (const it of items) {
      if (it.type === "header") continue;
      startAt.set(
        it.id,
        new Date(base + acc).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      );
      acc += (it.length || 0) * 1000;
    }
  }
  return (
    <div className="w-showflow">
      <div className="sf-controls">
        {liveItemId && (
          <span className="live-badge">
            <span className="rec-dot" /> LIVE
          </span>
        )}
        {heldByOther && (
          <button
            className="btn small"
            disabled={liveBusy}
            title={`${controller?.controllerName ?? "Someone else"} is controlling PCO Live. Take control to drive it from here.`}
            onClick={() => liveAction("toggle_control")}
          >
            Take control
          </button>
        )}
        <button
          className="btn small"
          disabled={liveBusy}
          title="Previous item"
          onClick={() => liveAction("go_to_previous_item")}
        >
          <Icon name="prev" size={13} />
        </button>
        <button
          className="btn small primary"
          disabled={liveBusy}
          title="Next item"
          onClick={() => liveAction("go_to_next_item")}
        >
          <Icon name="next" size={13} />
        </button>
      </div>
      {/* A failed live action used to go only to pco.status, which renders on
          the Planning Center page — so pressing next from a dashboard failed
          in complete silence. */}
      {liveError && <div className="error small">{liveError}</div>}
      <div className="showflow">
        {items.map((it) =>
        it.type === "header" ? (
          <div key={it.id} className="sf-header">
            {it.title}
          </div>
        ) : (
          <div key={it.id} className={`sf-item ${it.id === liveItemId ? "live" : ""}`}>
            <span className="sf-gutter">
              <span className="sf-at">{startAt.get(it.id) ?? ""}</span>
              <span className="sf-dur">{fmtLen(it.length)}</span>
            </span>
            <span className={`sf-type ${it.type}`} />
            <span className="sf-title">{it.title}</span>
            <SongKeyLeader item={it} />
            {it.id === liveItemId && <span className="sf-live">LIVE</span>}
          </div>
        ),
        )}
      </div>
    </div>
  );
}

function PlanItemWidget() {
  const pco = usePco();
  const { items, liveItemId, selectedPlanId } = pco;
  if (!selectedPlanId) return <PcoEmpty />;
  const real = items.filter((i) => i.type !== "header");
  const liveIdx = items.findIndex((i) => i.id === liveItemId);
  const current = liveIdx >= 0 ? items[liveIdx] : null;
  const next =
    liveIdx >= 0
      ? items.slice(liveIdx + 1).find((i) => i.type !== "header") ?? null
      : real[0] ?? null;
  // Songs answer the booth's next three questions in one line: who leads,
  // what key, which mic they're on.
  const detail = (it: (typeof items)[number] | null) => {
    if (!it || it.type !== "song" || !it.leader) return null;
    const mic = pco.micForLeader(it.leader);
    return `${it.leader}${mic ? ` · Mic ${mic}` : ""}`;
  };
  const row = (it: (typeof items)[number] | null, live: boolean) => (
    <div className={live ? "pi-now" : "pi-next"}>
      <div className="pi-row-main">
        <span className={`pi-label ${live ? "live" : ""}`}>{live ? "NOW" : "NEXT"}</span>
        <span className="pi-title">{it ? it.title : "—"}</span>
        {it?.key && <span className="sf-key">{it.key}</span>}
        {it && <span className={`pi-len ${live ? "" : "muted small"}`}>{fmtLen(it.length)}</span>}
      </div>
      {detail(it) && <div className="pi-detail muted small">{detail(it)}</div>}
    </div>
  );
  return (
    <div className="w-planitem">
      {row(current, true)}
      {row(next, false)}
    </div>
  );
}

// ---------------------------------------------------------- Switcher Cues
// The video operator's whole job is anticipation, so this widget answers
// exactly three questions, big enough to read from a lean-back position:
// what's live NOW, what's NEXT, and what does the switcher DO about it —
// the shot call and the ATEM macro cue. Deliberately zero automation: it
// tells a human what's coming; the human presses the buttons.
//
// Shot calls resolve per item: a "shots: ..." line in the item's PCO
// description wins; otherwise the first matching rule (one per line,
// `match = call`; match is a case-insensitive title substring, or `type:song`
// for every song). Macro cues use the same matching plus `@start` for the
// pre-service moment. Rules are edited in dashboard Edit mode on the booth
// and render everywhere, including web clients like the switcher screen.
const DEFAULT_SHOT_RULES = [
  "type:song = CU main vocalist · wide/float for team",
  "sermon = Wide + follow",
  "welcome = Wide crowd, push to host",
].join("\n");
const DEFAULT_MACRO_RULES = [
  "@start = MACRO 2 at service start (MACRO 4 if unstreamed)",
  "bumper = AFTER bumper ends → MACRO 3",
].join("\n");

function parseRules(text: string): { match: string; text: string }[] {
  return text
    .split("\n")
    .map((l) => l.split("="))
    .filter((p) => p.length >= 2 && p[0].trim())
    .map((p) => ({ match: p[0].trim().toLowerCase(), text: p.slice(1).join("=").trim() }));
}

function ruleFor(
  rules: { match: string; text: string }[],
  it: { title: string; type: string; description?: string } | null,
): string | null {
  if (!it) return null;
  // Per-item override straight from PCO: "shots: wide + lectern" in the
  // item description beats every rule.
  const m = (it.description ?? "").match(/shots?:\s*(.+)/i);
  if (m) return m[1].trim();
  const title = it.title.toLowerCase();
  for (const r of rules) {
    if (r.match === "@start") continue;
    if (r.match.startsWith("type:") ? it.type === r.match.slice(5) : title.includes(r.match))
      return r.text;
  }
  return null;
}

function SwitcherCuesWidget({ widget, editing, update }: WidgetProps) {
  const pco = usePco();
  const { items, liveItemId, selectedPlanId } = pco;
  const shotRules = parseRules(widget.config.shotRules ?? DEFAULT_SHOT_RULES);
  const macroRules = parseRules(widget.config.macroRules ?? DEFAULT_MACRO_RULES);
  if (editing) {
    return (
      <div className="w-switcher-edit" onMouseDown={(e) => e.stopPropagation()}>
        <span className="muted small">Shot calls — one per line, match = call</span>
        <textarea
          className="w-notes"
          rows={4}
          value={widget.config.shotRules ?? DEFAULT_SHOT_RULES}
          onChange={(e) => update({ shotRules: e.target.value })}
        />
        <span className="muted small">
          Macro cues — match = cue (`@start` shows before the service begins)
        </span>
        <textarea
          className="w-notes"
          rows={3}
          value={widget.config.macroRules ?? DEFAULT_MACRO_RULES}
          onChange={(e) => update({ macroRules: e.target.value })}
        />
        <span className="muted small">
          Tip: a "shots: …" line in a PCO item description overrides these.
        </span>
      </div>
    );
  }
  if (!selectedPlanId) return <PcoEmpty />;
  const real = items.filter((i) => i.type !== "header");
  const liveIdx = items.findIndex((i) => i.id === liveItemId);
  const current = liveIdx >= 0 ? items[liveIdx] : null;
  const next =
    liveIdx >= 0
      ? items.slice(liveIdx + 1).find((i) => i.type !== "header") ?? null
      : real[0] ?? null;
  const preService = liveIdx < 0;
  const macroCue = preService
    ? macroRules.find((r) => r.match === "@start")?.text ?? null
    : ruleFor(macroRules, next) ?? ruleFor(macroRules, current);
  const block = (it: typeof current, live: boolean) => (
    <div className={`sw-block ${live ? "sw-now" : "sw-next"}`}>
      <div className="pi-row-main">
        <span className={`pi-label ${live ? "live" : ""}`}>{live ? "NOW" : "NEXT"}</span>
        <span className="pi-title" style={{ fontSize: live ? undefined : "1.25em" }}>
          {it ? it.title : "—"}
        </span>
        {it && <span className="pi-len muted small">{fmtLen(it.length)}</span>}
      </div>
      {ruleFor(shotRules, it) && (
        <div className={live ? "pi-detail small" : "pi-detail"} style={{ color: "var(--accent-hi)" }}>
          🎥 {ruleFor(shotRules, it)}
        </div>
      )}
    </div>
  );
  return (
    <div className="w-planitem">
      {block(current, true)}
      {block(next, false)}
      {macroCue && (
        <div
          className="pi-detail"
          style={{
            marginTop: 6,
            padding: "6px 10px",
            borderRadius: 8,
            background: "var(--warn-dim, rgba(224,160,48,.15))",
            color: "var(--warn, #e0a030)",
            fontWeight: 600,
          }}
        >
          ⚡ {macroCue}
        </div>
      )}
    </div>
  );
}

// Permanent crew-signup QR — encodes PUBLIC_URL/join, which survives invite
// rotation by design, so a screen can display it forever.
function CrewQrWidget() {
  const [qr, setQr] = useState("");
  useEffect(() => {
    import("qrcode")
      .then((Q) => Q.toDataURL(`${PUBLIC_URL}/join`, { margin: 1, width: 320 }))
      .then(setQr)
      .catch(() => {});
  }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "center" }}>
      {qr && <img src={qr} alt="Join ProDeck Crew" style={{ maxWidth: "80%", maxHeight: "75%", borderRadius: 8 }} />}
      <span className="muted small">Join ProDeck Crew — scan</span>
    </div>
  );
}

function PeopleWidget({ widget, editing, update }: WidgetProps) {
  const { team, selectedPlanId } = usePco();
  if (!selectedPlanId) return <PcoEmpty />;
  if (team.length === 0) return <div className="widget-empty">No one scheduled</div>;

  const allTeams = Array.from(new Set(team.map((m) => m.team).filter(Boolean))).sort();
  const picked: string[] = widget.config.teams ?? [];
  const showAll = picked.length === 0;

  // While editing, expose a team checklist. Nothing checked = show everyone.
  if (editing) {
    const toggle = (t: string) =>
      update({
        teams: picked.includes(t) ? picked.filter((x) => x !== t) : [...picked, t],
      });
    return (
      <div className="w-config">
        <span className="muted small">Show teams</span>
        <div className="team-filter">
          {allTeams.map((t) => (
            <label
              key={t}
              className="tf-row"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={picked.includes(t)}
                onChange={() => toggle(t)}
              />
              <span>{t}</span>
            </label>
          ))}
        </div>
        <span className="muted small">None checked → show all teams</span>
      </div>
    );
  }

  const visible = showAll ? team : team.filter((m) => picked.includes(m.team));
  if (visible.length === 0)
    return <div className="widget-empty">No one on the selected teams</div>;
  const rank = (s: string) =>
    ({ confirmed: 0, unconfirmed: 1, declined: 3 } as Record<string, number>)[
      s.toLowerCase()
    ] ?? 2;
  const byTeam: Record<string, TeamMember[]> = {};
  for (const m of visible) (byTeam[m.team] ??= []).push(m);
  for (const k of Object.keys(byTeam))
    byTeam[k].sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));
  return (
    <div className="w-people">
      {Object.entries(byTeam).map(([name, members]) => {
        const inC = members.filter((m) => m.status.toLowerCase() === "confirmed").length;
        const outC = members.filter((m) => isDeclined(m.status)).length;
        return (
          <div key={name} className="team-group">
            <div className="team-name">
              <span>{name}</span>
              <span className="team-counts">
                {inC > 0 && <span className="tc-ok">{inC} in</span>}
                {outC > 0 && <span className="tc-no">{outC} out</span>}
              </span>
            </div>
            {members.map((m) => (
              <div key={m.id} className={`team-row ${m.status.toLowerCase()}`}>
                <Avatar src={m.photo} name={m.name} size={24} />
                <div className="t-info">
                  <span className="t-name">{m.name}</span>
                  <span className="t-pos">{m.position}</span>
                </div>
                <span className={`t-status ${m.status.toLowerCase()}`}>{m.status}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// Per-song leaders from PCO (the "Leader" item note, or the song description).
function SongLeadersWidget() {
  const { items, liveItemId, selectedPlanId } = usePco();
  if (!selectedPlanId) return <PcoEmpty />;
  const songs = items.filter((i) => i.type === "song");
  if (songs.length === 0) return <div className="widget-empty">No songs in this plan</div>;
  return (
    <div className="w-leaders">
      {songs.map((s) => (
        <div key={s.id} className={`lead-row ${s.id === liveItemId ? "live" : ""}`}>
          <span className="lead-name">{s.title}</span>
          <SongKeyLeader item={s} className="lead-edit" />
        </div>
      ))}
    </div>
  );
}


function MicAssignmentWidget() {
  const { team, selectedPlanId, micCount, micFor, setMic, micRoster } = usePco();
  if (!selectedPlanId) return <PcoEmpty />;
  const roster = micRoster();
  if (roster.length === 0)
    return <div className="widget-empty">No one on a mic</div>;
  // Conflicts count unique PEOPLE per mic — PCO schedules the same person as
  // several team entries (per position/time), and one human on one mic twice
  // is not a conflict.
  const use: Record<string, number> = {};
  const seen = new Set<string>();
  for (const m of team) {
    // Declined people aren't serving — their remembered mics must not
    // manufacture conflicts with this week's real assignments.
    if (isDeclined(m.status)) continue;
    const person = m.name.trim().toLowerCase();
    if (seen.has(person)) continue;
    seen.add(person);
    const mic = micFor(m.id, m.position).mic;
    if (mic) use[mic] = (use[mic] ?? 0) + 1;
  }
  return (
    <div className="mic-grid">
      {roster.map((m) => {
        const info = micFor(m.id, m.position);
        return (
          <MicCard
            key={m.id}
            name={m.name}
            photo={m.photo}
            position={m.position}
            value={info.mic}
            count={micCount}
            fromTemplate={info.fromTemplate}
            conflict={!!info.mic && use[info.mic] > 1}
            onChange={(v) => setMic(m.id, v)}
          />
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------- Mic Wall */

/* ----------------------------------------------------------- SPL meter */

// Map a dB-SPL value to a percent along the meter. The bar spans dBFS -60..0,
// and SPL = dBFS + calibration, so dBFS = spl - cal.
function splPct(spl: number, cal: number): number {
  return Math.max(0, Math.min(100, ((spl - cal + 60) / 60) * 100));
}
// A left→right gradient: green up to greenMax, amber up to yellowMax, red beyond.
function splGradient(greenMax: number, yellowMax: number, cal: number): string {
  const g = splPct(greenMax, cal);
  const y = splPct(Math.max(yellowMax, greenMax), cal);
  return `linear-gradient(90deg, var(--online) 0 ${g}%, var(--amber) ${g}% ${y}%, var(--live) ${y}% 100%)`;
}
// The zone color for the current reading (used to tint the big number).
function splZoneColor(spl: number, greenMax: number, yellowMax: number): string {
  return spl <= greenMax
    ? "var(--online)"
    : spl <= yellowMax
      ? "var(--amber)"
      : "var(--live)";
}

/* ----------------------------------------------------------- SPL + RTA combined */

function AudioMeterWidget({ widget, editing, update }: WidgetProps) {
  const { audioDb, audioPeakDb, audioRunning, splCalibration, setSplCalibration } =
    useProDeck();
  const [inputs, setInputs] = useState<string[]>([]);
  const [bands, setBands] = useState<number[]>([]);
  const [hold, setHold] = useState(-100);
  const [calibrating, setCalibrating] = useState(false);
  const [measured, setMeasured] = useState("");
  const device: string | null = widget.config.device ?? null;
  const cal = splCalibration;
  const greenMax = widget.config.greenMax ?? 90;
  const yellowMax = widget.config.yellowMax ?? 100;

  useEffect(() => {
    listAudioInputs().then(setInputs).catch(() => {});
  }, []);
  useEffect(() => {
    const un = on<number[]>("audio:rta", (b) => setBands(b));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const dbfs = audioDb;
  const peakDbfs = audioPeakDb;
  useEffect(() => {
    if (!audioRunning) {
      setHold(-100);
      return;
    }
    setHold((h) => (peakDbfs > h ? peakDbfs : h));
  }, [peakDbfs, audioRunning]);

  if (editing) {
    return (
      <div className="w-config">
        <span className="muted small">Input device</span>
        <select
          className="input"
          value={device ?? ""}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => update({ device: e.target.value || null })}
        >
          <option value="">System default</option>
          {inputs.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        <span className="muted small">Calibration — dB SPL at 0 dBFS (global)</span>
        <input
          className="input"
          type="number"
          value={cal}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => setSplCalibration(parseFloat(e.target.value) || 0)}
        />
        <span className="muted small">Green up to (dB SPL)</span>
        <input
          className="input"
          type="number"
          value={greenMax}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => update({ greenMax: parseFloat(e.target.value) || 0 })}
        />
        <span className="muted small">Yellow up to — louder is red (dB SPL)</span>
        <input
          className="input"
          type="number"
          value={yellowMax}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => update({ yellowMax: parseFloat(e.target.value) || 0 })}
        />
      </div>
    );
  }

  const fill = Math.max(0, Math.min(100, ((dbfs + 60) / 60) * 100));
  const peakPct = Math.max(0, Math.min(100, ((peakDbfs + 60) / 60) * 100));
  const spl = Math.round(dbfs + cal);
  function applyCal() {
    const m = parseFloat(measured);
    if (Number.isFinite(m) && audioRunning) {
      setSplCalibration(Math.round((m - dbfs) * 10) / 10);
      setCalibrating(false);
      setMeasured("");
    }
  }

  return (
    <div className="w-audiometer">
      <div className="am-top">
        <div className="spl-readout">
          <span
            className="spl-num"
            style={audioRunning ? { color: splZoneColor(spl, greenMax, yellowMax) } : undefined}
          >
            {audioRunning ? spl : "--"}
          </span>
          <span className="spl-unit">dB SPL</span>
        </div>
        <div className="am-actions" onMouseDown={(e) => e.stopPropagation()}>
          {audioRunning && (
            <button
              className={`btn small ${calibrating ? "primary" : "ghost"}`}
              title="Match this meter to a real SPL meter — changes readings on every screen"
              onClick={() => setCalibrating((c) => !c)}
            >
              Calibrate…
            </button>
          )}
          {audioRunning ? (
            <button className="btn small ghost" onClick={() => stopAudioCapture()}>
              Stop
            </button>
          ) : (
            <button className="btn small primary" onClick={() => startAudioCapture(device)}>
              Monitor
            </button>
          )}
        </div>
      </div>
      <div className="spl-meter" style={{ background: splGradient(greenMax, yellowMax, cal) }}>
        <div className="spl-unlit" style={{ width: `${100 - fill}%` }} />
        {audioRunning && <div className="spl-peak" style={{ left: `${peakPct}%` }} />}
      </div>
      {calibrating && audioRunning && (
        <div className="spl-cal" onMouseDown={(e) => e.stopPropagation()}>
          <span className="muted small">Read your real SPL meter, enter it:</span>
          <div className="spl-cal-row">
            <input
              className="input"
              type="number"
              placeholder="e.g. 85"
              value={measured}
              onChange={(e) => setMeasured(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyCal()}
            />
            <span className="muted small">dB SPL</span>
            <button className="btn small primary" onClick={applyCal}>
              Calibrate
            </button>
          </div>
        </div>
      )}
      <div className="am-rta">
        {!audioRunning || bands.length === 0 ? (
          <div className="rta-idle">{audioRunning ? "Analyzing…" : "Monitoring off"}</div>
        ) : (
          <RtaGraph bands={bands} />
        )}
      </div>
      <div
        className="am-foot muted small"
        title={audioRunning ? `raw input level ${Math.round(dbfs)} dBFS` : undefined}
      >
        {audioRunning
          ? dbfs <= -59
            ? "quiet"
            : `peak ${Math.round(hold + cal)} dB`
          : "idle"}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Sunday readiness */

// One glance, one button: everything the booth needs running before a
// service, each row green or red, and "Get ready" fixes whatever it can
// (connect PP, pick this week's plan, start sync, start audio). Rows ProDeck
// can't fix itself (desk, TapLink edge) say what to check instead.
function ReadinessWidget() {
  const pl = useProDeck();
  const pco = usePco();
  const [tap, setTap] = useState<TapEdgeState | null>(null);
  const [deskSnap, setDeskSnap] = useState<AvantisSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pl.settings?.tap_enabled) tapEdgeState().then(setTap).catch(() => {});
    avantisState().then(setDeskSnap).catch(() => {});
    const subs = [
      on<AvantisSnapshot>("avantis:state", setDeskSnap),
      on<{ connected: boolean }>("avantis:status", (s) =>
        setDeskSnap((p) => (p ? { ...p, connected: s.connected } : p)),
      ),
    ];
    return () => {
      subs.forEach((u) => u.then((f) => f()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pl.settings?.tap_enabled]);
  const deskUp = !!deskSnap?.connected;

  // The desk only transmits mute CHANGES and this board runs solid-state
  // (saved, never recalled) — so ProDeck caches every state it has ever seen
  // across restarts. A mapped mic is only "unknown" if it has NEVER been
  // touched while ProDeck was listening: a one-time setup task per channel.
  const mappedMics = Object.values(pco.micDeskMap ?? {});
  const knownMics = mappedMics.filter((id) => deskSnap?.mutes?.[id] !== undefined).length;

  // Weekly desk names: compare what the vocal channels are called on the
  // console against this week's roster — stale names get a one-tap fix right
  // here instead of a trip into Planning Center.
  const weeklyNames = deskUp ? pco.weeklyMicNames() : [];
  const staleNames = weeklyNames.filter((p) =>
    p.targets.some((t) => (deskSnap?.names?.[t] ?? "").trim() !== p.label),
  );
  const [pushingNames, setPushingNames] = useState(false);
  async function pushWeeklyNames() {
    const total = staleNames.reduce((n, p) => n + p.targets.length, 0);
    const summary = staleNames.map((p) => `Mic ${p.mic} → ${p.label}`).join(" · ");
    if (!(await askConfirm(`Rename ${total} desk channels for this week?\n${summary}`))) return;
    setPushingNames(true);
    try {
      for (const p of staleNames)
        for (const t of p.targets) await avantisSetName(t, p.label).catch(() => {});
    } finally {
      setPushingNames(false);
    }
  }

  // "This week's plan": the first plan dated today or later (PCO lists them
  // soonest-first); yesterday counts too so a Saturday-night setup still
  // matches Sunday... and vice versa across midnight.
  const today = Date.now() - 36 * 3600_000;
  const targetPlan =
    pco.plans.find((p) => {
      const t = Date.parse(p.date ?? "");
      return Number.isFinite(t) && t >= today;
    }) ?? null;
  const planOk = !!pco.selectedPlanId && (!targetPlan || pco.selectedPlanId === targetPlan.id);

  interface Row {
    label: string;
    ok: boolean;
    detail: string;
  }
  const rows: Row[] = [
    {
      label: "Pro",
      ok: pl.connected,
      detail: pl.connected ? pl.host || "connected" : "not connected",
    },
    {
      label: "Plan",
      ok: planOk,
      detail: planOk
        ? pco.plans.find((p) => p.id === pco.selectedPlanId)?.date ?? "selected"
        : targetPlan
          ? `should be ${targetPlan.date}`
          : "no plan selected",
    },
    { label: "Sync", ok: pco.syncing, detail: pco.syncing ? "live" : "off" },
    {
      label: "Audio",
      ok: pl.audioRunning,
      detail: pl.audioRunning ? "listening" : "off",
    },
    ...(pl.settings?.avantis_enabled
      ? [
          {
            label: "Desk",
            ok: deskUp,
            detail: deskUp ? "mirroring" : "check power / network",
          },
          ...(deskUp && mappedMics.length > 0
            ? [
                {
                  label: "Mic states",
                  ok: knownMics === mappedMics.length,
                  detail:
                    knownMics === mappedMics.length
                      ? `all ${mappedMics.length} tracked`
                      : `${knownMics}/${mappedMics.length} known — tap each vocal mute once; ProDeck remembers from then on`,
                },
              ]
            : []),
          ...(deskUp && weeklyNames.length > 0
            ? [
                {
                  label: "Names",
                  ok: staleNames.length === 0,
                  detail:
                    staleNames.length === 0
                      ? "match this week"
                      : `${staleNames.length} stale`,
                },
              ]
            : []),
        ]
      : []),
    ...(pl.settings?.tap_enabled
      ? [
          {
            label: "TapLink",
            ok: tap?.state === "default",
            detail: tap ? (tap.state === "default" ? "on default" : `on "${tap.state}"`) : "unreachable",
          },
        ]
      : []),
  ];
  const allOk = rows.every((r) => r.ok);

  // Fix what's fixable, in dependency order. Best-effort: each row re-renders
  // from real state, so anything that didn't take stays red and honest.
  async function getReady() {
    setBusy(true);
    try {
      const s = pl.settings;
      if (!pl.connected && s?.pp_host) await pl.connect(s.pp_host, s.pp_port).catch(() => {});
      if (targetPlan && pco.selectedPlanId !== targetPlan.id) {
        pco.selectPlan(targetPlan.id);
        await new Promise((r) => setTimeout(r, 1500)); // let the plan load
      }
      if (!pco.syncing && (pco.selectedPlanId || targetPlan)) await pco.startSync();
      if (!pl.audioRunning && !IS_WEB)
        await startAudioCapture(s?.audio_input ?? null).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  // Compact layout: healthy checks are one-word pills (detail in the
  // tooltip); only failing checks spend pixels explaining themselves.
  return (
    <div className="w-ready">
      <div className="w-ready-chips">
        {rows.map((r) => (
          <span
            key={r.label}
            className={`w-ready-chip ${r.ok ? "ok" : "bad"}`}
            title={r.detail}
          >
            <span className={`hl-dot ${r.ok ? "ok" : "bad"}`} />
            {r.label}
            {!r.ok && <span className="w-ready-why">{r.detail}</span>}
          </span>
        ))}
      </div>
      <div className="w-ready-actions">
        {allOk && <span className="w-ready-all">✓ Ready for service</span>}
        {!allOk && !IS_WEB && (
          <button className="btn small primary" disabled={busy} onClick={getReady}>
            {busy ? "Getting ready…" : "Get ready"}
          </button>
        )}
        {staleNames.length > 0 && !IS_WEB && (
          <button className="btn small" disabled={pushingNames} onClick={pushWeeklyNames}>
            {pushingNames ? "Renaming…" : `Write ${staleNames.length} mic name${staleNames.length === 1 ? "" : "s"} to console`}
          </button>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Avantis desk */

// Read-only mirror of the sound desk: every named channel with its live mute
// state, fader position, and desk colour. The tile a volunteer reads when the
// question is "is the pastor's mic on?" — without touching the console.
const AVANTIS_COLORS: Record<number, string> = {
  1: "#e0645b", // red
  2: "#3fcf8e", // green
  3: "#f0b429", // yellow
  4: "#5b8def", // blue
  5: "#b07ce8", // purple
  6: "#5bc8ef", // light blue
  7: "#eef3fa", // white
};
const KIND_LABEL: Record<string, string> = {
  input: "In", dca: "DCA", main: "Main", grp: "Grp", sgrp: "Grp",
  aux: "Aux", saux: "Aux", mtx: "Mtx", smtx: "Mtx", fxs: "FX", sfxs: "FX", fxr: "FXr", mgrp: "MGrp",
};
const KIND_ORDER = ["main", "dca", "input", "grp", "sgrp", "aux", "saux", "mtx", "smtx", "fxs", "sfxs", "fxr", "mgrp"];

function faderDb(v: number): string {
  const db = (v / 127) * 64 - 54;
  if (v === 0) return "-∞";
  return `${db >= 0 ? "+" : ""}${db.toFixed(0)} dB`;
}

function AvantisWidget({ widget, editing, update }: WidgetProps) {
  const { settings } = useProDeck();
  const [snap, setSnap] = useState<AvantisSnapshot | null>(null);
  // Watch list: channel ids this tile shows. Empty/absent = every named
  // channel. Each widget instance keeps its own list, so one dashboard can
  // have a "Vocals" tile and another a "Band" tile.
  const picked: string[] = widget.config.channels ?? [];
  // Control is opt-in PER TILE and admin-only: a monitoring tile stays inert
  // no matter who taps it; a control tile mirrors the desk's own mute keys.
  const allowControl: boolean = !!widget.config.allowControl;
  const [isAdmin, setIsAdmin] = useState(!IS_WEB);
  useEffect(() => {
    if (IS_WEB) webWhoami().then((w) => setIsAdmin(w.tier === "admin")).catch(() => {});
  }, []);
  const canControl = allowControl && isAdmin;

  useEffect(() => {
    avantisState().then(setSnap).catch(() => {});
    const subs = [
      on<AvantisSnapshot>("avantis:state", setSnap),
      on<{ connected: boolean }>("avantis:status", (s) =>
        setSnap((p) => (p ? { ...p, connected: s.connected } : p)),
      ),
    ];
    return () => {
      subs.forEach((u) => u.then((f) => f()));
    };
  }, []);

  const named = Object.entries(snap?.names ?? {})
    .filter(([, name]) => name.trim())
    .map(([id, name]) => {
      const [kind, idxs] = id.split(":");
      return { id, kind, idx: parseInt(idxs), name };
    })
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.idx - b.idx,
    );

  if (editing) {
    const toggle = (id: string) =>
      update({
        channels: picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id],
      });
    const groups = new Map<string, typeof named>();
    for (const r of named) {
      const g = KIND_LABEL[r.kind] ?? r.kind;
      (groups.get(g) ?? groups.set(g, []).get(g)!).push(r);
    }
    return (
      <div className="w-avantis av-pick" onMouseDown={(e) => e.stopPropagation()}>
        <div className="w-avantis-head">
          <span className="muted small">
            {picked.length === 0
              ? "Showing every named channel — check some to watch only those."
              : `Watching ${picked.length} channel${picked.length === 1 ? "" : "s"}.`}
          </span>
          {picked.length > 0 && (
            <button className="btn small ghost" onClick={() => update({ channels: [] })}>
              Show all
            </button>
          )}
        </div>
        <label className="av-pick-item" style={{ maxWidth: 380 }}>
          <input
            type="checkbox"
            checked={allowControl}
            onChange={(e) => update({ allowControl: e.target.checked })}
          />
          <span>
            Allow mute control from this tile (admin only — taps press the
            desk's mute keys)
          </span>
        </label>
        {named.length === 0 ? (
          <p className="muted small">Connect the desk to load channel names.</p>
        ) : (
          [...groups.entries()].map(([g, rows]) => (
            <div key={g}>
              <div className="av-pick-group">{g}</div>
              <div className="av-pick-grid">
                {rows.map((r) => (
                  <label key={r.id} className={`av-pick-item ${picked.includes(r.id) ? "on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={picked.includes(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                    <span>{r.name}</span>
                    <span className="muted small">{r.idx}</span>
                  </label>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  if (!settings?.avantis_enabled)
    return <div className="widget-empty">Desk mirror is off — enable it in Settings → Avantis</div>;
  if (!snap || !snap.connected)
    return <div className="widget-empty">Can't reach the Avantis — check it's on and networked</div>;

  const rows = picked.length === 0 ? named : named.filter((r) => picked.includes(r.id));

  return (
    <div className="w-avantis">
      <div className="w-avantis-head">
        <span className="chip online">{canControl ? "control" : "mirroring"}</span>
        {snap.scene != null && (
          <span className="muted small">
            Scene {snap.scene}
            {settings?.avantis_scene_labels?.[String(snap.scene)]
              ? ` — ${settings.avantis_scene_labels[String(snap.scene)]}`
              : ""}
          </span>
        )}
        {canControl && (
          <select
            className="input av-scene-pick"
            value=""
            title="Recall a scene on the desk"
            onChange={async (e) => {
              const v = e.target.value;
              e.target.value = "";
              const n =
                v === "other"
                  ? parseInt((await askText("Recall which scene? (1-500)", "")) ?? "")
                  : parseInt(v);
              if (!Number.isFinite(n) || n < 1 || n > 500) return;
              const label = settings?.avantis_scene_labels?.[String(n)];
              // A scene resets the whole console — never one accidental tap.
              if (
                await askConfirm(
                  `Recall scene ${n}${label ? ` — ${label}` : ""} on the Avantis? This changes the entire desk state.`,
                )
              )
                avantisRecallScene(n).catch(() => {});
            }}
          >
            <option value="">Recall scene…</option>
            {Object.entries(settings?.avantis_scene_labels ?? {})
              .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
              .map(([n, l]) => (
                <option key={n} value={n}>
                  {n} — {l}
                </option>
              ))}
            <option value="other">Scene number…</option>
          </select>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="muted small">
          Listening… channel names load on connect; mutes and faders appear as
          the desk transmits changes.
        </p>
      ) : (
        <>
          {/* Named mute groups get big toggle buttons on control tiles —
              they're the desk's own "mute the whole stage" switches. */}
          {canControl && rows.some((r) => r.kind === "mgrp") && (
            <div className="av-mgrps">
              {rows
                .filter((r) => r.kind === "mgrp")
                .map((r) => {
                  const active = snap.mutes[r.id] === true;
                  return (
                    <button
                      key={r.id}
                      className={`av-mgrp ${active ? "active" : ""}`}
                      title={`Mute Group ${r.idx} — ${active ? "release" : "engage"}`}
                      onClick={() => avantisSetMute(r.id, !active).catch(() => {})}
                    >
                      {r.name}
                      <span className="av-mgrp-state">{active ? "MUTED" : "open"}</span>
                    </button>
                  );
                })}
            </div>
          )}
          <div className="w-avantis-grid">
            {rows
              .filter((r) => !(canControl && r.kind === "mgrp"))
              .map((r) => {
                const muted = snap.mutes[r.id];
                const fader = snap.faders[r.id];
                const col = AVANTIS_COLORS[snap.colors[r.id] ?? 0];
                const cls = `av-chan ${muted === true ? "muted" : muted === false ? "live" : ""}`;
                // ±1 dB per press (the protocol maps 64 dB across 127 steps).
                const nudge = (d: number) => {
                  const cur = snap.faders[r.id];
                  if (cur === undefined) return;
                  avantisSetFader(r.id, Math.max(0, Math.min(127, cur + d))).catch(() => {});
                };
                return (
                  <div
                    key={r.id}
                    className={cls}
                    style={col ? { borderLeftColor: col } : undefined}
                    title={`${KIND_LABEL[r.kind] ?? r.kind} ${r.idx}`}
                  >
                    <span className="av-name">{r.name}</span>
                    <span className="av-sub">
                      {muted === true ? "MUTED" : muted === false ? "live" : "—"}
                      {fader !== undefined ? ` · ${faderDb(fader)}` : ""}
                    </span>
                    {canControl && (
                      <div className="av-ctl-row">
                        <button
                          className={`btn small ${muted === true ? "" : "danger"}`}
                          title={
                            muted === true
                              ? "Unmute on the desk"
                              : "Mute on the desk (unknown state mutes — the safe direction)"
                          }
                          onClick={() => avantisSetMute(r.id, muted !== true).catch(() => {})}
                        >
                          {muted === true ? "Unmute" : "Mute"}
                        </button>
                        {fader !== undefined && (
                          <>
                            <button className="btn small ghost" title="−1 dB" onClick={() => nudge(-2)}>
                              −
                            </button>
                            <button className="btn small ghost" title="+1 dB" onClick={() => nudge(2)}>
                              +
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- Service Tracking */

function fmtSec(s: number): string {
  if (s <= 0) return "—";
  const t = Math.round(s);
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function ServiceTrackingWidget() {
  const { rows, resetPlan, rehearsal, rehearsalAuto, setRehearsal, loadError } = useTracking();
  // Loud, because the failure mode it replaces was silent: the service simply
  // wasn't being recorded and nobody knew until the report came up empty.
  if (loadError)
    return (
      <div className="widget-empty">
        <span className="error">Not recording — {loadError}</span>
      </div>
    );
  if (rows.length === 0) return <div className="widget-empty">No plan loaded</div>;
  const plannedTotal = rows.reduce((s, r) => s + r.planned, 0);
  const actualTotal = rows.reduce((s, r) => s + (r.tracked ? r.actual : 0), 0);
  return (
    <div className="w-track">
      <div className="track-bar">
        <span className="muted small">planned {fmtSec(plannedTotal)} · actual {fmtSec(actualTotal)}</span>
        <button
          className={`btn small ${rehearsal ? "primary" : "ghost"}`}
          title={
            rehearsalAuto
              ? "Set from the scheduled service time — rehearsals are tracked separately so they never mix into the service's report. Click to override."
              : "Manually set — click to switch, or press auto to follow the service time again."
          }
          onClick={() => setRehearsal(!rehearsal)}
        >
          {rehearsal ? "Rehearsal" : "Service"}
        </button>
        {!rehearsalAuto && (
          <button className="btn small ghost" title="Follow the scheduled service time" onClick={() => setRehearsal(null)}>
            auto
          </button>
        )}
        <button
          className="btn small ghost"
          title="Erase this service's tracked times and SPL. Saved reports are untouched."
          onClick={async () => {
            // One unlabelled click used to wipe a whole service. Name what's
            // about to go, and where it still survives.
            const tracked = rows.filter((r) => r.tracked).length;
            const mins = Math.round(
              rows.reduce((s, r) => s + (r.tracked ? r.actual : 0), 0) / 60,
            );
            if (
              await askConfirm(
                `Erase tracking for this ${rehearsal ? "rehearsal" : "service"} — ${tracked} item${
                  tracked === 1 ? "" : "s"
                }, ${mins} min recorded? This can't be undone. Reports you've already saved are not affected.`,
                "Erase",
              )
            )
              resetPlan();
          }}
        >
          Reset
        </button>
      </div>
      <div className="track-head">
        <span className="tc-title">Item</span>
        <span className="tc">Plan</span>
        <span className="tc">Actual</span>
        <span className="tc">Δ</span>
        <span className="tc">SPL pk/avg</span>
      </div>
      <div className="track-rows">
        {rows.map((r) => {
          const delta = r.tracked ? Math.round(r.actual - r.planned) : null;
          return (
            <div key={r.itemId} className={`track-row ${r.live ? "live" : ""}`}>
              <span className="tc-title">{r.title}</span>
              <span className="tc mono">{fmtSec(r.planned)}</span>
              <span className="tc mono">{r.tracked ? fmtSec(r.actual) : "—"}</span>
              <span
                className={`tc mono ${delta != null ? (delta > 0 ? "over" : "under") : ""}`}
              >
                {delta != null ? `${delta > 0 ? "+" : ""}${delta}s` : "—"}
              </span>
              <span className="tc mono">
                {r.splPeak > -100
                  ? `${Math.round(r.splPeak)}/${Math.round(r.splAvg)}`
                  : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Playlist control */

/* ----------------------------------------------------------- Mission Control */

// One-glance health of every department.
function HealthStripWidget() {
  const { subsystems } = useAlerts();
  return (
    <div className="w-health">
      {subsystems.map((s) => (
        <div key={s.key} className={`hs-item ${s.state}`}>
          <span className="hs-dot" />
          <div className="hs-text">
            <span className="hs-label">{s.label}</span>
            <span className="hs-detail">{s.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// NOW / NEXT / IN 2 — the director's pre-cue peek.
function RunOrderWidget() {
  const { items, liveItemId, selectedPlanId } = usePco();
  if (!selectedPlanId) return <PcoEmpty />;
  const reals = items.filter((i) => i.type !== "header");
  const liveIdx = items.findIndex((i) => i.id === liveItemId);
  const cur = liveIdx >= 0 ? items[liveIdx] : null;
  const after =
    liveIdx >= 0 ? items.slice(liveIdx + 1).filter((i) => i.type !== "header") : reals;
  const next = after[0] ?? null;
  const in2 = after[1] ?? null;
  return (
    <div className="w-runorder">
      <div className="ro-now">
        <span className="ro-tag live">NOW</span>
        <span className="ro-title">{cur ? cur.title : "—"}</span>
        {cur?.key && <span className="sf-key">{cur.key}</span>}
        {cur && <span className="ro-len">{fmtLen(cur.length)}</span>}
      </div>
      <div className="ro-line">
        <span className="ro-tag">NEXT</span>
        <span className="ro-title">{next ? next.title : "—"}</span>
        {next?.key && <span className="sf-key">{next.key}</span>}
        {next && <span className="ro-len muted small">{fmtLen(next.length)}</span>}
      </div>
      <div className="ro-line dim">
        <span className="ro-tag">IN 2</span>
        <span className="ro-title">{in2 ? in2.title : "—"}</span>
        {in2?.key && <span className="sf-key">{in2.key}</span>}
        {in2 && <span className="ro-len muted small">{fmtLen(in2.length)}</span>}
      </div>
    </div>
  );
}

// Run-of-show pacing: are we ahead of or behind the plan, right now?
function ServiceTimelineWidget() {
  const { rows } = useTracking();
  if (rows.length === 0) return <div className="widget-empty">No plan loaded</div>;
  const plannedTotal = rows.reduce((s, r) => s + r.planned, 0);
  const reached = rows.filter((r) => r.tracked);
  const plannedSoFar = reached.reduce((s, r) => s + r.planned, 0);
  const actualSoFar = reached.reduce((s, r) => s + r.actual, 0);
  const delta = Math.round(actualSoFar - plannedSoFar);
  const pct = plannedTotal > 0 ? Math.min(100, (actualSoFar / plannedTotal) * 100) : 0;
  const state = Math.abs(delta) <= 15 ? "ontime" : delta > 0 ? "over" : "under";
  const label =
    state === "ontime"
      ? "ON TIME"
      : `${delta > 0 ? "+" : "−"}${fmtSec(Math.abs(delta))} ${delta > 0 ? "OVER" : "UNDER"}`;
  return (
    <div className="w-timeline">
      <div className="tl-head">
        <span className="muted small">Run of show</span>
        <span className={`tl-delta ${state}`}>{label}</span>
      </div>
      <div className="tl-bar">
        <div className={`tl-fill ${state}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="tl-foot muted small">
        elapsed {fmtSec(actualSoFar)} · planned {fmtSec(plannedTotal)}
      </div>
    </div>
  );
}

// Big countdown to a target time (service start, segment, etc.).
function ServiceClockWidget({ widget, editing, update }: WidgetProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const target: string = widget.config.target ?? "";

  if (editing) {
    return (
      <div className="w-config">
        <span className="muted small">Target time (24h)</span>
        <input
          className="input"
          type="time"
          value={target}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => update({ target: e.target.value })}
        />
        <span className="muted small">Counts down to this time each day.</span>
      </div>
    );
  }

  const wall = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (!/^\d{1,2}:\d{2}$/.test(target)) {
    return (
      <div className="w-svcclock">
        <span className="muted small">Set a target time in Edit</span>
        <span className="sc-wall muted small">{wall}</span>
      </div>
    );
  }
  const [h, m] = target.split(":").map(Number);
  const tgt = new Date(now);
  tgt.setHours(h, m, 0, 0);
  const diff = Math.round((tgt.getTime() - now) / 1000);
  const before = diff > 0;
  const abs = Math.abs(diff);
  const mmss = `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
  const urgent = before && diff <= 60;
  return (
    <div className="w-svcclock">
      <span className="sc-label">{before ? "ON AIR IN" : "ON AIR"}</span>
      <span className={`sc-big ${before ? (urgent ? "urgent" : "") : "live"}`}>
        {before ? mmss : `+${mmss}`}
      </span>
      <span className="sc-wall muted small">{wall}</span>
    </div>
  );
}


/* ----------------------------------------------------------- Registry */

// Lobby TVs — ProPresenter's ANNOUNCEMENTS layer, which plays independently
// of the service and feeds the lobby screens. Buttons are auto-discovered:
// any playlist item whose destination is "announcements" (that's how Pro
// marks them — e.g. "Pre-Service Slides", "14DaysPrayer"). Trigger plays the
// loop on the lobby TVs without touching the sanctuary output; Clear darkens
// them. Verified live: playlist/{id}/{index}/trigger → announcement/active →
// clear/layer/announcements.
function LobbyTvWidget(_: WidgetProps) {
  const [active, setActive] = useState<string | null>(null);
  const [buttons, setButtons] = useState<{ pl: string; plName: string; index: number; name: string }[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  // The standing loop the booth watchdog restores whenever the layer goes
  // dark (Pro reboots dark — this is what makes lobby TVs zero-touch).
  const [auto, setAuto] = useState<{ pl: string; index: number; name: string } | null>(null);

  useEffect(() => {
    getSettings()
      .then((s: any) => {
        if (s?.lobby_auto_playlist)
          setAuto({ pl: s.lobby_auto_playlist, index: s.lobby_auto_index ?? 0, name: s.lobby_auto_name ?? "" });
      })
      .catch(() => {});
  }, []);

  async function saveAuto(next: { pl: string; index: number; name: string } | null) {
    try {
      const s: any = await getSettings();
      await updateSettings({
        ...s,
        lobby_auto_playlist: next?.pl ?? "",
        lobby_auto_index: next?.index ?? 0,
        lobby_auto_name: next?.name ?? "",
      });
      setAuto(next);
    } catch (e) {
      setErr(String(e));
    }
  }

  // What's on the lobby TVs right now (poll — the status stream doesn't
  // carry the announcements layer).
  useEffect(() => {
    let alive = true;
    const poll = () =>
      ppGet("announcement/active")
        .then((j: any) => alive && setActive(j?.announcement?.id?.name ?? null))
        .catch(() => {});
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Discover the announcement loops across every playlist.
  useEffect(() => {
    (async () => {
      try {
        const pl = (await ppGet("playlists")) as any[];
        const flat: { uuid: string; name: string }[] = [];
        const walk = (xs: any[]) => {
          for (const p of xs ?? []) {
            if (p.field_type === "playlist") flat.push({ uuid: p.id.uuid, name: p.id.name });
            walk(p.children ?? []);
          }
        };
        walk(Array.isArray(pl) ? pl : []);
        const found: { pl: string; plName: string; index: number; name: string }[] = [];
        for (const p of flat) {
          const d = (await ppGet(`playlist/${p.uuid}`)) as any;
          (d?.items ?? []).forEach((it: any, i: number) => {
            if (it.destination === "announcements" && it.type === "presentation")
              found.push({ pl: p.uuid, plName: p.name, index: i, name: it.id.name });
          });
        }
        setButtons(found);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  async function play(b: { pl: string; index: number; name: string }) {
    setBusy(b.name);
    setErr("");
    try {
      await ppGet(`playlist/${b.pl}/${b.index}/trigger`);
      setActive(b.name);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%" }}>
      <div>
        <span className="muted small">On lobby TVs: </span>
        <strong>{active ?? "nothing"}</strong>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {buttons.map((b) => (
          <button
            key={`${b.pl}:${b.index}`}
            className={`btn small ${active === b.name ? "primary" : ""}`}
            disabled={busy === b.name}
            title={`From playlist "${b.plName}"`}
            onClick={() => play(b)}
          >
            ▶ {b.name}
          </button>
        ))}
        {buttons.length === 0 && !err && (
          <span className="muted small">
            No announcement loops found — mark a playlist item's destination
            as Announcements in Pro and it shows up here.
          </span>
        )}
      </div>
      <button
        className="btn small ghost"
        disabled={!active}
        title={auto ? "Also turns off auto-restore — otherwise the watchdog would relight the TVs within a minute" : undefined}
        onClick={async () => {
          try {
            // Clearing while auto-restore is armed would be undone in ≤60 s —
            // an explicit Clear means "off", so it disarms the watchdog too.
            if (auto) await saveAuto(null);
            await ppClearLayer("announcements");
            setActive(null);
          } catch (e) {
            setErr(String(e));
          }
        }}
      >
        ✕ Clear lobby TVs
      </button>
      <label className="muted small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        Auto-restore
        <select
          className="input"
          style={{ flex: 1 }}
          value={auto ? `${auto.pl}:${auto.index}` : ""}
          onChange={(e) => {
            const b = buttons.find((x) => `${x.pl}:${x.index}` === e.target.value);
            saveAuto(b ? { pl: b.pl, index: b.index, name: b.name } : null);
          }}
        >
          <option value="">Off — manual only</option>
          {buttons.map((b) => (
            <option key={`${b.pl}:${b.index}`} value={`${b.pl}:${b.index}`}>
              Keep "{b.name}" on the TVs
            </option>
          ))}
        </select>
      </label>
      {err && <span className="small" style={{ color: "var(--warn, #e6a23c)" }}>{err}</span>}
    </div>
  );
}

export const WIDGETS: WidgetDef[] = [
  // Mission Control — director overview
  { type: "health_strip", label: "System Health", group: "Mission Control", w: 12, h: 2, component: HealthStripWidget },
  { type: "run_order", label: "Run Order (Now/Next)", group: "Mission Control", w: 4, h: 4, component: RunOrderWidget },
  { type: "service_timeline", label: "Run-of-Show Timing", group: "Mission Control", w: 6, h: 2, component: ServiceTimelineWidget },
  { type: "service_clock", label: "Service Countdown", group: "Mission Control", w: 3, h: 3, component: ServiceClockWidget },
  { type: "service_tracking", label: "Service Tracking", group: "Mission Control", w: 6, h: 6, component: ServiceTrackingWidget },
  // ProPresenter
  { type: "slide_preview", label: "Slide Preview", group: "ProPresenter", w: 5, h: 5, component: SlidePreviewWidget },
  { type: "slide_grid", label: "Slide Grid", group: "ProPresenter", w: 4, h: 8, component: SlideGridWidget },
  { type: "timer", label: "Timer", group: "ProPresenter", w: 4, h: 3, component: TimerWidget },
  { type: "tap_link", label: "TapLink (NFC)", group: "ProPresenter", w: 4, h: 3, component: TapLinkWidget },
  { type: "lobby_tv", label: "Lobby TVs (Announcements)", group: "ProPresenter", w: 4, h: 3, component: LobbyTvWidget },
  // Planning Center
  { type: "show_flow", label: "Show Flow", group: "Planning Center", w: 4, h: 6, component: ShowFlowWidget },
  { type: "plan_item", label: "Now / Next", group: "Planning Center", w: 4, h: 3, component: PlanItemWidget },
  { type: "people", label: "Team", group: "Planning Center", w: 3, h: 5, component: PeopleWidget },
  { type: "song_leaders", label: "Song Leaders", group: "Planning Center", w: 4, h: 4, component: SongLeadersWidget },
  { type: "mic_assignment", label: "Mic Assignments", group: "Planning Center", w: 4, h: 5, component: MicAssignmentWidget },
  // Audio
  { type: "audio_meter", label: "SPL + RTA", group: "Audio", w: 5, h: 5, component: AudioMeterWidget },
  { type: "listen", label: "Overflow Listen", group: "Audio", w: 3, h: 3, component: ListenWidget },
  { type: "avantis", label: "Sound Desk (Avantis)", group: "Audio", w: 6, h: 4, component: AvantisWidget },
  { type: "readiness", label: "Sunday Readiness", group: "General", w: 4, h: 4, component: ReadinessWidget },
  // Video & Switcher
  { type: "video_input", label: "Stage Feed (NDI)", group: "Video", w: 4, h: 4, component: VideoInputWidget },
  { type: "live_viewers", label: "Live Viewers (Online)", group: "ProPresenter", w: 3, h: 4, component: LiveViewersWidget },
  { type: "switcher_cues", label: "Switcher Cues (What's Next)", group: "Video", w: 5, h: 5, component: SwitcherCuesWidget },
  { type: "crew_qr", label: "Join QR (Crew Signup)", group: "General", w: 3, h: 3, component: CrewQrWidget },
  // General
  { type: "clock", label: "Clock", group: "General", w: 4, h: 2, component: ClockWidget },
  { type: "checklist", label: "Checklist", group: "General", w: 4, h: 5, component: ChecklistWidget },
];

export const WIDGET_MAP: Record<string, WidgetDef> = Object.fromEntries(
  WIDGETS.map((w) => [w.type, w]),
);
