import { useState } from "react";
import { useAlerts, type Subsystem } from "../alertsStore";
import { useProDeck } from "../store";

// D17 — the troubleshooting strip. Four traffic lights, always visible in the
// sidebar footer; clicking one opens a card that says what the thing IS, what
// the color means, and the one thing to try. Every red banner elsewhere is a
// symptom — this is where a volunteer goes to understand it.

export const EXPLAIN: Record<
  string,
  { name: string; what: string; page?: string; fix: Record<string, string> }
> = {
  pp: {
    name: "ProPresenter",
    what: "The slides computer. ProDeck follows it for lyrics, slides, and triggers.",
    page: "propresenter",
    fix: {
      ok: "Connected and healthy.",
      bad: "Connection lost. Make sure ProPresenter is open on the presentation Mac — ProDeck reconnects by itself. Still red after a minute? Open the ProPresenter page and press Find.",
      idle: "Not connected yet this session. Open the ProPresenter page and press Find.",
    },
  },
  pco: {
    name: "Planning Center",
    what: "The service plan — the rundown, the team, call times.",
    page: "planning",
    fix: {
      ok: "Synced and live.",
      warn: "A plan is loaded but not syncing — open Planning Center and press Sync.",
      idle: "No plan selected. Open Planning Center and pick this week's plan.",
    },
  },
  audio: {
    name: "Audio",
    page: "settings",
    what: "The mix feed ProDeck listens to (over the Dante network) for SPL and the phone Listen stream.",
    fix: {
      ok: "Hearing sound.",
      idle: "Quiet — monitoring is off, or nothing is playing yet. That's normal before the band starts.",
      bad: "Sound was flowing and then stopped. Audio comes in over Dante — check the Dante route to this Mac and the network switch. The Routing page walks the whole chain.",
      warn: "The room has been very loud for a while. Nothing is broken — check levels.",
    },
  },
  desk: {
    name: "Sound desk",
    page: "settings",
    what: "The Avantis console. ProDeck mirrors it read-only — mutes, faders, scenes, channel names.",
    fix: {
      ok: "Connected and mirroring.",
      bad: "Can't reach the Avantis. Check it's powered on and its Network port is plugged into the switch; the address lives in Settings → Avantis.",
      idle: "Mirror is off (Settings → Avantis).",
    },
  },
  cam: {
    name: "Stage feed",
    page: "settings",
    what: "ProPresenter's stage output shared over the network (NDI) — the confidence screen.",
    fix: {
      ok: "Feed alive.",
      bad: "The stage feed dropped. Check ProPresenter is running and its NDI output is on, then the network.",
      idle: "No stage feed in use right now.",
    },
  },
};

export function HealthStrip() {
  const { subsystems } = useAlerts();
  const { host } = useProDeck();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = subsystems.find((s) => s.key === openKey) ?? null;
  const info = open ? EXPLAIN[open.key] : null;

  return (
    <div className="health-strip">
      {open && info && (
        <div className="health-pop">
          <div className="health-pop-head">
            <strong>{info.name}</strong>
            <span className={`hl-dot ${open.state}`} />
            <button className="btn small ghost" onClick={() => setOpenKey(null)}>
              ×
            </button>
          </div>
          <p className="muted small">{info.what}</p>
          <p className="small">
            {info.fix[open.state] ?? open.detail}
            {open.key === "pp" && open.state === "ok" && host ? ` (${host})` : ""}
          </p>
        </div>
      )}
      <div className="health-lights">
        {/* The stage-feed light only earns its spot when a feed is actually
            in use — an always-idle fourth light is noise. */}
        {subsystems
          .filter((s) => !(s.key === "cam" && s.detail === "none"))
          .map((s: Subsystem) => (
          <button
            key={s.key}
            className={`health-light ${openKey === s.key ? "open" : ""}`}
            title={`${EXPLAIN[s.key]?.name ?? s.label}: ${s.detail} — click for what to do`}
            onClick={() => setOpenKey(openKey === s.key ? null : s.key)}
          >
            <span className={`hl-dot ${s.state}`} />
            <span className="hl-label">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
