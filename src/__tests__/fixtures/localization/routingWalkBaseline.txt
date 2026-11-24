import { useMemo, useState } from "react";
import { usePco } from "../pcoStore";
import { StagePockets } from "./StagePockets";
import { AskPanel } from "./AskPanel";
import {
  ageText,
  channelsForDesk,
  deskKeyFor,
  firstIndex,
  searchNodes,
  STALE_AFTER_MS,
  walk,
  type LiveView,
  type RNode,
  type RoutingMap,
} from "../lib/routing";

// The troubleshooter — one component, two homes: the Routing page on the
// booth and the "No sound?" screen on a phone. Entry is a person (this week's
// team, via their mic), a channel (live desk names) or a place; the result is
// what ProDeck already checked, then what is left to walk to, in order.
//
// Read-only on purpose. Every ✓ is a place someone didn't have to walk to;
// nothing here reasons, invents or guesses — it reads the map and the desk.

export interface WalkPerson {
  name: string;
  position: string;
  /** Channel nodes their mic lands on (primary, then mirror). */
  nodes: RNode[];
  mic: string;
}

/** This week's people → the channel nodes their mic is mapped to. */
export function useWalkPeople(map: RoutingMap | null): WalkPerson[] {
  const pco = usePco();
  return useMemo(() => {
    if (!map) return [];
    const out: WalkPerson[] = [];
    for (const m of pco.micRoster()) {
      const mic = pco.micFor(m.id, m.position).mic;
      if (!mic) continue;
      const keys = [pco.micDeskMap[mic], pco.micDeskMap2[mic]].filter(Boolean) as string[];
      const nodes = keys.flatMap((k) => channelsForDesk(map, k));
      // No desk mapping yet: still list them, the walk falls back to a search.
      out.push({ name: m.name, position: m.position, nodes, mic });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
    // micRoster/micFor are stable functions on the store; the inputs that
    // matter are the maps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pco.team, pco.micAssignments, pco.micDeskMap, pco.micDeskMap2, pco.selectedPlanId]);
}

export function liveName(n: RNode, live: LiveView): string {
  const k = deskKeyFor(n);
  const nm = k && live.desk?.connected ? (live.desk.names[k] ?? "").trim() : "";
  return n.label || nm || (n.kind === "channel" ? `Channel ${n.ref?.index ?? ""}` : n.id);
}

/* ------------------------------------------------------------ picker */

type Mode = "people" | "channels" | "places" | "stage";

export function WalkPicker({
  map,
  live,
  onPick,
  compact,
}: {
  map: RoutingMap;
  live: LiveView;
  onPick: (nodeId: string) => void;
  compact?: boolean;
}) {
  const people = useWalkPeople(map);
  const places = map.nodes.filter((n) => n.kind === "destination");
  const hasStage = (map.panels ?? []).length > 0;
  const [mode, setMode] = useState<Mode>(people.length ? "people" : "channels");
  const [q, setQ] = useState("");

  const channels = useMemo(
    () => map.nodes.filter((n) => n.kind === "channel").sort((a, b) => firstIndex(a.ref?.index) - firstIndex(b.ref?.index)),
    [map],
  );
  const hits = q.trim() ? searchNodes(map, q, live.desk?.names) : null;

  return (
    <div className={`rw-picker ${compact ? "compact" : ""}`}>
      <AskPanel map={map} live={live} onPick={onPick} compact={compact} />
      <div className="rw-seg" role="tablist">
        {people.length > 0 && (
          <button className={mode === "people" ? "on" : ""} onClick={() => setMode("people")}>
            People
          </button>
        )}
        <button className={mode === "channels" ? "on" : ""} onClick={() => setMode("channels")}>
          Channels
        </button>
        {places.length > 0 && (
          <button className={mode === "places" ? "on" : ""} onClick={() => setMode("places")}>
            Places
          </button>
        )}
        {hasStage && (
          <button className={mode === "stage" ? "on" : ""} onClick={() => setMode("stage")}>
            Stage
          </button>
        )}
      </div>

      <input
        id="rw-search"
        className="rw-search"
        placeholder="Channel number, name, or what's on the desk…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoComplete="off"
      />

      {hits && (
        <ul className="rw-list">
          {hits.length === 0 && <li className="rw-empty">Nothing on the map matches “{q}”.</li>}
          {hits.map((n) => (
            <li key={n.id}>
              <button className="rw-row" onClick={() => onPick(n.id)}>
                <span className="rw-num mono">{n.kind === "channel" ? n.ref?.index : n.kind === "source" ? "src" : "out"}</span>
                <span className="rw-row-main">{liveName(n, live)}</span>
                <span className="rw-go">→</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!hits && mode === "people" && (
        <ul className="rw-list">
          {people.map((p) => (
            <li key={p.name + p.position}>
              <button
                className="rw-row"
                disabled={p.nodes.length === 0}
                onClick={() => p.nodes[0] && onPick(p.nodes[0].id)}
                title={p.nodes.length === 0 ? "This mic isn't mapped to a desk channel yet (Planning Center → Mics)" : undefined}
              >
                <span className="rw-num mono">{p.nodes[0]?.ref?.index ?? "—"}</span>
                <span className="rw-row-main">
                  {p.name}
                  <span className="rw-sub">
                    {p.position} · mic {p.mic}
                    {p.nodes.length === 0 ? " · not mapped to a channel" : ""}
                  </span>
                </span>
                <span className="rw-go">→</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!hits && mode === "channels" && (
        <ul className="rw-list">
          {channels.length === 0 && <li className="rw-empty">No channels on the map yet.</li>}
          {channels.map((n) => {
            const k = deskKeyFor(n);
            const muted = k && live.desk?.connected ? live.desk.mutes[k] === true : false;
            return (
              <li key={n.id}>
                <button className="rw-row" onClick={() => onPick(n.id)}>
                  <span className="rw-num mono">{n.ref?.index}</span>
                  <span className="rw-row-main">
                    {liveName(n, live)}
                    {n.label && k && live.desk?.connected && (live.desk.names[k] ?? "").trim() && (live.desk.names[k] ?? "").trim() !== n.label && (
                      <span className="rw-sub">“{(live.desk.names[k] ?? "").trim()}” on the desk</span>
                    )}
                  </span>
                  {muted && <span className="rw-chip bad">muted</span>}
                  <span className="rw-go">→</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!hits && mode === "stage" && <StagePockets map={map} live={live} compact={compact} onWalk={onPick} />}

      {!hits && mode === "places" && (
        <ul className="rw-list">
          {places.map((n) => (
            <li key={n.id}>
              <button className="rw-row" onClick={() => onPick(n.id)}>
                <span className="rw-num mono">out</span>
                <span className="rw-row-main">{n.label}</span>
                <span className="rw-go">→</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ result */

export function WalkView({
  map,
  live,
  targetId,
  onBack,
  onPick,
}: {
  map: RoutingMap;
  live: LiveView;
  targetId: string;
  onBack?: () => void;
  /** Jump to another node (a twin, a source) without leaving the walk. */
  onPick?: (nodeId: string) => void;
}) {
  const w = useMemo(() => walk(map, targetId, live), [map, targetId, live]);
  if (!w) {
    return (
      <div className="rw">
        {onBack && (
          <button className="rw-back" onClick={onBack}>
            ‹ Back
          </button>
        )}
        <p className="rw-empty">That isn't on the map any more.</p>
      </div>
    );
  }
  const stale = w.verifiedAt ? live.now - w.verifiedAt > STALE_AFTER_MS : true;
  const bad = w.checks.filter((c) => c.state === "bad");
  const ok = w.checks.filter((c) => c.state === "ok");
  const unknown = w.checks.filter((c) => c.state === "unknown");

  return (
    <div className="rw">
      <header className="rw-head">
        {onBack && (
          <button className="rw-back" onClick={onBack} aria-label="Back">
            ‹
          </button>
        )}
        <div>
          <h2 className="rw-title">{w.title}</h2>
          {w.subtitle && <div className="rw-subtitle mono">{w.subtitle}</div>}
        </div>
      </header>

      {w.watch.map((k) => (
        <section key={k.id} className={`rw-watch ${k.severity}`}>
          <div className="rw-watch-label mono">{k.severity === "fix" ? "Known issue" : "Deliberate — know about it"}</div>
          <div className="rw-watch-symptom">{k.symptom}</div>
          <p>{k.detail}</p>
        </section>
      ))}

      {bad.length > 0 && (
        <section className="rw-block">
          {bad.map((c, i) => (
            <div key={i} className="rw-check bad">
              <span className="rw-mark">✗</span>
              <div>
                <div>{c.text}</div>
                {c.fix && <div className="rw-fix">{c.fix}</div>}
              </div>
            </div>
          ))}
        </section>
      )}

      {ok.length > 0 && (
        <section className="rw-block">
          <div className="rw-label mono">Already checked for you</div>
          {ok.map((c, i) => (
            <div key={i} className="rw-check ok">
              <span className="rw-mark">✓</span>
              <div>{c.text}</div>
            </div>
          ))}
        </section>
      )}

      {unknown.map((c, i) => (
        <div key={"u" + i} className="rw-check unknown">
          <span className="rw-mark">?</span>
          <div>{c.text}</div>
        </div>
      ))}

      {w.steps.length > 0 && (
        <section className="rw-block">
          <div className="rw-label mono">
            {w.target.kind === "channel" ? "Between the source and the desk, in order" : "What to look at, in order"}
          </div>
          <ol className="rw-steps">
            {w.steps.map((s) => (
              <li key={s.n} className="rw-step">
                <span className="rw-step-num">{s.n}</span>
                <div>
                  <div>{s.text}</div>
                  {s.rule && <div className="rw-rule">{s.rule}</div>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {w.steps.length === 0 && bad.length === 0 && (
        <p className="rw-allgood">Everything on this path that ProDeck can see looks right. If there is still no sound, it is at the source itself.</p>
      )}

      <footer className="rw-foot">
        <span className={`rw-age ${stale ? "stale" : ""}`}>Map {ageText(w.verifiedAt, live.now)}</span>
        {w.blind && <span className="rw-blind">ProDeck can't see anything on this path live — it is all walking.</span>}
        {onPick && w.target.kind === "channel" && (
          <span className="rw-jump">
            {w.path
              .map((id) => map.nodes.find((n) => n.id === id))
              .filter((n): n is RNode => !!n && n.kind === "source")
              .map((n) => (
                <button key={n.id} className="rw-link" onClick={() => onPick(n.id)}>
                  Everything on {n.label} →
                </button>
              ))}
          </span>
        )}
      </footer>
    </div>
  );
}
