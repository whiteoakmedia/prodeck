import { useSyncExternalStore } from "react";
import {
  commsSnapshot,
  joinBlocker,
  joinComms,
  leaveComms,
  onComms,
  setListening,
  setTalkLine,
  talk,
  talkers,
  type CommsSnapshot,
} from "../lib/intercom";

// Comms: hold-to-talk party lines between crew phones (lib/intercom.ts).

export function useComms(): CommsSnapshot {
  return useSyncExternalStore(onComms, commsSnapshot, commsSnapshot);
}

/** Hold to talk. Pointer events cover touch, pen and mouse; letting go anywhere stops it. */
export function TalkButton({ className = "", label }: { className?: string; label?: string }) {
  const c = useComms();
  if (c.state !== "on") return null;
  const stop = () => talk(false);
  return (
    <button
      type="button"
      className={`crew-talk ${c.talking ? "on" : ""} ${className}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        talk(true);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      aria-pressed={c.talking}
    >
      {label ?? (c.talking ? `Talking on ${c.talkOn}` : `Hold to talk on ${c.talkOn}`)}
    </button>
  );
}

/** "Sam on Cameras", or nothing when the lines are quiet. */
export function NowTalking({ className = "" }: { className?: string }) {
  const c = useComms();
  if (c.state !== "on") return null;
  const t = talkers(c.roster.members, c.me);
  if (!t.length) return null;
  // Someone on a line you don't listen to is shown but silent: say so, or it
  // reads as comms being broken.
  return (
    <div className={`crew-now-talking ${className}`} aria-live="polite">
      {t.map((x) => `${x.name} on ${x.line}${x.me || c.listen.includes(x.line) ? "" : " (not listening)"}`).join(", ")}
    </div>
  );
}

/** What a connection is doing, in words, so "I can't hear" can be told apart from "never connected". */
function linkWord(st: string | undefined): string {
  if (st === "connected") return "";
  if (st === "failed") return " (can't connect, retrying)";
  if (st === "disconnected") return " (dropped, reconnecting)";
  return " (connecting)";
}

export function CrewComms({ onBack }: { onBack: () => void }) {
  const c = useComms();
  const blocker = joinBlocker();
  const lines = c.roster.channels.length ? c.roster.channels : ["All", "Cameras", "Stage", "Booth"];
  const others = c.roster.members.filter((m) => m.id !== c.me);
  return (
    <div className="crew-page crew-comms">
      <div className="crew-row-head">
        <button className="crew-back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <h1 className="crew-title" style={{ margin: 0 }}>
          Comms
        </h1>
      </div>

      {c.state !== "on" ? (
        <div className="crew-card edge">
          <p style={{ marginTop: 0 }}>
            Talk to the crew on a line while you hold the button. Phones talk to each other over the
            church Wi-Fi.
          </p>
          <p className="crew-hint">
            Wear earbuds, and keep ProDeck open with the screen on: a locked phone can't hear or talk.
          </p>
          {(c.err || blocker) && <p className="crew-comms-err">{c.err || blocker}</p>}
          <button
            className="crew-btn primary"
            disabled={!!blocker || c.state === "joining"}
            onClick={() => void joinComms()}
          >
            {c.state === "joining" ? "Joining…" : "Join comms"}
          </button>
        </div>
      ) : (
        <>
          <NowTalking />
          <div className="crew-card edge">
            <div className="crew-comms-label mono">Talk on</div>
            <div className="crew-comms-lines">
              {lines.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`crew-comms-line ${c.talkOn === l ? "on" : ""}`}
                  aria-pressed={c.talkOn === l}
                  onClick={() => setTalkLine(l)}
                >
                  {l}
                </button>
              ))}
            </div>
            <TalkButton className="big" />
          </div>

          <div className="crew-card edge">
            <div className="crew-comms-label mono">Listen to</div>
            {lines.map((l) => {
              const on = c.listen.includes(l);
              return (
                <div key={l} className="crew-comms-listen">
                  <span>{l}</span>
                  <button
                    className={`crew-toggle ${on ? "on" : ""}`}
                    role="switch"
                    aria-checked={on}
                    aria-label={`Listen to ${l}`}
                    onClick={() => setListening(l, !on)}
                  >
                    <span className="crew-toggle-knob" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="crew-card edge">
            <div className="crew-comms-label mono">On comms ({others.length + 1})</div>
            <div className="crew-comms-who">
              <span>You</span>
              {others.map((m) => (
                <span key={m.id} className={c.linked.includes(m.id) ? "" : "muted"}>
                  {m.name}
                  {linkWord(c.links[m.id])}
                </span>
              ))}
            </div>
            {c.err && <p className="crew-comms-err">{c.err}</p>}
            <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => void leaveComms()}>
              Leave comms
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Above every tab while on comms: who's talking, and Talk without leaving the page you're on. */
export function CommsChip({ onOpen, hidden }: { onOpen: () => void; hidden?: boolean }) {
  const c = useComms();
  if (c.state !== "on" || hidden) return null;
  // Only people you can hear: the chip is a glance, not the roster.
  const t = talkers(c.roster.members, c.me).filter((x) => !x.me && c.listen.includes(x.line));
  return (
    <div className="crew-comms-chip">
      <button type="button" className="crew-comms-chip-open" onClick={onOpen}>
        <span className="pulse-dot" style={{ background: t.length ? "var(--warn)" : "var(--success)" }} />
        {t.length ? `${t[0].name} on ${t[0].line}` : `Comms · ${c.talkOn}`}
      </button>
      <TalkButton className="chip" label="Talk" />
    </div>
  );
}
