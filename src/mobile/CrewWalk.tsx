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
            <button className="crew-back" onClick={onBack} aria-label="Volver">
              ‹
            </button>
            <h1 className="crew-title" style={{ margin: 0 }}>
              ¿Sin sonido?
            </h1>
          </div>
          <p className="crew-hint">
            Elegí la persona, el canal o el lugar. ProDeck revisa primero lo que puede ver desde Control y después te indica dónde ir.
          </p>
        </>
      )}
      {loadErr && <div className="crew-caution">No se pudo leer el mapa de ruteo de Control: {loadErr}</div>}
      {!map && !loadErr && <div className="crew-hint">Cargando el mapa…</div>}
      {map?.example && !target && (
        <div className="crew-caution">
          Este es el mapa de ejemplo de ProDeck. Alguien en Control debe configurar primero el ruteo de este lugar.
        </div>
      )}
      {map && !target && <WalkPicker map={map} live={live} onPick={setTarget} compact />}
      {map && target && <WalkView map={map} live={live} targetId={target} onBack={() => setTarget(null)} onPick={setTarget} />}
    </div>
  );
}
