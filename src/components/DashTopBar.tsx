import { useEffect, useState } from "react";
import { usePco } from "../pcoStore";
import { useProDeck } from "../store";
import { activePresentation, currentSlideIndex } from "../lib/status";
import { Icon } from "./Icon";
import { DASHBOARD_TEMPLATES, type Dashboard as Dash, type DashboardTemplate } from "../lib/dashboards";

/**
 * The producer bar.
 *
 * Replaces the old dashboard tab strip AND the PCO switcher bar that used to
 * sit below it: which view, which plan, which service time, what's live and
 * what's the current item all belong in one band across the top instead of two
 * stacked rows eating vertical space on every dashboard.
 */

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "July 5th, 2026" + "Sunday", from an epoch or any parseable date string. */
function planDateParts(ts: number, raw: string): { main: string; sub: string } {
  const d = ts > 0 ? new Date(ts) : new Date(raw);
  if (!raw && ts <= 0) return { main: "No plan", sub: "Planning Center" };
  if (isNaN(d.getTime())) return { main: raw || "No plan", sub: "Plan date" };
  return {
    main: `${MONTHS[d.getMonth()]} ${ordinal(d.getDate())}, ${d.getFullYear()}`,
    sub: DAYS[d.getDay()],
  };
}

function hms(ms: number): string {
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}

/** A bar cell that opens a menu; closes on outside click or Escape. */
function Cell({
  icon,
  main,
  sub,
  menu,
  open,
  setOpen,
  wide,
}: {
  icon: string;
  main: string;
  sub?: string;
  menu?: React.ReactNode;
  open?: boolean;
  setOpen?: (v: boolean) => void;
  wide?: boolean;
}) {
  const clickable = !!menu;
  return (
    <div className="pb-wrap">
      <button
        className={`pb-cell ${clickable ? "" : "static"} ${wide ? "wide" : ""} ${open ? "open" : ""}`}
        disabled={!clickable}
        onClick={() => setOpen?.(!open)}
      >
        <Icon name={icon} size={15} />
        <span className="pb-txt">
          <span className="pb-main">{main}</span>
          {sub && <span className="pb-sub">{sub}</span>}
        </span>
        {clickable && <span className="pb-chev"><Icon name="chevron" size={13} /></span>}
      </button>
      {open && menu && (
        <>
          <div className="pb-backdrop" onClick={() => setOpen?.(false)} />
          <div className="pb-menu">{menu}</div>
        </>
      )}
    </div>
  );
}

export function DashTopBar({
  dashboards,
  active,
  onSelect,
  editing,
  onToggleEdit,
  onAddWidget,
  onRename,
  onDelete,
  onNew,
  onTemplate,
  onNavigate,
}: {
  dashboards: Dash[];
  active: Dash;
  onSelect: (id: string) => void;
  editing: boolean;
  onToggleEdit: () => void;
  onAddWidget: () => void;
  onRename: () => void;
  onDelete: () => void;
  onNew: () => void;
  onTemplate: (t: DashboardTemplate) => void;
  onNavigate: (p: string) => void;
}) {
  const pco = usePco();
  const [viewMenu, setViewMenu] = useState(false);
  const [dateMenu, setDateMenu] = useState(false);
  const [timeMenu, setTimeMenu] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const { connected, status } = useProDeck();

  // "Current item" means what is on the screens. It used to read only
  // pco.liveItemId, which moves only while somebody is driving Services LIVE —
  // so with ProPresenter mid-song and nobody holding the PCO controller the bar
  // said OFF AIR / Nothing live. ProPresenter is the source of truth; the PCO
  // item is the fallback (and supplies the song key when the two agree).
  const pcoItem = pco.items.find((i) => i.id === pco.liveItemId) ?? null;
  const pres = connected ? activePresentation(status) : { uuid: null, name: null };
  const slideIdx = connected ? currentSlideIndex(status) : null;
  const onScreen = !!pres.name;

  // Match the live presentation back to a plan item by name so the key chip
  // still appears even when PCO Live is not being driven.
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const matched =
    onScreen && pres.name
      ? pco.items.find((i) => i.type !== "header" && norm(i.title) === norm(pres.name!)) ?? null
      : null;

  const liveTitle = onScreen ? pres.name : pcoItem?.title ?? null;
  const liveKey = (matched ?? pcoItem)?.key || "";
  const isLive = onScreen || !!pcoItem;
  const svcTime = pco.serviceTimes.find((t) => t.id === pco.selectedServiceTimeId) ?? null;
  const plan = pco.plans.find((p) => p.id === pco.selectedPlanId) ?? null;
  const stName = pco.serviceTypes.find((s) => s.id === pco.selectedServiceTypeId)?.name;

  // The clock runs for the whole service window, not just while an item is
  // live — it is the "how far into the service are we" number. Outside that
  // window we still tick, slowly, so the bar notices the service starting.
  const elapsedMs = svcTime && svcTime.ts > 0 ? now - svcTime.ts : -1;
  const inService = elapsedMs >= 0 && elapsedMs < 6 * 3600_000;
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), inService ? 1000 : 30_000);
    return () => clearInterval(t);
  }, [inService]);

  const elapsed = inService ? hms(elapsedMs) : null;

  const { main: dateMain, sub: dateSub } = planDateParts(svcTime?.ts ?? 0, plan?.date ?? "");

  // credsKnown is false for browser clients (the gateway redacts the PCO
  // secret), so gating the date cell on it hid the plan from every web client.
  // Gate on the data we actually have instead, and make the cell inert rather
  // than absent when there is nothing to switch between.
  const showDate = pco.credsKnown || !!plan || pco.serviceTimes.length > 0;
  const canPickPlan = pco.plans.length > 0 || pco.serviceTypes.length > 0;

  const closeAll = () => {
    setViewMenu(false);
    setDateMenu(false);
    setTimeMenu(false);
  };

  return (
    <header className="page-head dash-head prodbar">
      <Cell
        icon="dashboard"
        main={active.name}
        sub="Dashboard"
        open={viewMenu}
        setOpen={setViewMenu}
        menu={
          <>
            <div className="pb-menu-h">Dashboards</div>
            {dashboards.map((d) => (
              <button
                key={d.id}
                className={`pb-item ${d.id === active.id ? "on" : ""}`}
                onClick={() => {
                  onSelect(d.id);
                  closeAll();
                }}
              >
                {d.name}
              </button>
            ))}
            <div className="pb-sep" />
            <div className="pb-menu-h">New dashboard</div>
            <button
              className="pb-item"
              onClick={() => {
                onNew();
                closeAll();
              }}
            >
              Blank
              <span className="pb-item-sub">Start empty and add your own widgets.</span>
            </button>
            {DASHBOARD_TEMPLATES.map((t) => (
              <button
                key={t.key}
                className="pb-item"
                onClick={() => {
                  onTemplate(t);
                  closeAll();
                }}
              >
                {t.name}
                <span className="pb-item-sub">{t.blurb}</span>
              </button>
            ))}
          </>
        }
      />

      {showDate && (
        <Cell
          icon="calendar"
          main={dateMain}
          sub={dateSub}
          open={dateMenu}
          setOpen={setDateMenu}
          wide
          menu={
            canPickPlan ? (
            <>
              <div className="pb-menu-h">Service type</div>
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
              <div className="pb-menu-h">Plan</div>
              {pco.plans.length === 0 && <div className="pb-empty">No plans for {stName ?? "this service type"}.</div>}
              {pco.plans.map((p) => (
                <button
                  key={p.id}
                  className={`pb-item ${p.id === pco.selectedPlanId ? "on" : ""}`}
                  onClick={() => {
                    pco.selectPlan(p.id);
                    closeAll();
                  }}
                >
                  {p.date || p.title}
                  {p.date && p.title && <span className="pb-item-sub">{p.title}</span>}
                </button>
              ))}
            </>
            ) : null
          }
        />
      )}

      {pco.serviceTimes.length > 0 && (
        <Cell
          icon="clock"
          main={svcTime?.name ?? "—"}
          sub="Service time"
          open={timeMenu}
          setOpen={setTimeMenu}
          menu={
            <>
              <div className="pb-menu-h">Service time</div>
              {pco.serviceTimes.map((t) => (
                <button
                  key={t.id}
                  className={`pb-item ${t.id === pco.selectedServiceTimeId ? "on" : ""}`}
                  onClick={() => {
                    pco.selectServiceTime(t.id);
                    closeAll();
                  }}
                >
                  {t.name}
                </button>
              ))}
              <div className="pb-sep" />
              <button
                className={`pb-item toggle ${pco.autoAdvanceService ? "on" : ""}`}
                onClick={() => pco.setAutoAdvanceService(!pco.autoAdvanceService)}
              >
                Auto next service
                <span className="pb-item-sub">
                  Roll to the next service time automatically so analytics track per service.
                </span>
              </button>
              <button
                className={`pb-item toggle ${pco.followPro ? "on" : ""}`}
                onClick={() => pco.setFollowPro(!pco.followPro)}
              >
                Follow ProPresenter
                <span className="pb-item-sub">
                  Mark the rundown live from what's on the screens, matched by name.
                </span>
              </button>
            </>
          }
        />
      )}

      {/* Always rendered: a bar that changes shape depending on whether
          something is live is harder to read at a glance than one that always
          answers the question, off air included. */}
      <div className={`pb-live ${isLive ? "" : "off"}`}>
        <span className="pb-live-dot" />
        {isLive ? "LIVE" : "OFF AIR"}
        {elapsed && <span className="pb-live-time">{elapsed}</span>}
      </div>

      <div className="pb-spacer" />

      <div className="pb-cell static pb-current">
        <span className="pb-txt">
          <span className="pb-sub">Current item</span>
          <span className={`pb-main ${liveTitle ? "" : "idle"}`}>
            {liveTitle ?? (connected ? "Nothing live" : "ProPresenter offline")}
          </span>
        </span>
        {onScreen && slideIdx !== null && (
          <span className="pb-slide">{slideIdx + 1}</span>
        )}
        {liveKey && <span className="pb-key">{liveKey}</span>}
      </div>

      {editing && (
        <>
          <button className="btn small ghost" onClick={onRename}>
            Rename
          </button>
          <button className="btn small ghost" onClick={onDelete}>
            Delete
          </button>
          <button className="btn small primary" onClick={onAddWidget}>
            <Icon name="dashboard" size={14} /> Add Widget
          </button>
        </>
      )}
      <button
        className={`pb-icon ${editing ? "on" : ""}`}
        title={editing ? "Done editing" : "Edit this dashboard"}
        onClick={onToggleEdit}
      >
        <Icon name="edit" size={15} />
      </button>
      <button className="pb-icon" title="Settings" onClick={() => onNavigate("settings")}>
        <Icon name="settings" size={15} />
      </button>
    </header>
  );
}
