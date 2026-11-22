// Director: the booth's service controls on a phone, for whoever runs the
// service (the "director" grant, or admin). Pages, PCO Live, Pro, the
// screens, video, people and a log of what phones did. Sound is shown, never
// changed from here. Design: the Director mode canvas, November 2026.
//
// Safety: the booth enforces every grant (web.rs member_gate). On the phone,
// Director opens with Face ID (ProDeck Crew 1.5) or the crew PIN, stays open
// for the service (lib/directorLock), and anything the room sees at once
// (clearing the screens) is a press and hold.

import { useEffect, useRef, useState } from "react";
import { usePco } from "../pcoStore";
import { useProDeck } from "../store";
import { useChat } from "../chatStore";
import { usePages } from "../pagesStore";
import { usePerms } from "../lib/perms";
import { directorLog, ppClearLayer, ppNext, ppPrevious, type CrewPage, type DirectorLogEntry } from "../lib/tauri";
import { crewAppHome, IN_CREW_APP } from "../lib/crewApp";
import { IS_DEMO } from "../lib/demo";
import {
  appHasFaceId,
  directorOpen,
  directorUntil,
  faceIdHandoff,
  newNonce,
  readFaceIdReturn,
  readNonce,
  readUntil,
  readUsePin,
  saveNonce,
  saveUntil,
  saveUsePin,
  untilLabel,
} from "../lib/directorLock";
import { CrewPageComposer, CrewPageTracking } from "./CrewPages";
import { CrewDash, WidgetCard } from "./CrewDash";
import { clock, countdown } from "./fmt";
import type { Widget } from "../lib/dashboards";

export type DirectorSub = "" | "screens" | "sound" | "video" | "dash";

/** Pro layers "clear the screens" clears. Audio stays: walk in music and
 *  playback are the sound team's, not a screen. */
export const CLEAR_SCREEN_LAYERS = ["slide", "media", "video_input", "props", "messages", "announcements"];

const QUICK_PAGES = ["Come to the booth", "Check your mic", "Stand by", "You're on next"];

/** The plan's length and service times, as lib/serviceWindow wants them. */
function useServiceClock() {
  const pco = usePco();
  const planMs = pco.items.filter((i) => i.type !== "header").reduce((n, i) => n + (i.length || 0) * 1000, 0);
  const times = pco.serviceTimes.map((t) => ({ id: t.id, ts: t.ts ?? 0 }));
  return { planMs, times };
}

export function CrewDirector({
  sub,
  onOpen,
  onBack,
  onPeople,
}: {
  sub: DirectorSub;
  onOpen: (s: DirectorSub) => void;
  onBack: () => void;
  onPeople: () => void;
}) {
  const { planMs, times } = useServiceClock();
  const [until, setUntil] = useState(readUntil);
  const [, tick] = useState(0);

  // Coming back from the app's Face ID with the one time code.
  useEffect(() => {
    const nonce = readNonce();
    if (!nonce) return;
    const r = readFaceIdReturn(location.hash, nonce);
    if (r.rest !== location.hash) history.replaceState(history.state, "", location.pathname + location.search + r.rest);
    if (r.ok) {
      const u = directorUntil(Date.now(), times, planMs);
      saveUntil(u);
      setUntil(u);
    }
    if (r.pin) saveUsePin(true);
    saveNonce("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-check the lock each minute, so it closes on time while open.
  useEffect(() => {
    const iv = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(iv);
  }, []);

  // The demo has no PIN to ask for: it opens, so App Review and the curious
  // see what Director is.
  const open = IS_DEMO || directorOpen(until, Date.now());
  const unlock = () => {
    const u = directorUntil(Date.now(), times, planMs);
    saveUntil(u);
    setUntil(u);
  };
  const lock = () => {
    saveUntil(0);
    setUntil(0);
  };

  if (!open) return <DirectorGate onUnlocked={unlock} />;

  if (sub === "dash") return <CrewDash onBack={onBack} />;
  if (sub === "screens") return <DirectorWidgets title="Screens" types={SCREEN_WIDGETS} onBack={onBack} />;
  if (sub === "sound") return <DirectorWidgets title="Sound" types={SOUND_WIDGETS} onBack={onBack} note="View only. Changes stay at the desk." />;
  if (sub === "video") return <DirectorWidgets title="Video" types={VIDEO_WIDGETS} onBack={onBack} />;
  return <DirectorHome until={until} onLock={lock} onOpen={onOpen} onPeople={onPeople} />;
}

/* ------------------------------------------------------------------ gate */

function DirectorGate({ onUnlocked }: { onUnlocked: () => void }) {
  const chat = useChat();
  const faceId = IN_CREW_APP && appHasFaceId() && !readUsePin();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const withFaceId = () => {
    const nonce = newNonce();
    saveNonce(nonce);
    location.href = faceIdHandoff(crewAppHome(), nonce, location.href.replace(/#.*$/, ""));
  };

  const withPin = async () => {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setErr("");
    try {
      await chat.login(chat.name, pin);
      onUnlocked();
    } catch (e) {
      setErr(/pin|wrong|incorrect/i.test(String(e)) ? "That PIN didn't match." : String(e).replace(/^Error:\s*/, ""));
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="crew-page dir-gate">
      <h1 className="crew-title">Director</h1>
      <div className="dir-gate-mid">
        <span className="dir-gate-mark" aria-hidden>
          <IconFaceId />
        </span>
        <p className="dir-gate-title">Booth controls on your phone</p>
        <p className="dir-gate-body">Pages, the run of show, screens and video. Everything you do here is logged with your name.</p>
      </div>
      {faceId ? (
        <button className="crew-btn dir-amber" onClick={withFaceId}>
          Open with Face ID
        </button>
      ) : chat.name ? (
        <form
          className="dir-gate-pin"
          onSubmit={(e) => {
            e.preventDefault();
            void withPin();
          }}
        >
          <label htmlFor="dir-pin" className="dir-gate-label">
            Your crew PIN
          </label>
          <input
            id="dir-pin"
            className="dir-input mono-data"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />
          {err && <p className="dir-err">{err}</p>}
          <button className="crew-btn dir-amber" disabled={pin.length < 4 || busy}>
            {busy ? "Checking" : "Open Director"}
          </button>
        </form>
      ) : (
        <button className="crew-btn dir-amber" onClick={onUnlocked}>
          Open Director
        </button>
      )}
      <p className="dir-gate-foot">Stays open until the service ends.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ home */

function DirectorHome({
  until,
  onLock,
  onOpen,
  onPeople,
}: {
  until: number;
  onLock: () => void;
  onOpen: (s: DirectorSub) => void;
  onPeople: () => void;
}) {
  const pco = usePco();
  const { audioDb, audioRunning, splCalibration } = useProDeck();
  const { pages } = usePages();
  const { can } = usePerms();
  const [composer, setComposer] = useState<{ body?: string } | null>(null);
  const [tracking, setTracking] = useState<CrewPage | null>(null);
  const [proErr, setProErr] = useState("");

  const now = Date.now();
  const next = pco.serviceTimes
    .map((t) => t.ts)
    .filter((ts) => ts && ts > now - 2 * 60 * 60_000)
    .sort((a, b) => a - b)[0];
  const cd = next ? countdown(next) : null;

  const liveIdx = pco.items.findIndex((i) => i.id === pco.liveItemId);
  const real = pco.items.filter((i) => i.type !== "header");
  const nowItem = liveIdx >= 0 ? pco.items[liveIdx] : null;
  const nextItem = pco.items.slice(liveIdx + 1).find((i) => i.type !== "header") ?? null;
  const pos = nowItem ? real.findIndex((i) => i.id === nowItem.id) + 1 : 0;

  const myPages = [...pages].sort((a, b) => b.sent_ms - a.sent_ms);
  const last = myPages[0] ?? null;

  const pro = (p: Promise<void>) => {
    setProErr("");
    p.catch((e) => setProErr(String(e).replace(/^Error:\s*/, "")));
  };

  return (
    <div className="crew-page dir">
      <header className="dir-head">
        <div className="dir-head-text">
          <h1 className="crew-title">Director</h1>
          <span className="mono dir-sub">Open until {untilLabel(until)}</span>
        </div>
        <button className="dir-icon-btn" onClick={onLock} aria-label="Lock Director">
          <IconLock />
        </button>
      </header>

      <section className="crew-card dir-status">
        <div className="dir-status-cd">
          <span className="mono-data dir-big">{cd ? cd.big : "--"}</span>
          <span className="mono dir-dim">{cd ? cd.caption : "no service time"}</span>
        </div>
        <div className="dir-status-room">
          <span className="mono dir-dim">Room</span>
          <span className="mono-data">{audioRunning ? `${Math.round(audioDb + splCalibration)} dB` : "Meter off"}</span>
        </div>
      </section>

      <div className="dir-col">
      <section className="crew-card accent dir-live">
        <div className="dir-row">
          <span className="mono dir-accent">PCO Live</span>
          {pos > 0 && <span className="mono-data dir-dim">{pos} of {real.length}</span>}
        </div>
        <p className="dir-now">{nowItem ? nowItem.title : "Nothing live yet"}</p>
        <p className="dir-next">Next: {nextItem ? nextItem.title : nowItem ? "End of the plan" : real[0]?.title ?? "No plan"}</p>
        {pco.liveError && <p className="dir-err">{pco.liveError}</p>}
        <div className="dir-pair">
          <button className="dir-btn" disabled={!can("control") || pco.liveBusy} onClick={() => void pco.liveAction("go_to_previous_item")}>
            Back
          </button>
          <button className="dir-btn primary" disabled={!can("control") || pco.liveBusy} onClick={() => void pco.liveAction("go_to_next_item")}>
            {pco.liveBusy ? "Moving" : "Next item"}
          </button>
        </div>
      </section>

      <section className="crew-card dir-pro">
        <span className="mono dir-dim">ProPresenter</span>
        <div className="dir-pair even">
          <button className="dir-btn" onClick={() => pro(ppPrevious())}>
            Previous slide
          </button>
          <button className="dir-btn primary" onClick={() => pro(ppNext())}>
            Next slide
          </button>
        </div>
        <div className="dir-pair even">
          <button className="dir-btn small" onClick={() => pro(ppClearLayer("slide"))}>
            Clear slide
          </button>
          <button className="dir-btn small" onClick={() => pro(ppClearLayer("props"))}>
            Clear props
          </button>
        </div>
        <HoldButton
          label="Hold to clear the screens"
          holding="Keep holding"
          done="Screens cleared"
          onDone={() => pro(Promise.all(CLEAR_SCREEN_LAYERS.map((l) => ppClearLayer(l))).then(() => {}))}
        />
        {proErr && <p className="dir-err">{proErr}</p>}
      </section>
      </div>

      <div className="dir-col">

      {can("page") && (
        <section className="crew-card dir-page">
          <div className="dir-row">
            <span className="mono dir-dim">Page</span>
            <button className="dir-link" onClick={() => setComposer({})}>
              New page
            </button>
          </div>
          <div className="dir-quick">
            {QUICK_PAGES.map((q, i) => (
              <button key={q} className={`dir-quick-btn${i === 0 ? " hot" : ""}`} onClick={() => setComposer({ body: q })}>
                {q}
              </button>
            ))}
          </div>
          {last && (
            <button className="dir-last" onClick={() => setTracking(last)}>
              <span className="dir-last-body">
                Last: {clock(last.sent_ms)}, “{last.body}”
              </span>
              <span className="mono-data dir-seen">
                {last.receipts.length}/{last.recipients.length || last.receipts.length} seen
              </span>
            </button>
          )}
        </section>
      )}

      <section className="dir-tiles">
        <DirTile title="Screens" sub="Stage, child call, TVs" onClick={() => onOpen("screens")} icon={<IconScreen />} />
        <DirTile title="Video" sub="Switcher and stream" onClick={() => onOpen("video")} icon={<IconVideo />} />
        <DirTile title="Sound" sub="View only" onClick={() => onOpen("sound")} icon={<IconSound />} />
        <DirTile title="People" sub="Who's here" onClick={onPeople} icon={<IconPeople />} />
      </section>
      <button className="dir-row-link" onClick={() => onOpen("dash")}>
        <span>Dashboards</span>
        <span aria-hidden>›</span>
      </button>

      <DirectorLog />
      </div>

      {composer && <CrewPageComposer preset={composer} onClose={() => setComposer(null)} />}
      {tracking && (
        <CrewPageTracking page={pages.find((p) => p.id === tracking.id) ?? tracking} onClose={() => setTracking(null)} />
      )}
    </div>
  );
}

function DirTile({ title, sub, icon, onClick }: { title: string; sub: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button className="dir-tile" onClick={onClick}>
      <span className="dir-tile-icon" aria-hidden>
        {icon}
      </span>
      <span className="dir-tile-title">{title}</span>
      <span className="mono-data dir-tile-sub">{sub}</span>
    </button>
  );
}

/* ------------------------------------------------------------------- log */

function DirectorLog() {
  const [log, setLog] = useState<DirectorLogEntry[]>([]);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      directorLog()
        .then((l) => alive && setLog(Array.isArray(l) ? l : []))
        .catch(() => {});
    load();
    const iv = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);
  const shown = all ? log : log.slice(0, 5);
  return (
    <section className="crew-card dir-log">
      <span className="mono dir-dim">Log</span>
      {log.length === 0 && <p className="dir-log-empty">Nothing yet. Pages, slides and screen changes from phones show up here.</p>}
      {shown.map((e, i) => (
        <div key={`${e.ts}-${i}`} className="dir-log-row">
          <span className="mono-data dir-dim">{clock(e.ts)}</span>
          <span>
            <b>{e.who}</b> {e.what}
          </span>
        </div>
      ))}
      {log.length > 5 && (
        <button className="dir-link" onClick={() => setAll(!all)}>
          {all ? "Show less" : `Show all ${log.length}`}
        </button>
      )}
    </section>
  );
}

/* ------------------------------------------------------- widget screens */

const SCREEN_WIDGETS: [string, number][] = [["stage_message", 5], ["confidence", 4], ["child_call", 6], ["lobby_tv", 5]];
const SOUND_WIDGETS: [string, number][] = [["avantis", 7], ["audio_meter", 6]];
const VIDEO_WIDGETS: [string, number][] = [["atem", 8], ["obs", 4], ["live_viewers", 4]];

function DirectorWidgets({ title, types, onBack, note }: { title: string; types: [string, number][]; onBack: () => void; note?: string }) {
  return (
    <div className="crew-page">
      <header className="crew-thread-head">
        <button className="crew-back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <h1 className="crew-title">{title}</h1>
      </header>
      {note && <p className="crew-hint">{note}</p>}
      <div className="dash-stack">
        {types.map(([type, h]) => {
          const w: Widget = { id: `director-${type}`, type, x: 0, y: 0, w: 4, h, config: {} };
          return <WidgetCard key={type} w={w} />;
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ hold button */

/** Press and hold for anything the room sees at once. Holding fills the
 *  button; letting go early does nothing. Keyboard: hold Enter or Space. */
export function HoldButton({
  label,
  holding,
  done,
  onDone,
  ms = 1200,
}: {
  label: string;
  holding: string;
  done: string;
  onDone: () => void;
  ms?: number;
}) {
  const [state, setState] = useState<"idle" | "holding" | "done">("idle");
  const timer = useRef<number | null>(null);
  const reset = useRef<number | null>(null);
  const start = () => {
    if (state === "holding") return;
    setState("holding");
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setState("done");
      onDone();
      reset.current = window.setTimeout(() => setState("idle"), 2000);
    }, ms);
  };
  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      setState("idle");
    }
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (reset.current) clearTimeout(reset.current);
    },
    [],
  );
  return (
    <button
      className={`dir-hold ${state}`}
      style={{ ["--hold-ms" as string]: `${ms}ms` }}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter" || e.key === " ") cancel();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="dir-hold-fill" aria-hidden />
      <span className="dir-hold-label">{state === "holding" ? holding : state === "done" ? done : label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ icons */

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function IconLock() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function IconFaceId() {
  return (
    <svg width="56" height="56" viewBox="0 0 48 48" {...stroke} strokeWidth={2.4}>
      <path d="M6 15V10a4 4 0 0 1 4-4h5M33 6h5a4 4 0 0 1 4 4v5M42 33v5a4 4 0 0 1-4 4h-5M15 42h-5a4 4 0 0 1-4-4v-5" />
      <path d="M17 18v3M31 18v3M24 18v8h-2M18 32c3.5 3 8.5 3 12 0" />
    </svg>
  );
}
function IconScreen() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}
function IconVideo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3z" />
    </svg>
  );
}
function IconSound() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}>
      <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
    </svg>
  );
}
function IconPeople() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" />
    </svg>
  );
}
