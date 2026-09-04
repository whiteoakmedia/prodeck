import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  checkinList,
  getSettings,
  IS_WEB,
  identityList,
  loadSchedules,
  on,
  saveSchedules,
  type CrewUser,
  type Json,
} from "./lib/tauri";
import { usePages } from "./pagesStore";
import { usePco, type TeamMember , isDeclined } from "./pcoStore";

// Scheduled alerts — fire a real page at a set time, so it takes the screen,
// pushes to a locked phone, and comes back with read receipts.
//
// The schedule is EVALUATED ON THE BOOTH ONLY (`!IS_WEB`). Every phone runs this
// same code, and if they all evaluated it, one scheduled alert would fire once
// per open phone. The booth is also the only machine guaranteed to be running.
//
// "T-30" is relative to the Planning Center service start, which is why this
// lives in the frontend at all: the backend has no idea when the service is.
//
// Firing is recorded per service occurrence, so an alert fires once for the
// 9:30 service and again next week — but never twice for the same one, even
// across a ProDeck restart.

export interface ScheduledAlert {
  id: string;
  label: string;
  body: string;
  /** "clock" = a wall time like 09:45; "relative" = minutes before the service. */
  kind: "clock" | "relative";
  /** HH:MM for clock alerts. */
  at: string;
  /** Minutes BEFORE the service start for relative alerts (30 = T-30). */
  beforeMin: number;
  /** Empty = everyone. Otherwise crew user ids. */
  recipients: string[];
  /** PCO service type this belongs to ("Sunday Morning", "Youth"). Empty = any.
   *  This is what makes one alert a Sunday alert and another a Wednesday one. */
  serviceTypeId: string;
  /** Local weekdays it may fire on (0=Sun … 6=Sat). Empty = any day. */
  days: number[];
  /** Address a PCO team by name instead of hand-picking crew, so the alert
   *  follows whoever is rostered that week. Empty = use `recipients`. */
  team: string;
  buzz: boolean;
  enabled: boolean;
  /** Service keys this alert has already fired for. */
  firedFor: string[];
}

interface ScheduleStore {
  alerts: ScheduledAlert[];
  add: () => void;
  update: (id: string, patch: Partial<ScheduledAlert>) => void;
  remove: (id: string) => void;
  /** Human summary of when the next fire is due, for the UI. */
  nextFire: (a: ScheduledAlert) => string;
  /** Who this alert would page right now, and why it can't fire if it can't. */
  resolve: (a: ScheduledAlert) => { ids: string[]; problem: string | null };
}

const Ctx = createContext<ScheduleStore | null>(null);

const uid = () => Math.random().toString(36).slice(2, 10);


const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Who an alert actually pages, resolved at fire time.
 *
 *  A page with an EMPTY recipient list means "everyone" to the booth. So when
 *  an alert names a team that resolves to nobody, this must report a problem
 *  rather than return []: falling through would silently page the entire crew,
 *  which is the worst possible failure for an automated 7am message.
 */
export function resolveRecipients(
  a: Pick<ScheduledAlert, "team" | "recipients">,
  pcoTeam: Pick<TeamMember, "name" | "team" | "status">[],
  crew: Pick<CrewUser, "id" | "name" | "approved" | "pco_name">[],
): { ids: string[]; problem: string | null } {
  if (!a.team.trim()) return { ids: a.recipients, problem: null };
  const want = norm(a.team);
  const serving = pcoTeam.filter(
    (m) => norm(m.team) === want && !isDeclined(m.status),
  );
  if (serving.length === 0)
    return { ids: [], problem: `nobody from ${a.team} is on this plan` };
  // Healed PCO spelling first: a "Joshua" signup whose account healed to
  // "Joshua Gorneault" must match his plan row, same as the call-time nudge.
  const byName = new Map(
    crew
      .filter((u) => u.approved)
      .flatMap((u) => {
        const keys = [norm(u.name)];
        if (u.pco_name) keys.push(norm(u.pco_name));
        return keys.map((k) => [k, u.id] as [string, string]);
      }),
  );
  const ids = [
    ...new Set(serving.map((m) => byName.get(norm(m.name))).filter((x): x is string => !!x)),
  ];
  if (ids.length === 0)
    return { ids: [], problem: `nobody from ${a.team} has a ProDeck account yet` };
  return { ids, problem: null };
}

/** Fill in fields added after an alert was first saved. Without this, alerts
 *  written before service-type targeting existed have no `days` array and the
 *  scheduler throws on `a.days.length` — killing every alert, not just the old
 *  one. */
export function migrate(a: Partial<ScheduledAlert>): ScheduledAlert {
  return {
    ...(a as ScheduledAlert),
    recipients: a.recipients ?? [],
    firedFor: a.firedFor ?? [],
    serviceTypeId: a.serviceTypeId ?? "",
    days: a.days ?? [],
    team: a.team ?? "",
  };
}

/** Whether the calendar lets this alert fire today, for this service. */
export function matchesOccasion(
  a: Pick<ScheduledAlert, "serviceTypeId" | "days">,
  serviceTypeId: string,
  now: Date,
): boolean {
  if (a.serviceTypeId && a.serviceTypeId !== serviceTypeId) return false;
  if (a.days.length > 0 && !a.days.includes(now.getDay())) return false;
  return true;
}

/** Epoch ms this alert is due, for the currently-selected service. */
function dueAt(a: ScheduledAlert, serviceStart: number): number | null {
  if (a.kind === "relative") {
    if (!serviceStart) return null; // no service time → nothing to be relative to
    return serviceStart - a.beforeMin * 60_000;
  }
  const [h, m] = a.at.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function ScheduleProvider({ children }: { children: ReactNode }) {
  const [alerts, setAlerts] = useState<ScheduledAlert[]>([]);
  const { send } = usePages();
  const pco = usePco();
  const loaded = useRef(false);
  const alertsRef = useRef<ScheduledAlert[]>([]);
  alertsRef.current = alerts;
  const startRef = useRef(0);
  startRef.current =
    pco.serviceTimes.find((t) => t.id === pco.selectedServiceTimeId)?.ts ?? 0;
  const [crew, setCrew] = useState<CrewUser[]>([]);
  const crewRef = useRef<CrewUser[]>([]);
  crewRef.current = crew;
  const teamRef = useRef<TeamMember[]>([]);
  teamRef.current = pco.team;
  const stRef = useRef("");
  stRef.current = pco.selectedServiceTypeId ?? "";
  const keyRef = useRef("");
  keyRef.current = `${pco.selectedPlanId ?? ""}::${pco.selectedServiceTimeId ?? ""}`;
  const sendRef = useRef(send);
  sendRef.current = send;

  // The crew roster, for mapping PCO names onto ProDeck accounts.
  useEffect(() => {
    if (IS_WEB) return;
    const load = () => identityList().then(setCrew).catch(() => {});
    load();
    const un = on("identity:changed", load);
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    loadSchedules()
      .then((d) => {
        if (Array.isArray(d)) setAlerts((d as unknown as Partial<ScheduledAlert>[]).map(migrate));
        loaded.current = true;
      })
      .catch(() => {
        // Same rule as everywhere else: a failed read must not be persisted
        // over. Leave the store empty and don't save.
      });
  }, []);

  function persist(next: ScheduledAlert[]) {
    setAlerts(next);
    if (!IS_WEB && loaded.current) saveSchedules(next as unknown as Json).catch(() => {});
  }

  // The scheduler. Booth-only, ticks every 20s — fine for minute-resolution
  // alerts and cheap enough to ignore.
  useEffect(() => {
    if (IS_WEB) return;
    const tick = async () => {
      if (!loaded.current) return;
      const now = Date.now();
      const key = keyRef.current;
      // One arrival-sheet read per tick: team alerts page only people IN THE
      // BUILDING, so firing decisions need it up front — marking an alert
      // fired first and filtering later would eat the retry window.
      const sheet = await checkinList("").catch(() => null);
      const arrived: Set<string> | null = sheet
        ? new Set(Object.keys((sheet as any).at ?? {}))
        : null;
      let changed = false;
      const next = alertsRef.current.map((a) => {
        if (!a.enabled || a.firedFor.includes(key)) return a;
        // Wrong service type or wrong day of the week — not this alert's turn.
        if (!matchesOccasion(a, stRef.current, new Date())) return a;
        const due = dueAt(a, startRef.current);
        if (due === null || now < due) return a;
        // Don't fire an alert we've only just discovered was long overdue —
        // starting ProDeck at 11am must not replay the morning's alerts.
        if (now - due > 10 * 60_000) return a;
        const { ids, problem } = resolveRecipients(a, teamRef.current, crewRef.current);
        // Unresolvable → skip WITHOUT marking it fired. Better to miss a page
        // than to send one to everybody; the overdue guard above stops this
        // retrying forever.
        if (problem) return a;
        // Team alerts are gather calls ("report to the booth") — they go only
        // to people IN THE BUILDING. Hand-picked recipient lists stay as
        // chosen. The call-time nudge below is the deliberate opposite: it
        // pages exactly the people who are NOT here yet.
        let to = ids;
        if (a.team.trim()) {
          // Sheet unreadable → don't fire and don't mark fired; the
          // 10-minute overdue window retries on the next tick.
          if (arrived === null) return a;
          to = ids.filter((id) => arrived.has(id));
        }
        // Empty after filtering = nobody from the team is here. Mark fired
        // without sending — a gather call with no one to gather is done, and
        // it must not go out to the whole team at home instead.
        if (to.length > 0) {
          sendRef.current(a.body || a.label, to, a.buzz).catch(() => {});
        }
        changed = true;
        return { ...a, firedFor: [...a.firedFor, key] };
      });
      if (changed) persist(next);
    };
    const iv = setInterval(tick, 20_000);
    tick();
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // CALL-TIME CHECK-IN NUDGE (Settings → Auto check-in). At each per-position
  // call time (PCO Setup → "Check-in times"), page exactly the people of those
  // positions who HAVEN'T checked in yet — auto check-in usually beats this,
  // so most Sundays it pages nobody. Booth-only like the scheduler above;
  // fires once per (day, time slot) regardless of how many services follow,
  // because a call time is an arrival, not a per-service event.
  const checkinTimesRef = useRef<Record<string, string>>({});
  checkinTimesRef.current = pco.checkinTimes;
  useEffect(() => {
    if (IS_WEB) return;
    const FIRED_KEY = "prodeck.nudgeFired";
    const roleHits = (role: string, pos: string) => {
      const r = role.trim().toLowerCase();
      const p = pos.trim().toLowerCase();
      return !!r && !!p && (r === p || r.startsWith(p) || p.startsWith(r));
    };
    const tick = async () => {
      const start = startRef.current;
      if (!start) return;
      const now = Date.now();
      // Only on the service's own calendar day — the booth being on at 7am
      // Thursday must not page anyone about Sunday's call.
      if (new Date(start).toDateString() !== new Date(now).toDateString()) return;
      const s = await getSettings().catch(() => null);
      if (!s?.checkin_nudge) return;
      // Group positions sharing a call time into one page.
      const slots = new Map<string, string[]>();
      for (const [pos, hhmm] of Object.entries(checkinTimesRef.current)) {
        if (!/^\d{1,2}:\d{2}$/.test(hhmm)) continue;
        slots.set(hhmm, [...(slots.get(hhmm) ?? []), pos]);
      }
      if (slots.size === 0) return;
      const fired: Record<string, number> = JSON.parse(
        localStorage.getItem(FIRED_KEY) ?? "{}",
      );
      const day = new Date(start).toDateString();
      // People already nudged today — a role like "Camera Team Lead" can
      // loosely match positions in TWO slots, and one 7am buzz is plenty
      // (audit finding).
      const pagedKey = `${day}::paged`;
      const paged = new Set<string>(JSON.parse(localStorage.getItem(FIRED_KEY + ".ids") ?? "{}")[pagedKey] ?? []);
      // Only people ON THIS WEEK'S PLAN: a standing role must not buzz an
      // off-rotation volunteer at 7am (audit finding). Matching uses the
      // healed PCO spelling when present.
      const normN = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
      const scheduled = new Set(
        teamRef.current
          .filter((m) => !isDeclined(m.status))
          .map((m) => normN(m.name)),
      );
      let firedChanged = false;
      for (const [hhmm, positions] of slots) {
        const [h, m] = hhmm.split(":").map(Number);
        const d = new Date(start);
        d.setHours(h, m, 0, 0);
        const due = d.getTime();
        const key = `${day}::${hhmm}`;
        if (now < due || now - due > 10 * 60_000 || fired[key]) continue;
        // The arrival sheet is the whole point — if it can't be read, do
        // NOTHING (don't page people who may be in, don't mark fired; the
        // 10-minute window retries).
        const sheet = await checkinList("").catch(() => null);
        if (!sheet) continue;
        const arrived = new Set(Object.keys(sheet.at ?? {}));
        const ids = crewRef.current
          .filter(
            (u) =>
              u.approved &&
              !arrived.has(u.id) &&
              !paged.has(u.id) &&
              scheduled.has(normN(u.pco_name || u.name)) &&
              positions.some((p) => roleHits(u.role ?? "", p)),
          )
          .map((u) => u.id);
        if (ids.length > 0) {
          const label = new Date(due).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          });
          sendRef.current(
            `Call time (${label}) — open ProDeck to check in`,
            ids,
            true,
          ).catch(() => {});
          ids.forEach((id) => paged.add(id));
        }
        // Marked fired either way: everyone already in = success, and nobody
        // matching = nothing that will change within the 10-minute window.
        fired[key] = now;
        firedChanged = true;
      }
      if (firedChanged) {
        // Keep only this week's marks; the map would otherwise grow forever.
        for (const k of Object.keys(fired)) {
          if (now - fired[k] > 7 * 24 * 3600_000) delete fired[k];
        }
        localStorage.setItem(FIRED_KEY, JSON.stringify(fired));
        localStorage.setItem(FIRED_KEY + ".ids", JSON.stringify({ [pagedKey]: [...paged] }));
      }
    };
    const iv = setInterval(tick, 30_000);
    tick();
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resolve(a: ScheduledAlert) {
    return resolveRecipients(a, teamRef.current, crewRef.current);
  }

  function nextFire(a: ScheduledAlert): string {
    if (!matchesOccasion(a, stRef.current, new Date()))
      return "not scheduled for today's service";
    const problem = resolve(a).problem;
    if (problem) return `won't fire — ${problem}`;
    const due = dueAt(a, startRef.current);
    if (due === null)
      return a.kind === "relative" ? "no service time selected" : "invalid time";
    if (a.firedFor.includes(keyRef.current)) return "already fired for this service";
    const mins = Math.round((due - Date.now()) / 60000);
    const when = new Date(due).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return mins >= 0 ? `fires ${when} (in ${mins} min)` : `${when} — passed`;
  }

  return (
    <Ctx.Provider
      value={{
        alerts,
        add: () =>
          persist([
            ...alerts,
            {
              id: uid(),
              label: "New alert",
              body: "",
              kind: "relative",
              at: "09:45",
              beforeMin: 30,
              recipients: [],
              serviceTypeId: "",
              days: [],
              team: "",
              buzz: true,
              enabled: false,
              firedFor: [],
            },
          ]),
        update: (id, patch) =>
          persist(
            alerts.map((a) =>
              a.id === id
                ? // Editing an alert clears its fired record, so a corrected
                  // time can still fire for the service you're setting it up for.
                  { ...a, ...patch, firedFor: patch.firedFor ?? [] }
                : a,
            ),
          ),
        remove: (id) => persist(alerts.filter((a) => a.id !== id)),
        nextFire,
        resolve,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSchedules(): ScheduleStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSchedules must be used within ScheduleProvider");
  return ctx;
}
