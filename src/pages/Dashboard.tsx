import { useEffect, useMemo, useRef, useState } from "react";
import { usePerms } from "../lib/perms";
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

/** Which dashboard was open last, so leaving and returning lands on it. */
const ACTIVE_DASH_KEY = "prodeck.activeDashboard";

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
  const [saveError, setSaveError] = useState("");
  useEffect(() => {
    if (!activeId) return;
    try {
      localStorage.setItem(ACTIVE_DASH_KEY, activeId);
    } catch {
      /* storage unavailable */
    }
  }, [activeId]);
  // Editing writes the whole dashboards file, which only the admin password
  // may do. A crew-password screen used to get the full editor anyway: every
  // drag looked like it worked, every save was refused, and leaving the page
  // "reverted" it. Don't offer what can't be kept.
  const { isAdmin, loaded: permsLoaded } = usePerms();
  const canEdit = !IS_WEB || (permsLoaded && isAdmin);
  /// dashboards.json is present but unreadable — refuse to render or persist.
  const [loadError, setLoadError] = useState("");
  // The widget just added, so it can be scrolled to and briefly marked.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const loaded = useRef(false);
  const lastSaved = useRef("");
  /// The layout whose debounced save hasn't fired yet, flushed on unmount.
  const pending = useRef<Dash[] | null>(null);
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
      // A REJECTION means dashboards.json exists but could not be read.
      // Seeding the factory layouts in that case looked like a fresh install
      // and then persisted them over the real file on the first drag — the
      // grid fires onLayoutChange on mount, so that needed no user action.
      let failed = false;
      let data = await loadDashboards().catch((e) => {
        failed = true;
        setLoadError(String(e));
        return null;
      });
      if (failed) return;
      if (!data || !Array.isArray(data) || data.length === 0) {
        data = defaultDashboards();
      }
      setDashboards(data);
      // Come back to the dashboard you were on. Always selecting the first one
      // meant that arranging "Green Room", leaving, and returning showed
      // "Front of House" — which reads as "my changes reverted" even though
      // they were saved and one picker click away.
      let remembered: string | null = null;
      try {
        remembered = localStorage.getItem(ACTIVE_DASH_KEY);
      } catch {
        /* storage unavailable */
      }
      setActiveId(data.find((d) => d.id === remembered)?.id ?? data[0].id);
      lastSaved.current = JSON.stringify(data);
      loaded.current = true;
    })();
  }, []);

  // Persist (debounced) whenever dashboards change — except on a relay client,
  // which mirrors the host's dashboards and would fight its own next update.
  //
  // Browsers used to be excluded too, and the gateway refused the write on top
  // of that. The result was that adding a widget from a phone or a laptop
  // looked like it worked and was silently gone on the next load. Both halves
  // are lifted; a failure is now shown rather than swallowed, because a save
  // that quietly does nothing is the bug this replaced.
  useEffect(() => {
    if (!loaded.current || relay.mode === "client") return;
    const json = JSON.stringify(dashboards);
    if (json === lastSaved.current) return;
    // Flush on unmount rather than dropping the timer: navigating away within
    // the debounce window (App renders one page at a time, so leaving unmounts
    // this) silently reverted the edit the user had just made.
    pending.current = dashboards;
    const t = setTimeout(() => {
      pending.current = null;
      lastSaved.current = json;
      saveDashboards(dashboards).catch((e) => {
        // Let it be retried: the next edit must not be skipped by the
        // unchanged-since-last-save check above.
        lastSaved.current = "";
        setSaveError(String(e));
      });
    }, 400);
    return () => {
      clearTimeout(t);
      const p = pending.current;
      if (p) {
        pending.current = null;
        lastSaved.current = json;
        saveDashboards(p).catch(() => {});
      }
    };
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
    const id = newId();
    patchActive((d) => ({
      ...d,
      widgets: [...d.widgets, { id, type, x: 0, y: nextY, w: def.w, h: def.h, config: {} }],
    }));
    setAdding(false);
    setPickQuery("");
    // A new widget goes to the BOTTOM of the layout. On a full dashboard that
    // is well below the fold, so the picker closed and — from where the user
    // was looking — nothing happened. Reported as "adding widgets isn't
    // working". Scroll to it and mark it for a moment so the click has a
    // visible result.
    setJustAdded(id);
  }

  // Scroll the newly added widget into view once the grid has actually placed
  // it. A single attempt right after the click is too early: react-grid-layout
  // positions the new tile on a later frame, so the scroll targeted its
  // pre-layout position and moved the page by a couple of dozen pixels while
  // the widget itself ended up a thousand pixels further down — still invisible,
  // which is the whole complaint. Re-aiming a few times as the layout settles
  // is cheap and needs no hook into the grid's internals.
  useEffect(() => {
    if (!justAdded) return;
    let tries = 0;
    let timer = 0;
    const aim = () => {
      // Deliberately instant, not "smooth": a smooth scroll is a no-op for
      // anyone with reduced motion enabled (and in some embedded browsers),
      // which would have left the widget off-screen for exactly the people
      // least likely to notice it slide past. Landing there is the point.
      document
        .querySelector(`[data-wid="${justAdded}"]`)
        ?.scrollIntoView({ behavior: "auto", block: "center" });
      if (++tries < 5) timer = window.setTimeout(aim, 140);
    };
    timer = window.setTimeout(aim, 60);
    const clear = window.setTimeout(() => setJustAdded(null), 2600);
    return () => {
      clearTimeout(timer);
      clearTimeout(clear);
    };
  }, [justAdded]);

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
    const d: Dash = { id: newId(), name, widgets: t.build(), audio: t.audio };
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
        canEdit={canEdit}
        onAddWidget={() => setAdding((a) => !a)}
        audio={!!active.audio}
        onToggleAudio={() => patchActive((d) => ({ ...d, audio: !d.audio }))}
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

      {loadError && (
        <div className="banner dash-banner">
          Your dashboards couldn't be read, so nothing has been loaded or saved —
          this is deliberate, to avoid replacing them with blank ones.{" "}
          {loadError}
        </div>
      )}

      {saveError && (
        <div className="banner dash-banner">
          {/needs admin access/i.test(saveError)
            ? "This screen is signed in with the crew password, so its changes can't be saved. Edit dashboards on the booth computer or a browser signed in as admin."
            : `Couldn't save this dashboard — ${saveError}`}
          <button className="btn small" onClick={() => setSaveError("")}>
            Dismiss
          </button>
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
          {!editing && canEdit && (
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
                data-wid={w.id}
                className={`widget ${justAdded === w.id ? "widget-new" : ""}`}
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
            // An unrecognised type still gets a full shell with a remove button.
            // A bare <div> left a blank tile holding its grid space that could
            // not be deleted — which is what a stale template id, or a layout
            // restored from a newer build, looked like on screen.
            if (!def)
              return (
                <div key={w.id} className="widget">
                  <div className="widget-bar widget-drag">
                    <span className="widget-title">Unknown widget</span>
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
                  <div className="widget-body widget-empty">
                    This layout uses a widget this version doesn't have
                    ("{w.type}"). Edit the dashboard to remove it.
                  </div>
                </div>
              );
            const Comp = def.component;
            return (
              <div
                key={w.id}
                data-wid={w.id}
                className={`widget ${justAdded === w.id ? "widget-new" : ""}`}
              >
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
