import { useState } from "react";
import { useRouting, useRoutingLive } from "../routingStore";
import { WalkPicker, WalkView } from "../components/RoutingWalk";

// "No sound?" — the phone face of the routing map. A volunteer alone at 9am
// taps the person whose mic is dead and gets what ProDeck already checked
// plus the one or two things left to walk to. Read-only; the booth owns the
// map. Design tokens: design/mobile/README.md.

export function CrewWalk({ onBack }: { onBack: () => void }) {
  const { map, loadErr } = useRouting();
  const live = useRoutingLive();
  const [target, setTarget] = useState<string | null>(null);

  return (
    <div className="crew-page crew-walk">
      {!target && (
        <>
          <div className="crew-row-head">
            <button className="crew-back" onClick={onBack} aria-label="Back">
              ‹
            </button>
            <h1 className="crew-title" style={{ margin: 0 }}>
              No sound?
            </h1>
          </div>
          <p className="crew-hint">
            Pick the person, channel or place. ProDeck checks what it can see from the booth first, then tells you where to walk.
          </p>
        </>
      )}
      {loadErr && <div className="crew-caution">The booth's routing map couldn't be read: {loadErr}</div>}
      {!map && !loadErr && <div className="crew-hint">Loading the map…</div>}
      {map?.example && !target && (
        <div className="crew-caution">
          This is the example map that ships with ProDeck, not this building's. Someone at the booth needs to fill in Routing first.
        </div>
      )}
      {map && !target && <WalkPicker map={map} live={live} onPick={setTarget} compact />}
      {map && target && <WalkView map={map} live={live} targetId={target} onBack={() => setTarget(null)} onPick={setTarget} />}
    </div>
  );
}
