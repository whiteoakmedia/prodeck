import { useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useProDeck } from "../store";
import { useRelay } from "../relayStore";
import { Icon } from "../components/Icon";
import { DashTopBar } from "../components/DashTopBar";
import { WIDGETS, WIDGET_MAP, WIDGET_GROUP_ORDER } from "../widgets/registry";
import { askConfirm, askText } from "../lib/dialogs";
import { IS_WEB } from "../lib/tauri";
import {
  defaultDashboards,
  loadDashboards,
  newId,
  saveDashboards,
  type Dashboard as Dash,
  type DashboardTemplate,
} from "../lib/dashboards";

const Grid = WidthProvider(GridLayout);

export function Dashboard({ onNavigate }: { onNavigate: (p: any) => void }) {
  const { connected, connect, settings } = useProDeck();
  const relay = useRelay();
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectFailed, setReconnectFailed] = useState(false);

  // "Connect" should DO the thing: retry the saved host first, and only send
  // the operator to the settings page when there's nothing saved or the retry
  // fails. (Web clients can't drive pp_connect at all — they get plain text.)
  async function tryReconnect() {
    const host = settings?.pp_host;
    if (!host) {
      onNavigate("propresenter");
      return;
    }
    setReconnecting(true);
    setReconnectFailed(false);
    try {
      await connect(host, settings?.pp_port ?? 1025);
    } catch {
      setReconnectFailed(true);
      onNavigate("propresenter");
    } finally {
      setReconnecting(false);
    }
  }
  const [dashboards, setDashboards] = useState<Dash[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pickQuery, setPickQuery] = useState("");
  const loaded = useRef(false);
  const lastSaved = useRef("");
  // On phones the 12-column drag grid is unusable, so stack widgets in one
  // column instead (still fully interactive — just not draggable).
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 760,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 760);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Load persisted dashboards (or seed defaults) once.
  useEffect(() => {
    (async () => {
      let data = await loadDashboards().catch(() => null);
      if (!data || !Array.isArray(data) || data.length === 0) {
        data = defaultDashboards();
      }
      setDashboards(data);
      setActiveId(data[0].id);
      lastSaved.current = JSON.stringify(data);
      loaded.current = true;
    })();
  }, []);

  // Persist (debounced) whenever dashboards change — except on a relay client
  // (mirrors the host's dashboards) or a browser client (the booth app owns
  // dashboards.json; a phone's stale copy must not overwrite it).
  useEffect(() => {
    if (!loaded.current || relay.mode === "client" || IS_WEB) return;
    const json = JSON.stringify(dashboards);
    if (json === lastSaved.current) return;
    const t = setTimeout(() => {
      lastSaved.current = json;
      saveDashboards(dashboards).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [dashboards, relay.mode]);

  // On a relay client, mirror the host's dashboards live.
  useEffect(() => {
    if (relay.mode !== "client" || !relay.dashboards || relay.dashboards.length === 0) return;
    setDashboards(relay.dashboards);
    setActiveId((cur) =>
      relay.dashboards!.some((d) => d.id === cur) ? cur : relay.dashboards![0].id,
    );
  }, [relay.mode, relay.dashboards]);

  const active = dashboards.find((d) => d.id === activeId) ?? dashboards[0];

  const layout: Layout[] = useMemo(
    () =>
      (active?.widgets ?? []).map((w) => ({
        i: w.id,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        minW: 2,
        minH: 2,
      })),
    [active],
  );

  function patchActive(fn: (d: Dash) => Dash) {
    setDashboards((ds) => ds.map((d) => (d.id === active.id ? fn(d) : d)));
  }

  function onLayoutChange(next: Layout[]) {
    if (!active) return;
    let changed = false;
    const byId = new Map(next.map((l) => [l.i, l]));
    const widgets = active.widgets.map((w) => {
      const l = byId.get(w.id);
      if (!l) return w;
      if (l.x !== w.x || l.y !== w.y || l.w !== w.w || l.h !== w.h) {
        changed = true;
        return { ...w, x: l.x, y: l.y, w: l.w, h: l.h };
      }
      return w;
    });
    if (changed) patchActive((d) => ({ ...d, widgets }));
  }

  function addWidget(type: string) {
    const def = WIDGET_MAP[type];
    const nextY = active.widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
    patchActive((d) => ({
      ...d,
      widgets: [
        ...d.widgets,
        { id: newId(), type, x: 0, y: nextY, w: def.w, h: def.h, config: {} },
      ],
    }));
    setAdding(false);
    setPickQuery("");
  }

  function removeWidget(id: string) {
    patchActive((d) => ({ ...d, widgets: d.widgets.filter((w) => w.id !== id) }));
  }

  function updateWidget(id: string, patch: Record<string, any>) {
    patchActive((d) => ({
      ...d,
      widgets: d.widgets.map((w) =>
        w.id === id ? { ...w, config: { ...w.config, ...patch } } : w,
      ),
    }));
  }

  function newDashboard() {
    const d: Dash = { id: newId(), name: `Dashboard ${dashboards.length + 1}`, widgets: [] };
    setDashboards((ds) => [...ds, d]);
    setActiveId(d.id);
    setEditing(true);
  }

  function createFromTemplate(t: DashboardTemplate) {
    // Avoid duplicate names: append a counter if one already exists.
    const base = t.name;
    let name = base;
    let n = 2;
    while (dashboards.some((d) => d.name === name)) name = `${base} ${n++}`;
    const d: Dash = { id: newId(), name, widgets: t.build() };
    setDashboards((ds) => [...ds, d]);
    setActiveId(d.id);
  }

  async function renameDashboard() {
    const name = await askText("Dashboard name", active.name);
    if (name?.trim()) patchActive((d) => ({ ...d, name: name.trim() }));
  }

  async function deleteDashboard() {
    if (dashboards.length <= 1) return;
    // One mis-click sits right next to Rename — destroying a whole layout
    // (persisted 400ms later, no undo) deserves a confirm.
    if (!(await askConfirm(`Delete dashboard "${active.name}"?`, "Delete"))) return;
    const remaining = dashboards.filter((d) => d.id !== active.id);
    setDashboards(remaining);
    setActiveId(remaining[0].id);
  }

  if (!active) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>Dashboard</h1>
        </header>
      </div>
    );
  }

  return (
    <div className="page dashboard-page">
      <DashTopBar
        dashboards={dashboards}
        active={active}
        onSelect={setActiveId}
        editing={editing}
        onToggleEdit={() => {
          setEditing((e) => !e);
          setAdding(false);
        }}
        onAddWidget={() => setAdding((a) => !a)}
        onRename={renameDashboard}
        onDelete={deleteDashboard}
        onNew={newDashboard}
        onTemplate={createFromTemplate}
        onNavigate={onNavigate}
      />


      {!connected && (
        <div className="banner dash-banner">
          {IS_WEB
            ? "Not connected to ProPresenter — live widgets are idle. Connecting happens on the booth Mac itself."
            : reconnectFailed
              ? `Couldn't reach ProPresenter at ${settings?.pp_host ?? "the saved address"} — check it's open, then reconnect here.`
              : "Not connected to ProPresenter — live widgets are idle."}
          {!IS_WEB && (
            <button className="btn small" disabled={reconnecting} onClick={tryReconnect}>
              {reconnecting ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>
      )}

      {adding && (
        <div className="wpick">
          <input
            className="input wpick-search"
            autoFocus
            placeholder="Search widgets…"
            value={pickQuery}
            onChange={(e) => setPickQuery(e.target.value)}
          />
          <div className="wpick-body">
            {WIDGET_GROUP_ORDER.map((group) => {
              const q = pickQuery.trim().toLowerCase();
              const items = WIDGETS.filter(
                (w) => w.group === group && w.label.toLowerCase().includes(q),
              );
              if (items.length === 0) return null;
              return (
                <div key={group} className="wpick-group">
                  <div className="wpick-gh">{group}</div>
                  <div className="wpick-grid">
                    {items.map((w) => (
                      <button
                        key={w.type}
                        className="wpick-item"
                        onClick={() => addWidget(w.type)}
                      >
                        <span className="wpick-name">{w.label}</span>
                        <span className="wpick-size">{w.w}×{w.h}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {active.widgets.length === 0 ? (
        <div className="dash-empty">
          <Icon name="dashboard" size={34} />
          <h2>This dashboard is empty</h2>
          <p className="muted">
            Turn on <strong>Edit</strong> and add widgets to build your layout.
          </p>
          {!editing && (
            <button className="btn primary" onClick={() => { setEditing(true); setAdding(true); }}>
              Start building
            </button>
          )}
        </div>
      ) : isMobile ? (
        <div className="mobile-stack">
          {active.widgets.map((w) => {
            const def = WIDGET_MAP[w.type];
            if (!def)
              return (
                <div key={w.id} className="widget">
                  <div className="widget-body widget-empty">
                    Unknown widget: {w.type}
                  </div>
                </div>
              );
            const Comp = def.component;
            return (
              <div
                key={w.id}
                className="widget"
                style={{ minHeight: Math.min(440, Math.max(150, w.h * 62)) }}
              >
                <div className="widget-bar">
                  <span className="widget-title">{def.label}</span>
                </div>
                <div className="widget-body">
                  <Comp
                    widget={w}
                    editing={false}
                    update={(patch) => updateWidget(w.id, patch)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Grid
          className={`layout ${editing ? "editing" : ""}`}
          layout={layout}
          cols={12}
          rowHeight={70}
          margin={[14, 14]}
          containerPadding={[0, 0]}
          isDraggable={editing}
          isResizable={editing}
          draggableHandle=".widget-drag"
          compactType="vertical"
          onLayoutChange={onLayoutChange}
        >
          {active.widgets.map((w) => {
            const def = WIDGET_MAP[w.type];
            if (!def) return <div key={w.id} />;
            const Comp = def.component;
            return (
              <div key={w.id} className="widget">
                <div className="widget-bar widget-drag">
                  <span className="widget-title">{def.label}</span>
                  {editing && (
                    <button
                      className="widget-remove"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => removeWidget(w.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="widget-body">
                  <Comp
                    widget={w}
                    editing={editing}
                    update={(patch) => updateWidget(w.id, patch)}
                  />
                </div>
              </div>
            );
          })}
        </Grid>
      )}
    </div>
  );
}
