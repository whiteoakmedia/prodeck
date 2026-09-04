import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  avantisRecallScene,
  chatSend,
  getSettings,
  identityHealPco,
  invoke,
  IS_WEB,
  loadPcoData,
  on,
  pcoGet,
  pcoLiveAction,
  pcoLiveController,
  pcoSetLiveInterval,
  pcoStartSync,
  pcoStopSync,
  pcoTest,
  ppGet,
  ppFocusTrigger,
  savePcoData,
  updateSettings,
  type Json,
  type PcoLiveAction,
  type PcoController,
} from "./lib/tauri";
import { normTitle, bestMatch } from "./lib/match";

export interface ServiceType {
  id: string;
  name: string;
}
export interface Plan {
  id: string;
  title: string;
  date: string;
}
export interface PlanItem {
  id: string;
  title: string;
  sequence: number;
  length: number;
  type: string;
  description: string;
  key: string; // song key (e.g. "G"); empty for non-songs
  leader: string; // per-song leader (PCO "Leader" note, or description fallback)
  // Set on the derived display items when a live override is in effect, so the
  // editor can show "overridden vs. PCO" and offer a reset. Undefined on the raw
  // parsed items.
  /** Chord charts / lead sheets etc. attached to this item in PCO. */
  attachments?: { id: string; name: string; webUrl?: string }[];
  songId?: string;
  arrangementId?: string;
  keyId?: string; // the PCO Key record (per-key chord charts hang off it)
  pcoKey?: string; // original PCO key before any override
  pcoLeader?: string; // original PCO leader before any override
  keyOverridden?: boolean;
  leaderOverridden?: boolean;
}
export interface TeamMember {
  id: string;
  name: string;
  position: string;
  team: string;
  status: string;
  photo: string;
  /** Plan-time ids this member is scheduled onto (their call times). PCO
   *  won't inline the PlanTime objects on this endpoint, so ids are joined
   *  against the plan's own plan_times list at lookup. */
  timeIds: string[];
}

type MicMap = Record<string, Record<string, string>>; // planId -> personId -> mic
type MicTemplate = Record<string, string>; // team_position_name -> mic

export interface MicInfo {
  mic: string;
  fromTemplate: boolean;
}

/* ----------------------------------------------------------- parsers */

function parseServiceTypes(j: Json | null): ServiceType[] {
  const data = j?.data;
  if (!Array.isArray(data)) return [];
  return data.map((d: any) => ({ id: String(d.id), name: d.attributes?.name ?? "Untitled" }));
}

function parsePlans(j: Json | null): Plan[] {
  const data = j?.data;
  if (!Array.isArray(data)) return [];
  return data.map((d: any) => {
    const a = d.attributes ?? {};
    return {
      id: String(d.id),
      title: a.title || a.series_title || a.dates || "Untitled plan",
      date: a.dates || a.sort_date || "",
    };
  });
}

// A note/description is "meaningful" if it's more than placeholder punctuation.
function meaningful(s: string): boolean {
  const t = (s ?? "").trim();
  return t !== "" && !/^[\s?\-–—.·*]+$/.test(t) && !/^(tbd|tba|n\/?a|none)$/i.test(t);
}

function parseItems(j: Json | null): PlanItem[] {
  const data = j?.data;
  if (!Array.isArray(data)) return [];
  // Map ItemNote id -> content for the PCO "Leader" note category (per-song leader).
  const leaderNotes: Record<string, string> = {};
  // Attachment id -> filename (chord charts, lead sheets — the worship pull).
  const attachNames: Record<string, string> = {};
  if (Array.isArray(j?.included)) {
    for (const inc of j.included as any[]) {
      if (
        inc.type === "ItemNote" &&
        String(inc.attributes?.category_name ?? "").toLowerCase() === "leader"
      ) {
        leaderNotes[String(inc.id)] = String(inc.attributes?.content ?? "").trim();
      }
      if (inc.type === "Attachment") {
        attachNames[String(inc.id)] = String(
          inc.attributes?.filename ?? inc.attributes?.display_name ?? "attachment",
        );
      }
    }
  }
  return data
    .map((d: any) => {
      const a = d.attributes ?? {};
      // Per-song leader: the structured "Leader" note if filled, else the
      // song description (where many teams actually type "<name> lead").
      let leader = "";
      const noteRels = d.relationships?.item_notes?.data;
      if (Array.isArray(noteRels)) {
        for (const r of noteRels) {
          const c = leaderNotes[String(r.id)];
          if (c && meaningful(c)) {
            leader = c;
            break;
          }
        }
      }
      if (!leader && meaningful(a.description ?? "")) leader = String(a.description).trim();
      const attRels = d.relationships?.attachments?.data;
      const attachments = Array.isArray(attRels)
        ? (attRels as any[]).map((r) => ({
            id: String(r.id),
            name: attachNames[String(r.id)] ?? "attachment",
          }))
        : [];
      return {
        id: String(d.id),
        title: a.title ?? "(untitled)",
        sequence: a.sequence ?? 0,
        length: a.length ?? 0,
        type: a.item_type ?? "item",
        description: a.description ?? a.html_details ?? "",
        key: a.key_name ?? "",
        leader,
        attachments: attachments.length > 0 ? attachments : undefined,
        songId: d.relationships?.song?.data?.id
          ? String(d.relationships.song.data.id)
          : undefined,
        arrangementId: d.relationships?.arrangement?.data?.id
          ? String(d.relationships.arrangement.data.id)
          : undefined,
        keyId: d.relationships?.key?.data?.id
          ? String(d.relationships.key.data.id)
          : undefined,
      };
    })
    .sort((x, y) => x.sequence - y.sequence);
}

function parseTeam(j: Json | null): TeamMember[] {
  const data = j?.data;
  if (!Array.isArray(data)) return [];
  const teamNames: Record<string, string> = {};
  if (Array.isArray(j?.included)) {
    for (const inc of j.included as any[]) {
      if (inc.type === "Team") teamNames[String(inc.id)] = inc.attributes?.name ?? "";
    }
  }
  const statusLabel: Record<string, string> = { C: "Confirmed", U: "Unconfirmed", D: "Declined" };
  return data.map((d: any) => {
    const a = d.attributes ?? {};
    const teamId = d.relationships?.team?.data?.id;
    return {
      id: String(d.id),
      name: a.name ?? "Unknown",
      position: a.team_position_name ?? "",
      team: (teamId && teamNames[String(teamId)]) || a.team_position_name || "Team",
      status: statusLabel[a.status] ?? a.status ?? "",
      photo: a.photo_thumbnail ?? "",
      timeIds: ((d.relationships?.times?.data ?? []) as any[]).map((t) => String(t.id)),
    };
  });
}

// Charts live wherever worship attached them: the plan item, the song, or the
// arrangement. This parses PCO's all_attachments aggregate into lookup maps.
export interface AttachRef {
  id: string;
  name: string;
  /** PCO web page for GENERATED charts (non-numeric ids) — these can't be
   *  fetched through the API, only viewed logged-in on planningcenter. */
  webUrl?: string;
}
export interface AttachMaps {
  byItem: Record<string, AttachRef[]>;
  bySong: Record<string, AttachRef[]>;
  byArrangement: Record<string, AttachRef[]>;
  byKey: Record<string, AttachRef[]>;
}
function parseAllAttachments(j: Json | null): AttachMaps {
  const out: AttachMaps = { byItem: {}, bySong: {}, byArrangement: {}, byKey: {} };
  const data = j?.data;
  if (!Array.isArray(data)) return out;
  for (const d of data as any[]) {
    const ref: AttachRef = {
      id: String(d.id),
      name: String(d.attributes?.filename ?? d.attributes?.display_name ?? "attachment"),
      webUrl: /^\d+$/.test(String(d.id)) ? undefined : d.attributes?.url ?? undefined,
    };
    const att = d.relationships?.attachable?.data;
    const kind = String(att?.type ?? "");
    const owner = att?.id ? String(att.id) : "";
    if (!owner) continue;
    const bucket =
      kind === "PlanItem" || kind === "Item"
        ? out.byItem
        : kind === "Song"
          ? out.bySong
          : kind === "Arrangement"
            ? out.byArrangement
            : kind === "Key"
              ? out.byKey
              : null;
    if (bucket) (bucket[owner] ??= []).push(ref);
  }
  return out;
}

// Which files matter to which band position, matched by filename keyword.
// The booth can override per position (Setup → Files by position); these
// defaults cover the common band. A position with NO rule sees everything —
// and also isn't "band", so Home shows the compact setlist card instead of
// the inline My Set section.
export const DEFAULT_FILE_FILTERS: Record<string, string[]> = {
  "Worship Leader": ["chord", "chart", "lyric", "vocal", "master"],
  Vocal: ["chord", "chart", "lyric", "vocal", "master"],
  Bass: ["chord", "chart", "bass", "master"],
  Keys: ["chord", "chart", "keys", "piano", "pad", "master"],
  Piano: ["chord", "chart", "keys", "piano", "master"],
  Drums: ["chart", "drum", "click", "master"],
  Electric: ["chord", "chart", "guitar", "master"],
  Acoustic: ["chord", "chart", "guitar", "master"],
  Guitar: ["chord", "chart", "guitar", "master"],
};

/** The keyword rule for a scheduled position: booth overrides first, then
 *  defaults, loose position matching either way. Null = no rule (not band). */
export function fileRuleFor(
  custom: Record<string, string[]>,
  position: string,
): string[] | null {
  if (!position) return null;
  const norm = (x: string) => x.trim().toLowerCase();
  const p = norm(position);
  const hit = (map: Record<string, string[]>) => {
    for (const [k, words] of Object.entries(map)) {
      const kk = norm(k);
      if (kk && (p === kk || p.startsWith(kk) || kk.startsWith(p))) return words;
    }
    return null;
  };
  return hit(custom) ?? hit(DEFAULT_FILE_FILTERS);
}

/** Split a song's files into "mine" (rule keywords hit the filename) and the
 *  rest. No rule = everything is mine. */
export function splitFilesFor(
  rule: string[] | null,
  files: { id: string; name: string }[],
): { mine: { id: string; name: string }[]; rest: { id: string; name: string }[] } {
  if (!rule || rule.length === 0) return { mine: files, rest: [] };
  const words = rule.map((w) => w.trim().toLowerCase()).filter(Boolean);
  const mine: { id: string; name: string }[] = [];
  const rest: { id: string; name: string }[] = [];
  for (const f of files) {
    const n = f.name.toLowerCase();
    (words.some((w) => n.includes(w)) ? mine : rest).push(f);
  }
  return { mine, rest };
}

// The song's "real" chord chart, if one was uploaded — MultiTracks syncs
// attach one per song (Chord Chart.pdf / Chords Only.pdf, plus capo
// variants). Zach prefers these over the PCO chord-text renderer: they're
// the charts the band already rehearses from, and most of their songs come
// in via MultiTracks. Non-capo full chart first; capo copies stay ordinary
// chips so guitarists tap them directly.
const CHART_PDF_RANK = [
  /^chord chart\b(?!.*capo)/i,
  /\bchords only\b(?!.*capo)/i,
  /\bchord chart\b/i,
  /songselect chart/i,
];
export function chartPdfFor(
  files: { id: string; name: string }[],
): { id: string; name: string } | null {
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
  for (const re of CHART_PDF_RANK) {
    const hit = pdfs.find((f) => re.test(f.name));
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-person call time, with nickname tolerance.
// Match order: exact name → nickname-style (same last name, first names share
// a prefix: "Zach Green" ↔ "Zachary Green") → position (their crew role
// matches a scheduled position; earliest call among those, since a section
// usually shares one call time). Null = truly unmatched — callers fall back
// to the service start and SAY SO rather than inventing a time.
// ---------------------------------------------------------------------------
const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export interface ArrivalMatch {
  ts: number | null;
  how: "manual" | "name" | "nickname" | null;
  /** True only when this person is on this week's plan — nobody else gets an
   *  expected-arrival time anywhere in the app. */
  scheduled: boolean;
  /** The PCO position they're scheduled to this week ("" when unscheduled).
   *  Drives the position guide callout and position-gated checklists. */
  position: string;
}

/** Manual per-position expected time ("08:45") anchored to the service date.
 *  Loose role matching, same rule as checklists ("camera" covers "Camera 1"). */
export function manualArrival(
  checkinTimes: Record<string, string>,
  crewRole: string,
  serviceStartTs: number,
): number | null {
  const role = crewRole.trim().toLowerCase();
  if (!role) return null;
  let hhmm: string | null = null;
  for (const [k, v] of Object.entries(checkinTimes)) {
    const key = k.trim().toLowerCase();
    if (key && (key === role || role.startsWith(key) || key.startsWith(role))) {
      hhmm = v;
      break;
    }
  }
  if (!hhmm) return null;
  const [hh, mm] = hhmm.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  // Anchor to the selected service's DATE (today if none selected yet).
  const base = serviceStartTs > 0 ? new Date(serviceStartTs) : new Date();
  const t = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm, 0, 0);
  return t.getTime();
}

// Who belongs on the join screen's roster. The plan lists everyone serving —
// worship band included — but ProDeck is a production tool: a vocalist has no
// booth account, and a list full of them buries the four people who do.
//
// Decided on the PCO team name first (that's the real grouping) and falls back
// to the position. Short tokens are matched as whole words so "av" can't hit a
// name like "Dave". Exclusions win: a "Worship" team is out even if someone's
// position happens to contain a production word.
const WORSHIP_WORDS = [
  "worship", "band", "vocal", "singer", "choir", "music", "keys", "keyboard",
  "guitar", "bass", "drum", "piano", "violin", "cello", "sax", "horn", "strings",
  "acoustic", "percussion",
];
const PRODUCTION_WORDS = [
  "production", "tech", "audio", "sound", "camera", "video", "lighting", "light",
  "media", "propresenter", "prodeck", "slide", "stream", "broadcast", "graphic",
  "switcher", "director", "booth", "projection", "computer",
];
/** Short ones need word boundaries — "av" inside "Dave" is not a production team. */
const PRODUCTION_TOKENS = ["av", "avl", "cam", "foh", "a1", "a2", "v1", "l1"];

function hasWord(hay: string, token: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`).test(hay);
}

export function isProductionMember(m: { team: string; position: string }): boolean {
  const hay = `${m.team} ${m.position}`.toLowerCase();
  if (WORSHIP_WORDS.some((w) => hay.includes(w))) return false;
  return (
    PRODUCTION_WORDS.some((w) => hay.includes(w)) ||
    PRODUCTION_TOKENS.some((t) => hasWord(hay, t))
  );
}

/** The roster shown when joining: production only, minus anyone who declined.
 *  Falls back to the whole team if nothing matches, so an unusual set of PCO
 *  team names can never lock a volunteer out of registering. */
/** PCO reports team status as SINGLE LETTERS on team_members ("C"onfirmed,
 *  "U"nconfirmed, "D"eclined) — every longhand "declined" comparison in the
 *  app silently passed declined people for months. One canonical test. */
export const isDeclined = (status: string): boolean => {
  const s = (status ?? "").trim().toLowerCase();
  return s === "d" || s === "declined";
};

export function productionRoster<T extends { team: string; position: string; status: string }>(
  team: T[],
): T[] {
  // Worship is on the app now (Aug 2026): everyone active on the plan can
  // join. Production listed first — they were here first and it keeps the
  // pick-list familiar — worship follows.
  const active = team.filter((m) => !isDeclined(m.status));
  const prod = active.filter(isProductionMember);
  const worship = active.filter((m) => !isProductionMember(m));
  return [...prod, ...worship];
}

export function arrivalForIn(
  team: TeamMember[],
  timesById: Record<string, number>,
  crewName: string,
  _crewRole: string,
  serviceStartTs = 0,
): ArrivalMatch {
  // Only call times on the SERVICE'S calendar day count. PlanTimes carry every
  // scheduled time on the plan — including a Thursday rehearsal — and taking
  // the bare minimum told people their Sunday call time was last Thursday.
  const sameDay = (t: number) =>
    serviceStartTs <= 0 ||
    new Date(t).toDateString() === new Date(serviceStartTs).toDateString();
  const callOf = (m: TeamMember): number | null => {
    const ts = m.timeIds
      .map((id) => timesById[id])
      .filter((t) => typeof t === "number" && sameDay(t));
    return ts.length > 0 ? Math.min(...ts) : null;
  };
  // "Scheduled" means THIS person is on the plan (exact name, or nickname:
  // same last name + first-name prefix either way). Nobody else gets an
  // expected time — the old position/service-start fallbacks marked people
  // who weren't serving as "expected here".
  const me = normName(crewName);
  if (me) {
    const exact = team.find((m) => normName(m.name) === me);
    if (exact)
      return { ts: callOf(exact), how: "name", scheduled: true, position: exact.position };
    const meParts = me.split(" ");
    const myFirst = meParts[0];
    const myLast = meParts.length > 1 ? meParts[meParts.length - 1] : "";
    if (myLast) {
      const nick = team.find((m) => {
        const parts = normName(m.name).split(" ");
        const first = parts[0] ?? "";
        const last = parts[parts.length - 1] ?? "";
        return (
          last === myLast &&
          (first.startsWith(myFirst) || myFirst.startsWith(first)) &&
          first.length > 1 &&
          myFirst.length > 1
        );
      });
      if (nick)
        return { ts: callOf(nick), how: "nickname", scheduled: true, position: nick.position };
    }
  }
  return { ts: null, how: null, scheduled: false, position: "" };
}

function parseLiveItemId(j: Json | null): string | null {
  const itemId = j?.data?.relationships?.item?.data?.id;
  return itemId ? String(itemId) : null;
}

export interface ServiceTime {
  id: string;
  name: string;
  startsAt: string;
  ts: number; // epoch ms (0 if unknown)
}

function parsePlanTimes(j: Json | null): ServiceTime[] {
  const data = j?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((d: any) => (d.attributes?.time_type ?? "service") === "service")
    .map((d: any) => {
      const a = d.attributes ?? {};
      const starts = a.starts_at ?? "";
      const ts = starts ? Date.parse(starts) : 0;
      const name =
        a.name ||
        (ts
          ? new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          : "Service");
      return { id: String(d.id), name, startsAt: starts, ts };
    })
    .sort((x, y) => x.ts - y.ts);
}

// How long auto-advance will wait for a live item to finish before switching
// service anyway. Covers a service genuinely running long; past this, the item
// was simply left live and holding the switch would misfile the NEXT service.
const SERVICE_SWITCH_GRACE_MS = 20 * 60 * 1000;

const MIN = 60_000;

// When the selection hands off from one service to the next: 15 minutes
// before the NEXT service starts — Zach's rule of thumb. Works for any
// number of times per day; the day's last service holds until the day ends.
function handoffAt(_cur: number, next: number): number {
  return next - 15 * MIN;
}

// The service time that "should" be current right now. The day's last
// service holds until the day ends (there's nothing to hand off to).
function currentServiceTime(times: ServiceTime[]): string | null {
  const timed = times.filter((t) => t.ts).sort((a, b) => a.ts! - b.ts!);
  if (timed.length === 0) return times[0]?.id ?? null;
  const now = Date.now();
  for (let i = 0; i < timed.length - 1; i++) {
    if (now < handoffAt(timed[i].ts!, timed[i + 1].ts!)) return timed[i].id;
  }
  return timed[timed.length - 1].id;
}

/* ----------------------------------------------------------- store */

interface PcoStore {
  credsKnown: boolean;
  me: string | null;
  status: string;
  serviceTypes: ServiceType[];
  plans: Plan[];
  selectedServiceTypeId: string | null;
  selectedPlanId: string | null;
  serviceTimes: ServiceTime[];
  selectedServiceTimeId: string | null;
  selectServiceTime: (id: string) => void;
  autoAdvanceService: boolean;
  setAutoAdvanceService: (on: boolean) => void;
  items: PlanItem[];
  team: TeamMember[];
  /** Per-person call time: booth-set position time first, else this week's
   *  PCO schedule (name → nickname → position); ts null = unmatched. */
  arrivalFor: (crewName: string, crewRole: string) => ArrivalMatch;
  /** Manual expected times by position ("Camera" → "08:45"), booth-edited. */
  checkinTimes: Record<string, string>;
  setCheckinTime: (role: string, hhmm: string | null) => void;
  liveItemId: string | null;
  syncing: boolean;
  canControl: boolean;
  controller: PcoController | null;
  hasControl: boolean;
  liveError: string | null;
  liveBusy: boolean;
  liveAction: (action: PcoLiveAction) => Promise<void>;
  micAssignments: MicMap;
  micCount: number;
  micTemplate: MicTemplate;
  micPositions: string[];
  micDeskMap: Record<string, string>;
  setMicDeskChannel: (mic: string, deskId: string | null) => void;
  micDeskMap2: Record<string, string>;
  setMicDeskChannel2: (mic: string, deskId: string | null) => void;
  micSceneMap: Record<string, string>;
  setMicScene: (mic: string, scene: string | null) => void;
  positionGuides: Record<string, string>;
  setPositionGuide: (position: string, text: string | null) => void;
  fileFilters: Record<string, string[]>;
  setFileFilter: (position: string, words: string[] | null) => void;
  /** This week's desk-channel names, one per assigned mic: person's first
   *  name (last initial on collision), clipped to the desk's 8-char field,
   *  with the mapped primary+mirror channel ids to write them to. */
  weeklyMicNames: () => { mic: string; label: string; targets: string[] }[];
  autoScene: boolean;
  setAutoScene: (on: boolean) => void;
  setMicCount: (n: number) => void;
  setMicTemplate: (position: string, mic: string) => void;
  setMicPositionEligible: (position: string, on: boolean) => void;
  micFor: (personId: string, position: string) => MicInfo;
  micForLeader: (leaderText: string) => string;
  micRoster: () => TeamMember[];
  effectiveLink: (
    item: PlanItem,
  ) => { uuid: string; name: string; auto: boolean } | null;
  autoAdvance: boolean;
  followPro: boolean;
  followStatus: { presName: string; matched: boolean } | null;
  setFollowStatus: (s: { presName: string; matched: boolean } | null) => void;
  library: { uuid: string; name: string }[];
  setLink: (title: string, link: { uuid: string; name: string } | null) => void;
  suppressLink: (title: string) => void;
  setAutoAdvance: (on: boolean) => void;
  setFollowPro: (on: boolean) => void;
  goToItem: (itemId: string) => void;
  loadLibrary: () => Promise<void>;
  triggerPresentation: (uuid: string, force?: boolean) => void;
  saveCredentials: (appId: string, secret: string) => Promise<void>;
  loadServiceTypes: () => Promise<void>;
  selectServiceType: (id: string) => Promise<void>;
  selectPlan: (id: string) => Promise<void>;
  startSync: () => Promise<void>;
  stopSync: () => Promise<void>;
  refresh: () => Promise<void>;
  setMic: (personId: string, mic: string) => void;
  setKeyOverride: (itemId: string, value: string | null) => void;
  setLeaderOverride: (itemId: string, value: string | null) => void;
}

const Ctx = createContext<PcoStore | null>(null);

export function PcoProvider({ children }: { children: ReactNode }) {
  const [credsKnown, setCredsKnown] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedServiceTypeId, setSelectedServiceTypeId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [serviceTimes, setServiceTimes] = useState<ServiceTime[]>([]);
  const [selectedServiceTimeId, setSelectedServiceTimeId] = useState<string | null>(null);
  const [autoAdvanceService, setAutoAdvanceServiceState] = useState(false);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  // Every plan time (rehearsals included) by id — the arrival-time join table.
  const [planTimeById, setPlanTimeById] = useState<Record<string, number>>({});
  // Manual expected times by POSITION ("camera" → "08:45"), booth-set. These
  // beat the PCO schedule: when Zach says cameras arrive 8:45, that's the law.
  const [checkinTimes, setCheckinTimes] = useState<Record<string, string>>({});
  const [liveItemId, setLiveItemId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [canControl, setCanControl] = useState(true);
  // Who holds the LIVE controller, and the last failure from a live action —
  // shown on the widget the operator actually pressed.
  const [controller, setController] = useState<PcoController | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [micAssignments, setMicAssignments] = useState<MicMap>({});
  // Persistent person-name → mic memory (normName-keyed). Plans key their
  // assignments by per-plan PCO member ids, so nothing carries over on its
  // own — this map is what makes mics automatic week to week.
  const [micNameMap, setMicNameMap] = useState<Record<string, string>>({});
  const [micCount, setMicCountState] = useState(16);
  const [micTemplate, setMicTemplate2] = useState<MicTemplate>({});
  // Mic number → Avantis channel id ("6" → "input:21"). Follows the physical
  // patch, so it maps mic NUMBERS (not positions or people) to desk channels;
  // drives the "scheduled mic is muted while live" alert.
  const [micDeskMap, setMicDeskMap] = useState<Record<string, string>>({});
  // Second desk channel per mic — the mirror that shares the capsule but is
  // processed differently. Renames go to both; mute alerts key on the primary.
  const [micDeskMap2, setMicDeskMap2] = useState<Record<string, string>>({});
  // Mic number → Avantis scene number ("1" → "21", i.e. "Lead: Mic 1"). The
  // desk's lead-vocal scenes are per MIC, not per person — so this map is
  // set once, and the weekly leader rotation rides on PCO mic assignments:
  // song leader → micForLeader → mic number → scene.
  const [micSceneMap, setMicSceneMap] = useState<Record<string, string>>({});
  const [autoScene, setAutoSceneState] = useState(false);
  // Position → job description/expectations text. Written at the booth,
  // read by phones: the Home callout shows the guide for whatever position
  // the person is scheduled to THIS WEEK.
  const [positionGuides, setPositionGuides] = useState<Record<string, string>>({});
  // Booth overrides for which files each band position sees (keyword lists).
  const [fileFilters, setFileFilters] = useState<Record<string, string[]>>({});
  // Aggregate chart/file attachments for the plan (item + song + arrangement
  // level), from the sync loop's pco:attachments event.
  const [attachMaps, setAttachMaps] = useState<AttachMaps>({
    byItem: {},
    bySong: {},
    byArrangement: {},
    byKey: {},
  });
  const [micPositions, setMicPositions] = useState<string[]>([]);
  const [planByType, setPlanByType] = useState<Record<string, string>>({});
  const [linksByPlan, setLinksByPlan] = useState<
    Record<string, Record<string, { uuid: string; name: string }>>
  >({});
  // Persistent links keyed by normalized item TITLE (so they carry across weeks,
  // since plan/item IDs change every week). An empty uuid means "explicitly no
  // link" — used to suppress an unwanted auto-match.
  const [linkRules, setLinkRules] = useState<Record<string, { uuid: string; name: string }>>({});
  // Live, per-plan overrides for a song's key and leader — for when things change
  // during the service and we don't want to (or can't) edit PCO mid-stream. Keyed
  // planId -> itemId -> value. Scoped per plan so they reset cleanly next week
  // (PCO item ids change weekly), but survive an app restart mid-service.
  const [keyOverrides, setKeyOverridesState] = useState<Record<string, Record<string, string>>>({});
  const [leaderOverrides, setLeaderOverridesState] = useState<
    Record<string, Record<string, string>>
  >({});
  const [autoAdvance, setAutoAdvanceState] = useState(false);
  const [followPro, setFollowProState] = useState(false);
  const [followStatus, setFollowStatus] = useState<{
    presName: string;
    matched: boolean;
  } | null>(null);
  const [library, setLibrary] = useState<{ uuid: string; name: string }[]>([]);
  const lastAdvanced = useRef<string | null>(null);
  const advancing = useRef(false);
  const libLoading = useRef(false);
  // UUID of the presentation ProPresenter currently has live (tracked off the
  // pp:status stream via a ref so it never forces a re-render of this provider).
  const activeUuidRef = useRef<string | null>(null);
  // When "Follow ProPresenter" drives PCO Live to an item, record it here so the
  // auto-advance effect doesn't bounce that same change straight back to Pro.
  const suppressItem = useRef<string | null>(null);

  const loaded = useRef(false);
  const lastSaved = useRef("");
  const stRef = useRef<string | null>(null);
  const planRef = useRef<string | null>(null);
  stRef.current = selectedServiceTypeId;
  planRef.current = selectedPlanId;
  const serviceTimesRef = useRef<ServiceTime[]>([]);
  serviceTimesRef.current = serviceTimes;
  const serviceTimeRef = useRef<string | null>(null);
  serviceTimeRef.current = selectedServiceTimeId;
  // Read by the auto-advance timer, which must not switch services mid-item.
  const liveItemRef = useRef<string | null>(null);
  liveItemRef.current = liveItemId;
  // A service switch whose start time has passed but which is waiting for the
  // current item to finish, and when it started waiting.
  const pendingServiceTime = useRef<string | null>(null);
  const pendingSince = useRef(0);

  async function loadServiceTypes() {
    setStatus("Loading service types…");
    try {
      const j = await pcoGet("services/v2/service_types?per_page=100");
      setServiceTypes(parseServiceTypes(j));
      setStatus("");
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function saveCredentials(appId: string, secret: string) {
    const s = await getSettings();
    await updateSettings({ ...s, pco_app_id: appId, pco_secret: secret });
    setStatus("Verifying…");
    try {
      const meJson = await pcoTest();
      setMe(meJson?.data?.attributes?.name ?? "Connected");
      setCredsKnown(true);
      setStatus("");
      await loadServiceTypes();
    } catch (e) {
      setCredsKnown(false);
      setStatus(String(e));
    }
  }

  async function loadPlans(stId: string) {
    setStatus("Loading plans…");
    try {
      const j = await pcoGet(
        `services/v2/service_types/${stId}/plans?filter=future&order=sort_date&per_page=25`,
      );
      let parsed = parsePlans(j);
      if (parsed.length === 0) {
        // Fall back to most recent plans if none are upcoming.
        const j2 = await pcoGet(
          `services/v2/service_types/${stId}/plans?order=-sort_date&per_page=25`,
        );
        parsed = parsePlans(j2);
      }
      setPlans(parsed);
      setStatus("");
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function selectServiceType(id: string) {
    setSelectedServiceTypeId(id);
    stRef.current = id;
    setPlans([]);
    setItems([]);
    setTeam([]);
    setLiveItemId(null);
    await loadPlans(id);
    // Restore this service type's last-used plan, if any.
    const remembered = planByType[id];
    if (remembered) {
      await selectPlan(remembered);
    } else {
      setSelectedPlanId(null);
      planRef.current = null;
      await stopSync();
    }
  }

  async function startSync() {
    if (!stRef.current || !planRef.current) return;
    await pcoStartSync(stRef.current, planRef.current).catch((e) => setStatus(String(e)));
  }

  async function stopSync() {
    await pcoStopSync();
    setSyncing(false);
    // No more polls will arrive to end the current item — clear it now so the
    // service tracker finalizes its running stretch instead of losing it (the
    // sermon is exactly the item most likely live when sync is stopped).
    setLiveItemId(null);
  }

  // Shared by the direct fetch (booth/admin) and the pco:times sync event —
  // which is a member phone's only source of plan times.
  function applyPlanTimes(pt: Json | null) {
    // ALL plan times (rehearsal included — that's usually the call time),
    // keyed by id for the arrival join. parsePlanTimes filters to service
    // times for the picker, so it can't be reused here.
    const byId: Record<string, number> = {};
    for (const d of ((pt as any)?.data ?? []) as any[]) {
      const t = Date.parse(d.attributes?.starts_at ?? "");
      if (!Number.isNaN(t)) byId[String(d.id)] = t;
    }
    setPlanTimeById(byId);
    const times = parsePlanTimes(pt);
    setServiceTimes(times);
    setSelectedServiceTimeId((prev) =>
      prev && times.some((t) => t.id === prev) ? prev : currentServiceTime(times),
    );
  }

  async function refresh() {
    const st = stRef.current;
    const plan = planRef.current;
    if (!st || !plan) return;
    setStatus("Refreshing…");
    try {
      const [it, tm, pt] = await Promise.all([
        pcoGet(`services/v2/service_types/${st}/plans/${plan}/items?per_page=200&include=item_notes`),
        // include=times makes PCO emit each member's assigned plan-time ids
        // (it won't inline the PlanTime objects — joined from plan_times below).
        pcoGet(`services/v2/service_types/${st}/plans/${plan}/team_members?per_page=200&include=team,times`),
        pcoGet(`services/v2/service_types/${st}/plans/${plan}/plan_times?per_page=100`),
      ]);
      setItems(parseItems(it));
      setTeam(parseTeam(tm));
      applyPlanTimes(pt);
      setStatus("");
    } catch (e) {
      setStatus(String(e));
    }
  }

  // Immediately re-read the live item after an action (don't wait for the 5s poll).
  async function refreshLive() {
    const st = stRef.current;
    const plan = planRef.current;
    if (!st || !plan) return;
    try {
      const j = await pcoGet(
        `services/v2/service_types/${st}/plans/${plan}/live/current_item_time?include=item`,
      );
      setLiveItemId(parseLiveItemId(j));
    } catch (e) {
      // Only a 404 means "nothing is live". A transient failure (timeout, 429,
      // 5xx) must NOT clear the live item — that un-tracked it and re-armed
      // auto-advance, which re-fired the presentation when the next poll
      // recovered.
      if (String(e).includes("PCO 404")) setLiveItemId(null);
    }
  }

  async function loadLive() {
    const st = stRef.current;
    const plan = planRef.current;
    if (!st || !plan) return;
    try {
      const j = await pcoGet(`services/v2/service_types/${st}/plans/${plan}/live`);
      setCanControl(j?.data?.attributes?.can_control !== false);
    } catch {
      /* keep optimistic default */
    }
  }

  // Refresh who holds the LIVE controller. Null controller = nobody has taken
  // control, which is the normal resting state of a plan.
  async function refreshController(): Promise<PcoController | null> {
    const st = stRef.current;
    const plan = planRef.current;
    if (!st || !plan) return null;
    try {
      const c = await pcoLiveController(st, plan);
      setController(c);
      return c;
    } catch {
      return null;
    }
  }

  async function liveAction(action: PcoLiveAction) {
    const st = stRef.current;
    const plan = planRef.current;
    if (!st || !plan) {
      setLiveError("No Planning Center plan is selected.");
      return;
    }
    setLiveBusy(true);
    setLiveError(null);
    try {
      // PCO ignores next/previous unless someone holds the controller, and an
      // untouched plan has nobody holding it — which is why these buttons did
      // nothing at all. Take control first when it's free. Never take it from
      // a teammate silently: that would yank the service out from under them,
      // so say who has it and let the operator decide.
      if (action !== "toggle_control") {
        const c = await refreshController();
        const heldByOther = !!c?.controllerId && !!c.meId && c.controllerId !== c.meId;
        if (heldByOther) {
          setLiveError(
            `${c?.controllerName ?? "Someone else"} is controlling Planning Center Live. Press "Take control" to drive it from here.`,
          );
          return;
        }
        if (!c?.controllerId) {
          await pcoLiveAction(st, plan, "toggle_control");
          await refreshController();
        }
      }
      await pcoLiveAction(st, plan, action);
      await refreshLive();
      if (action === "toggle_control") {
        await loadLive();
        await refreshController();
      }
    } catch (e) {
      // Surfaced on the widget itself now. This used to go only to pco.status,
      // which is rendered on the Planning Center page — so a failure pressed
      // from a dashboard was completely invisible.
      setLiveError(String(e));
      setStatus(String(e));
    } finally {
      setLiveBusy(false);
    }
  }

  async function selectPlan(id: string) {
    setSelectedPlanId(id);
    setItems([]);
    setTeam([]);
    setLiveItemId(null);
    planRef.current = id;
    // Remember this plan as the chosen one for the current service type.
    const st = stRef.current;
    if (st) setPlanByType((prev) => ({ ...prev, [st]: id }));
    await refresh();
    await loadLive();
    await startSync();
  }

  // Auto-target the next service (booth only). On launch and every 30 min:
  // if no plan is selected — or the selected one is in the past — jump to
  // the soonest plan dated today or later and sync it. A deliberately chosen
  // future plan is never overridden, so picking a special service by hand
  // still sticks. Volunteers open the app to a loaded, syncing rundown.
  // Auto-advance BETWEEN SERVICE TIMES on the selected plan: once the 8:00
  // has been over for a while, the day belongs to the 11:00 — check-ins and
  // tracking must follow, or the second service piles onto the first one's
  // data (which is exactly what happened before this existed). Manual picks
  // hold for two hours.
  // Tell the backend which service we're on: check_in uses THIS as the sheet
  // key, so a phone carrying last service's key (backgrounded through the
  // switch, or an offline replay) can no longer wipe the live arrivals
  // (audit finding). Booth-only — it's the booth's selection that's truth.
  useEffect(() => {
    if (IS_WEB || !selectedPlanId || !selectedServiceTimeId) return;
    invoke("checkin_set_service", {
      serviceKey: `${selectedPlanId}::${selectedServiceTimeId}`,
    }).catch(() => {});
  }, [selectedPlanId, selectedServiceTimeId]);

  // PCO name heal: whenever a roster lands, let the booth link typed signup
  // names to their PCO person (and adopt scheduled positions as roles). Booth
  // only — every phone running this would hammer an admin-shaped command —
  // and only when the roster actually changed, not on every 30s re-parse.
  const healedRoster = useRef("");
  useEffect(() => {
    if (IS_WEB || team.length === 0) return;
    const roster = team
      .filter((m) => !isDeclined(m.status))
      .map((m) => ({ name: m.name, position: m.position }));
    const key = JSON.stringify(roster);
    if (key === healedRoster.current) return;
    healedRoster.current = key;
    identityHealPco(roster).catch(() => {});
  }, [team]);

  const manualTimeUntil = useRef(0);
  useEffect(() => {
    if (IS_WEB) return;
    const tick = () => {
      if (Date.now() < manualTimeUntil.current) return;
      const times = serviceTimesRef.current;
      if (!times || times.length < 2) return;
      const want = currentServiceTime(times);
      if (!want || want === selectedServiceTimeId) return;
      const cur = times.find((t) => t.id === selectedServiceTimeId);
      const next = times.find((t) => t.id === want);
      // Only ever move forward — backward jumps are a human's call.
      if (cur?.ts && next?.ts && next.ts < cur.ts) return;
      setSelectedServiceTimeId(want);
    };
    const iv = setInterval(tick, 60_000);
    tick();
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServiceTimeId]);

  const autoTargetBusy = useRef(false);
  useEffect(() => {
    if (IS_WEB) return;
    const fresh = (p: Plan) => {
      const t = Date.parse(p.date);
      return Number.isFinite(t) && t >= Date.now() - 36 * 3600_000;
    };
    const tick = async () => {
      if (autoTargetBusy.current || !loaded.current || !stRef.current) return;
      const target = plans
        .filter(fresh)
        .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
      if (!target) return;
      const cur = plans.find((p) => p.id === selectedPlanId);
      if ((cur && fresh(cur)) || selectedPlanId === target.id) return;
      autoTargetBusy.current = true;
      try {
        await selectPlan(target.id);
      } finally {
        autoTargetBusy.current = false;
      }
    };
    tick();
    const iv = setInterval(tick, 30 * 60_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, selectedPlanId]);

  function setMic(personId: string, mic: string) {
    setMicAssignments((prev) => {
      const planId = planRef.current ?? "_";
      return { ...prev, [planId]: { ...(prev[planId] ?? {}), [personId]: mic } };
    });
    // Teach the name memory: an explicit set IS the truth about this person.
    // Clearing a mic clears the memory too — an empty remembered value would
    // silently pin them to "no mic" forever.
    const member = team.find((m) => m.id === personId);
    if (member) {
      const key = normName(member.name);
      setMicNameMap((prev) => {
        const next = { ...prev };
        if (mic) next[key] = mic;
        else delete next[key];
        return next;
      });
    }
  }

  // A key or leader change is information the whole band needs NOW — announce
  // it in team chat automatically (booth only; the booth is where overrides
  // happen). Skips no-op changes so re-saving the same value stays silent.
  function announceChange(itemId: string, what: "key" | "leader", next: string | null) {
    if (IS_WEB) return;
    const it = displayItems.find((i) => i.id === itemId);
    if (!it) return;
    const prev = what === "key" ? it.key : it.leader;
    const val = (next ?? (what === "key" ? it.pcoKey : it.pcoLeader) ?? "").trim();
    if (!val || val === prev) return;
    const msg =
      what === "key"
        ? `🎵 "${it.title}" key → ${val}${prev ? ` (was ${prev})` : ""}`
        : `🎵 "${it.title}" — ${val} leads${prev ? ` (was ${prev})` : ""}`;
    chatSend("Booth", msg, "team", "team").catch(() => {});
  }

  // Override (or clear) a song's key for the current plan. Passing null — or the
  // same value PCO already has — clears the override so the item tracks PCO again.
  function setKeyOverride(itemId: string, value: string | null) {
    const pid = selectedPlanId ?? "_";
    const orig = items.find((i) => i.id === itemId)?.key ?? "";
    announceChange(itemId, "key", value);
    setKeyOverridesState((prev) => {
      const cur = { ...(prev[pid] ?? {}) };
      if (value === null || value.trim() === orig) delete cur[itemId];
      else cur[itemId] = value.trim();
      return { ...prev, [pid]: cur };
    });
  }

  // Override (or clear) a song's leader for the current plan. Clearing reverts to
  // the PCO "Leader" note. The overridden name still flows through micForLeader,
  // so the mic number follows whoever actually steps up to lead.
  function setLeaderOverride(itemId: string, value: string | null) {
    const pid = selectedPlanId ?? "_";
    const orig = items.find((i) => i.id === itemId)?.leader ?? "";
    announceChange(itemId, "leader", value);
    setLeaderOverridesState((prev) => {
      const cur = { ...(prev[pid] ?? {}) };
      if (value === null || value.trim() === orig) delete cur[itemId];
      else cur[itemId] = value.trim();
      return { ...prev, [pid]: cur };
    });
  }

  // Items with any live key/leader override applied. Everything reads the store's
  // `items` (which is this), so a change shows everywhere — run of show, transport,
  // confidence monitor, mobile, web — at once. The raw PCO values ride along as
  // pcoKey/pcoLeader so the editor can show what was overridden and reset it.
  const displayItems = useMemo(() => {
    const pid = selectedPlanId ?? "_";
    const ko = keyOverrides[pid];
    const lo = leaderOverrides[pid];
    const chartsFor = (it: PlanItem): { id: string; name: string }[] | undefined => {
      const all = [
        ...(it.attachments ?? []),
        ...(attachMaps.byItem[it.id] ?? []),
        ...(it.songId ? attachMaps.bySong[it.songId] ?? [] : []),
        ...(it.keyId ? attachMaps.byKey[it.keyId] ?? [] : []),
        ...(it.arrangementId ? attachMaps.byArrangement[it.arrangementId] ?? [] : []),
      ];
      if (all.length === 0) return undefined;
      const seen = new Set<string>();
      return all.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
    };
    return items.map((it) => {
      const k = ko?.[it.id];
      const l = lo?.[it.id];
      const attachments = chartsFor(it);
      if (k === undefined && l === undefined) return { ...it, attachments };
      return {
        ...it,
        attachments,
        key: k !== undefined ? k : it.key,
        leader: l !== undefined ? l : it.leader,
        pcoKey: it.key,
        pcoLeader: it.leader,
        keyOverridden: k !== undefined,
        leaderOverridden: l !== undefined,
      };
    });
  }, [items, keyOverrides, leaderOverrides, selectedPlanId, attachMaps]);

  // Auto scene-per-mic: when the live item CHANGES to a song, resolve its
  // leader to THIS WEEK'S mic (micForLeader reads the PCO assignments), then
  // the mic to its "Lead: Mic N" scene — the softkey press that swaps the
  // lead-vocal bus, automated. The scenes are per mic, so the map never
  // changes as vocalists rotate. Booth only (a web client must never fire
  // desk control), armed by the Desk Scenes toggle, and it skips the first
  // observation after launch so a mid-service restart can't surprise the
  // desk with a recall.
  const autoSceneRef = useRef<{ prev: string | null; fired: string }>({
    prev: null,
    fired: "",
  });
  useEffect(() => {
    const st = autoSceneRef.current;
    const prev = st.prev;
    st.prev = liveItemId;
    if (IS_WEB || !autoScene || !liveItemId || prev === null || prev === liveItemId) return;
    const item = displayItems.find((i) => i.id === liveItemId);
    if (!item || item.type !== "song" || !item.leader) return;
    const mic = micForLeader(item.leader);
    const scene = mic ? micSceneMap[mic] : undefined;
    const key = `${liveItemId}:${scene}`;
    if (!scene || st.fired === key) return;
    st.fired = key;
    avantisRecallScene(parseInt(scene)).catch(() => {
      /* desk offline — the mirror's health light already says so */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveItemId, autoScene, displayItems, micSceneMap, micAssignments]);

  function setMicCount(n: number) {
    setMicCountState(Math.max(0, Math.min(128, Math.floor(n) || 0)));
  }

  function setMicTemplate(position: string, mic: string) {
    setMicTemplate2((prev) => {
      const next = { ...prev };
      if (mic) next[position] = mic;
      else delete next[position];
      return next;
    });
  }

  // Effective mic for a person: explicit per-plan override wins, otherwise the
  // position template default, otherwise unassigned.
  function micFor(personId: string, position: string): MicInfo {
    const plan = micAssignments[selectedPlanId ?? "_"] ?? {};
    if (personId in plan) return { mic: plan[personId], fromTemplate: false };
    // The person's remembered mic — Sarah is mic 2 every week, whatever
    // per-plan id PCO hands her this time. Learned from every manual set
    // (and backfilled from historic plans), so assignment converges to
    // zero-touch: only genuinely new people or exceptions need a hand.
    const member = team.find((m) => m.id === personId);
    if (member) {
      const remembered = micNameMap[normName(member.name)];
      if (remembered) return { mic: remembered, fromTemplate: true };
    }
    const t = micTemplate[position];
    if (t) return { mic: t, fromTemplate: true };
    return { mic: "", fromTemplate: false };
  }

  // Best-effort: map a song's free-text leader (e.g. "Lynds", "Amber Lead") to a
  // scheduled team member and return the mic assigned to them in this app. Used
  // to surface mic numbers in the run of show.
  function micForLeader(leaderText: string): string {
    if (!leaderText) return "";
    const clean = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(/\b(lead|leader|leads|vocal|vocals|bgv|bgvs|and|the|with|feat|ft)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const ltTokens = clean(leaderText).split(" ").filter(Boolean);
    if (ltTokens.length === 0) return "";
    for (const m of team) {
      if (isDeclined(m.status)) continue;
      const nmTokens = clean(m.name).split(" ").filter(Boolean);
      const match = ltTokens.some((a) =>
        nmTokens.some(
          (b) =>
            a === b ||
            (a.length >= 3 && b.startsWith(a)) ||
            (b.length >= 3 && a.startsWith(b)),
        ),
      );
      if (match) {
        const mic = micFor(m.id, m.position).mic;
        if (mic) return mic;
      }
    }
    return "";
  }

  function setMicPositionEligible(position: string, on: boolean) {
    setMicPositions((prev) => {
      const has = prev.includes(position);
      if (on && !has) return [...prev, position];
      if (!on && has) return prev.filter((p) => p !== position);
      return prev;
    });
  }

  // The clean mic list: only people whose position is mic-eligible (or who have
  // an explicit mic), sorted by mic number. Falls back to the whole team when
  // nothing has been configured yet.
  function micRoster(): TeamMember[] {
    // People who declined aren't serving this plan — keep them out of the mic
    // pool so they don't take up channels.
    const active = team.filter((m) => !isDeclined(m.status));
    const eligible = active.filter(
      (m) => micPositions.includes(m.position) || !!micFor(m.id, m.position).mic,
    );
    let list = micPositions.length === 0 && eligible.length === 0 ? active : eligible;
    // ONE card per person: PCO schedules the same human as several team
    // entries (per position, per service time — "Team Lead" AND "Thursday"),
    // and a person only wears one mic. Prefer the entry with a real mic
    // position so the card's sub-label reads "Worship Leader", not a day.
    const byName = new Map<string, TeamMember>();
    for (const m of list) {
      const k = normName(m.name);
      const cur = byName.get(k);
      if (!cur) {
        byName.set(k, m);
        continue;
      }
      const curReal = micPositions.includes(cur.position);
      const mReal = micPositions.includes(m.position);
      // Upgrade to the real-position entry, or to one with an explicit mic.
      const curExplicit = cur.id in (micAssignments[selectedPlanId ?? "_"] ?? {});
      const mExplicit = m.id in (micAssignments[selectedPlanId ?? "_"] ?? {});
      if ((mReal && !curReal) || (mExplicit && !curExplicit)) byName.set(k, m);
    }
    list = [...byName.values()];
    return [...list].sort((a, b) => {
      const ma = parseInt(micFor(a.id, a.position).mic, 10) || 9999;
      const mb = parseInt(micFor(b.id, b.position).mic, 10) || 9999;
      if (ma !== mb) return ma - mb;
      return a.name.localeCompare(b.name);
    });
  }

  // Save (or clear) a link for an item, keyed by its title so it persists every
  // week. null clears the rule (the item reverts to auto-detect).
  function setLink(title: string, link: { uuid: string; name: string } | null) {
    setLinkRules((prev) => {
      const key = normTitle(title);
      if (!key) return prev;
      const next = { ...prev };
      if (link) next[key] = link;
      else delete next[key];
      return next;
    });
  }

  // Pin an item to "no link" so a wrong auto-match stops triggering.
  function suppressLink(title: string) {
    const key = normTitle(title);
    if (!key) return;
    setLinkRules((prev) => ({ ...prev, [key]: { uuid: "", name: "" } }));
  }

  // Resolve the presentation an item should trigger:
  //   1. a saved title rule (manual link, or explicit "none"),
  //   2. else an auto-match against the ProPresenter library by name,
  //   3. else a legacy per-plan link (older saved data).
  function effectiveLink(
    item: PlanItem,
  ): { uuid: string; name: string; auto: boolean } | null {
    const rule = linkRules[normTitle(item.title)];
    if (rule) return rule.uuid ? { ...rule, auto: false } : null;
    const m = bestMatch(item.title, library);
    if (m) return { uuid: m.uuid, name: m.name, auto: true };
    const legacy = linksByPlan[selectedPlanId ?? "_"]?.[item.id];
    return legacy ? { ...legacy, auto: false } : null;
  }

  function setAutoAdvance(on: boolean) {
    lastAdvanced.current = liveItemId; // avoid firing on the toggle itself
    setAutoAdvanceState(on);
  }

  function selectServiceTime(id: string) {
    // A human picked this — the auto-advancer stands down for two hours so a
    // deliberate look back at the 8:00 isn't yanked forward a minute later.
    manualTimeUntil.current = Date.now() + 2 * 3600_000;
    setSelectedServiceTimeId(id || null);
  }
  function setAutoAdvanceService(on: boolean) {
    setAutoAdvanceServiceState(on);
  }

  // Fetch ProPresenter's presentation library (for the link picker + auto-detect).
  async function loadLibrary() {
    if (library.length > 0 || libLoading.current) return;
    libLoading.current = true;
    try {
      const libs = (await ppGet("libraries")) as any;
      if (Array.isArray(libs)) {
        const all: { uuid: string; name: string }[] = [];
        for (const lib of libs) {
          const data = (await ppGet(`library/${lib.uuid}`)) as any;
          for (const it of data?.items ?? []) all.push({ uuid: it.uuid, name: it.name });
        }
        if (all.length > 0) setLibrary(all);
      }
    } catch {
      /* ProPresenter not connected */
    } finally {
      libLoading.current = false;
    }
  }

  // Trigger a presentation from its first cue. ProPresenter fires that cue's
  // attached actions (Look, macro, clear, stage layout, MIDI) on an API trigger
  // — confirmed against the live rig and the official API spec, which says the
  // index "Respects the selected arrangement of cues."
  //
  // Auto-advance calls this WITHOUT force: if the presentation is already live we
  // skip, so a routine PCO poll never yanks the song back to slide 0. An explicit
  // operator click passes force=true — they asked for it to go, so we (re)fire the
  // cue and its actions even when it's already the active presentation.
  function triggerPresentation(uuid: string, force = false) {
    if (!uuid) return;
    if (!force && uuid === activeUuidRef.current) return;
    ppFocusTrigger(uuid, 0).catch(() => {});
  }

  function setFollowPro(on: boolean) {
    setFollowProState(on);
  }

  // Step PCO Live to a specific item (no direct "go to item" API exists, so we
  // step next/previous by sequence and verify against the live item). If the
  // live item stops moving we probably don't hold the controller — take control
  // once and keep going.
  async function goToItem(itemId: string) {
    const st = stRef.current;
    const plan = planRef.current;
    if (!st || !plan || advancing.current) return;
    const seqOf = (id: string | null) =>
      id ? items.find((i) => i.id === id)?.sequence ?? null : null;
    const targetSeq = seqOf(itemId);
    if (targetSeq == null) return;
    advancing.current = true;
    suppressItem.current = itemId; // mark this as a Follow-driven change
    let prevCur: string | null | undefined = undefined;
    let stuck = 0;
    let tookControl = false;
    let curId: string | null = null;
    try {
      for (let i = 0; i < 30; i++) {
        try {
          const j = await pcoGet(
            `services/v2/service_types/${st}/plans/${plan}/live/current_item_time?include=item`,
          );
          curId = parseLiveItemId(j);
        } catch {
          curId = null;
        }
        if (curId === itemId) break;
        // Our previous step didn't move the live item → we likely lack control.
        if (prevCur !== undefined && curId === prevCur) {
          if (++stuck >= 2 && !tookControl) {
            tookControl = true;
            stuck = 0;
            await pcoLiveAction(st, plan, "toggle_control").catch(() => {});
            await loadLive();
          }
        } else {
          stuck = 0;
        }
        prevCur = curId;
        const curSeq = seqOf(curId);
        const action =
          curSeq == null || targetSeq > curSeq ? "go_to_next_item" : "go_to_previous_item";
        await pcoLiveAction(st, plan, action).catch(() => {});
        await new Promise((r) => setTimeout(r, 120));
      }
      // Publish ONLY when the target was actually reached — never an
      // intermediate (or null from a failed read); the poll corrects within
      // seconds either way, and publishing a miss would clock the wrong item.
      if (curId === itemId) setLiveItemId(curId);
    } finally {
      // If we never reached the target, disarm its suppression — otherwise the
      // NEXT legitimate live change to that item would be silently swallowed
      // by the auto-advance suppressor.
      if (curId !== itemId && suppressItem.current === itemId) {
        suppressItem.current = null;
      }
      advancing.current = false;
    }
  }

  // Auto-advance: when the live plan item changes, trigger its linked
  // ProPresenter presentation.
  useEffect(() => {
    // Booth-only: a phone auto-advancing too would double-fire every trigger.
    if (IS_WEB) return;
    // While goToItem is stepping PCO toward a Follow target, the poll emits
    // every INTERMEDIATE item — don't trigger (or record) those, or a long
    // jump yanks ProPresenter through wrong songs mid-flight.
    if (advancing.current) return;
    if (!autoAdvance || !liveItemId) {
      lastAdvanced.current = liveItemId;
      return;
    }
    if (lastAdvanced.current === liveItemId) return;
    lastAdvanced.current = liveItemId;
    // This live change was caused by "Follow ProPresenter" stepping PCO to match
    // Pro — don't bounce it straight back and re-trigger the same song.
    if (suppressItem.current === liveItemId) {
      suppressItem.current = null;
      return;
    }
    const item = items.find((i) => i.id === liveItemId);
    const link = item ? effectiveLink(item) : null;
    if (link) triggerPresentation(link.uuid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveItemId, autoAdvance]);

  // Keep the ProPresenter library loaded so unlinked items (esp. songs) can
  // auto-detect their matching presentation by name.
  useEffect(() => {
    if (items.length > 0 && library.length === 0) loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, library.length]);

  // Promote any legacy per-plan links for the current plan to persistent title
  // rules, so links made before this update survive into future weeks too.
  useEffect(() => {
    const legacy = linksByPlan[selectedPlanId ?? "_"];
    if (!legacy || items.length === 0) return;
    setLinkRules((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const it of items) {
        const l = legacy[it.id];
        const key = normTitle(it.title);
        if (l && key && !(key in next)) {
          next[key] = l;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedPlanId]);

  // Auto-advance to the next service time when its start arrives.
  //
  // Deferred while an item is live. Analytics are bucketed per service time, so
  // switching mid-item splits one service across two buckets: the running
  // service's report is truncated at the switch and the next service is
  // credited with time it never had. A service that runs past the next start
  // time is exactly when this used to fire. The pending switch is applied the
  // moment the plan goes idle (item cleared / service ends).
  useEffect(() => {
    if (!autoAdvanceService) return;
    const tick = () => {
      const want = currentServiceTime(serviceTimesRef.current);
      if (!want || want === serviceTimeRef.current) return;
      if (liveItemRef.current) {
        // Hold the switch — but only for so long. An item left live after the
        // service ends would otherwise defer it forever, and the NEXT service
        // would track into the previous service's bucket: worse than switching
        // mid-item. Past the grace period, switch regardless.
        if (pendingServiceTime.current !== want) {
          pendingServiceTime.current = want;
          pendingSince.current = Date.now();
        }
        if (Date.now() - pendingSince.current < SERVICE_SWITCH_GRACE_MS) return;
      }
      pendingServiceTime.current = null;
      setSelectedServiceTimeId(want);
    };
    tick();
    const iv = setInterval(tick, 15000);
    return () => clearInterval(iv);
  }, [autoAdvanceService]);

  // Apply a switch that was held back while an item was live.
  useEffect(() => {
    if (!autoAdvanceService || liveItemId) return;
    const want = pendingServiceTime.current;
    if (want && want !== serviceTimeRef.current) {
      pendingServiceTime.current = null;
      setSelectedServiceTimeId(want);
    }
  }, [autoAdvanceService, liveItemId]);

  // Poll PCO Live faster while a sync mode is actually running, relax when idle.
  // Booth-only: the host owns the poll cadence, not whichever phone loaded last.
  useEffect(() => {
    if (IS_WEB) return;
    const fast = syncing && (followPro || autoAdvance);
    pcoSetLiveInterval(fast ? 1500 : 5000).catch(() => {});
  }, [syncing, followPro, autoAdvance]);

  // Subscribe to sync events.
  useEffect(() => {
    const subs: Promise<() => void>[] = [];
    subs.push(on<Json>("pco:items", (j) => setItems(parseItems(j))));
    subs.push(on<Json>("pco:team", (j) => setTeam(parseTeam(j))));
    subs.push(on<Json>("pco:times", (j) => applyPlanTimes(j)));
    subs.push(on<Json>("pco:attachments", (j) => setAttachMaps(parseAllAttachments(j))));
    subs.push(on<Json | null>("pco:live", (j) => setLiveItemId(parseLiveItemId(j))));
    subs.push(on("pco:sync_started", () => setSyncing(true)));
    subs.push(on("pco:sync_stopped", () => setSyncing(false)));
    // Track ProPresenter's live presentation UUID so we never re-trigger (and
    // yank to slide 0) a presentation that is already on screen.
    subs.push(
      on<{ stream: string; data: Json }>("pp:status", (m) => {
        if (m?.stream === "active_presentation")
          activeUuidRef.current =
            (m?.data as any)?.presentation?.id?.uuid ?? null;
      }),
    );
    return () => subs.forEach((u) => u.then((fn) => fn()));
  }, []);

  // Initial load: creds + persisted selection + mic assignments.
  useEffect(() => {
    (async () => {
      const s = await getSettings().catch(() => null);
      const hasCreds = !!(s?.pco_app_id && s?.pco_secret);
      setCredsKnown(hasCreds);

      const data = (await loadPcoData().catch(() => null)) as Json | null;
      if (data) {
        if (data.micAssignments) setMicAssignments(data.micAssignments);
        if (data.micNameMap && typeof data.micNameMap === "object")
          setMicNameMap(data.micNameMap as Record<string, string>);
        if (data.checkinTimes && typeof data.checkinTimes === "object")
          setCheckinTimes(data.checkinTimes as Record<string, string>);
        if (typeof data.micCount === "number") setMicCountState(data.micCount);
        if (data.micTemplate) setMicTemplate2(data.micTemplate);
        if (data.micDeskMap && typeof data.micDeskMap === "object")
          setMicDeskMap(data.micDeskMap as Record<string, string>);
        if (data.micDeskMap2 && typeof data.micDeskMap2 === "object")
          setMicDeskMap2(data.micDeskMap2 as Record<string, string>);
        if (data.micSceneMap && typeof data.micSceneMap === "object")
          setMicSceneMap(data.micSceneMap as Record<string, string>);
        if (data.positionGuides && typeof data.positionGuides === "object")
          setPositionGuides(data.positionGuides as Record<string, string>);
        if (data.fileFilters && typeof data.fileFilters === "object")
          setFileFilters(data.fileFilters as Record<string, string[]>);
        if (typeof data.autoScene === "boolean") setAutoSceneState(data.autoScene);
        if (Array.isArray(data.micPositions)) setMicPositions(data.micPositions);
        if (data.planByType && typeof data.planByType === "object")
          setPlanByType(data.planByType);
        if (data.linksByPlan && typeof data.linksByPlan === "object")
          setLinksByPlan(data.linksByPlan);
        if (data.linkRules && typeof data.linkRules === "object")
          setLinkRules(data.linkRules);
        if (data.keyOverrides && typeof data.keyOverrides === "object")
          setKeyOverridesState(data.keyOverrides as Record<string, Record<string, string>>);
        if (data.leaderOverrides && typeof data.leaderOverrides === "object")
          setLeaderOverridesState(data.leaderOverrides as Record<string, Record<string, string>>);
        if (typeof data.autoAdvance === "boolean") setAutoAdvanceState(data.autoAdvance);
        if (typeof data.autoAdvanceService === "boolean")
          setAutoAdvanceServiceState(data.autoAdvanceService);
        if (typeof data.followPro === "boolean") setFollowProState(data.followPro);
        if (data.selectedServiceTypeId) setSelectedServiceTypeId(data.selectedServiceTypeId);
        if (data.selectedPlanId) setSelectedPlanId(data.selectedPlanId);
        if (data.selectedServiceTimeId) setSelectedServiceTimeId(data.selectedServiceTimeId);
      }
      lastSaved.current = JSON.stringify({
        selectedServiceTypeId: data?.selectedServiceTypeId ?? null,
        selectedPlanId: data?.selectedPlanId ?? null,
        selectedServiceTimeId: data?.selectedServiceTimeId ?? null,
        autoAdvanceService: data?.autoAdvanceService ?? false,
        micCount: data?.micCount ?? 16,
        micTemplate: data?.micTemplate ?? {},
        micPositions: data?.micPositions ?? [],
        planByType: data?.planByType ?? {},
        linksByPlan: data?.linksByPlan ?? {},
        linkRules: data?.linkRules ?? {},
        keyOverrides: data?.keyOverrides ?? {},
        leaderOverrides: data?.leaderOverrides ?? {},
        autoAdvance: data?.autoAdvance ?? false,
        followPro: data?.followPro ?? false,
        micAssignments: data?.micAssignments ?? {},
      });
      loaded.current = true;

      if (hasCreds) {
        await loadServiceTypes();
        const stId = data?.selectedServiceTypeId;
        const planId = data?.selectedPlanId;
        if (stId) await loadPlans(stId);
        if (stId && planId) {
          stRef.current = stId;
          planRef.current = planId;
          await refresh();
          await loadLive();
          await startSync();
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist selection + mic assignments (debounced). Browser clients are
  // viewers — the booth app owns pco.json (the gateway also rejects the write),
  // so don't even attempt it from web.
  useEffect(() => {
    if (IS_WEB || !loaded.current) return;
    const payload = {
      selectedServiceTypeId,
      selectedPlanId,
      selectedServiceTimeId,
      autoAdvanceService,
      micCount,
      micTemplate,
      micPositions,
      planByType,
      linksByPlan,
      linkRules,
      keyOverrides,
      leaderOverrides,
      autoAdvance,
      followPro,
      micAssignments,
      micNameMap,
      checkinTimes,
      micDeskMap,
      micDeskMap2,
      micSceneMap,
      autoScene,
      positionGuides,
      fileFilters,
    };
    const json = JSON.stringify(payload);
    if (json === lastSaved.current) return;
    const t = setTimeout(() => {
      lastSaved.current = json;
      savePcoData(payload).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [
    selectedServiceTypeId,
    selectedPlanId,
    selectedServiceTimeId,
    autoAdvanceService,
    micCount,
    micTemplate,
    micPositions,
    planByType,
    linksByPlan,
    linkRules,
    keyOverrides,
    leaderOverrides,
    autoAdvance,
    followPro,
    micAssignments,
    micNameMap,
    checkinTimes,
    micDeskMap,
    micDeskMap2,
    micSceneMap,
    autoScene,
    positionGuides,
    fileFilters,
  ]);

  const value: PcoStore = {
    credsKnown,
    me,
    status,
    serviceTypes,
    plans,
    selectedServiceTypeId,
    selectedPlanId,
    serviceTimes,
    selectedServiceTimeId,
    selectServiceTime,
    autoAdvanceService,
    setAutoAdvanceService,
    items: displayItems,
    team,
    arrivalFor: (crewName: string, crewRole: string) => {
      // Priority: booth-set position time → PCO schedule — but only for
      // people actually on this week's plan. Everyone else gets no
      // expectation at all.
      const startTs =
        serviceTimesRef.current.find((t) => t.id === selectedServiceTimeId)?.ts ?? 0;
      const base = arrivalForIn(team, planTimeById, crewName, crewRole, startTs);
      if (!base.scheduled) return base;
      // Keyed on the PCO position, not on anything stored against the account:
      // a manual call time is set per POSITION in Setup, and the position is
      // whatever this week's plan says it is.
      const manual = manualArrival(checkinTimes, base.position, startTs);
      if (manual != null)
        return { ts: manual, how: "manual" as const, scheduled: true, position: base.position };
      return base;
    },
    checkinTimes,
    setCheckinTime: (role: string, hhmm: string | null) =>
      setCheckinTimes((prev) => {
        const next = { ...prev };
        const key = role.trim();
        if (!key) return prev;
        if (hhmm) next[key] = hhmm;
        else delete next[key];
        return next;
      }),
    liveItemId,
    syncing,
    canControl,
    controller,
    hasControl: !!controller?.controllerId && controller.controllerId === controller.meId,
    liveError,
    liveBusy,
    liveAction,
    micAssignments,
    micCount,
    micTemplate,
    micPositions,
    micDeskMap,
    setMicDeskChannel: (mic: string, deskId: string | null) =>
      setMicDeskMap((prev) => {
        const next = { ...prev };
        if (deskId) next[mic] = deskId;
        else delete next[mic];
        return next;
      }),
    micDeskMap2,
    setMicDeskChannel2: (mic: string, deskId: string | null) =>
      setMicDeskMap2((prev) => {
        const next = { ...prev };
        if (deskId) next[mic] = deskId;
        else delete next[mic];
        return next;
      }),
    micSceneMap,
    setMicScene: (mic: string, scene: string | null) =>
      setMicSceneMap((prev) => {
        const next = { ...prev };
        const key = mic.trim();
        if (!key) return prev;
        if (scene) next[key] = scene;
        else delete next[key];
        return next;
      }),
    autoScene,
    setAutoScene: setAutoSceneState,
    fileFilters,
    setFileFilter: (position: string, words: string[] | null) =>
      setFileFilters((prev) => {
        const next = { ...prev };
        const key = position.trim();
        if (!key) return prev;
        if (words && words.length > 0) next[key] = words;
        else delete next[key];
        return next;
      }),
    positionGuides,
    setPositionGuide: (position: string, text: string | null) =>
      setPositionGuides((prev) => {
        const next = { ...prev };
        const key = position.trim();
        if (!key) return prev;
        if (text && text.trim()) next[key] = text;
        else delete next[key];
        return next;
      }),
    weeklyMicNames: () => {
      const roster = micRoster();
      const firstCounts = new Map<string, number>();
      for (const m of roster) {
        if (!micFor(m.id, m.position).mic) continue;
        const f = m.name.trim().split(/\s+/)[0] ?? "";
        firstCounts.set(f, (firstCounts.get(f) ?? 0) + 1);
      }
      const out: { mic: string; label: string; targets: string[] }[] = [];
      for (const m of roster) {
        const mic = micFor(m.id, m.position).mic;
        if (!mic) continue;
        const parts = m.name.trim().split(/\s+/);
        let label = parts[0] ?? "";
        if ((firstCounts.get(label) ?? 0) > 1 && parts[1])
          label = `${label.slice(0, 6)} ${parts[1][0]}`;
        label = label.slice(0, 8);
        const targets = [micDeskMap[mic], micDeskMap2[mic]].filter(Boolean) as string[];
        if (label && targets.length > 0) out.push({ mic, label, targets });
      }
      return out;
    },
    setMicCount,
    setMicTemplate,
    setMicPositionEligible,
    micFor,
    micForLeader,
    micRoster,
    effectiveLink,
    suppressLink,
    autoAdvance,
    followPro,
    followStatus,
    setFollowStatus,
    library,
    setLink,
    setAutoAdvance,
    setFollowPro,
    goToItem,
    loadLibrary,
    triggerPresentation,
    saveCredentials,
    loadServiceTypes,
    selectServiceType,
    selectPlan,
    startSync,
    stopSync,
    refresh,
    setMic,
    setKeyOverride,
    setLeaderOverride,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePco(): PcoStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePco must be used within PcoProvider");
  return ctx;
}

export function fmtLen(seconds: number): string {
  if (!seconds || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
