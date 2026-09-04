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

// The page has two jobs that used to share one five-card grid: RUNNING the
// service (Show Flow + transport) and everything around it (who's here, mics,
// call times). Now the flow owns the main column and the rest lives in a
// sidebar with three tabs — People / Mics / Setup — so a volunteer scanning
// the screen mid-service only ever has one live surface to watch.

const hhmm = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function PlanningCenter() {
  const pco = usePco();
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [connecting, setConnecting] = useState(false);
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
          <div className="card connect-card">
            <div className="card-head">
              <h3>Connect Planning Center</h3>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              Create a Personal Access Token at{" "}
              <code>api.planningcenteronline.com</code> → Developers → Personal
              Access Tokens, then paste the Application ID and Secret.
            </p>
            <div className="field" style={{ marginBottom: 10 }}>
              <span>Application ID</span>
              <input className="input" value={appId} onChange={(e) => setAppId(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 14 }}>
              <span>Secret</span>
              <input
                className="input"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </div>
            <button
              className="btn primary"
              disabled={connecting || !appId || !secret}
              onClick={async () => {
                setConnecting(true);
                await pco.saveCredentials(appId.trim(), secret.trim());
                setConnecting(false);
              }}
            >
              {connecting ? "Connecting…" : "Connect"}
            </button>
            {pco.status && <p className="error">{pco.status}</p>}
          </div>
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
        <div className="pco-controls">
          <select
            className="input"
            value={pco.selectedServiceTypeId ?? ""}
            onChange={(e) => pco.selectServiceType(e.target.value)}
          >
            <option value="">Service type…</option>
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
              <span className="rec-dot" /> Stop Sync
            </button>
          ) : (
            <button
              className="btn small primary"
              onClick={() => pco.startSync()}
              disabled={!pco.selectedPlanId}
            >
              Sync
            </button>
          )}
          <button className="btn small ghost" onClick={() => pco.refresh()}>
            <Icon name="search" size={14} /> Refresh
          </button>
          <button
            className="btn small"
            title="Guided setup: service, ProPresenter setlist, mics, desk names"
            onClick={() => setWizard(true)}
          >
            ✨ Service setup
          </button>
        </div>
      </header>

      {wizard && <ServiceWizard onClose={() => setWizard(false)} />}

      {pco.status && <div className="banner">{pco.status}</div>}

      {!pco.selectedPlanId ? (
        <div className="dash-empty">
          <Icon name="slides" size={32} />
          <h2>Select a plan</h2>
          <p className="muted">Choose a service type and plan to load the rundown.</p>
        </div>
      ) : (
        <div className="pco-layout">
          <section className="card pco-flow">
            <div className="card-head">
              <h3>Show Flow</h3>
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
                    Take control of PCO Live
                  </button>
                  <span className="hint pco-transport-hint">
                    Next / Previous only work while this booth holds control.
                  </span>
                </>
              ) : (
                <>
                  <button
                    className="btn"
                    disabled={pco.liveBusy}
                    title="Previous item"
                    onClick={() => pco.liveAction("go_to_previous_item")}
                  >
                    <Icon name="prev" size={14} /> Prev
                  </button>
                  <button
                    className="btn primary pco-next"
                    disabled={pco.liveBusy}
                    title="Advance PCO Live to the next item"
                    onClick={() => pco.liveAction("go_to_next_item")}
                  >
                    Next <Icon name="next" size={16} />
                  </button>
                </>
              )}
              <div className="pco-transport-toggles">
                <button
                  className={`btn small ${pco.autoAdvance ? "primary" : "ghost"}`}
                  title="When the live item changes, its linked ProPresenter presentation fires automatically (slide actions included)"
                  onClick={() => pco.setAutoAdvance(!pco.autoAdvance)}
                >
                  {pco.autoAdvance ? "✓ " : ""}Auto-fire slides
                </button>
                <button
                  className={`btn small ${pco.followPro ? "primary" : "ghost"}`}
                  title="When ProPresenter changes presentations, PCO Live advances to the matching item by name"
                  onClick={() => pco.setFollowPro(!pco.followPro)}
                >
                  {pco.followPro ? "✓ " : ""}Follow ProPresenter
                </button>
                <button
                  className={`btn small ${pco.autoScene ? "primary" : "ghost"}`}
                  title="When a song goes live, recall its leader's Avantis scene (set up under Setup → Leader scenes)"
                  onClick={() => pco.setAutoScene(!pco.autoScene)}
                >
                  {pco.autoScene ? "✓ " : ""}Desk scenes
                </button>
              </div>
            </div>

            {pco.items.length === 0 ? (
              <p className="muted">No items.</p>
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
                              title="Trigger this presentation now (fires its slide actions too)"
                              onClick={() => pco.triggerPresentation(linked.uuid, true)}
                            >
                              ▶ {linked.name}
                            </button>
                            {linked.auto && (
                              <span className="sf-auto" title="Matched to this item by name">
                                auto
                              </span>
                            )}
                            <button
                              className="sf-unlink"
                              title="Pick a different presentation"
                              onClick={openPicker}
                            >
                              ⋯
                            </button>
                            <button
                              className="sf-unlink"
                              title={
                                linked.auto
                                  ? "Stop matching this item by name"
                                  : "Remove this slide link"
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
                            Link slide…
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
                            placeholder="Search ProPresenter presentations…"
                            value={linkQuery}
                            onChange={(e) => setLinkQuery(e.target.value)}
                          />
                          <div className="sf-picker-results">
                            {pco.library.length === 0 ? (
                              <span className="muted small">
                                Connect ProPresenter to load presentations.
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
                People
              </button>
              <button
                className={`pco-side-tab ${tab === "mics" ? "active" : ""}`}
                onClick={() => setTab("mics")}
              >
                Mics
              </button>
              <button
                className={`pco-side-tab ${tab === "setup" ? "active" : ""}`}
                onClick={() => setTab("setup")}
              >
                Setup
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

  if (pco.team.length === 0) return <p className="muted">No one scheduled.</p>;

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
                {inCount > 0 && <span className="tc-ok">{inCount} in</span>}
                {outCount > 0 && <span className="tc-no">{outCount} out</span>}
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
                          ? `here ${hhmm(arrivedAt)} ✓`
                          : expected != null
                            ? late
                              ? `expected ${hhmm(expected)} — not here`
                              : `expected ${hhmm(expected)}`
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
        "Here" means they checked in on their phone. Call times are set under{" "}
        <strong>Setup</strong>.
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
            .map(([mic, n]) => `Mic ${mic} is assigned to ${n} people`)
            .join(" · ")}
        </div>
      )}
      {roster.length === 0 ? (
        <p className="muted">
          No one is on a mic yet. Open <strong>Set up mic positions</strong>{" "}
          below and check the positions that wear one.
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
        <p className="hint">Dimmed number = filled in from the position's default.</p>
      )}

      <button
        className="btn small ghost pco-mic-setup"
        onClick={() => setEditPositions((v) => !v)}
      >
        {editPositions ? "▾" : "▸"} Set up mic positions…
      </button>
      {editPositions && (
        <>
          <p className="muted small">
            Check a position to put it on mics; give it a default mic number and
            every week's assignment starts there (e.g.{" "}
            <strong>Worship Leader → 6</strong>).
          </p>
          <label className="mic-count-field">
            Number of mics
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
            <p className="muted">Positions appear here once a plan is loaded.</p>
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
        `Rename ${total} channels on the Avantis for this week?\n${summary}`,
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
        <h3>Desk channels</h3>
        <button
          className="btn small primary"
          disabled={pushing || weeklyNames().length === 0}
          title="Rename each mic's desk channels (primary + mirror) to this week's vocalist"
          onClick={pushNames}
        >
          {pushing ? "Renaming…" : "Push names to desk"}
        </button>
      </div>
      <p className="muted small">
        Which Avantis channels each mic lands on — the primary drives the
        muted-mic alerts; the mirror is the second, differently-processed
        channel. <strong>Push names</strong> stamps this week's vocalists onto
        both.
      </p>
      {micsInUse.map((mic) => (
        <div key={mic} className="field-row" style={{ alignItems: "center", padding: "3px 0" }}>
          <span style={{ width: 52, fontWeight: 600 }}>Mic {mic}</span>
          <select
            className="input"
            title="Primary channel (alerts + rename)"
            value={pco.micDeskMap[mic] ?? ""}
            onChange={(e) => pco.setMicDeskChannel(mic, e.target.value || null)}
          >
            <option value="">primary…</option>
            {deskInputs.map((d) => (
              <option key={d.id} value={d.id}>
                In {d.idx}
                {d.name ? ` — ${d.name}` : ""}
              </option>
            ))}
          </select>
          <select
            className="input"
            title="Mirror channel (rename only)"
            value={pco.micDeskMap2[mic] ?? ""}
            onChange={(e) => pco.setMicDeskChannel2(mic, e.target.value || null)}
          >
            <option value="">mirror…</option>
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
        <h3>Call times</h3>
        {rows.length > 0 && <span className="count">{rows.length}</span>}
      </div>
      <p className="muted small">
        When each position should arrive, shown on their phones and on the
        People tab. Positions without a time here fall back to their Planning
        Center schedule, then the service start. "Camera" covers "Camera 1" and
        "Camera 2".
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
            title="Remove this call time"
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
          placeholder="Position (e.g. Camera)"
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
          Add
        </button>
      </div>

      <PositionGuidesEditor />
      <FileFiltersEditor />

      <div className="card-head" style={{ marginTop: 18, marginBottom: 0 }}>
        <h3>Lead scenes by mic</h3>
        {Object.keys(pco.micSceneMap).length > 0 && (
          <span className="count">{Object.keys(pco.micSceneMap).length}</span>
        )}
      </div>
      <p className="muted small">
        Which Avantis scene puts each MIC in the lead-vocal bus (your "Lead:
        Mic N" scenes). With <strong>Desk scenes</strong> on (transport bar),
        the booth resolves each song's leader to this week's mic assignment
        and recalls that mic's scene automatically — set this up once; the
        weekly vocalist rotation rides on the mic assignments. Save each
        softkey's routing as a scene with recall-safes so it only touches the
        vocal bus.
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
              title="Remove this mic's lead scene"
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
          placeholder="Mic #"
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
          placeholder="Scene"
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
          Add
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
        <h3>Position guides</h3>
        {Object.keys(pco.positionGuides).length > 0 && (
          <span className="count">{Object.keys(pco.positionGuides).length}</span>
        )}
      </div>
      <p className="muted small">
        Job description &amp; expectations per position, shown on the phone of
        whoever is scheduled to it each week. "Camera" covers "Camera 1" and
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
              <span className="muted small">{has ? `${pco.positionGuides[pos].length} chars` : "no guide"}</span>
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
                {open ? "Close" : has ? "Edit" : "Write…"}
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
                      title="Remove this file"
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
                {busyPos === pos ? "Uploading…" : "+ Attach file"}
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
                  Formatting: <code>#</code> heading · <code>-</code> bullet ·{" "}
                  <code>1.</code> numbered · <code>**bold**</code> · <code>*italic*</code> ·{" "}
                  <code>---</code> divider. Plain text works fine on its own.
                </p>
                <div className="guide-split">
                  <textarea
                    className="input"
                    rows={14}
                    placeholder={`What does ${pos} do? Arrival expectations, responsibilities, who to ask for help…`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  {/* Live preview, styled exactly like the phone renders it —
                      the whole point of formatting is seeing what they'll see. */}
                  <div className="guide-preview">
                    <span className="mono muted small">Preview</span>
                    {draft.trim() ? (
                      <Markdown text={draft} />
                    ) : (
                      <p className="muted small">Nothing yet.</p>
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
                    Save guide
                  </button>
                  {has && (
                    <button
                      className="btn small ghost"
                      onClick={() => {
                        pco.setPositionGuide(pos, null);
                        setEditing(null);
                      }}
                    >
                      Delete
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
          placeholder="Add a position not on this week's plan…"
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
          Add
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
        <h3>Files by position</h3>
        {Object.keys(pco.fileFilters).length > 0 && (
          <span className="count">{Object.keys(pco.fileFilters).length}</span>
        )}
      </div>
      <p className="muted small">
        Which song files show on each band position's phone (matched against
        the filename — e.g. Bass: <code>chord, bass, master</code>). Built-in
        defaults cover Vocals, Bass, Keys, Drums, and Guitars; add a row to
        override one. Everyone can still expand "all files" per song.
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
              title="Remove override (fall back to the built-in default)"
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
          placeholder="Position (e.g. Bass)"
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
          placeholder="keywords, comma separated (chord, bass, master)"
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
          Add
        </button>
      </div>
    </>
  );
}
