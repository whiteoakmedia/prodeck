import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useProDeck } from "./store";
import { usePco } from "./pcoStore";
import { IS_WEB, loadTracking, saveTracking } from "./lib/tauri";
import { toDbfs } from "./lib/audioMeter";

interface ItemStat {
  title: string;
  type: string;
  planned: number; // seconds
  actual: number; // accumulated seconds
  splPeak: number; // dB SPL
  splSum: number;
  splCount: number;
  startedAt: number | null; // ms epoch while currently live
}

export interface TrackedItem {
  itemId: string;
  title: string;
  type: string;
  planned: number;
  actual: number;
  splPeak: number;
  splAvg: number;
  live: boolean;
  tracked: boolean;
}

// Per-service metadata, stored alongside the item stats so a saved service can
// be labelled (date / plan / service time) long after the plan is unloaded.
interface ServiceMeta {
  planId: string;
  timeId: string;
  planTitle: string | null;
  planDate: string | null;
  timeName: string | null;
  rehearsal?: boolean;
  savedAt: number;
  /// Stamped on each periodic save while an item is running, so a quit/crash
  /// mid-item can be banked up to the last known moment at next load.
  heartbeatAt?: number;
  /// Wall-clock window this service actually occupied: first item going live
  /// to last activity. `savedAt` is rewritten on every item change, so it is
  /// the time of the last edit, NOT when the service ran — reports and the
  /// per-service tap query both need the real window.
  startedAt?: number;
  endedAt?: number;
  /// The WHOLE plan as it stood during this service, not just the items that
  /// went live. Item stats are only created when an item goes live, so without
  /// this a service where one song ran reported a one-line plan. Kept per
  /// bucket (not looked up from PCO later) so a past service still renders its
  /// real running order after the plan is edited or the week rolls over.
  plan?: PlanSnapshotItem[];
}

export interface PlanSnapshotItem {
  id: string;
  title: string;
  type: string;
  length: number;
}

// A past service, reconstructed entirely from stored data (no live PCO sync
// needed) so historical analytics survive switching weeks.
export interface ServiceHistory {
  key: string;
  planDate: string | null;
  planTitle: string | null;
  timeName: string | null;
  rehearsal: boolean;
  savedAt: number;
  /// Real wall-clock window (absent on buckets recorded before this existed).
  startedAt?: number;
  endedAt?: number;
  rows: TrackedItem[];
}

const META = "_meta"; // reserved bucket key holding ServiceMeta (never an item id)

// Longest continuous stretch we'll credit to a single item. Nothing in a service
// legitimately runs this long, so a bigger gap means the app simply sat on a live
// item (left open overnight, operator walked away). Without this a single
// forgotten item silently turns into a 40-hour "actual" and ruins the report.
const MAX_STRETCH_S = 2 * 3600;

// How close to the scheduled start still counts as the service itself. Pre-service
// slides / countdown legitimately roll ~10 min out, so only work earlier than this
// is treated as rehearsal.
const REHEARSAL_GRACE_MS = 15 * 60 * 1000;

const clampStretch = (sec: number) => Math.min(Math.max(0, sec), MAX_STRETCH_S);

// Close out a running stretch, clamped so idle time can't inflate the item.
function finalizeStretch(st: ItemStat, now: number) {
  if (st.startedAt == null) return;
  st.actual += clampStretch((now - st.startedAt) / 1000);
  st.startedAt = null;
}

type Data = Record<string, Record<string, ItemStat>>; // planKey -> itemId -> stat

// Build report rows from a bucket's OWN stored data (independent of the
// currently-synced plan), so any past service renders correctly.
//
// Driven by the plan snapshot when there is one, so the report covers the FULL
// running order — items that never ran included, marked untracked — instead of
// only whatever went live.
function bucketRows(bucket: Record<string, ItemStat>): TrackedItem[] {
  const meta = (bucket as Record<string, unknown>)[META] as ServiceMeta | undefined;
  const stats = Object.entries(bucket).filter(([k]) => k !== META);
  const byId = new Map(stats);
  const row = (itemId: string, title: string, type: string, planned: number, s?: ItemStat) => ({
    itemId,
    title,
    type,
    planned,
    actual: s?.actual ?? 0,
    splPeak: s && s.splCount ? s.splPeak : -100,
    splAvg: s && s.splCount ? s.splSum / s.splCount : -100,
    live: false,
    tracked: !!s && s.actual > 0,
  });

  const rows: TrackedItem[] = [];
  const seen = new Set<string>();
  for (const p of meta?.plan ?? []) {
    seen.add(p.id);
    if (p.type === "header") continue;
    rows.push(row(p.id, p.title, p.type, p.length, byId.get(p.id)));
  }
  // Anything tracked that the snapshot doesn't cover still has to appear: a
  // plan edited mid-service, and every bucket recorded before snapshots existed
  // (which is all of the older ones — they fall through to exactly the old
  // behaviour of listing only what ran).
  for (const [itemId, s] of stats) {
    if (seen.has(itemId) || s.type === "header") continue;
    rows.push(row(itemId, s.title, s.type, s.planned, s));
  }
  return rows;
}

interface TrackingStore {
  rows: TrackedItem[];
  currentKey: string | null;
  /// Non-null when tracking.json couldn't be read this session. While set,
  /// nothing is persisted — surfaced in the UI so the operator knows the
  /// service is NOT being recorded rather than finding out afterwards.
  loadError: string | null;
  // Whether what's being tracked right now counts as a rehearsal (kept out of
  // the service's own numbers). `setRehearsal(null)` returns to deciding by the
  // scheduled service time.
  rehearsal: boolean;
  rehearsalAuto: boolean;
  setRehearsal: (v: boolean | null) => void;
  resetPlan: () => void;
  serviceRows: (timeId: string) => TrackedItem[];
  history: () => ServiceHistory[];
}

const Ctx = createContext<TrackingStore | null>(null);

export function TrackingProvider({ children }: { children: ReactNode }) {
  const { audioLevel, audioPeak, audioRunning, splCalibration } = useProDeck();
  const { liveItemId, items, selectedPlanId, selectedServiceTimeId, plans, serviceTimes } =
    usePco();
  // Rehearsal vs. the real service. Running the plan before the service's
  // scheduled start (Thursday practice, Sunday pre-service run-through) is a
  // rehearsal, and must never land in the numbers reported for the service
  // itself — so it gets its own bucket. `rehearsalOverride` lets the operator
  // force either way for the cases the clock can't know about (a run-through
  // between services, or a plan with no scheduled time set in PCO).
  const [rehearsalOverride, setRehearsalOverride] = useState<boolean | null>(null);
  // A manual Rehearsal/Service override is scoped to the service it was set
  // for: when the selected service time or plan changes (including the
  // auto-advance to the next service), return to deciding by the clock — a
  // toggle left on from Saturday practice must not misfile Sunday's service.
  useEffect(() => {
    setRehearsalOverride(null);
  }, [selectedPlanId, selectedServiceTimeId]);
  const startTs = serviceTimes.find((t) => t.id === selectedServiceTimeId)?.ts ?? 0;
  const autoRehearsal = startTs > 0 && Date.now() < startTs - REHEARSAL_GRACE_MS;
  const rehearsal = rehearsalOverride ?? autoRehearsal;

  // Analytics are bucketed per plan + service time (4 services on a Sunday → 4
  // independent buckets keyed "planId::timeId"), with rehearsals kept in their
  // own sibling bucket so they never mix into a service's reported numbers.
  const trackKey = selectedPlanId
    ? `${selectedPlanId}::${selectedServiceTimeId ?? "default"}${rehearsal ? "::rehearsal" : ""}`
    : null;

  const dataRef = useRef<Data>({});
  const lastLive = useRef<string | null>(null);
  const loaded = useRef(false);
  // Set when tracking.json exists but couldn't be read. Persistence stays off
  // for the whole session in that case, so nothing overwrites recoverable data.
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastSaved = useRef("");
  const [, force] = useState(0);
  // Bumped when the stored data finishes loading (and by resetPlan) so the
  // live-item effect re-runs against the real data — registration is gated on
  // `loaded`, else an early pco:live event's stat would be wiped by the load.
  const [loadTick, setLoadTick] = useState(0);

  // Refs so the sampling interval always reads the latest values.
  const keyRef = useRef<string | null>(null);
  keyRef.current = trackKey;
  const prevKeyRef = useRef<string | null>(null);
  const liveRef = useRef<string | null>(null);
  liveRef.current = liveItemId;
  const levelRef = useRef(0);
  levelRef.current = audioLevel;
  const peakRef = useRef(0);
  peakRef.current = audioPeak;
  const runningRef = useRef(false);
  runningRef.current = audioRunning;
  const calRef = useRef(100);
  calRef.current = splCalibration;
  // Current plan/time labels, mirrored so the live-item effect can stamp them
  // onto the bucket's metadata for later historical display.
  const metaRef = useRef<{ title: string | null; date: string | null; timeName: string | null }>({
    title: null,
    date: null,
    timeName: null,
  });
  const curPlan = plans.find((p) => p.id === selectedPlanId);
  metaRef.current = {
    title: curPlan?.title ?? null,
    date: curPlan?.date ?? null,
    timeName: serviceTimes.find((t) => t.id === selectedServiceTimeId)?.name ?? null,
  };

  useEffect(() => {
    (async () => {
      // A rejected load means the file exists but could not be read or parsed.
      // Treating that as "no data" is what silently destroyed history: the
      // store started empty and the 4-second autosave wrote that emptiness
      // straight back over the real file. Refuse to persist instead, and say
      // so loudly — the data on disk is still there to be recovered.
      let d: Data | null = null;
      try {
        d = (await loadTracking()) as Data | null;
      } catch (e) {
        setLoadError(String(e));
        loaded.current = false;
        force((x) => x + 1);
        return;
      }
      if (d && typeof d === "object") dataRef.current = d;
      // Snapshot BEFORE the cleanup below, so clearing a stale flag counts as a
      // change and gets written back — otherwise the file would keep the stale
      // value forever even though memory is correct.
      lastSaved.current = JSON.stringify(dataRef.current);
      // Close out any stretch still marked running from a previous session (the
      // app quit or crashed mid-item). Bank it up to the bucket's last saved
      // heartbeat — the best truth we have — so e.g. the sermon that was live
      // at quit keeps its time instead of reading ~0. Without a heartbeat
      // (legacy data) the unknowable tail is dropped rather than inflated.
      for (const bucket of Object.values(dataRef.current)) {
        const hb = ((bucket as Record<string, unknown>)[META] as ServiceMeta | undefined)
          ?.heartbeatAt;
        for (const [k, st] of Object.entries(bucket)) {
          if (k !== META && st && typeof st === "object" && st.startedAt != null) {
            if (hb && hb > st.startedAt) {
              st.actual += clampStretch((hb - st.startedAt) / 1000);
            }
            st.startedAt = null;
          }
        }
      }
      loaded.current = true;
      setLoadTick((t) => t + 1);
      force((x) => x + 1);
    })();
  }, []);

  // Live item changed → finalize the previous item, start the new one.
  useEffect(() => {
    // Wait for the stored data: registering into the pre-load object would be
    // silently discarded when the load replaces it (losing the item's first
    // stretch and SPL until the next item change).
    if (!loaded.current) return;
    const key = trackKey;
    // Bucket switched (service time / rehearsal flip / plan change — INCLUDING
    // to "no plan"): finalize the previous bucket's running item first, so its
    // stretch can't keep accumulating while nothing is selected.
    if (prevKeyRef.current !== key) {
      const oldKey = prevKeyRef.current;
      if (oldKey && lastLive.current) {
        const st = dataRef.current[oldKey]?.[lastLive.current];
        if (st) finalizeStretch(st, Date.now());
      }
      prevKeyRef.current = key;
      lastLive.current = null;
    }
    if (!key) return;
    if (lastLive.current === liveItemId) return;
    const now = Date.now();
    const planData = (dataRef.current[key] ??= {});
    // Refresh this bucket's metadata so it can be labelled in history. MERGED,
    // not replaced: startedAt must survive every later item change, since it's
    // the only record of when this service actually began.
    const prevMeta = (planData as Record<string, unknown>)[META] as ServiceMeta | undefined;
    (planData as Record<string, unknown>)[META] = {
      ...prevMeta,
      planId: selectedPlanId ?? "",
      timeId: selectedServiceTimeId ?? "default",
      planTitle: metaRef.current.title,
      planDate: metaRef.current.date,
      timeName: metaRef.current.timeName,
      rehearsal,
      savedAt: now,
      startedAt: prevMeta?.startedAt ?? now,
      endedAt: now,
    } satisfies ServiceMeta;
    const prev = lastLive.current;
    if (prev && planData[prev]) finalizeStretch(planData[prev], now);
    if (liveItemId) {
      const it = items.find((i) => i.id === liveItemId);
      const existing = planData[liveItemId];
      if (existing) {
        existing.startedAt = now;
        if (it) {
          existing.planned = it.length;
          existing.title = it.title;
        }
      } else {
        planData[liveItemId] = {
          title: it?.title ?? "Item",
          type: it?.type ?? "item",
          planned: it?.length ?? 0,
          actual: 0,
          splPeak: -100,
          splSum: 0,
          splCount: 0,
          startedAt: now,
        };
      }
    }
    lastLive.current = liveItemId;
    force((x) => x + 1);
  }, [liveItemId, trackKey, items, loadTick]);

  // Keep each active bucket's plan snapshot current — including edits made to
  // the plan mid-service. Deliberately only writes into buckets that ALREADY
  // exist: creating one here would put every plan you merely *select* into the
  // report history, even if the service never ran.
  useEffect(() => {
    if (!loaded.current || !trackKey || items.length === 0) return;
    const bucket = dataRef.current[trackKey];
    if (!bucket) return;
    const snapshot: PlanSnapshotItem[] = items.map((i) => ({
      id: i.id,
      title: i.title,
      type: i.type,
      length: i.length,
    }));
    const meta = ((bucket as Record<string, unknown>)[META] ??= {}) as ServiceMeta;
    if (JSON.stringify(meta.plan) !== JSON.stringify(snapshot)) {
      meta.plan = snapshot;
      force((x) => x + 1);
    }
  }, [items, trackKey, loadTick]);

  // Sample SPL into the live item + tick the display.
  useEffect(() => {
    const iv = setInterval(() => {
      const key = keyRef.current;
      const live = liveRef.current;
      if (key && live) {
        const stat = dataRef.current[key]?.[live];
        if (stat && stat.startedAt != null && runningRef.current && levelRef.current > 0) {
          // Floored, so a near-silent input (a lone dither LSB reads ~−140 dBFS)
          // can't drag an item's average SPL far below the meter's own floor.
          const db = toDbfs(levelRef.current) + calRef.current;
          const peakDb = toDbfs(Math.max(levelRef.current, peakRef.current)) + calRef.current;
          if (peakDb > stat.splPeak) stat.splPeak = peakDb;
          stat.splSum += db;
          stat.splCount += 1;
        }
      }
      force((x) => x + 1);
    }, 300);
    return () => clearInterval(iv);
  }, []);

  // Persist at most every few seconds when changed. Booth-only: browser
  // clients are viewers — each one saving its own divergent copy clobbered the
  // booth's real analytics (the gateway also rejects the write now).
  useEffect(() => {
    if (IS_WEB) return;
    const iv = setInterval(() => {
      // `loaded` stays false after a failed read — never write over data we
      // couldn't parse, or the only remaining copy is the .bak file.
      if (!loaded.current) return;
      // Heartbeat: while an item is running, stamp the bucket so a quit/crash
      // can be banked up to this moment at the next load.
      const key = keyRef.current;
      const bucket = key ? dataRef.current[key] : undefined;
      if (bucket) {
        const running = Object.entries(bucket).some(
          ([k, st]) => k !== META && (st as ItemStat)?.startedAt != null,
        );
        if (running) {
          const meta = ((bucket as Record<string, unknown>)[META] ??= {}) as ServiceMeta;
          const now = Date.now();
          meta.heartbeatAt = now;
          // Extend the service window while an item is still running, so a long
          // closing item isn't cut off the report (and its taps aren't lost).
          meta.startedAt ??= now;
          meta.endedAt = now;
        }
      }
      const json = JSON.stringify(dataRef.current);
      if (json !== lastSaved.current) {
        lastSaved.current = json;
        saveTracking(dataRef.current).catch(() => {});
      }
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  const now = Date.now();
  const computeRows = (bucket: Record<string, ItemStat>): TrackedItem[] =>
    items
      .filter((i) => i.type !== "header")
      .map((i) => {
        const s = bucket[i.id];
        const live = i.id === liveItemId;
        const actual = s
          ? s.actual +
            (live && s.startedAt != null ? clampStretch((now - s.startedAt) / 1000) : 0)
          : 0;
        return {
          itemId: i.id,
          title: i.title,
          type: i.type,
          planned: i.length,
          actual,
          splPeak: s && s.splCount ? s.splPeak : -100,
          splAvg: s && s.splCount ? s.splSum / s.splCount : -100,
          live,
          tracked: !!s && (s.actual > 0 || s.startedAt != null),
        };
      });

  const rows = trackKey ? computeRows(dataRef.current[trackKey] ?? {}) : [];

  // Rows for a specific service time of the current plan (used by the report).
  function serviceRows(timeId: string): TrackedItem[] {
    const k = selectedPlanId ? `${selectedPlanId}::${timeId}` : null;
    return k ? computeRows(dataRef.current[k] ?? {}) : [];
  }

  function resetPlan() {
    if (trackKey) {
      delete dataRef.current[trackKey];
      lastLive.current = null;
      prevKeyRef.current = null;
      // Re-run the registration effect so the currently-live item starts
      // tracking again immediately (not after the next ≤30s items poll).
      setLoadTick((t) => t + 1);
      force((x) => x + 1);
    }
  }

  // Every saved service (current week + all past weeks), newest first, each
  // reconstructed from its own stored data so it renders without a live sync.
  function history(): ServiceHistory[] {
    const out: ServiceHistory[] = [];
    for (const [key, bucket] of Object.entries(dataRef.current)) {
      const rows = bucketRows(bucket).filter((r) => r.actual > 0 || r.planned > 0);
      if (rows.length === 0) continue;
      const meta = (bucket as Record<string, unknown>)[META] as ServiceMeta | undefined;
      out.push({
        key,
        planDate: meta?.planDate ?? null,
        planTitle: meta?.planTitle ?? null,
        timeName: meta?.timeName ?? null,
        // Fall back to the key suffix so buckets saved before the flag existed
        // are still labelled correctly.
        rehearsal: meta?.rehearsal ?? key.endsWith("::rehearsal"),
        savedAt: meta?.savedAt ?? 0,
        startedAt: meta?.startedAt,
        endedAt: meta?.endedAt ?? meta?.heartbeatAt,
        rows,
      });
    }
    out.sort((a, b) => b.savedAt - a.savedAt);
    return out;
  }

  return (
    <Ctx.Provider
      value={{
        rows,
        currentKey: trackKey,
        loadError,
        rehearsal,
        rehearsalAuto: rehearsalOverride === null,
        setRehearsal: setRehearsalOverride,
        resetPlan,
        serviceRows,
        history,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useTracking(): TrackingStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTracking must be used within TrackingProvider");
  return ctx;
}
