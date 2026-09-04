import { useEffect, useState } from "react";
import { listVisibleFor, useChecklists, type Checklist } from "../checklistStore";
import { usePco } from "../pcoStore";
import { CREW_ID_KEY, CREW_SESSION_KEY } from "../chatStore";
import { IS_WEB, checkinList, checkinSet, identityWhoami, webWhoami } from "../lib/tauri";
import { enqueue, flush, queueSize } from "../lib/outbox";

// S08 — the checklist screen.
//
// Items now carry an OWNER (assigned at the booth from the crew roster), which
// finally makes this "my checklist": items assigned to this phone's identity
// render first as one aggregated MY CHECKLIST card, team-wide (unassigned)
// items follow in their lists, and other people's items are omitted — a count
// line says they exist so a list never looks mysteriously short. Per-item due
// times / T-offsets from the design remain future work; due dates still live
// on the list.
//
// Faithful: check-in pinned as item zero (same single source of truth as the
// Home bar — cannot be checked twice), overdue tinting the whole panel, and
// completion state driving the progress.

import { clock, dayClock } from "./fmt";

export function CrewChecklist() {
  const cl = useChecklists();
  const pco = usePco();
  const [checked, setChecked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Anything waiting to reach the booth. A queue nobody can see is just a
  // different way of losing someone's work.
  const [queued, setQueued] = useState(queueSize());
  useEffect(() => {
    const bump = () => setQueued(queueSize());
    const iv = setInterval(bump, 3000);
    window.addEventListener("prodeck-outbox-flushed", bump);
    return () => {
      clearInterval(iv);
      window.removeEventListener("prodeck-outbox-flushed", bump);
    };
  }, []);

  const serviceKey = `${pco.selectedPlanId ?? ""}::${pco.selectedServiceTimeId ?? ""}`;
  const start = pco.serviceTimes.find((t) => t.id === pco.selectedServiceTimeId)?.ts ?? 0;

  useEffect(() => {
    let alive = true;
    checkinList(localStorage.getItem(CREW_SESSION_KEY) ?? "")
      .then((r) => alive && setChecked(r.mine ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [serviceKey]);

  async function checkIn() {
    setBusy(true);
    try {
      const r = await checkinSet(localStorage.getItem(CREW_SESSION_KEY) ?? "", serviceKey);
      setChecked(r.at);
    } catch {
      // Offline → queue it. Safe because the booth keeps the FIRST timestamp,
      // so a replay can never move someone's arrival later than it was.
      enqueue({
        kind: "checkin",
        session: localStorage.getItem(CREW_SESSION_KEY) ?? "",
        serviceKey,
      });
      setChecked(Date.now());
      /* the card simply stays un-checked */
    } finally {
      setBusy(false);
    }
  }

  const myId = localStorage.getItem(CREW_ID_KEY) ?? "";
  // Role and admin-ness decide which LISTS this phone sees at all. Fetched
  // fresh each mount so a role change at the booth applies without re-login;
  // cached so the offline checklist (S11's promise) still filters correctly.
  const [myRole, setMyRole] = useState(() => localStorage.getItem("prodeck.crewRole") ?? "");
  const [isAdmin, setIsAdmin] = useState(!IS_WEB);
  useEffect(() => {
    if (!IS_WEB) return;
    identityWhoami(localStorage.getItem(CREW_SESSION_KEY) ?? "")
      .then((w) => {
        localStorage.setItem(CREW_ID_KEY, w.id);
        localStorage.setItem("prodeck.crewRole", w.role);
        setMyRole(w.role);
      })
      .catch(() => {});
    webWhoami().then((w) => setIsAdmin(w.tier === "admin")).catch(() => {});
  }, []);

  // Position first: lists tagged with a PCO position only exist on this
  // phone in weeks I'm SCHEDULED to that position; other tags match my
  // static crew role. Admins keep the full picture.
  const myArrival = pco.arrivalFor(
    localStorage.getItem("prodeck.crewName") ?? "",
    myRole,
  );
  const visible = cl.checklists.filter((c) =>
    listVisibleFor(c, myArrival.position, isAdmin),
  );
  const hiddenCount = cl.checklists.length - visible.length;

  const mine = cl.itemsFor(myId);
  const myDone = mine.filter((m) => m.item.done).length;

  const totals = visible.reduce(
    (a, c) => {
      const p = cl.progress(c);
      return { done: a.done + p.done, total: a.total + p.total };
    },
    { done: 0, total: 0 },
  );

  return (
    <div className="crew-page">
      <h1 className="crew-title">Checklist</h1>
      <p className="crew-hint muted" style={{ marginTop: -4 }}>
        {mine.length > 0
          ? `Mine ${myDone} of ${mine.length} · team ${totals.done} of ${totals.total}`
          : `Team checklist · ${totals.done} of ${totals.total} done`}
      </p>
      {queued > 0 && (
        <button className="crew-queued" onClick={() => flush().then(() => setQueued(queueSize()))}>
          <span className="pulse-dot" style={{ background: "var(--warn)" }} />
          {queued} change{queued === 1 ? "" : "s"} waiting to reach the booth · tap to retry
        </button>
      )}

      {/* Item zero: check-in, same state as the Home bar */}
      <div className={`crew-card ${checked ? "sunk" : "accent"}`}>
        {checked ? (
          <span className="crew-checkin-done">
            <span className="crew-check on green">✓</span> Checked in {clock(checked)}
          </span>
        ) : (
          <div className="crew-checkin-inner">
            <div>
              <div className="crew-buzz-title">I'm here</div>
              <div className="crew-buzz-sub">
                {(() => {
                  // MY call time from the PCO schedule; service start only as
                  // a labeled fallback so a mismatch is visible, not silent.
                  const m = pco.arrivalFor(
                    localStorage.getItem("prodeck.crewName") ?? "",
                    myRole,
                  );
                  const t = m.ts ?? start;
                  if (!t) return "tells the booth";
                  return m.ts
                    ? `Expected ${dayClock(t)} · tells the booth`
                    : `Expected ${dayClock(t)} (service start — you're not on this week's plan) · tells the booth`;
                })()}
              </div>
            </div>
            <button className="crew-checkin-btn" disabled={busy} onClick={checkIn}>
              {busy ? "…" : "Check in"}
            </button>
          </div>
        )}
      </div>

      {/* MY CHECKLIST — items assigned to this identity, across all lists. */}
      {mine.length > 0 && (
        <div className="crew-card accent-line edge">
          <div className="crew-row-head">
            <span className="crew-buzz-title">My checklist</span>
            <span className="mono-data crew-count-of">
              {myDone}/{mine.length}
            </span>
          </div>
          <div className="crew-items">
            {mine.map(({ list, item }) => (
              <button
                key={item.id}
                className={`crew-item ${item.done ? "done" : ""}`}
                onClick={() => cl.toggleItem(list.id, item.id)}
              >
                <span className={`crew-check ${item.done ? "on green" : ""}`}>
                  {item.done ? "✓" : ""}
                </span>
                <span className="crew-item-text">
                  {item.text}
                  <span className="mono-data crew-item-list"> {list.name}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {visible.length === 0 && (
        <p className="crew-hint muted">
          {cl.checklists.length === 0
            ? "No checklists set up at the booth yet."
            : myRole
              ? `Nothing for "${myRole}" this week.`
              : "No role set for you yet — ask the booth to assign your position."}
        </p>
      )}

      {visible.map((c) => (
        <ChecklistCard key={c.id} list={c} myId={myId} />
      ))}

      {hiddenCount > 0 && !isAdmin && (
        <p className="crew-hint muted" style={{ textAlign: "center" }}>
          {hiddenCount} other-position checklist{hiddenCount === 1 ? "" : "s"} hidden
        </p>
      )}
    </div>
  );
}

// Collapse state lives per list id, so a volunteer who folds away the list
// they've finished doesn't find it open again after visiting Home. Kept in
// localStorage rather than component state for the same reason.
const COLLAPSE_KEY = "prodeck.clCollapsed";
function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function ChecklistCard({ list, myId }: { list: Checklist; myId: string }) {
  const cl = useChecklists();
  // Default OPEN: a checklist that hides its steps until you find the right
  // tap is worse than a long one, and the whole point is that it's scannable.
  const [open, setOpen] = useState(() => readCollapsed()[list.id] !== true);
  function toggle() {
    const next = !open;
    setOpen(next);
    const all = readCollapsed();
    if (next) delete all[list.id];
    else all[list.id] = true;
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(all));
  }
  const p = cl.progress(list);
  const overdue = cl.isOverdue(list);
  const due = cl.dueAt(list);
  // Mine are already up top; team (unassigned) items render here; other
  // people's items are their business — but count them so a 2-item view of a
  // 9-item list doesn't read as data loss.
  const team = list.items.filter((it) => !it.owner);
  const others = list.items.filter((it) => it.owner && it.owner !== myId).length;

  // Everything in this list is assigned elsewhere — one summary line beats an
  // empty-looking card.
  if (team.length === 0 && list.items.length > 0) {
    return (
      <div className="crew-card sunk">
        <div className="crew-row-head">
          <span className="crew-buzz-title" style={{ color: "var(--muted)" }}>
            {list.name}
          </span>
          <span className="mono-data crew-count-of">
            {p.done}/{p.total}
          </span>
        </div>
        <div className="mono-data crew-buzz-sub">assigned to the team individually</div>
      </div>
    );
  }

  return (
    <div className={`crew-card ${overdue ? "warn" : "edge"}`}>
      {/* The whole header is the toggle — a 44pt-tall target you can hit
          one-handed, rather than a small chevron you have to aim at. */}
      <button
        className="crew-list-toggle"
        onClick={toggle}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${list.name}`}
      >
        <div className="crew-row-head">
          <span className={`crew-caret ${open ? "open" : ""}`}>▸</span>
          <span className="crew-buzz-title">{list.name}</span>
          <span className="mono-data crew-count-of">
            {p.done}/{p.total}
          </span>
        </div>
        <div className="mono-data crew-buzz-sub">
          {due ? `due ${dayClock(due)}` : cl.recurrenceSummary(list)}
          {overdue ? " · overdue" : ""}
          {others > 0 ? ` · ${others} assigned` : ""}
          {!open ? ` · ${p.total - p.done} left` : ""}
        </div>
      </button>

      <div className="crew-items" hidden={!open}>
        {team.map((it) =>
          // A header is a label between steps: no checkbox, no tap target, and
          // it never counts toward the done/total above.
          it.header ? (
            <div key={it.id} className="mono crew-sheet-label crew-item-section">
              {it.text}
            </div>
          ) : (
            <button
              key={it.id}
              className={`crew-item ${it.done ? "done" : ""}`}
              onClick={() => cl.toggleItem(list.id, it.id)}
            >
              <span className={`crew-check ${it.done ? "on green" : ""}`}>
                {it.done ? "✓" : ""}
              </span>
              <span className="crew-item-text">{it.text}</span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}
