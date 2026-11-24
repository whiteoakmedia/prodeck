import { useEffect, useState } from "react";
import { usePco , isDeclined } from "../pcoStore";
import { CREW_SESSION_KEY } from "../chatStore";
import {
  checkinList,
  identityList,
  inviteCreate,
  on,
  PUBLIC_URL,
  type CrewUser,
} from "../lib/tauri";
import { CrewPageComposer } from "./CrewPages";
import { usePerms } from "../lib/perms";

// S09 — leader board (admin).
//
// Sorted by EXCEPTION, never alphabetically: the two people who need attention
// are the reason you opened this screen, so they sit at the top and everyone
// on track collapses to one line each.
//
// "Not arrived" is a fact, not a guess: it compares a real booth-recorded
// check-in against the Planning Center service time. What the design also wants
// per person — "4 of 6 checklist items" — does NOT exist here, because
// checklists are shared team-wide with no owner field. Rather than invent a
// per-person number on the screen a leader uses to chase people, that column is
// left out and the team's progress is shown once at the top.
//
// Nudge opens the page composer pre-filled with that person (confirmed with
// Zach as the one cross-screen link worth building).

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function CrewLeader({ onBack }: { onBack?: () => void }) {
  const pco = usePco();
  // Director opens this too; inviting is Manage crew's.
  const canManage = usePerms().can("manage");
  const [crew, setCrew] = useState<CrewUser[]>([]);
  const [arrivals, setArrivals] = useState<Record<string, number>>({});
  const [nudge, setNudge] = useState<CrewUser | null>(null);
  // Personal invite from the couch: pick a name, get a pre-approved one-time
  // link, hand it to the share sheet (Messages, etc.).
  const [inviteWho, setInviteWho] = useState("");
  const [inviteMsg, setInviteMsg] = useState("");
  async function sendInvite() {
    const who = inviteWho.trim();
    if (!who) return;
    setInviteMsg("");
    try {
      const role =
        pco.team.find((m) => m.name.toLowerCase() === who.toLowerCase())?.position ?? "";
      const inv = await inviteCreate(who, role);
      const url = `${PUBLIC_URL}/?invite=${inv.token}`;
      const text = `Sumate al equipo de ProDeck, ${who.split(" ")[0]}. Abrí el enlace, agregá ProDeck a la pantalla de inicio y elegí un PIN. Tu acceso ya está aprobado: ${url}`;
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard?.writeText(url);
        setInviteMsg("Enlace copiado. Podés enviárselo.");
      }
      setInviteWho("");
    } catch (e) {
      // Share sheets reject when dismissed — that's not an error worth showing.
      if (!String(e).includes("AbortError")) setInviteMsg(String(e));
    }
  }
  const [, tick] = useState(0);

  const serviceKey = `${pco.selectedPlanId ?? ""}::${pco.selectedServiceTimeId ?? ""}`;
  const start = pco.serviceTimes.find((t) => t.id === pco.selectedServiceTimeId)?.ts ?? 0;

  useEffect(() => {
    let alive = true;
    const load = () => {
      identityList()
        .then((u) => alive && setCrew(u.filter((x) => x.approved)))
        .catch(() => {});
      checkinList(localStorage.getItem(CREW_SESSION_KEY) ?? "")
        .then((r) => alive && setArrivals(r.at ?? {}))
        .catch(() => {});
    };
    load();
    const subs = [on("checkin:changed", load), on("identity:changed", load)];
    const iv = setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      alive = false;
      clearInterval(iv);
      subs.forEach((u) => u.then((f) => f()));
    };
  }, [serviceKey]);

  // Per-person call times from the Planning Center schedule (name → nickname
  // match, same-day times only). Someone is only "late" past THEIR time — and
  // only SCHEDULED people can be expected at all: crew accounts that aren't
  // on this week's plan sit in their own group with no expectation.
  const arrival = (u: CrewUser) => pco.arrivalFor(u.name, u.role);
  const expected = (u: CrewUser) => arrival(u).ts ?? start;
  const now = Date.now();
  const scheduled = crew.filter((u) => arrival(u).scheduled);
  const offPlan = crew.filter((u) => !arrival(u).scheduled && !arrivals[u.id]);
  const onSite = crew.filter((u) => arrivals[u.id]);
  const missing = scheduled.filter((u) => !arrivals[u.id]);
  const needAttention = missing.filter((u) => expected(u) > 0 && now > expected(u));
  const waiting = missing.filter((u) => !(expected(u) > 0 && now > expected(u)));

  return (
    <div className="crew-page">
      <div className="crew-row-head">
        {onBack && (
          <button className="crew-back" onClick={onBack} aria-label="Volver">
            ‹
          </button>
        )}
        <h1 className="crew-title" style={{ margin: 0 }}>
          Panel del equipo
        </h1>
      </div>
      <p className="crew-hint muted" style={{ marginTop: -4 }}>
        {scheduled.length} programados · {needAttention.length} necesitan atención
      </p>

      <div className="crew-tiles crew-tiles-3">
        <div className="crew-card edge">
          <span className="mono" style={{ color: "var(--dim)" }}>Presentes</span>
          <div className="crew-tile-big">
            {onSite.length}/{scheduled.length || crew.length}
          </div>
        </div>
        <div className="crew-card edge">
          <span className="mono" style={{ color: "var(--dim)" }}>Evento</span>
          <div className="crew-tile-big mono-data" style={{ fontSize: 19 }}>
            {start ? clock(start) : "—"}
          </div>
        </div>
        <div className="crew-card edge">
          <span className="mono" style={{ color: "var(--dim)" }}>Pendientes</span>
          <div
            className="crew-tile-big"
            style={{ color: needAttention.length ? "var(--warn)" : "var(--success)" }}
          >
            {needAttention.length}
          </div>
        </div>
      </div>

      {crew.length === 0 && (
        <p className="crew-hint muted">
          Todavía no hay integrantes aprobados. Aprobá a cada persona en Configuración, Integrantes del equipo, y asignale un rol.
        </p>
      )}

      {needAttention.length > 0 && (
        <>
          <span className="mono crew-sheet-label">Necesitan atención</span>
          {needAttention.map((u) => (
            <div key={u.id} className="crew-card danger">
              <div className="crew-row-head">
                <span className="crew-dot" style={{ background: "var(--danger)" }} />
                <span className="crew-buzz-title">{u.name}</span>
              </div>
              <div className="crew-buzz-sub">
                {u.role || "sin rol asignado"} · horario previsto {expected(u) ? clock(expected(u)) : "—"},
                todavía no llegó
              </div>
              <div className="field-row" style={{ marginTop: 10, marginBottom: 0 }}>
                <button className="crew-nudge" onClick={() => setNudge(u)}>
                  Enviar aviso
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {waiting.length > 0 && (
        <>
          <span className="mono crew-sheet-label">Todavía no llegaron</span>
          {waiting.map((u) => (
            <div key={u.id} className="crew-leader-row">
              <span className="crew-dot" style={{ background: "var(--dim)" }} />
              <span className="crew-recip-name">{u.name}</span>
              <span className="mono-data crew-recip-seen">
                {u.role ? `${u.role} · ` : ""}
                {expected(u) ? `previsto ${clock(expected(u))}` : "sin horario"}
              </span>
            </div>
          ))}
        </>
      )}

      {onSite.length > 0 && (
        <>
          <span className="mono crew-sheet-label">Presentes</span>
          {onSite.map((u) => (
            <div key={u.id} className="crew-leader-row">
              <span className="crew-dot" style={{ background: "var(--success)" }} />
              <span className="crew-recip-name">{u.name}</span>
              <span className="mono-data crew-recip-seen">
                {u.role ? `${u.role} · ` : ""}llegó {clock(arrivals[u.id])}
              </span>
            </div>
          ))}
        </>
      )}

      {/* Crew accounts not on this week's plan: listed for completeness, but
          never "expected" and never counted as an issue. */}
      {offPlan.length > 0 && (
        <>
          <span className="mono crew-sheet-label">Sin programar esta semana</span>
          {offPlan.map((u) => (
            <div key={u.id} className="crew-leader-row">
              <span className="crew-dot" style={{ background: "var(--dim)" }} />
              <span className="crew-recip-name">{u.name}</span>
              <span className="mono-data crew-recip-seen">{u.role || "—"}</span>
            </div>
          ))}
        </>
      )}

      {canManage && (
        <>
      <span className="mono crew-sheet-label">Invitar a alguien</span>
      <div className="field-row" style={{ alignItems: "center" }}>
        <input
          className="crew-input"
          list="leader-invite-roster"
          placeholder="Nombre del plan o escrito a mano"
          value={inviteWho}
          onChange={(e) => setInviteWho(e.target.value)}
          style={{ flex: 1 }}
        />
        <datalist id="leader-invite-roster">
          {pco.team
            .filter((m) => !isDeclined(m.status))
            .map((m) => (
              <option key={m.id} value={m.name} />
            ))}
        </datalist>
        <button className="crew-nudge" disabled={!inviteWho.trim()} onClick={sendInvite}>
          Compartir enlace
        </button>
      </div>
      {inviteMsg && <p className="crew-hint muted">{inviteMsg}</p>}
      <p className="crew-hint muted">
        Enlace de un solo uso con acceso aprobado: la persona lo abre, instala la aplicación y elige un PIN.
        No necesita contraseña ni esperar aprobación.
      </p>
        </>
      )}

      {nudge && (
        <CrewPageComposer
          onClose={() => setNudge(null)}
          preset={{
            recipientId: nudge.id,
            body: `${nudge.name}, ¿ya estás en camino?`,
          }}
        />
      )}
    </div>
  );
}
