import { useAutoSceneStatus } from "../lib/autoScene";
import { deskControlSupported } from "../lib/consoles";
import { useEffect, useState } from "react";
import { usePco, fmtLen, type TeamMember , isDeclined } from "../pcoStore";
import { Icon } from "../components/Icon";
import { Avatar, MicSelect, MicCard } from "../components/PcoBits";
import { SongKeyLeader } from "../components/SongKeyLeader";
import {
  identityList,
  checkinList,
  on,
  avantisState,
  avantisSetName,
  posfileList,
  posfileAdd,
  posfileRemove,
  type AvantisSnapshot,
  type CrewUser,
  type PosFile,
} from "../lib/tauri";
import { askConfirm } from "../lib/dialogs";
import { Markdown } from "../lib/markdown";
import { ProSetlistSwap } from "../components/ProSetlistSwap";
import { ServiceWizard } from "../components/ServiceWizard";
import { PcoConnect } from "../components/PcoConnect";

// The page has two jobs that used to share one five-card grid: RUNNING the
// service (Show Flow + transport) and everything around it (who's here, mics,
// call times). Now the flow owns the main column and the rest lives in a
// sidebar with three tabs — People / Mics / Setup — so a volunteer scanning
// the screen mid-service only ever has one live surface to watch.

const hhmm = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function PlanningCenter() {
  const pco = usePco();
  const [linkingItem, setLinkingItem] = useState<string | null>(null);
  const [linkQuery, setLinkQuery] = useState("");
  const [tab, setTab] = useState<"people" | "mics" | "setup">("people");
  const [wizard, setWizard] = useState(false);

  if (!pco.credsKnown) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>Planning Center</h1>
        </header>
        <div className="center-card">
          <PcoConnect onConnected={() => pco.reconnect()} />
          {pco.status && <p className="error">{pco.status}</p>}
        </div>
      </div>
    );
  }

  const total = pco.items.reduce((s, i) => s + (i.length || 0), 0);

  return (
    <div className="page pco-page">
      <header className="page-head pco-head">
        <h1>Planning Center</h1>
        {pco.me && <span className="chip online">{pco.me}</span>}
        {/* A church that connected with a pasted token has no other way to reach
            Connect — the sign-in card only shows when nothing is configured.
            Clearing the token is what gets them there. */}
        <button
          className="btn ghost small"
          title="Olvidar las credenciales guardadas de Planning Center y conectar de nuevo"
          onClick={async () => {
            if (await askConfirm("¿Desconectar Planning Center? Podés ingresar de nuevo de inmediato. Se conservan los planes y las asignaciones de micrófonos.")) {
              await pco.saveCredentials("", "");
            }
          }}
        >
          Desconectar
        </button>
        <div className="pco-controls">
          <select
            className="input"
            value={pco.selectedServiceTypeId ?? ""}
            onChange={(e) => pco.selectServiceType(e.target.value)}
          >
            <option value="">Tipo de evento…</option>
            {pco.serviceTypes.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={pco.selectedPlanId ?? ""}
            onChange={(e) => pco.selectPlan(e.target.value)}
            disabled={pco.plans.length === 0}
          >
            <option value="">Plan…</option>
            {pco.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.date ? `${p.date} — ${p.title}` : p.title}
              </option>
            ))}
          </select>
          {pco.syncing ? (
            <button className="btn small danger" onClick={() => pco.stopSync()}>
              <span className="rec-dot" /> Detener sincronización
            </button>
          ) : (
            <button
              className="btn small primary"
              onClick={() => pco.startSync()}
              disabled={!pco.selectedPlanId}
            >
              Sincronizar
            </button>
          )}
          <button className="btn small ghost" onClick={() => pco.refresh()}>
            <Icon name="search" size={14} /> Actualizar
          </button>
          <button
            className="btn small"
            title="Configuración guiada: evento, Setlist de ProPresenter, micrófonos y nombres de consola"
            onClick={() => setWizard(true)}
          >
            ✨ Configurar evento
          </button>
        </div>
      </header>

      {wizard && <ServiceWizard onClose={() => setWizard(false)} />}

      {pco.status && <div className="banner">{pco.status}</div>}

      {!pco.selectedPlanId ? (
        <div className="dash-empty">
          <Icon name="slides" size={32} />
          <h2>Seleccioná un plan</h2>
          <p className="muted">Elegí un tipo de evento y un plan para cargar el Crono.</p>
        </div>
      ) : (
        <div className="pco-layout">
          <section className="card pco-flow">
            <div className="card-head">
              <h3>Orden del evento</h3>
              <span className="count">{fmtLen(total)} total</span>
              {pco.liveItemId && (
                <span className="live-badge">
                  <span className="rec-dot" /> LIVE
                </span>
              )}
            </div>

            {/* Transport: one bar, plain words. "Take control" is the gate PCO
                imposes — without holding the controller, Live ignores
                next/prev — so it replaces the arrows instead of hiding among
                them while the click would do nothing. */}
            <div className="pco-transport">
              {!pco.canControl ? (
                <>
                  <button
                    className="btn primary"
                    disabled={pco.liveBusy}
                    onClick={() => pco.liveAction("toggle_control")}
                  >
                    Tomar control de PCO Live
                  </button>
                  <span className="hint pco-transport-hint">
                    Próximo y anterior funcionan solo mientras este Control tenga el mando.
                  </span>
                </>
              ) : (
                <>
                  <button
                    className="btn"
                    disabled={pco.liveBusy}
                    title="Elemento anterior"
                    onClick={() => pco.liveAction("go_to_previous_item")}
                  >
                    <Icon name="prev" size={14} /> Anterior
                  </button>
                  <button
                    className="btn primary pco-next"
                    disabled={pco.liveBusy}
                    title="Avanzar PCO Live al próximo elemento"
                    onClick={() => pco.liveAction("go_to_next_item")}
                  >
                    Próximo <Icon name="next" size={16} />
                  </button>
                </>
              )}
              <div className="pco-transport-toggles">
                <button
                  className={`btn small ${pco.autoAdvance ? "primary" : "ghost"}`}
                  title="Cuando cambia el elemento en curso, se activa automáticamente la presentación vinculada de ProPresenter, incluidas las acciones de diapositiva"
                  onClick={() => pco.setAutoAdvance(!pco.autoAdvance)}
                >
                  {pco.autoAdvance ? "✓ " : ""}Activar diapositivas automáticamente
                </button>
                <button
                  className={`btn small ${pco.followPro ? "primary" : "ghost"}`}
                  title="Cuando cambia la presentación de ProPresenter, PCO Live avanza al elemento con el mismo nombre"
                  onClick={() => pco.setFollowPro(!pco.followPro)}
                >
                  {pco.followPro ? "✓ " : ""}Seguir ProPresenter
                </button>
                <button
                  className={`btn small ${pco.autoScene ? "primary" : "ghost"}`}
                  title="Cuando comienza una canción, se carga la escena Avantis de su líder. Se usa ProPresenter primero o PCO Live si no está disponible. Se configura en Configuración, en escenas de líderes, y funciona independientemente de Automix."
                  onClick={() => pco.setAutoScene(!pco.autoScene)}
                >
                  {pco.autoScene ? "✓ " : ""}Escenas de consola
                </button>
              </div>
            </div>
            <AutoSceneLine />

            {pco.items.length === 0 ? (
              <p className="muted">No hay elementos.</p>
            ) : (
              <div className="showflow">
                {pco.items.map((it) => {
                  const live = it.id === pco.liveItemId;
                  if (it.type === "header") {
                    return (
                      <div key={it.id} className="sf-header">
                        {it.title}
                      </div>
                    );
                  }
                  const linked = pco.effectiveLink(it);
                  const openPicker = async () => {
                    await pco.loadLibrary();
                    setLinkQuery("");
                    setLinkingItem(linkingItem === it.id ? null : it.id);
                  };
                  return (
                    <div key={it.id}>
                      <div className={`sf-item ${live ? "live" : ""}`}>
                        <span className={`sf-type ${it.type}`} />
                        <span className="sf-title">{it.title}</span>
                        <SongKeyLeader item={it} />
                        {linked ? (
                          <span className="sf-linked">
                            <button
                              className="sf-link-name"
                              title="Activar esta presentación ahora, incluidas las acciones de sus diapositivas"
                              onClick={() => pco.triggerPresentation(linked.uuid, true)}
                            >
                              ▶ {linked.name}
                            </button>
                            {linked.auto && (
                              <span className="sf-auto" title="Vinculado a este elemento por nombre">
                                auto
                              </span>
                            )}
                            <button
                              className="sf-unlink"
                              title="Elegir otra presentación"
                              onClick={openPicker}
                            >
                              ⋯
                            </button>
                            <button
                              className="sf-unlink"
                              title={
                                linked.auto
                                  ? "Dejar de vincular este elemento por nombre"
                                  : "Quitar este vínculo de diapositiva"
                              }
                              onClick={() =>
                                linked.auto ? pco.suppressLink(it.title) : pco.setLink(it.title, null)
                              }
                            >
                              ×
                            </button>
                          </span>
                        ) : (
                          <button className="sf-link" onClick={openPicker}>
                            Vincular diapositiva…
                          </button>
                        )}
                        {live && <span className="sf-live">LIVE</span>}
                        <span className="sf-len">{fmtLen(it.length)}</span>
                      </div>
                      {linkingItem === it.id && (
                        <div className="sf-picker">
                          <input
                            className="input"
                            autoFocus
                            placeholder="Buscar presentaciones de ProPresenter…"
                            value={linkQuery}
                            onChange={(e) => setLinkQuery(e.target.value)}
                          />
                          <div className="sf-picker-results">
                            {pco.library.length === 0 ? (
                              <span className="muted small">
                                Conectá ProPresenter para cargar las presentaciones.
                              </span>
                            ) : (
                              pco.library
                                .filter((p) =>
                                  p.name.toLowerCase().includes(linkQuery.toLowerCase()),
                                )
                                .slice(0, 8)
                                .map((p) => (
                                  <button
                                    key={p.uuid}
                                    className="sf-picker-item"
                                    onClick={() => {
                                      pco.setLink(it.title, p);
                                      setLinkingItem(null);
                                    }}
                                  >
                                    {p.name}
                                  </button>
                                ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="pco-side">
            <div className="pco-side-tabs">
              <button
                className={`pco-side-tab ${tab === "people" ? "active" : ""}`}
                onClick={() => setTab("people")}
              >
                Equipo
              </button>
              <button
                className={`pco-side-tab ${tab === "mics" ? "active" : ""}`}
                onClick={() => setTab("mics")}
              >
                Micrófonos
              </button>
              <button
                className={`pco-side-tab ${tab === "setup" ? "active" : ""}`}
                onClick={() => setTab("setup")}
              >
                Configuración
              </button>
            </div>
            {tab === "people" && <PeoplePanel />}
            {tab === "mics" && <MicsPanel />}
            {tab === "setup" && <SetupPanel />}
          </aside>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- People

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Match a PCO plan person to a crew account: exact name, else same last name
 *  with a first-name prefix either way ("Zach" ↔ "Zachary") — the same
 *  nickname rule the arrival matcher uses. */
function crewFor(crew: CrewUser[], m: TeamMember): CrewUser | undefined {
  const target = normName(m.name);
  const exact = crew.find((c) => normName(c.name) === target);
  if (exact) return exact;
  const parts = target.split(" ");
  const tFirst = parts[0] ?? "";
  const tLast = parts.length > 1 ? parts[parts.length - 1] : "";
  if (!tLast || tFirst.length < 2) return undefined;
  return crew.find((c) => {
    const p = normName(c.name).split(" ");
    const f = p[0] ?? "";
    const l = p[p.length - 1] ?? "";
    return (
      l === tLast && f.length > 1 && (f.startsWith(tFirst) || tFirst.startsWith(f))
    );
  });
}

// The "who's on first" board: everyone scheduled, their PCO answer, when
// they're expected (manual call time beats the PCO schedule), and whether
// they've actually checked in — the three facts that used to live on three
// different screens.
function PeoplePanel() {
  const pco = usePco();
  const [crew, setCrew] = useState<CrewUser[]>([]);
  const [checkins, setCheckins] = useState<Record<string, number>>({});
  // Re-render each minute so "late" turns red without a refresh.
  const [, setTick] = useState(0);

  useEffect(() => {
    const load = () =>
      Promise.all([identityList(), checkinList("")])
        .then(([c, ci]) => {
          setCrew(c.filter((u) => u.approved));
          setCheckins(ci.at ?? {});
        })
        .catch(() => {});
    load();
    const subs = [on("checkin:changed", load), on("identity:changed", load)];
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => {
      subs.forEach((u) => u.then((f) => f()));
      clearInterval(t);
    };
  }, []);

  const statusRank = (s: string) =>
    ({ confirmed: 0, unconfirmed: 1, declined: 3 } as Record<string, number>)[
      s.toLowerCase()
    ] ?? 2;
  const byTeam: Record<string, TeamMember[]> = {};
  for (const m of pco.team) {
    (byTeam[m.team] ??= []).push(m);
  }
  for (const k of Object.keys(byTeam)) {
    byTeam[k].sort(
      (a, b) => statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name),
    );
  }

  if (pco.team.length === 0) return <p className="muted">No hay personas programadas.</p>;

  const now = Date.now();
  return (
    <>
      {Object.entries(byTeam).map(([teamName, members]) => {
        const inCount = members.filter((m) => m.status.toLowerCase() === "confirmed").length;
        const outCount = members.filter((m) => isDeclined(m.status)).length;
        return (
          <div key={teamName} className="team-group">
            <div className="team-name">
              <span>{teamName}</span>
              <span className="team-counts">
                {inCount > 0 && <span className="tc-ok">{inCount} confirmados</span>}
                {outCount > 0 && <span className="tc-no">{outCount} rechazados</span>}
              </span>
            </div>
            {members.map((m) => {
              const declined = isDeclined(m.status);
              const user = declined ? undefined : crewFor(crew, m);
              const arrivedAt = user ? checkins[user.id] : undefined;
              const expected = declined ? null : pco.arrivalFor(m.name, m.position).ts;
              const late = !arrivedAt && expected != null && now > expected;
              return (
                <div key={m.id} className={`team-row ${m.status.toLowerCase()}`}>
                  <Avatar src={m.photo} name={m.name} size={26} />
                  <div className="t-info">
                    <span className="t-name">{m.name}</span>
                    <span className="t-pos">{m.position}</span>
                    {!declined && (arrivedAt || expected != null) && (
                      <span
                        className={`t-arrival ${arrivedAt ? "here" : late ? "late" : ""}`}
                      >
                        {arrivedAt
                          ? `llegó ${hhmm(arrivedAt)} ✓`
                          : expected != null
                            ? late
                              ? `esperado ${hhmm(expected)}. Aún no llegó`
                              : `esperado ${hhmm(expected)}`
                            : ""}
                      </span>
                    )}
                  </div>
                  <span className={`t-status ${m.status.toLowerCase()}`}>{m.status}</span>
                </div>
              );
            })}
          </div>
        );
      })}
      <p className="hint">
        "Llegó" indica que registró su asistencia desde el celular. Los horarios se configuran en{" "}
        <strong>Configuración</strong>.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- Mics

function MicsPanel() {
  const pco = usePco();
  const [editPositions, setEditPositions] = useState(false);
  // Desk names + LIVE mute states for the mic→console mapping (null when the
  // Avantis mirror is off — the desk UI hides itself then).
  const [desk, setDesk] = useState<AvantisSnapshot | null>(null);
  useEffect(() => {
    avantisState()
      .then((s) => setDesk(s.connected ? s : null))
      .catch(() => {});
    const un = on<AvantisSnapshot>("avantis:state", (s) => setDesk(s.connected ? s : null));
    return () => {
      un.then((f) => f());
    };
  }, []);

  // Mics assigned to more than one PERSON (conflicts). Skip declined —
  // they're not serving — and count each human once: PCO schedules the same
  // person as several team entries (per position/time), and one person on
  // one mic twice is not a conflict.
  const micUse: Record<string, number> = {};
  const micSeen = new Set<string>();
  for (const m of pco.team) {
    if (isDeclined(m.status)) continue;
    const person = m.name.trim().toLowerCase();
    if (micSeen.has(person)) continue;
    micSeen.add(person);
    const mic = pco.micFor(m.id, m.position).mic;
    if (mic) micUse[mic] = (micUse[mic] ?? 0) + 1;
  }
  const conflicts = Object.entries(micUse).filter(([, n]) => n > 1);
  const roster = pco.micRoster();

  // Unique positions across the plan + template + eligible set.
  const positions = Array.from(
    new Set([
      ...pco.team.map((m) => m.position).filter(Boolean),
      ...Object.keys(pco.micTemplate),
      ...pco.micPositions,
    ]),
  ).sort();

  return (
    <>
      {conflicts.length > 0 && (
        <div className="banner">
          {conflicts
            .map(([mic, n]) => `El micrófono ${mic} está asignado a ${n} personas`)
            .join(" · ")}
        </div>
      )}
      {roster.length === 0 ? (
        <p className="muted">
          Todavía no hay personas asignadas a un micrófono. Abrí <strong>Configurar posiciones de micrófonos</strong>{" "}
          y seleccioná las posiciones que usan uno.
        </p>
      ) : (
        <div className="mic-grid">
          {roster.map((m) => {
            const info = pco.micFor(m.id, m.position);
            const deskId = info.mic ? pco.micDeskMap[info.mic] : undefined;
            return (
              <MicCard
                key={m.id}
                name={m.name}
                photo={m.photo}
                position={m.position}
                value={info.mic}
                count={pco.micCount}
                fromTemplate={info.fromTemplate}
                conflict={!!info.mic && micUse[info.mic] > 1}
                deskMuted={desk && deskId ? desk.mutes[deskId] : undefined}
                onChange={(v) => pco.setMic(m.id, v)}
              />
            );
          })}
        </div>
      )}
      {roster.length > 0 && (
        <p className="hint">El número atenuado proviene del valor predeterminado de la posición.</p>
      )}

      <button
        className="btn small ghost pco-mic-setup"
        onClick={() => setEditPositions((v) => !v)}
      >
        {editPositions ? "▾" : "▸"} Configurar posiciones de micrófonos…
      </button>
      {editPositions && (
        <>
          <p className="muted small">
            Seleccioná una posición que use micrófono y asignale un número predeterminado.
            Ese número se usará como punto de partida cada semana (por ejemplo,{" "}
            <strong>Worship Leader → 6</strong>).
          </p>
          <label className="mic-count-field">
            Cantidad de micrófonos
            <input
              className="input"
              type="number"
              min={1}
              max={128}
              value={pco.micCount}
              onChange={(e) => {
                const n = parseInt(e.target.value);
                if (Number.isFinite(n)) pco.setMicCount(n);
              }}
            />
          </label>
          {positions.length === 0 ? (
            <p className="muted">Las posiciones aparecen aquí cuando se carga un plan.</p>
          ) : (
            <div className="mic-list">
              {positions.map((pos) => {
                const on = pco.micPositions.includes(pos);
                return (
                  <div key={pos} className={`pos-row ${on ? "on" : ""}`}>
                    <label className="pos-toggle">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => pco.setMicPositionEligible(pos, e.target.checked)}
                      />
                      <span className="mic-name">{pos}</span>
                    </label>
                    <MicSelect
                      value={pco.micTemplate[pos] ?? ""}
                      count={pco.micCount}
                      onChange={(v) => pco.setMicTemplate(pos, v)}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {desk && <MicDeskMapEditor desk={desk} />}
        </>
      )}
    </>
  );
}

// Mic number → Avantis channels. Follows the physical patch (wireless mic 6
// is the same desk channels no matter who wears it). The PRIMARY channel
// powers the muted-mic alerts; the MIRROR is the second channel that shares
// the capsule but processes differently — renames go to both.
function MicDeskMapEditor({ desk }: { desk: AvantisSnapshot }) {
  const pco = usePco();
  const [pushing, setPushing] = useState(false);
  const roster = pco.micRoster();
  const micsInUse = [
    ...new Set([
      ...roster.map((m) => pco.micFor(m.id, m.position).mic).filter(Boolean),
      ...Object.values(pco.micTemplate).filter(Boolean),
      ...Object.keys(pco.micDeskMap),
      ...Object.keys(pco.micDeskMap2),
    ]),
  ].sort((a, b) => parseInt(a) - parseInt(b));
  // All inputs 1-64, named or not — mirror channels may be unnamed until the
  // first push.
  const deskInputs = Array.from({ length: 64 }, (_, i) => {
    const id = `input:${i + 1}`;
    return { id, idx: i + 1, name: (desk.names[id] ?? "").trim() };
  });

  const weeklyNames = pco.weeklyMicNames;

  async function pushNames() {
    const plan = weeklyNames();
    if (plan.length === 0) return;
    const total = plan.reduce((n, p) => n + p.targets.length, 0);
    const summary = plan.map((p) => `Mic ${p.mic} → ${p.label}`).join(" · ");
    if (
      !(await askConfirm(
        `¿Cambiar los nombres de ${total} canales en Avantis para esta semana?\n${summary}`,
      ))
    )
      return;
    setPushing(true);
    try {
      for (const p of plan) {
        for (const t of p.targets) {
          await avantisSetName(t, p.label).catch(() => {});
        }
      }
    } finally {
      setPushing(false);
    }
  }

  if (micsInUse.length === 0) return null;
  return (
    <>
      <div className="card-head" style={{ marginTop: 14, marginBottom: 0 }}>
        <h3>Canales de consola</h3>
        <button
          className="btn small primary"
          disabled={pushing || weeklyNames().length === 0 || !deskControlSupported(desk.model)}
          title={deskControlSupported(desk.model) ? "Cambiar los nombres de los canales de consola de cada micrófono (principal y espejo) por el vocalista de esta semana" : "Por ahora ProDeck solo puede monitorear una consola Yamaha y no puede cambiar los nombres de sus canales."}
          onClick={pushNames}
        >
          {pushing ? "Cambiando nombres…" : "Enviar nombres a la consola"}
        </button>
      </div>
      <p className="muted small">
        Elegí los canales Avantis de cada micrófono. El principal activa las alertas
        de micrófono muteado; el espejo es un segundo canal procesado de otra
        manera. <strong>Enviar nombres a la consola</strong> aplica los nombres
        de los vocalistas de esta semana a ambos.
      </p>
      {micsInUse.map((mic) => (
        <div key={mic} className="field-row" style={{ alignItems: "center", padding: "3px 0" }}>
          <span style={{ width: 52, fontWeight: 600 }}>Mic {mic}</span>
          <select
            className="input"
            title="Canal principal (alertas y cambio de nombre)"
            value={pco.micDeskMap[mic] ?? ""}
            onChange={(e) => pco.setMicDeskChannel(mic, e.target.value || null)}
          >
            <option value="">principal…</option>
            {deskInputs.map((d) => (
              <option key={d.id} value={d.id}>
                In {d.idx}
                {d.name ? ` — ${d.name}` : ""}
              </option>
            ))}
          </select>
          <select
            className="input"
            title="Canal espejo (solo cambio de nombre)"
            value={pco.micDeskMap2[mic] ?? ""}
            onChange={(e) => pco.setMicDeskChannel2(mic, e.target.value || null)}
          >
            <option value="">espejo…</option>
            {deskInputs.map((d) => (
              <option key={d.id} value={d.id}>
                In {d.idx}
                {d.name ? ` — ${d.name}` : ""}
              </option>
            ))}
          </select>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- Setup

// Tuesday work, not Sunday work: call times by position, and the leader →
// desk-scene map behind the Desk Scenes toggle. The plan pickers and Sync
// stay in the page header so the empty state can never strand anyone.
function SetupPanel() {
  const pco = usePco();
  const [role, setRole] = useState("");
  const [time, setTime] = useState("");
  const [micNum, setMicNum] = useState("");
  const [scene, setScene] = useState("");
  // Suggest mic numbers already in use this week.
  const micsInUse = [
    ...new Set(
      pco
        .micRoster()
        .map((m) => pco.micFor(m.id, m.position).mic)
        .filter(Boolean),
    ),
  ].sort((a, b) => parseInt(a) - parseInt(b));
  const rows = Object.entries(pco.checkinTimes).sort((a, b) =>
    (a[1] || "").localeCompare(b[1] || ""),
  );
  // Suggest positions straight from this week's schedule.
  const positions = [...new Set(pco.team.map((m) => m.position).filter(Boolean))];

  return (
    <>
      <ProSetlistSwap />

      <div className="card-head" style={{ marginBottom: 0 }}>
        <h3>Horarios de llegada</h3>
        {rows.length > 0 && <span className="count">{rows.length}</span>}
      </div>
      <p className="muted small">
        La hora de llegada de cada posición se muestra en los celulares y en la
        pestaña Equipo. Si no se define una hora, se usa primero el horario de
        Planning Center y, si no existe, el inicio del evento. "Camera" incluye
        "Camera 1" y "Camera 2".
      </p>
      {rows.map(([r, t]) => (
        <div key={r} className="field-row" style={{ alignItems: "center", padding: "4px 0" }}>
          <span style={{ flex: 1, fontWeight: 600 }}>{r}</span>
          <input
            className="input"
            type="time"
            style={{ width: 120 }}
            value={t}
            onChange={(e) => pco.setCheckinTime(r, e.target.value || null)}
          />
          <button
            className="btn small ghost"
            title="Quitar este horario de llegada"
            onClick={() => pco.setCheckinTime(r, null)}
          >
            ×
          </button>
        </div>
      ))}
      <div className="field-row" style={{ marginTop: 8 }}>
        <input
          className="input"
          list="checkin-positions"
          placeholder="Posición (por ejemplo, Cámara)"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />
        <datalist id="checkin-positions">
          {positions.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <input
          className="input"
          type="time"
          style={{ width: 120 }}
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
        <button
          className="btn small primary"
          disabled={!role.trim() || !time}
          onClick={() => {
            pco.setCheckinTime(role, time);
            setRole("");
            setTime("");
          }}
        >
          Agregar
        </button>
      </div>

      <PositionGuidesEditor />
      <FileFiltersEditor />

      <div className="card-head" style={{ marginTop: 18, marginBottom: 0 }}>
        <h3>Escenas de voz principal por micrófono</h3>
        {Object.keys(pco.micSceneMap).length > 0 && (
          <span className="count">{Object.keys(pco.micSceneMap).length}</span>
        )}
      </div>
      <p className="muted small">
        Elegí qué escena de Avantis coloca cada micrófono en el bus de voz principal
        (tus escenas "Lead: Mic N"). Con <strong>Escenas de consola</strong> activado,
        Control identifica el micrófono asignado al líder de cada canción y carga
        su escena automáticamente. Configuralo una vez: la rotación semanal sigue
        las asignaciones de micrófonos. Guardá el ruteo de cada softkey como escena
        con recall-safes para que solo afecte al bus de voz.
      </p>
      {Object.entries(pco.micSceneMap)
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .map(([mic, sc]) => (
          <div key={mic} className="field-row" style={{ alignItems: "center", padding: "4px 0" }}>
            <span style={{ flex: 1, fontWeight: 600 }}>Mic {mic}</span>
            <input
              className="input"
              type="number"
              min={1}
              max={500}
              style={{ width: 100 }}
              value={sc}
              onChange={(e) => pco.setMicScene(mic, e.target.value || null)}
            />
            <button
              className="btn small ghost"
              title="Quitar la escena de voz principal de este micrófono"
              onClick={() => pco.setMicScene(mic, null)}
            >
              ×
            </button>
          </div>
        ))}
      <div className="field-row" style={{ marginTop: 8 }}>
        <input
          className="input"
          list="lead-mic-nums"
          type="number"
          min={1}
          placeholder="N.º de micrófono"
          style={{ width: 100 }}
          value={micNum}
          onChange={(e) => setMicNum(e.target.value)}
        />
        <datalist id="lead-mic-nums">
          {micsInUse.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <input
          className="input"
          type="number"
          min={1}
          max={500}
          placeholder="Escena"
          style={{ width: 100 }}
          value={scene}
          onChange={(e) => setScene(e.target.value)}
        />
        <button
          className="btn small primary"
          disabled={!micNum.trim() || !scene}
          onClick={() => {
            pco.setMicScene(micNum, scene);
            setMicNum("");
            setScene("");
          }}
        >
          Agregar
        </button>
      </div>
    </>
  );
}

// Position job descriptions/expectations. Written once here; each phone's
// Home screen shows the guide for whatever position that person is scheduled
// to THIS WEEK ("Camera" covers "Camera 1"). Unscheduled people see nothing.
/** Read a picked file as base64 for the invoke bridge. No dialog plugin needed
 *  — the booth is a webview, so its own file input is the picker. */
function fileToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("could not read that file"));
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1)); // strip the data: prefix
    };
    r.readAsDataURL(f);
  });
}

const prettySize = (n: number) =>
  n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function PositionGuidesEditor() {
  const pco = usePco();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newPos, setNewPos] = useState("");
  const [files, setFiles] = useState<PosFile[]>([]);
  const [busyPos, setBusyPos] = useState<string | null>(null);
  const [fileErr, setFileErr] = useState("");

  useEffect(() => {
    const load = () => posfileList().then(setFiles).catch(() => {});
    load();
    const un = on("posfiles:changed", load);
    return () => {
      un.then((f) => f());
    };
  }, []);

  async function attach(pos: string, input: HTMLInputElement) {
    const f = input.files?.[0];
    input.value = ""; // so picking the same file twice still fires onChange
    if (!f) return;
    setFileErr("");
    setBusyPos(pos);
    try {
      await posfileAdd(pos, f.name, f.type, await fileToBase64(f));
      setFiles(await posfileList());
    } catch (e) {
      setFileErr(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusyPos(null);
    }
  }
  const positions = [
    ...new Set([
      ...pco.team.map((m) => m.position).filter(Boolean),
      ...Object.keys(pco.positionGuides),
    ]),
  ].sort();

  return (
    <>
      <div className="card-head" style={{ marginTop: 18, marginBottom: 0 }}>
        <h3>Guías de posiciones</h3>
        {Object.keys(pco.positionGuides).length > 0 && (
          <span className="count">{Object.keys(pco.positionGuides).length}</span>
        )}
      </div>
      <p className="muted small">
        Descripción y responsabilidades de cada posición, visibles en el celular
        de la persona programada cada semana. "Camera" incluye "Camera 1" y
        "Camera 2".
      </p>
      {fileErr && <p className="err small">{fileErr}</p>}
      {positions.map((pos) => {
        const has = !!pco.positionGuides[pos];
        const open = editing === pos;
        return (
          <div key={pos}>
            <div className="field-row" style={{ alignItems: "center", padding: "3px 0" }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{pos}</span>
              <span className="muted small">{has ? `${pco.positionGuides[pos].length} caracteres` : "sin guía"}</span>
              <button
                className="btn small ghost"
                onClick={() => {
                  if (open) setEditing(null);
                  else {
                    setDraft(pco.positionGuides[pos] ?? "");
                    setEditing(pos);
                  }
                }}
              >
                {open ? "Cerrar" : has ? "Editar" : "Escribir…"}
              </button>
            </div>
            {/* Files sit with the position, not inside the guide editor: they
                are useful on their own, and hiding them behind "Edit" made an
                attached diagram look like it had vanished. */}
            <div className="pos-files">
              {files
                .filter((f) => f.position === pos)
                .map((f) => (
                  <span key={f.id} className="pos-file">
                    <span className="pos-file-name" title={f.name}>
                      {f.name}
                    </span>
                    <span className="muted small">{prettySize(f.size)}</span>
                    <button
                      className="btn small ghost"
                      title="Quitar este archivo"
                      onClick={() => {
                        posfileRemove(f.id)
                          .then(() => posfileList().then(setFiles))
                          .catch((e) => setFileErr(String(e)));
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              <label className="btn small ghost pos-file-add">
                {busyPos === pos ? "Subiendo…" : "+ Adjuntar archivo"}
                <input
                  type="file"
                  hidden
                  disabled={busyPos === pos}
                  onChange={(e) => attach(pos, e.currentTarget)}
                />
              </label>
            </div>
            {open && (
              <>
                <p className="muted small">
                  Formato: <code>#</code> título · <code>-</code> viñeta · {" "}
                  <code>1.</code> lista numerada · <code>**negrita**</code> · <code>*cursiva*</code> · {" "}
                  <code>---</code> separador. También podés escribir texto sin formato.
                </p>
                <div className="guide-split">
                  <textarea
                    className="input"
                    rows={14}
                    placeholder={`¿Qué hace ${pos}? Hora de llegada, responsabilidades y a quién pedir ayuda…`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  {/* Live preview, styled exactly like the phone renders it —
                      the whole point of formatting is seeing what they'll see. */}
                  <div className="guide-preview">
                    <span className="mono muted small">Vista previa</span>
                    {draft.trim() ? (
                      <Markdown text={draft} />
                    ) : (
                      <p className="muted small">Todavía no hay contenido.</p>
                    )}
                  </div>
                </div>
                <div className="field-row" style={{ marginTop: 6 }}>
                  <button
                    className="btn small primary"
                    onClick={() => {
                      pco.setPositionGuide(pos, draft);
                      setEditing(null);
                    }}
                  >
                    Guardar guía
                  </button>
                  {has && (
                    <button
                      className="btn small ghost"
                      onClick={() => {
                        pco.setPositionGuide(pos, null);
                        setEditing(null);
                      }}
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
      <div className="field-row" style={{ marginTop: 8 }}>
        <input
          className="input"
          placeholder="Agregar una posición que no figure en el plan de esta semana…"
          value={newPos}
          onChange={(e) => setNewPos(e.target.value)}
        />
        <button
          className="btn small"
          disabled={!newPos.trim()}
          onClick={() => {
            setDraft("");
            setEditing(newPos.trim());
            pco.setPositionGuide(newPos.trim(), " ");
            setNewPos("");
          }}
        >
          Agregar
        </button>
      </div>
    </>
  );
}

// Which song files each band position sees in "My Set" on their phone,
// matched by filename keyword. Built-in defaults cover the common band; a
// row here overrides the default for that position. Positions with no rule
// (production) get the compact setlist card instead.
function FileFiltersEditor() {
  const pco = usePco();
  const [pos, setPos] = useState("");
  const [words, setWords] = useState("");
  const positions = [
    ...new Set([
      ...pco.team.map((m) => m.position).filter(Boolean),
      ...Object.keys(pco.fileFilters),
    ]),
  ].sort();

  return (
    <>
      <div className="card-head" style={{ marginTop: 18, marginBottom: 0 }}>
        <h3>Archivos por posición</h3>
        {Object.keys(pco.fileFilters).length > 0 && (
          <span className="count">{Object.keys(pco.fileFilters).length}</span>
        )}
      </div>
      <p className="muted small">
        Elegí qué archivos de canciones aparecen en el celular de cada posición de la
        banda, según su nombre de archivo (por ejemplo, Bass: <code>chord, bass, master</code>).
        Hay valores predeterminados para Vocals, Bass, Keys, Drums y Guitars;
        agregá una fila para reemplazar uno. Cada persona puede seguir abriendo
        todos los archivos de cada canción.
      </p>
      {Object.entries(pco.fileFilters)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([p, w]) => (
          <div key={p} className="field-row" style={{ alignItems: "center", padding: "3px 0" }}>
            <span style={{ width: 130, fontWeight: 600 }}>{p}</span>
            <input
              className="input"
              value={w.join(", ")}
              onChange={(e) =>
                pco.setFileFilter(
                  p,
                  e.target.value
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean),
                )
              }
            />
            <button
              className="btn small ghost"
              title="Quitar esta excepción y volver al valor predeterminado"
              onClick={() => pco.setFileFilter(p, null)}
            >
              ×
            </button>
          </div>
        ))}
      <div className="field-row" style={{ marginTop: 8 }}>
        <input
          className="input"
          list="filefilter-positions"
          placeholder="Posición (por ejemplo, Bass)"
          style={{ maxWidth: 180 }}
          value={pos}
          onChange={(e) => setPos(e.target.value)}
        />
        <datalist id="filefilter-positions">
          {positions.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <input
          className="input"
          placeholder="Palabras clave separadas por comas (chord, bass, master)"
          value={words}
          onChange={(e) => setWords(e.target.value)}
        />
        <button
          className="btn small primary"
          disabled={!pos.trim() || !words.trim()}
          onClick={() => {
            pco.setFileFilter(
              pos,
              words
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
            );
            setPos("");
            setWords("");
          }}
        >
          Agregar
        </button>
      </div>
    </>
  );
}

/** What the desk-scene switch did for the last song (or why it didn't). */
function AutoSceneLine() {
  const st = useAutoSceneStatus();
  if (!st) return null;
  return (
    <p className={`small ${st.ok ? "muted" : ""}`} style={{ margin: "4px 0 8px", color: st.ok ? undefined : "var(--warn)" }}>
      Escena de consola · {st.song}: {st.text} · {new Date(st.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
    </p>
  );
}
