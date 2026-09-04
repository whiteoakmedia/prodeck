import { useEffect, useRef, useState } from "react";
import { usePco, type PlanItem , isDeclined } from "../pcoStore";

// Common worship keys (sharps/flats mixed to match how PCO usually names them).
// Anything unusual — "C (Capo 1)", odd spellings — goes through the free-text box.
const KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

// Positions that are most likely to lead a song — floated to the top of the
// leader picker so the common pick is one tap away.
const VOCAL_HINT = /(vocal|lead|worship|sing|bgv|acoustic|keys|pastor|speaker|\bmc\b|host)/i;

type Anchor = { kind: "key" | "leader"; left: number; top: number; bottom: number };

// A small free-text row used in both popovers (keeps its own draft state).
function FreeText({
  initial,
  placeholder,
  onApply,
}: {
  initial: string;
  placeholder: string;
  onApply: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <div className="kl-free">
      <input
        className="input"
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onApply(v);
        }}
      />
      <button className="btn small primary" onClick={() => onApply(v)}>
        Set
      </button>
    </div>
  );
}

// Inline editor for a song's key + leader. Reads/writes the live per-plan
// overrides in the PCO store, so a change here shows everywhere the run of show
// is displayed (booth, confidence monitor, phone, web) at once. Overrides are
// local to ProDeck — they never write back to Planning Center.
export function SongKeyLeader({
  item,
  className = "",
}: {
  item: PlanItem;
  className?: string;
}) {
  const { setKeyOverride, setLeaderOverride, team, micForLeader } = usePco();
  const [pop, setPop] = useState<Anchor | null>(null);
  const ref = useRef<HTMLSpanElement | null>(null);

  // Close on outside click, Escape, or any scroll (a fixed popover would
  // otherwise drift away from its now-moved chip).
  useEffect(() => {
    if (!pop) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPop(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPop(null);
    };
    const onScroll = () => setPop(null);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [pop]);

  const isSong = item.type === "song";
  const showKey = isSong || !!item.key;
  const showLeader = isSong || !!item.leader;
  if (!showKey && !showLeader) return null;

  const open = (kind: "key" | "leader", e: React.MouseEvent) => {
    if (pop?.kind === kind) {
      setPop(null);
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPop({ kind, left: r.left, top: r.top, bottom: r.bottom });
  };

  const mic = item.leader ? micForLeader(item.leader) : "";
  const roster = [...team.filter((m) => !isDeclined(m.status))].sort((a, b) => {
    const av = VOCAL_HINT.test(a.position) ? 0 : 1;
    const bv = VOCAL_HINT.test(b.position) ? 0 : 1;
    if (av !== bv) return av - bv;
    return a.name.localeCompare(b.name);
  });

  // Pin the fixed popover near its chip, flipping above if it would run off the
  // bottom and clamping to the viewport on the left.
  const popStyle = (): React.CSSProperties => {
    if (!pop) return {};
    const estH = pop.kind === "leader" ? 300 : 196;
    const W = 244;
    const left = Math.max(8, Math.min(pop.left, window.innerWidth - W - 8));
    const below = pop.bottom + 6 + estH <= window.innerHeight;
    const top = below ? pop.bottom + 6 : Math.max(8, pop.top - 6 - estH);
    return { position: "fixed", left, top, width: W };
  };

  return (
    <span
      className={`kled ${className}`}
      ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {showLeader && (
        <button
          className={`kl-chip leader ${item.leaderOverridden ? "ovr" : ""} ${item.leader ? "" : "empty"}`}
          title={
            item.leaderOverridden
              ? `Leader overridden — Planning Center had ${item.pcoLeader || "none"}`
              : "Set who's leading"
          }
          onClick={(e) => open("leader", e)}
        >
          {item.leader || "+ leader"}
          {mic && <span className="sf-mic">{mic}</span>}
          {item.leaderOverridden && <span className="kl-dot" />}
        </button>
      )}
      {showKey && (
        <button
          className={`kl-chip key ${item.keyOverridden ? "ovr" : ""} ${item.key ? "" : "empty"}`}
          title={
            item.keyOverridden
              ? `Key overridden — Planning Center had ${item.pcoKey || "none"}`
              : "Set the key"
          }
          onClick={(e) => open("key", e)}
        >
          {item.key || "+ key"}
          {item.keyOverridden && <span className="kl-dot" />}
        </button>
      )}

      {pop?.kind === "key" && (
        <div className="kl-pop" style={popStyle()}>
          <div className="kl-pop-head">
            <span className="kl-pop-title">{item.title}</span>
            {item.keyOverridden && (
              <button
                className="kl-reset"
                onClick={() => {
                  setKeyOverride(item.id, null);
                  setPop(null);
                }}
              >
                reset to PCO ({item.pcoKey || "—"})
              </button>
            )}
          </div>
          <div className="kl-keys">
            {KEYS.map((k) => (
              <button
                key={k}
                className={`kl-k ${item.key === k ? "on" : ""}`}
                onClick={() => {
                  setKeyOverride(item.id, k);
                  setPop(null);
                }}
              >
                {k}
              </button>
            ))}
          </div>
          <div className="kl-keys minor">
            {KEYS.map((k) => (
              <button
                key={k}
                className={`kl-k ${item.key === `${k}m` ? "on" : ""}`}
                onClick={() => {
                  setKeyOverride(item.id, `${k}m`);
                  setPop(null);
                }}
              >
                {k}m
              </button>
            ))}
          </div>
          <FreeText
            initial={item.key}
            placeholder="Custom (e.g. C (Capo 2))"
            onApply={(v) => {
              setKeyOverride(item.id, v.trim() || null);
              setPop(null);
            }}
          />
        </div>
      )}

      {pop?.kind === "leader" && (
        <div className="kl-pop" style={popStyle()}>
          <div className="kl-pop-head">
            <span className="kl-pop-title">{item.title}</span>
            {item.leaderOverridden && (
              <button
                className="kl-reset"
                onClick={() => {
                  setLeaderOverride(item.id, null);
                  setPop(null);
                }}
              >
                reset to PCO ({item.pcoLeader || "—"})
              </button>
            )}
          </div>
          <div className="kl-leaders">
            {roster.map((m) => (
              <button
                key={m.id}
                className={`kl-l ${item.leader === m.name ? "on" : ""}`}
                onClick={() => {
                  setLeaderOverride(item.id, m.name);
                  setPop(null);
                }}
              >
                <span className="kl-l-name">{m.name}</span>
                {m.position && <span className="kl-l-pos">{m.position}</span>}
              </button>
            ))}
            {roster.length === 0 && (
              <span className="muted small kl-l-empty">No team scheduled yet</span>
            )}
          </div>
          <FreeText
            initial={item.leader}
            placeholder="Type a name"
            onApply={(v) => {
              setLeaderOverride(item.id, v.trim() || null);
              setPop(null);
            }}
          />
        </div>
      )}
    </span>
  );
}
