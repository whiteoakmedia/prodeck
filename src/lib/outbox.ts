import { IS_WEB, checkinSet, checklistToggle, onGatewayState } from "./tauri";

// Offline queue for the two things a volunteer does with their thumbs when the
// booth is unreachable: ticking a checklist item and checking in.
//
// Deliberately narrow. Page acknowledgements are NOT queued — the design is
// explicit that a confirm which never reached the booth must not show as read,
// and a queued ack would be exactly that lie told to the person who sent it.
// Chat isn't queued either: a message that silently arrives twenty minutes late
// mid-service is worse than one that visibly failed.
//
// Check-in is safe to queue because the booth keeps the FIRST timestamp, so a
// replay can never move someone's arrival later. Checklist toggles are safe
// because the booth applies the flip to its own copy on arrival.

const KEY = "prodeck.outbox";

// Split so the queued shape and the caller's shape stay in step; Omit<> over a
// union collapses it to the common keys, which loses the discriminated fields.
type NewEntry =
  | { kind: "checklist"; listId: string; itemId: string }
  | { kind: "checkin"; session: string; serviceKey: string };
type Entry = NewEntry & { at: number };

function read(): Entry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Entry[]) : [];
  } catch {
    return [];
  }
}

function write(list: Entry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full / private mode — the queue is best-effort */
  }
}

export function queueSize(): number {
  return read().length;
}

export function enqueue(entry: NewEntry) {
  const list = read();
  // A toggle queued twice for the same item would flip it back — collapse to
  // the latest intent rather than replaying both.
  const deduped =
    entry.kind === "checklist"
      ? list.filter(
          (e) => !(e.kind === "checklist" && e.listId === entry.listId && e.itemId === entry.itemId),
        )
      : list.filter((e) => e.kind !== "checkin");
  write([...deduped, { ...entry, at: Date.now() }]);
}

let flushing = false;

/** Send everything queued. Anything that fails stays queued for the next try. */
export async function flush(): Promise<number> {
  if (flushing || !IS_WEB) return 0;
  const list = read();
  if (list.length === 0) return 0;
  flushing = true;
  const kept: Entry[] = [];
  let sent = 0;
  for (const e of list) {
    try {
      if (e.kind === "checklist") await checklistToggle(e.listId, e.itemId);
      else await checkinSet(e.session, e.serviceKey);
      sent++;
    } catch {
      kept.push(e); // still offline, or the booth refused — try again later
    }
  }
  write(kept);
  flushing = false;
  if (sent > 0 && typeof window !== "undefined")
    window.dispatchEvent(new Event("prodeck-outbox-flushed"));
  return sent;
}

/** Flush whenever the booth becomes reachable again. Call once at startup. */
export function startOutbox() {
  if (!IS_WEB) return;
  onGatewayState((up) => {
    if (up) flush();
  });
}
