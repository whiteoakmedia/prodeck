import { useMemo, useState } from "react";
import { panelViews, type LiveView, type Panel, type RoutingMap, type SocketView } from "../lib/routing";

// The wall: every stage pocket drawn as its sockets, each cross-referenced
// through the map — socket → SLink input → console channel, with the desk's
// live state and any external insert (Waves) on the channel. The Routing
// Bible's "SLink — the stage" page, grouped the way the floor is.
//
// Shared by the Routing page (with editing) and the phone (read-only, compact).

export interface PocketActions {
  onWalk?: (channelId: string) => void;
  /** Editing only: toggle a socket dead. */
  onDead?: (port: string, n: number, dead: boolean) => void;
  onPanels?: (panels: Panel[]) => void;
}

export function StagePockets({
  map,
  live,
  editing,
  compact,
  onWalk,
  onDead,
  onPanels,
}: { map: RoutingMap; live: LiveView; editing?: boolean; compact?: boolean } & PocketActions) {
  const views = useMemo(() => panelViews(map), [map]);
  const desk = live.desk?.connected ? live.desk : null;

  if (views.length === 0 && !editing) {
    return <p className="sp-empty">Todavía no hay paneles de conectores del escenario en el mapa. Desde Control, elegí Editar → Escenario para agregarlos con su nombre y rango de conectores.</p>;
  }

  return (
    <div className={`sp ${compact ? "compact" : ""}`}>
      {views.map(({ panel, sockets, live: liveCount }) => (
        <section key={panel.id} className="sp-panel">
          <header className="sp-head">
            {editing && onPanels ? (
              <PanelEditor panel={panel} panels={map.panels ?? []} onPanels={onPanels} />
            ) : (
              <>
                <h3 className="sp-title">{panel.label}</h3>
                <span className="sp-range mono">
                  {panel.port} {panel.from}–{panel.to} · {liveCount} de {sockets.length} en uso
                </span>
              </>
            )}
          </header>
          {panel.note && <p className="sp-note">{panel.note}</p>}
          <div className="sp-grid">
            {sockets.map((s) => (
              <SocketTile key={s.n} s={s} port={panel.port} desk={desk} editing={!!editing} onWalk={onWalk} onDead={onDead} />
            ))}
          </div>
        </section>
      ))}
      {editing && onPanels && <AddPanel panels={map.panels ?? []} onPanels={onPanels} defaultPort={views[0]?.panel.port ?? "stage"} />}
    </div>
  );
}

function SocketTile({
  s,
  port,
  desk,
  editing,
  onWalk,
  onDead,
}: {
  s: SocketView;
  port: string;
  desk: LiveView["desk"] | null;
  editing: boolean;
  onWalk?: (id: string) => void;
  onDead?: (port: string, n: number, dead: boolean) => void;
}) {
  const first = s.lands[0];
  const muted = first?.deskKey && desk ? desk.mutes[first.deskKey] === true : false;
  const deskName = first?.deskKey && desk ? (desk.names[first.deskKey] ?? "").trim() : "";
  const cls = ["sp-tile", s.free ? "free" : "", s.dead ? "dead" : "", muted ? "muted" : "", first?.stereoSide ? "stereo" : ""].filter(Boolean).join(" ");
  const clickable = !!first && !!onWalk && !editing;

  return (
    <div
      className={cls}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onWalk!(first!.channelId) : undefined}
      onKeyDown={clickable ? (e) => e.key === "Enter" && onWalk!(first!.channelId) : undefined}
      title={
        s.dead
          ? "Marcado como fuera de servicio: parece normal, pero no conecta"
          : s.free
            ? "Nada en el mapa usa este conector. Puede estar libre en la consola o ser una línea directa que no se registró."
            : !first
              ? "Figura como fuente en el mapa, pero todavía no está conectado a un puerto o canal."
              : `Conector ${s.n} → ${first.doorLabel} ${first.at} → canal ${first.channelIndex}${s.inserts.length ? ` · inserción mediante ${s.inserts.join(", ")}` : ""}`
      }
    >
      <div className="sp-num mono">{s.n}</div>
      {s.dead && <div className="sp-state">fuera de servicio</div>}
      {!s.dead && s.free && <div className="sp-state">libre</div>}
      {!s.dead && !s.free && !first && <div className="sp-state">sin conectar</div>}
      {first && !s.dead && (
        <>
          <div className="sp-door mono">
            {first.doorLabel} {first.at}
          </div>
          <div className="sp-ch">
            <span className="mono sp-chnum">{first.channelIndex}</span> {first.channelLabel || deskName || ""}
            {first.stereoSide && <span className="sp-side mono">{first.stereoSide}</span>}
          </div>
          {deskName && first.channelLabel && deskName !== first.channelLabel && <div className="sp-desk mono">“{deskName}”</div>}
          {s.lands.length > 1 && <div className="sp-twin mono">+{s.lands.slice(1).map((l) => l.channelIndex).join(", ")} comparte ganancia</div>}
          {s.inserts.length > 0 && <div className="sp-insert mono">→ {s.inserts.join(", ")}</div>}
          {muted && <div className="sp-live bad">muteado</div>}
        </>
      )}
      {editing && onDead && (
        <button className="sp-deadbtn" onClick={(e) => (e.stopPropagation(), onDead(port, s.n, !s.dead))} title={s.dead ? "Marcar como funcional" : "Marcar fuera de servicio"}>
          {s.dead ? "deshacer" : "fuera de servicio"}
        </button>
      )}
    </div>
  );
}

function PanelEditor({ panel, panels, onPanels }: { panel: Panel; panels: Panel[]; onPanels: (p: Panel[]) => void }) {
  const upd = (patch: Partial<Panel>) => onPanels(panels.map((p) => (p.id === panel.id ? { ...p, ...patch } : p)));
  return (
    <div className="sp-edit">
      <input className="input sp-edit-label" value={panel.label} onChange={(e) => upd({ label: e.target.value })} placeholder="Nombre del panel" />
      <input className="input sp-edit-port" value={panel.port} onChange={(e) => upd({ port: e.target.value })} title="Grupo de numeración de los conectores, por ejemplo escenario" />
      <input className="input sp-edit-n" type="number" value={panel.from} onChange={(e) => upd({ from: parseInt(e.target.value || "1", 10) })} />
      <span className="muted">–</span>
      <input className="input sp-edit-n" type="number" value={panel.to} onChange={(e) => upd({ to: parseInt(e.target.value || "1", 10) })} />
      <input className="input sp-edit-note" value={panel.note ?? ""} onChange={(e) => upd({ note: e.target.value || undefined })} placeholder="Dónde está y qué particularidades tiene" />
      <button className="rt-icon" title="Quitar panel" onClick={() => onPanels(panels.filter((p) => p.id !== panel.id))}>
        ×
      </button>
    </div>
  );
}

function AddPanel({ panels, onPanels, defaultPort }: { panels: Panel[]; onPanels: (p: Panel[]) => void; defaultPort: string }) {
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const ok = label.trim() && /^\d+$/.test(from) && /^\d+$/.test(to) && parseInt(to, 10) >= parseInt(from, 10);
  return (
    <div className="sp-add">
      <input className="input sp-edit-label" placeholder="Nuevo panel, por ejemplo escenario adelante a la derecha" value={label} onChange={(e) => setLabel(e.target.value)} />
      <input className="input sp-edit-n" placeholder="desde" value={from} onChange={(e) => setFrom(e.target.value)} />
      <span className="muted">–</span>
      <input className="input sp-edit-n" placeholder="hasta" value={to} onChange={(e) => setTo(e.target.value)} />
      <button
        className="btn small ghost"
        disabled={!ok}
        onClick={() => {
          onPanels([...panels, { id: `pan-${Math.random().toString(36).slice(2, 8)}`, label: label.trim(), port: defaultPort, from: parseInt(from, 10), to: parseInt(to, 10) }]);
          setLabel("");
          setFrom("");
          setTo("");
        }}
      >
        Agregar panel
      </button>
    </div>
  );
}
