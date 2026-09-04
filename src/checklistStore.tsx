import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IS_WEB, checklistToggle, loadChecklists, saveChecklists } from "./lib/tauri";
import { enqueue } from "./lib/outbox";

export interface ChItem {
  id: string;
  text: string;
  done: boolean;
  /** Crew user id this item is assigned to; empty/undefined = whole team. */
  owner?: string;
  /** Section header — a label between steps, never tickable, never counted
   *  in progress. Authored with "# Title" or a line ending in ":". */
  header?: boolean;
}
export interface Slot {
  day: number; // 0 = Sun … 6 = Sat
  time: string; // "HH:MM" (24h)
}
export interface Checklist {
  id: string;
  name: string;
  items: ChItem[];
  due: string | null; // one-time due (datetime-local) when not recurring
  schedule: Slot[]; // weekly recurrence slots; empty = one-time
  activeDue: number | null; // epoch ms of the current target occurrence (recurring)
  /** Who this list is for. Explicit, because the old free-text role box
   *  conflated a POSITION with a PERMISSION — "ADMIN" was a magic string that
   *  looked exactly like "Audio". */
  visibility?: Visibility;
  /** The PCO position, when visibility is "position" ("Camera", "Audio", …).
   *  Matched loosely, so "Camera" covers "Camera 1" and "Camera 2". */
  role?: string;
}

export type Visibility = "all" | "position" | "admin";

/** Derive visibility for lists saved before the field existed.
 *
 *  Deterministic and plan-independent on purpose: keying off "is this tag a
 *  position on the CURRENT plan" would make an old list change meaning from one
 *  week to the next, which is precisely the ambiguity this field removes. */
export function visibilityOf(c: Pick<Checklist, "visibility" | "role">): Visibility {
  if (c.visibility) return c.visibility;
  const tag = (c.role ?? "").trim();
  if (!tag) return "all";
  return tag.toLowerCase() === "admin" ? "admin" : "position";
}

/** Does a list tagged `listRole` apply to a person whose role is `userRole`?
 *  Loose on purpose: "Camera" matches "Camera 1", "Audio" matches "Audio A2".
 *  Both empty-safe: an untagged list applies to everyone; an unroled person
 *  sees only untagged lists. */
export function roleMatches(listRole: string | undefined, userRole: string): boolean {
  const l = (listRole ?? "").trim().toLowerCase();
  if (!l) return true;
  const u = userRole.trim().toLowerCase();
  if (!u) return false;
  return u === l || u.startsWith(l) || l.startsWith(u);
}

/** Can this person see this list right now?
 *
 *  Position lists are gated on THIS WEEK'S PCO schedule and nothing else: not
 *  on the plan means not their position, so the list simply isn't there. There
 *  is deliberately no manual override and no last-known fallback — one source
 *  of truth, and it is Planning Center. */
export function listVisibleFor(
  c: Pick<Checklist, "visibility" | "role">,
  scheduledPosition: string,
  isAdmin: boolean,
): boolean {
  switch (visibilityOf(c)) {
    case "all":
      return true;
    case "admin":
      return isAdmin;
    case "position":
      return (
        isAdmin || (!!scheduledPosition.trim() && roleMatches(c.role, scheduledPosition))
      );
  }
}

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR = 3600_000;
const MAX_OVERDUE = 6 * HOUR; // longest a missed occurrence stays flagged

const uid = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

// The earliest occurrence of any slot strictly after `after` (epoch ms).
function nextOccurrence(schedule: Slot[], after: number): number | null {
  let best = Infinity;
  for (const s of schedule) {
    const [hh, mm] = s.time.split(":").map((x) => parseInt(x, 10));
    if (Number.isNaN(hh) || Number.isNaN(mm)) continue;
    const base = new Date(after);
    for (let add = 0; add <= 7; add++) {
      const c = new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate() + add,
        hh,
        mm,
        0,
        0,
      );
      if (c.getDay() === s.day && c.getTime() > after) {
        best = Math.min(best, c.getTime());
        break;
      }
    }
  }
  return Number.isFinite(best) ? best : null;
}

// When the current occurrence "rolls" to the next (and the list resets): the
// midpoint to the next slot, capped so a missed weekly item doesn't stay
// flagged for days.
function flipTime(activeDue: number, schedule: Slot[]): number {
  const next = nextOccurrence(schedule, activeDue);
  const gap = next != null ? next - activeDue : 2 * MAX_OVERDUE;
  return activeDue + Math.min(MAX_OVERDUE, gap / 2);
}

interface ChecklistStore {
  checklists: Checklist[];
  addChecklist: (name: string) => void;
  renameChecklist: (id: string, name: string) => void;
  setRole: (id: string, role: string) => void;
  setVisibility: (id: string, v: Visibility) => void;
  deleteChecklist: (id: string) => void;
  setDue: (id: string, due: string | null) => void;
  setSchedule: (id: string, slots: Slot[]) => void;
  resetChecklist: (id: string) => void;
  addItem: (id: string, text: string) => void;
  toggleItem: (id: string, itemId: string) => void;
  removeItem: (id: string, itemId: string) => void;
  /** Booth-side assignment: ownerId "" clears back to whole-team. */
  setItemOwner: (id: string, itemId: string, ownerId: string) => void;
  /** All items assigned to a crew user id, with their list context. */
  itemsFor: (ownerId: string) => { list: Checklist; item: ChItem }[];
  progress: (c: Checklist) => { done: number; total: number };
  dueAt: (c: Checklist) => number | null;
  recurrenceSummary: (c: Checklist) => string;
  isOverdue: (c: Checklist, now?: number) => boolean;
  overdue: (now?: number) => Checklist[];
}

const Ctx = createContext<ChecklistStore | null>(null);

// Last-known checklists, so an unreachable booth still shows the list a
// volunteer is working through rather than an empty screen.
const CACHE_KEY = "prodeck.checklistCache";
function readCache(): Checklist[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) && v.length > 0 ? (v as Checklist[]) : null;
  } catch {
    return null;
  }
}
function writeCache(list: Checklist[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch {
    /* best-effort */
  }
}

export function ChecklistProvider({ children }: { children: ReactNode }) {
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const loaded = useRef(false);
  const lastSaved = useRef("");

  useEffect(() => {
    (async () => {
      const raw = (await loadChecklists().catch(() => null)) as Checklist[] | null;
      // Fall back to the last copy this device saw. S11 promises the checklist
      // still works when the booth is unreachable, and without a cache that
      // promise was empty — there was nothing to render.
      const source =
        Array.isArray(raw) && raw.length > 0 ? raw : (readCache() ?? (raw as Checklist[] | null));
      const data: Checklist[] = Array.isArray(source)
        ? source.map((c) => ({
            ...c,
            due: c.due ?? null,
            activeDue: c.activeDue ?? null,
            schedule: Array.isArray(c.schedule) ? c.schedule : [],
          }))
        : [];
      setChecklists(data);
      if (Array.isArray(raw) && raw.length > 0) writeCache(data);
      lastSaved.current = JSON.stringify(data);
      loaded.current = true;
    })();
  }, []);

  useEffect(() => {
    // Booth-only: a phone saving its (possibly days-stale) copy of the whole
    // file over the booth's would silently lose edits. Phone check-offs are
    // session-local; the booth is the system of record.
    if (IS_WEB || !loaded.current) return;
    const json = JSON.stringify(checklists);
    if (json === lastSaved.current) return;
    const t = setTimeout(() => {
      lastSaved.current = json;
      saveChecklists(checklists as never).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [checklists]);

  // Recurrence engine: roll each recurring checklist forward to its current
  // occurrence, resetting the steps when an occurrence rolls over.
  useEffect(() => {
    const advance = () => {
      const now = Date.now();
      setChecklists((prev) => {
        let changed = false;
        const next = prev.map((c) => {
          if (!c.schedule || c.schedule.length === 0) return c;
          let activeDue = c.activeDue;
          let items = c.items;
          let mutated = false;
          if (activeDue == null) {
            activeDue = nextOccurrence(c.schedule, now);
            mutated = activeDue != null;
          }
          let guard = 0;
          while (activeDue != null && guard++ < 400) {
            if (now >= flipTime(activeDue, c.schedule)) {
              const after = nextOccurrence(c.schedule, activeDue);
              if (after == null) break;
              activeDue = after;
              items = items.map((it) => ({ ...it, done: false }));
              mutated = true;
              continue;
            }
            break;
          }
          if (!mutated) return c;
          changed = true;
          return { ...c, activeDue, items };
        });
        return changed ? next : prev;
      });
    };
    advance();
    const t = setInterval(advance, 30000);
    return () => clearInterval(t);
  }, []);

  const patch = (id: string, fn: (c: Checklist) => Checklist) =>
    setChecklists((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));

  const dueAt = (c: Checklist): number | null => {
    if (c.schedule && c.schedule.length > 0) return c.activeDue;
    if (!c.due) return null;
    const t = new Date(c.due).getTime();
    return Number.isNaN(t) ? null : t;
  };

  const isOverdue = (c: Checklist, now = Date.now()): boolean => {
    // Headers are never "done" — counting them here would leave any list that
    // has one permanently overdue, however many steps were actually ticked.
    const steps = c.items.filter((it) => !it.header);
    if (steps.length === 0) return false;
    const d = dueAt(c);
    return d != null && d <= now && steps.some((it) => !it.done);
  };

  const value: ChecklistStore = {
    checklists,
    addChecklist: (name) =>
      setChecklists((prev) => [
        ...prev,
        { id: uid(), name: name.trim() || "Checklist", items: [], due: null, schedule: [], activeDue: null },
      ]),
    renameChecklist: (id, name) => patch(id, (c) => ({ ...c, name: name.trim() || c.name })),
    setRole: (id, role) => patch(id, (c) => ({ ...c, role: role.trim() || undefined })),
    setVisibility: (id, v) =>
      patch(id, (c) => ({
        ...c,
        visibility: v,
        // Leaving "position" drops the tag: a stale position sitting behind an
        // "Everyone" list is how a list silently re-narrows later.
        role: v === "position" ? c.role : undefined,
      })),
    deleteChecklist: (id) => setChecklists((prev) => prev.filter((c) => c.id !== id)),
    setDue: (id, due) => patch(id, (c) => ({ ...c, due: due || null })),
    setSchedule: (id, slots) =>
      patch(id, (c) => ({
        ...c,
        schedule: slots,
        due: slots.length > 0 ? null : c.due,
        activeDue: slots.length > 0 ? nextOccurrence(slots, Date.now()) : null,
      })),
    resetChecklist: (id) =>
      patch(id, (c) => ({ ...c, items: c.items.map((it) => ({ ...it, done: false })) })),
    addItem: (id, text) =>
      patch(id, (c) => {
        let t = text.trim();
        if (!t) return c;
        // "# Title" or "Title:" authors a section header, not a step.
        const header = /^#\s*/.test(t) || /:$/.test(t);
        if (header) t = t.replace(/^#\s*/, "").replace(/:$/, "").trim();
        if (!t) return c;
        return {
          ...c,
          items: [
            ...c.items,
            { id: uid(), text: t, done: false, ...(header ? { header: true } : {}) },
          ],
        };
      }),
    // Web clients never persist the whole file (see the save effect below), so
    // an optimistic local flip on a phone silently vanished on reload and the
    // booth never learned. Browsers ask the booth to flip the single item and
    // reload from its answer; the desktop keeps the direct path.
    toggleItem: (id, itemId) => {
      // Headers are labels, not steps — nothing to flip.
      if (checklists.find((c) => c.id === id)?.items.find((i) => i.id === itemId)?.header)
        return;
      if (IS_WEB) {
        checklistToggle(id, itemId)
          .then(() =>
            patch(id, (c) => ({
              ...c,
              items: c.items.map((it) =>
                it.id === itemId ? { ...it, done: !it.done } : it,
              ),
            })),
          )
          .catch(() => {
            // Unreachable booth → queue it and reflect the tick locally. Safe
            // to show as done because the booth applies the flip on arrival;
            // if it refused for a real reason, the next load corrects us.
            enqueue({ kind: "checklist", listId: id, itemId });
            patch(id, (c) => ({
              ...c,
              items: c.items.map((it) =>
                it.id === itemId ? { ...it, done: !it.done } : it,
              ),
            }));
          });
        return;
      }
      patch(id, (c) => ({
        ...c,
        items: c.items.map((it) => (it.id === itemId ? { ...it, done: !it.done } : it)),
      }));
    },
    removeItem: (id, itemId) =>
      patch(id, (c) => ({ ...c, items: c.items.filter((it) => it.id !== itemId) })),
    setItemOwner: (id, itemId, ownerId) =>
      patch(id, (c) => ({
        ...c,
        items: c.items.map((it) =>
          it.id === itemId ? { ...it, owner: ownerId || undefined } : it,
        ),
      })),
    itemsFor: (ownerId) =>
      ownerId
        ? checklists.flatMap((list) =>
            list.items.filter((it) => it.owner === ownerId).map((item) => ({ list, item })),
          )
        : [],
    progress: (c) => {
      const steps = c.items.filter((it) => !it.header);
      return { done: steps.filter((it) => it.done).length, total: steps.length };
    },
    dueAt,
    recurrenceSummary: (c) =>
      c.schedule && c.schedule.length > 0
        ? "Weekly · " +
          [...c.schedule]
            .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time))
            .map((s) => `${DAY_NAMES[s.day]} ${s.time}`)
            .join(", ")
        : "",
    isOverdue,
    overdue: (now = Date.now()) => checklists.filter((c) => isOverdue(c, now)),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChecklists(): ChecklistStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChecklists must be used within ChecklistProvider");
  return ctx;
}
