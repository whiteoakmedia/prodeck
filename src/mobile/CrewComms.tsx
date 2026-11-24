import { useSyncExternalStore } from "react";
import {
  commsSnapshot,
  joinBlocker,
  joinComms,
  leaveComms,
  onComms,
  setListening,
  setOpenMic,
  setTalkLine,
  talk,
  talkLabel,
  toggleMute,
  talkers,
  type CommsSnapshot,
} from "../lib/intercom";

// Comms: hold-to-talk party lines between crew phones (lib/intercom.ts).

export function useComms(): CommsSnapshot {
  return useSyncExternalStore(onComms, commsSnapshot, commsSnapshot);
}

/**
 * Hold to talk, or with open mic on, a tap to mute and unmute. Pointer events
 * cover touch, pen and mouse; letting go anywhere stops a hold.
 */
export function TalkButton({ className = "", label }: { className?: string; label?: string }) {
  const c = useComms();
  if (c.state !== "on") return null;
  if (c.openMic) {
    const text = talkLabel({ openMic: true, talking: c.talking, line: c.talkOn, short: label });
    return (
      <button
        type="button"
        className={`crew-talk ${c.talking ? "on" : ""} ${className}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleMute();
        }}
        aria-pressed={c.talking}
      >
        {text}
      </button>
    );
  }
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
      {talkLabel({ openMic: false, talking: c.talking, line: c.talkOn, short: label })}
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
      {t.map((x) => `${x.name} en ${x.line}${x.me || c.listen.includes(x.line) ? "" : " (sin escuchar)"}`).join(", ")}
    </div>
  );
}

/** What a connection is doing, in words, so "I can't hear" can be told apart from "never connected". */
function linkWord(st: string | undefined, unreachable: boolean): string {
  if (st === "connected") return "";
  if (unreachable) return " (sin conexión: ¿ambos usan el Wi-Fi de la iglesia y no datos móviles?)";
  if (st === "failed") return " (no conecta, reintentando)";
  if (st === "disconnected") return " (conexión interrumpida, reconectando)";
  return " (conectando)";
}

/**
 * Comms on a tally screen: a crew phone in tally mode, or a camera station
 * (an iPad on a tally link, named after its camera). Join, then Talk or Mute
 * in the corner and who's talking along the top. Open mic and Leave are in
 * the screen's tap menu (TallyCommsMenu).
 */
export function TallyComms() {
  const c = useComms();
  if (c.state === "on") {
    return (
      <>
        <NowTalking className="tally-talking" />
        <TalkButton className="tally-talk" label="Hablar" />
      </>
    );
  }
  return (
    <div className="tally-comms-join" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="tally-info-btn"
        disabled={c.state === "joining"}
        onClick={() => void joinComms()}
      >
        {c.state === "joining" ? "Conectando comunicaciones…" : c.needsTap ? "Tocá para volver a comunicaciones" : "Conectar comunicaciones"}
      </button>
      {(c.err || joinBlocker()) && <span className="tally-comms-err">{c.err || joinBlocker()}</span>}
    </div>
  );
}

/** Open mic and Leave, for the tally's tap menu while on comms. */
export function TallyCommsMenu() {
  const c = useComms();
  if (c.state !== "on") return null;
  return (
    <>
      <button type="button" className="tally-info-btn" onClick={() => setOpenMic(!c.openMic)}>
        {c.openMic ? "Micrófono abierto: sí" : "Micrófono abierto: no"}
      </button>
      <button type="button" className="tally-info-btn" onClick={() => void leaveComms()}>
        Salir de comunicaciones
      </button>
    </>
  );
}

export function CrewComms({ onBack }: { onBack: () => void }) {
  const c = useComms();
  const blocker = joinBlocker();
  const lines = c.roster.channels.length ? c.roster.channels : ["All", "Cameras", "Stage", "Booth"];
  const others = c.roster.members.filter((m) => m.id !== c.me);
  return (
    <div className="crew-page crew-comms">
      <div className="crew-row-head">
        <button className="crew-back" onClick={onBack} aria-label="Volver">
          ‹
        </button>
        <h1 className="crew-title" style={{ margin: 0 }}>
          Comunicaciones
        </h1>
      </div>

      {c.state !== "on" ? (
        <div className="crew-card edge">
          <p style={{ marginTop: 0 }}>
            Hablá con el equipo en una línea mientras mantenés presionado el botón. Los celulares se comunican
            entre sí por el Wi-Fi de la iglesia.
          </p>
          <p className="crew-hint">
            Usá auriculares y mantené ProDeck abierto con la pantalla encendida: un celular bloqueado no puede escuchar ni hablar.
          </p>
          {(c.err || blocker) && <p className="crew-comms-err">{c.err || blocker}</p>}
          <button
            className="crew-btn primary"
            disabled={!!blocker || c.state === "joining"}
            onClick={() => void joinComms()}
          >
            {c.state === "joining" ? "Conectando…" : "Conectar comunicaciones"}
          </button>
        </div>
      ) : (
        <>
          <NowTalking />
          <div className="crew-card edge">
            <div className="crew-comms-label mono">Hablar en</div>
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
            <div className="crew-comms-listen" style={{ marginTop: 10 }}>
              <span>
                Micrófono abierto
                <span className="crew-hint" style={{ display: "block" }}>
                  Hablá sin mantener presionado hasta que lo desactives. Empieza muteado: tocá el botón para hablar.
                </span>
              </span>
              <button
                className={`crew-toggle ${c.openMic ? "on" : ""}`}
                role="switch"
                aria-checked={c.openMic}
                aria-label="Micrófono abierto"
                onClick={() => setOpenMic(!c.openMic)}
              >
                <span className="crew-toggle-knob" />
              </button>
            </div>
          </div>

          <div className="crew-card edge">
            <div className="crew-comms-label mono">Escuchar</div>
            {lines.map((l) => {
              const on = c.listen.includes(l);
              return (
                <div key={l} className="crew-comms-listen">
                  <span>{l}</span>
                  <button
                    className={`crew-toggle ${on ? "on" : ""}`}
                    role="switch"
                    aria-checked={on}
                    aria-label={`Escuchar ${l}`}
                    onClick={() => setListening(l, !on)}
                  >
                    <span className="crew-toggle-knob" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="crew-card edge">
            <div className="crew-comms-label mono">En comunicaciones ({others.length + 1})</div>
            <div className="crew-comms-who">
              <span>Vos</span>
              {others.map((m) => (
                <span key={m.id} className={c.linked.includes(m.id) ? "" : "muted"}>
                  {m.name}
                  {linkWord(c.links[m.id], c.unreachable.includes(m.id))}
                </span>
              ))}
            </div>
            {c.err && <p className="crew-comms-err">{c.err}</p>}
            <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => void leaveComms()}>
              Salir de comunicaciones
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
  if (hidden) return null;
  // Reopened while on comms, and the phone wants a tap for the microphone.
  if (c.state === "off" && c.needsTap) {
    return (
      <button type="button" className="crew-comms-chip crew-comms-rejoin" onClick={() => void joinComms()}>
        Tocá para volver a comunicaciones
      </button>
    );
  }
  if (c.state !== "on") return null;
  // Only people you can hear: the chip is a glance, not the roster.
  const t = talkers(c.roster.members, c.me).filter((x) => !x.me && c.listen.includes(x.line));
  return (
    <div className="crew-comms-chip">
      <button type="button" className="crew-comms-chip-open" onClick={onOpen}>
        <span className="pulse-dot" style={{ background: t.length ? "var(--warn)" : "var(--success)" }} />
        {t.length ? `${t[0].name} en ${t[0].line}` : `Comunicaciones · ${c.talkOn}`}
      </button>
      <TalkButton className="chip" label="Hablar" />
    </div>
  );
}
