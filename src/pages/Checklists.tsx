import { useEffect, useState } from "react";
import {
  useChecklists,
  visibilityOf,
  DAY_NAMES,
  type Checklist,
  type Visibility,
} from "../checklistStore";
import { askConfirm, askText } from "../lib/dialogs";
import { identityList, on, type CrewUser } from "../lib/tauri";
import { usePco } from "../pcoStore";

function fmtDue(ts: number | null): string {
  if (ts == null) return "No due time";
  return new Date(ts).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ChecklistsPage() {
  const cl = useChecklists();
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);

  // Approved crew, for per-item assignment. Items owned by someone appear on
  // that person's phone as "my checklist"; unassigned items stay team-wide.
  const [crew, setCrew] = useState<CrewUser[]>([]);
  const pco = usePco();
  useEffect(() => {
    let alive = true;
    const load = () =>
      identityList()
        .then((u) => alive && setCrew(u.filter((x) => x.approved)))
        .catch(() => {});
    load();
    const un = on("identity:changed", load);
    return () => {
      alive = false;
      un.then((f) => f());
    };
  }, []);

  const addChecklist = () => {
    const n = newName.trim();
    if (!n) return;
    cl.addChecklist(n);
    setNewName("");
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Checklists</h1>
        <div className="cl-new">
          <input
            className="input"
            placeholder="New checklist name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addChecklist()}
          />
          <button className="btn small primary" onClick={addChecklist}>
            Add checklist
          </button>
        </div>
      </header>

      {cl.checklists.length === 0 ? (
        <p className="muted cl-empty">
          No checklists yet. Create one above — e.g. "Startup", "Pre‑Service", "Shutdown" — add
          steps, and set a due time to get an alert if it isn't finished in time.
        </p>
      ) : (
        <div className="cl-page-body">
          {cl.checklists.map((c: Checklist) => {
            const { done, total } = cl.progress(c);
            const overdue = cl.isOverdue(c, now);
            const complete = total > 0 && done === total;
            const isOpen = expanded === c.id;
            const recurring = c.schedule.length > 0;
            const due = cl.dueAt(c);
            const updateSlot = (i: number, day: number, time: string) =>
              cl.setSchedule(
                c.id,
                c.schedule.map((s, j) => (j === i ? { day, time } : s)),
              );
            return (
              <div key={c.id} className={`cl-card ${overdue ? "overdue" : ""}`}>
                <div className="cl-card-head" onClick={() => setExpanded(isOpen ? null : c.id)}>
                  <span className={`cl-caret ${isOpen ? "open" : ""}`}>▸</span>
                  <span className="cl-card-name">{c.name}</span>
                  <span className={`cl-count ${complete ? "done" : ""}`}>
                    {done}/{total}
                  </span>
                  <span
                    className={`cl-due ${overdue ? "overdue" : ""}`}
                    title={
                      recurring
                        ? "This list unchecks itself on a schedule — next reset shown"
                        : "Due"
                    }
                  >
                    {overdue
                      ? "⚠ overdue"
                      : recurring
                        ? `resets ${fmtDue(due)}`
                        : `due ${fmtDue(due)}`}
                  </span>
                </div>

                {isOpen && (
                  <div className="cl-card-body">
                    <div className="cl-role-row">
                      <span className="muted small">Who sees this list on their phone</span>
                      <select
                        className="input cl-vis"
                        value={visibilityOf(c)}
                        onChange={(e) =>
                          cl.setVisibility(c.id, e.target.value as Visibility)
                        }
                      >
                        <option value="all">Everyone</option>
                        <option value="position">A position</option>
                        <option value="admin">Admins only</option>
                      </select>
                      {visibilityOf(c) === "position" && (
                        <input
                          className="input cl-role-input"
                          list="cl-roles"
                          placeholder="Position from Planning Center"
                          value={c.role ?? ""}
                          onChange={(e) => cl.setRole(c.id, e.target.value)}
                        />
                      )}
                      {/* Positions come from THIS WEEK'S plan — the same list
                          the gating matches against, so what you pick here is
                          exactly what PCO will compare. */}
                      <datalist id="cl-roles">
                        {[...new Set(pco.team.map((m) => m.position.trim()).filter(Boolean))]
                          .sort((a, b) => a.localeCompare(b))
                          .map((r) => (
                            <option key={r} value={r} />
                          ))}
                      </datalist>
                    </div>
                    {c.items.map((it) =>
                      it.header ? (
                        <div key={it.id} className="cl-section">
                          <span className="cl-section-text">{it.text}</span>
                          <button
                            className="cl-item-x"
                            title="Remove header"
                            onClick={(e) => {
                              e.preventDefault();
                              cl.removeItem(c.id, it.id);
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                      <label key={it.id} className={`cl-item ${it.done ? "done" : ""}`}>
                        <input
                          type="checkbox"
                          checked={it.done}
                          onChange={() => cl.toggleItem(c.id, it.id)}
                        />
                        <span className="cl-item-text">{it.text}</span>
                        <select
                          className="input cl-item-owner"
                          value={it.owner ?? ""}
                          title="Assign this step to a crew member"
                          onClick={(e) => e.preventDefault()}
                          onChange={(e) => cl.setItemOwner(c.id, it.id, e.target.value)}
                        >
                          <option value="">Team</option>
                          {crew.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                          {/* Keep a stale assignment visible instead of silently
                              re-teaming it when someone leaves the roster. */}
                          {it.owner && !crew.some((u) => u.id === it.owner) && (
                            <option value={it.owner}>(removed member)</option>
                          )}
                        </select>
                        <button
                          className="cl-item-x"
                          title="Remove step"
                          onClick={(e) => {
                            e.preventDefault();
                            cl.removeItem(c.id, it.id);
                          }}
                        >
                          ×
                        </button>
                      </label>
                      ),
                    )}

                    <div className="cl-additem">
                      <input
                        className="input"
                        placeholder='Add a step… (paste a list for many; "# Title" or "Title:" makes a section header)'
                        value={isOpen ? draft : ""}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && draft.trim()) {
                            cl.addItem(c.id, draft);
                            setDraft("");
                          }
                        }}
                        onPaste={(e) => {
                          // Pasting a multi-line list creates one step per
                          // line, with bullet markers (-, •, *, "1.") stripped.
                          const text = e.clipboardData.getData("text");
                          if (!text.includes("\n")) return; // single line: normal paste
                          e.preventDefault();
                          const lines = text
                            .split(/\r?\n/)
                            .map((l) => l.replace(/^\s*(?:[-–—•*▪◦]|\d+[.)])\s*/, "").trim())
                            .filter(Boolean);
                          for (const line of lines) cl.addItem(c.id, line);
                          setDraft("");
                        }}
                      />
                    </div>

                    <div className="cl-sched">
                      <label className="cl-recur-toggle">
                        <input
                          type="checkbox"
                          checked={recurring}
                          onChange={(e) =>
                            cl.setSchedule(
                              c.id,
                              e.target.checked
                                ? c.schedule.length
                                  ? c.schedule
                                  : [{ day: 0, time: "08:00" }]
                                : [],
                            )
                          }
                        />
                        <span>Repeats weekly</span>
                      </label>

                      {recurring ? (
                        <div className="cl-slots">
                          {c.schedule.map((s, i) => (
                            <div key={i} className="cl-slot">
                              <select
                                className="input"
                                value={s.day}
                                onChange={(e) => updateSlot(i, parseInt(e.target.value), s.time)}
                              >
                                {DAY_NAMES.map((d, di) => (
                                  <option key={di} value={di}>
                                    {d}
                                  </option>
                                ))}
                              </select>
                              <input
                                className="input"
                                type="time"
                                value={s.time}
                                onChange={(e) => updateSlot(i, s.day, e.target.value)}
                              />
                              <button
                                className="cl-slot-x"
                                title="Remove time"
                                onClick={() =>
                                  cl.setSchedule(
                                    c.id,
                                    c.schedule.filter((_, j) => j !== i),
                                  )
                                }
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <button
                            className="btn small ghost"
                            onClick={() =>
                              cl.setSchedule(c.id, [...c.schedule, { day: 0, time: "08:00" }])
                            }
                          >
                            + Add time
                          </button>
                        </div>
                      ) : (
                        <label className="cl-duefield">
                          <span>Due (one‑time)</span>
                          <input
                            className="input"
                            type="datetime-local"
                            value={c.due ?? ""}
                            onChange={(e) => cl.setDue(c.id, e.target.value || null)}
                          />
                        </label>
                      )}
                    </div>

                    <div className="cl-card-foot">
                      <span className="cl-next muted small">
                        {recurring && due ? `Next: ${fmtDue(due)}` : ""}
                      </span>
                      <div className="cl-card-actions">
                        <button
                          className="btn small ghost"
                          onClick={() => cl.resetChecklist(c.id)}
                          title="Uncheck all"
                        >
                          Reset
                        </button>
                        <button
                          className="btn small ghost"
                          onClick={async () => {
                            const n = await askText("Rename checklist", c.name);
                            if (n?.trim()) cl.renameChecklist(c.id, n.trim());
                          }}
                        >
                          Rename
                        </button>
                        <button
                          className="btn small ghost danger"
                          onClick={async () => {
                            if (await askConfirm(`Delete "${c.name}"?`, "Delete"))
                              cl.deleteChecklist(c.id);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
