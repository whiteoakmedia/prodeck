import { useEffect, useState } from "react";
import { useChecklists, type Checklist } from "../checklistStore";
import { askConfirm, askText } from "../lib/dialogs";

function dueLabel(due: string | null): string {
  if (!due) return "No due time";
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return "No due time";
  return d.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ChecklistSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cl = useChecklists();
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [draft, setDraft] = useState("");

  // Refresh overdue state about every 20s while open.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(t);
  }, [open]);

  if (!open) return null;

  const addChecklist = () => {
    const n = newName.trim();
    if (!n) return;
    cl.addChecklist(n);
    setNewName("");
  };

  return (
    <>
      <div className="cl-scrim" onClick={onClose} />
      <aside className="cl-sidebar" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cl-side-head">
          <h3>Checklists</h3>
          <button className="cl-side-x" onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <div className="cl-new">
          <input
            className="input"
            placeholder="New checklist name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addChecklist()}
          />
          <button className="btn small primary" onClick={addChecklist}>
            Add
          </button>
        </div>

        <div className="cl-side-body">
          {cl.checklists.length === 0 && (
            <p className="muted small cl-empty">
              No checklists yet. Create one above — e.g. "Startup", "Pre‑Service", "Shutdown".
            </p>
          )}
          {cl.checklists.map((c: Checklist) => {
            const { done, total } = cl.progress(c);
            const overdue = cl.isOverdue(c, now);
            const complete = total > 0 && done === total;
            const isOpen = expanded === c.id;
            return (
              <div key={c.id} className={`cl-card ${overdue ? "overdue" : ""}`}>
                <div className="cl-card-head" onClick={() => setExpanded(isOpen ? null : c.id)}>
                  <span className={`cl-caret ${isOpen ? "open" : ""}`}>▸</span>
                  <span className="cl-card-name">{c.name}</span>
                  <span className={`cl-count ${complete ? "done" : ""}`}>
                    {done}/{total}
                  </span>
                  <span className={`cl-due ${overdue ? "overdue" : ""}`}>
                    {overdue ? "⚠ overdue" : dueLabel(c.due)}
                  </span>
                </div>

                {isOpen && (
                  <div className="cl-card-body">
                    {c.items.map((it) =>
                      // Headers segment the list; they get no checkbox, because
                      // a tickable header would count as a step nobody can do.
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
                          <button
                            className="cl-item-x"
                            title="Remove item"
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
                        placeholder="Add a step…"
                        value={isOpen ? draft : ""}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && draft.trim()) {
                            cl.addItem(c.id, draft);
                            setDraft("");
                          }
                        }}
                      />
                    </div>

                    <div className="cl-card-foot">
                      <label className="cl-duefield">
                        <span>Due</span>
                        <input
                          className="input"
                          type="datetime-local"
                          value={c.due ?? ""}
                          onChange={(e) => cl.setDue(c.id, e.target.value || null)}
                        />
                      </label>
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
      </aside>
    </>
  );
}
