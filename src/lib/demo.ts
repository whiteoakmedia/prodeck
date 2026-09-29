// Demo mode — "Explore with sample data".
//
// A church evaluating ProDeck shouldn't have to wire up their booth to see
// what it does. With demo mode on, every backend call is answered from the
// sample world below and a ticker pushes live-looking events, so dashboards
// fill in immediately on a machine connected to nothing.
//
// Two hard rules, because this runs on real machines:
//   1. NOTHING is written. Every mutating command is a no-op that reports
//      success. Demo mode cannot touch settings, dashboards, or any file.
//   2. It is explicit and obvious — the user turns it on, and a banner says
//      so until they turn it off.
//
// Deliberately self-contained: this module must not import lib/tauri (which
// imports it), so the shapes here are structural.

const KEY = "prodeck.demo";

// Screenshot mode (`?shots=1`): the demo's sample world, drawn exactly as the
// booth app — no demo banner, booth-only pages on — for marketing shots.
// `page=planning`, `dash=2` (the third dashboard) and `phone=1` pick the
// surface. Nothing is written, same as demo mode.
const QS = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
export const IS_SHOTS: boolean = !!QS?.has("shots");
export const SHOT_PAGE: string | null = QS?.get("page") ?? null;
export const SHOT_DASH: number | null = QS?.get("dash") != null ? Number(QS.get("dash")) : null;
export const SHOT_PHONE: boolean = !!QS?.has("phone");
export const SHOT_TAB: string | null = QS?.get("tab") ?? null;
export const SHOT_CHAT: boolean = !!QS?.has("chat");

export const IS_DEMO: boolean = (() => {
  if (IS_SHOTS) return true;
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false; // storage unavailable — never guess our way into demo mode
  }
})();

/** Turn demo mode on/off and reload, so every store re-reads from scratch. */
export function setDemo(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  location.reload();
}

// ---------------------------------------------------------------- the world

const NOW = () => Date.now();
/** Today's service, 10:00 local — the plan is always "this Sunday". */
function serviceStart(): number {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  return d.getTime();
}
function iso(ts: number) {
  return new Date(ts).toISOString();
}

const SONGS = [
  { title: "Welcome & Countdown", type: "header", len: 300, key: "", leader: "" },
  { title: "King of Kings", type: "song", len: 320, key: "D", leader: "Maria Delgado" },
  { title: "Goodness of God", type: "song", len: 380, key: "Ab", leader: "Maria Delgado" },
  { title: "Welcome / Announcements", type: "item", len: 240, key: "", leader: "Pastor Dan" },
  { title: "Great Are You Lord", type: "song", len: 300, key: "A", leader: "Josh Kim" },
  { title: "Giving Moment", type: "item", len: 180, key: "", leader: "" },
  { title: "Message — “Rooted”, part 3", type: "item", len: 1980, key: "", leader: "Pastor Dan" },
  { title: "Response — Build My Life", type: "song", len: 360, key: "G", leader: "Josh Kim" },
  { title: "Closing & Dismissal", type: "item", len: 180, key: "", leader: "Pastor Dan" },
];

const TEAM = [
  { name: "Maria Delgado", position: "Worship Leader", team: "Worship", status: "C" },
  { name: "Josh Kim", position: "Acoustic / Vocals", team: "Worship", status: "C" },
  { name: "Tasha Brooks", position: "Keys", team: "Worship", status: "C" },
  { name: "Andre Willis", position: "Drums", team: "Worship", status: "U" },
  { name: "Sam Porter", position: "Audio", team: "Production", status: "C" },
  { name: "Kayla Nguyen", position: "ProPresenter", team: "Production", status: "C" },
  { name: "Devon Clark", position: "Camera", team: "Production", status: "C" },
  { name: "Renee Alvarez", position: "Production Lead", team: "Production", status: "C" },
  { name: "Marcus Webb", position: "Livestream", team: "Production", status: "D" },
];

/** Desk channels, so the console widget reads like a real Sunday. */
const DESK: [string, string][] = [
  ["input:1", "Kick"], ["input:2", "Snare"], ["input:3", "OH L"], ["input:4", "OH R"],
  ["input:5", "Bass"], ["input:6", "El Gtr"], ["input:7", "Ac Gtr"], ["input:8", "Keys L"],
  ["input:9", "Keys R"], ["input:10", "Track L"], ["input:11", "Track R"],
  ["input:12", "Vox Ld"], ["input:13", "Vox 2"], ["input:14", "Vox 3"],
  ["input:15", "Pulpit"], ["input:16", "Lav 1"],
  ["dca:1", "Drums"], ["dca:2", "EGs"], ["dca:3", "KEYs"], ["dca:4", "Speech"],
  ["dca:5", "AGs"], ["dca:6", "Pad"], ["dca:7", "TRX"], ["dca:8", "All FX"],
  ["grp:1", "Lead Voc"], ["sgrp:5", "BGVs"],
  ["main:1", "L/R"], ["fxs:1", "Vocal Verb"], ["fxs:2", "Drum Room"], ["fxr:1", "Vocal Verb"],
];

const CREW = TEAM.slice(0, 7).map((m, i) => ({
  id: `demo-${i + 1}`,
  name: m.name,
  approved: true,
  created_ms: NOW() - 86_400_000 * (30 - i),
  last_seen_ms: NOW() - 60_000 * (i * 7 + 3),
  role: m.position,
  pco_name: m.name,
  nickname: i === 1 ? "Josh" : "",
  pco_pinned: false,
  // The worship leader may put text on stage; the producer may page and
  // control. Everyone else is a viewer — which is what most of a team is.
  perms: i === 0 ? ["stage"] : i === 2 ? ["page", "control"] : [],
}));

// ------------------------------------------------------------- PCO payloads
// Shaped like the real Planning Center API so the app's own parsers run.

const ST_ID = "demo-st-1";
const PLAN_ID = "demo-plan-1";

function pcoServiceTypes() {
  return { data: [{ id: ST_ID, type: "ServiceType", attributes: { name: "Sunday Morning" } }] };
}
function pcoPlans() {
  const start = serviceStart();
  const fmt = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  return {
    data: [0, 7, 14].map((offsetDays, i) => {
      const ts = start + offsetDays * 86_400_000;
      return {
        id: i === 0 ? PLAN_ID : `${PLAN_ID}-${i}`,
        type: "Plan",
        attributes: {
          title: ["Rooted, part 3", "Rooted, part 4", "Rooted, finale"][i],
          series_title: "Rooted",
          dates: fmt(ts),
          sort_date: iso(ts),
        },
      };
    }),
  };
}
function pcoItems() {
  return {
    data: SONGS.map((s, i) => ({
      id: `demo-item-${i + 1}`,
      type: "Item",
      attributes: {
        title: s.title,
        sequence: i + 1,
        length: s.len,
        item_type: s.type,
        key_name: s.key,
        description: s.leader ? `${s.leader} lead` : "",
      },
      relationships: {},
    })),
    included: [],
  };
}
function pcoTeam() {
  const times = ["demo-time-1"];
  return {
    data: TEAM.map((m, i) => ({
      id: `demo-tm-${i + 1}`,
      type: "PlanPerson",
      attributes: {
        name: m.name,
        team_position_name: m.position,
        status: m.status,
        photo_thumbnail: "",
      },
      relationships: {
        team: { data: { id: m.team === "Worship" ? "t1" : "t2", type: "Team" } },
        times: { data: times.map((t) => ({ id: t, type: "PlanTime" })) },
      },
    })),
    included: [
      { id: "t1", type: "Team", attributes: { name: "Worship" } },
      { id: "t2", type: "Team", attributes: { name: "Production" } },
    ],
  };
}
function pcoPlanTimes() {
  const start = serviceStart();
  return {
    data: [
      {
        id: "demo-time-1",
        type: "PlanTime",
        attributes: { starts_at: iso(start), time_type: "service", name: "10:00 AM" },
      },
      {
        id: "demo-time-2",
        type: "PlanTime",
        attributes: { starts_at: iso(start + 5_400_000), time_type: "service", name: "11:30 AM" },
      },
    ],
  };
}
/** Which item is "live" — walks the plan on the service clock. */
/**
 * The current demo live item's window — what PCO's live_start_at and length
 * would say. Mirrors liveIndex() exactly, including the slow loop it falls
 * into once the plan has run out (45 s per item), or a demo left open all
 * afternoon shows "over by 454:38".
 */
function liveWindow(): { start: number; len: number } {
  const elapsed = NOW() - serviceStart();
  const idx = liveIndex();
  let acc = 0;
  for (let i = 0; i < SONGS.length; i++) acc += SONGS[i].len * 1000;
  if (elapsed >= 0 && elapsed < acc) {
    let before = 0;
    for (let i = 0; i < idx; i++) before += SONGS[i].len * 1000;
    return { start: serviceStart() + before, len: SONGS[idx].len };
  }
  // Looping: each item gets a 45 s slot; the current slot started at the last boundary.
  return { start: NOW() - (Math.max(0, elapsed) % 45_000), len: 45 };
}

function liveIndex(): number {
  const elapsed = NOW() - serviceStart();
  if (elapsed < 0) return 0;
  let acc = 0;
  for (let i = 0; i < SONGS.length; i++) {
    acc += SONGS[i].len * 1000;
    if (elapsed < acc) return i;
  }
  // After the plan runs out, loop slowly so a demo left open keeps moving.
  return Math.floor((elapsed / 45_000) % SONGS.length);
}
function pcoLive() {
  // Shaped like PCO's current_item_time: live_start_at / live_end_at are what
  // the LIVE screen counts down from, and what Keys to the Stage reads.
  const idx = liveIndex();
  const { start, len } = liveWindow();
  return {
    data: {
      attributes: { live_start_at: iso(start), live_end_at: null, length: len, length_offset: 0, exclude: false },
      relationships: { item: { data: { id: `demo-item-${idx + 1}`, type: "Item" } } },
    },
  };
}

// ------------------------------------------------------------ ProPresenter

function slideTitle(): string {
  const item = SONGS[liveIndex()];
  return item.type === "song" ? item.title : item.title;
}
/**
 * The stage message, demo-side. It is held here and echoed back on the same
 * `pp:status` stream ProPresenter uses, so the Stage Message widget behaves
 * exactly as it would on a real rig — send, see it land, clear it. Without
 * this the widget looked dead in demo mode, which is the one place a church
 * evaluating ProDeck actually looks.
 */
let demoStageMessage = "";

export function demoSetStageMessage(msg: string) {
  demoStageMessage = msg;
  emit("pp:status", { stream: "stage_message", data: { message: msg } });
}

function ppStatusPayloads(): { stream: string; data: unknown }[] {
  const idx = liveIndex();
  const slide = Math.floor((NOW() / 12_000) % 6);
  return [
    {
      stream: "active_presentation",
      data: { presentation: { id: { uuid: `demo-pres-${idx}`, name: slideTitle(), index: idx } } },
    },
    { stream: "slide_index", data: { presentation_index: { index: slide } } },
    {
      stream: "layers",
      data: { slide: true, media: idx === 6, audio: false, props: false, announcements: idx === 0, messages: false, video_input: false },
    },
    { stream: "stage_message", data: { message: demoStageMessage } },
  ];
}

/** A slide-shaped SVG so thumbnails aren't grey boxes. Public-domain hymn
 *  lines only (see PP_SONGS) — never copyrighted lyrics in a screenshot. */
const THUMB_LINES = [
  "Holy, holy, holy! Lord God Almighty!\nEarly in the morning our song shall rise to Thee",
  "Amazing grace! how sweet the sound\nThat saved a wretch like me!",
  "When peace like a river attendeth my way,\nWhen sorrows like sea billows roll",
  "It is well with my soul,\nIt is well, it is well with my soul.",
  "Be Thou my Vision, O Lord of my heart;\nNaught be all else to me, save that Thou art",
  "I once was lost, but now am found,\nWas blind, but now I see.",
];
function demoThumb(index: number, text = THUMB_LINES[index % THUMB_LINES.length]): string {
  const rows = text.split("\n").map((l) => l.replace(/[<>&]/g, ""));
  const y0 = 140 - (rows.length - 1) * 16;
  const tspans = rows.map((l, i) => `<tspan x="240" y="${y0 + i * 32}">${l}</tspan>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#10151f"/><text font-family="system-ui,sans-serif" font-size="19" fill="#eef3fa" text-anchor="middle">${tspans}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

// ------------------------------------------------------------------ console

function deskSnapshot() {
  const names: Record<string, string> = {};
  const mutes: Record<string, boolean> = {};
  const faders: Record<string, number> = {};
  const idx = liveIndex();
  const speaking = SONGS[idx].type !== "song";
  for (const [id, name] of DESK) {
    names[id] = name;
    // Speech channels open during the message, band channels open in songs.
    const speech = id === "input:15" || id === "input:16" || id === "dca:4";
    mutes[id] = speaking ? !speech && id.startsWith("input:") : speech;
    faders[id] = id.startsWith("main") ? 108 : 96 + ((parseInt(id.split(":")[1], 10) * 7) % 12);
  }
  const seenAt = NOW();
  const faderSeen: Record<string, number> = {};
  for (const id of Object.keys(faders)) faderSeen[id] = seenAt;
  // Every mute reported by the desk this connection: confirmed, not "remembered".
  const muteSeen: Record<string, number> = {};
  for (const id of Object.keys(mutes)) muteSeen[id] = seenAt;
  return {
    model: "avantis",
    namesSupported: true,
    maxScene: 500,
    connected: true,
    connectedAt: seenAt - 3_600_000,
    faderSeen,
    muteSeen,
    scene: speaking ? 4 : 2,
    mutes,
    faders,
    names,
    colors: {},
    watchLog: [],
  };
}


// ------------------------------------------------ recording, routing, stream

/** The booth's 32 recorded inputs: [name, what feeds it]. */
const REC_INPUTS: [string, string][] = [
  ["Room L", "FOH-Console 1 · Room group L"], ["Room R", "FOH-Console 2 · Room group R"],
  ["Stream L", "FOH-Console 63 · Stream matrix L"], ["Stream R", "FOH-Console 64 · Stream matrix R"],
  ["Click", "Playback-Mac 15"], ["Guide", "Playback-Mac 16"],
  ["Lav 1", "FOH-Console 7 · Lav 1 direct out"], ["Pulpit", "FOH-Console 8 · Pulpit direct out"],
  ["Kick", "FOH-Console 9 · Kick direct out"], ["Snare", "FOH-Console 10 · Snare direct out"],
  ["OH L", "FOH-Console 11 · OH L direct out"], ["OH R", "FOH-Console 12 · OH R direct out"],
  ["Bass", "FOH-Console 13 · Bass direct out"], ["El Gtr", "FOH-Console 14 · El Gtr direct out"],
  ["Ac Gtr", "FOH-Console 15 · Ac Gtr direct out"], ["Keys L", "FOH-Console 16 · Keys L direct out"],
  ["Keys R", "FOH-Console 17 · Keys R direct out"], ["Track L", "Playback-Mac 01"], ["Track R", "Playback-Mac 02"],
  ["Vox Ld", "Wireless-1 · 01"], ["Vox 2", "Wireless-1 · 02"], ["Vox 3", "Wireless-1 · 03"],
  ["House L", "FOH-Console 39 · House L direct out"], ["House R", "FOH-Console 40 · House R direct out"],
  ["Main L", "FOH-Console 57 · Main L+R L"], ["Main R", "FOH-Console 58 · Main L+R R"],
];

function recNames() {
  const names: Record<string, string> = {};
  const sources: Record<string, string> = {};
  REC_INPUTS.forEach(([n, src], i) => {
    names[String(i + 1)] = n;
    sources[String(i + 1)] = src.replace(/^(\S+) (\d+)/, "$1 ch $2");
  });
  return { names, sources };
}

/** Per-input levels (dBFS), moving with the service: band in songs, speech in the message. */
function channelLevels(): number[] {
  const speaking = SONGS[liveIndex()].type !== "song";
  const out: number[] = [];
  for (let i = 1; i <= 64; i++) {
    const n = REC_INPUTS[i - 1]?.[0] ?? "";
    let base = -120;
    if (i <= 4) base = -30;
    else if (/Lav|Pulpit/.test(n)) base = speaking ? -24 : -70;
    else if (/Click|Guide|Track/.test(n)) base = speaking ? -120 : -18;
    else if (/House|Main/.test(n)) base = -32;
    else if (/Vox/.test(n)) base = speaking ? -48 : -22;
    else if (n) base = speaking ? -68 : -26;
    out.push(base <= -119 ? -120 : Math.round((base + (Math.random() * 8 - 4)) * 10) / 10);
  }
  return out;
}

function danteSnapshot() {
  const t = Math.floor(NOW() / 1000);
  const rx = (subs: [number, string, string][], count: number) => {
    const m = new Map(subs.map(([ch, dev, txc]) => [ch, { dev, txc }]));
    return Array.from({ length: count }, (_, i) => {
      const s = m.get(i + 1);
      return { ch: i + 1, name: String(i + 1).padStart(2, "0"), txDevice: s?.dev ?? null, txChannel: s?.txc ?? null, status: s ? "Connected" : "No subscription", ok: !!s };
    });
  };
  const booth: [number, string, string][] = REC_INPUTS.map(([, src], i) => {
    const m = src.match(/^(\S+)(?: ·)? (\d+)/);
    return [i + 1, m?.[1] ?? "FOH-Console", (m?.[2] ?? "01").padStart(2, "0")];
  });
  const tx = (n: number) => Array.from({ length: n }, (_, i) => ({ ch: i + 1, name: String(i + 1).padStart(2, "0") }));
  return {
    at: t - 4,
    localName: "Booth-Mac",
    devices: [
      { name: "Booth-Mac", ip: "10.0.80.54", port: 4440, model: "Dante Virtual Soundcard", rxCount: 64, txCount: 64, rx: rx(booth, 64), tx: tx(64), error: null },
      { name: "FOH-Console", ip: "10.0.80.146", port: 4440, model: "Dante64", rxCount: 64, txCount: 64, rx: rx([[1, "Playback-Mac", "01"], [2, "Playback-Mac", "02"], [15, "Playback-Mac", "15"], [16, "Playback-Mac", "16"], [41, "Wireless-1", "01"], [42, "Wireless-1", "02"], [43, "Wireless-1", "03"], [44, "Wireless-2", "01"]], 64), tx: tx(64), error: null },
      { name: "Playback-Mac", ip: "10.0.80.60", port: 4440, model: "Dante Virtual Soundcard", rxCount: 0, txCount: 24, rx: [], tx: tx(24), error: null },
      { name: "Stream-Encoder", ip: "10.0.80.143", port: 4440, model: "AVIO", rxCount: 2, txCount: 0, rx: rx([[1, "FOH-Console", "63"], [2, "FOH-Console", "64"]], 2), tx: [], error: null },
      { name: "Wireless-1", ip: "10.0.80.148", port: 4440, model: "ULXD4Q", rxCount: 0, txCount: 4, rx: [], tx: tx(4), error: null },
      { name: "Wireless-2", ip: "10.0.80.149", port: 4440, model: "ULXD4Q", rxCount: 0, txCount: 4, rx: [], tx: tx(4), error: null },
    ],
    changes: [
      { at: t - 3600 * 20, text: "Booth-Mac 24: (nothing) → FOH-Console · 40" },
      { at: t - 3600 * 20, text: "Booth-Mac 23: (nothing) → FOH-Console · 39" },
      { at: t - 3600 * 46, text: "FOH-Console 44: Wireless-2 · 02 → Wireless-2 · 01" },
    ],
  };
}

function avantisPatch() {
  const inputs = DESK.filter(([id]) => id.startsWith("input:")).map(([id], i) => {
    const ch = Number(id.slice(6));
    const slink = ch <= 9;
    return { ch, port: slink ? 3 : 1, socket: slink ? ch : 30 + i, text: slink ? `SLink ${ch}` : `I/O Port 1 (Dante) ${30 + i}` };
  });
  const outs: [number, string][] = [
    [1, "Room L"], [2, "Room R"], [7, "Ch 16 Lav 1 direct out"], [8, "Ch 15 Pulpit direct out"], [9, "Ch 1 Kick direct out"],
    [10, "Ch 2 Snare direct out"], [11, "Ch 3 OH L direct out"], [12, "Ch 4 OH R direct out"], [13, "Ch 5 Bass direct out"],
    [14, "Ch 6 El Gtr direct out"], [15, "Ch 7 Ac Gtr direct out"], [16, "Ch 8 Keys L direct out"], [17, "Ch 9 Keys R direct out"],
    [36, "Lead Voc"], [57, "Main L+R L"], [58, "Main L+R R"], [63, "Stream matrix L"], [64, "Stream matrix R"],
  ];
  return {
    file: "~/Downloads/Avantis/Shows/sunday-0928.tar.gz",
    exportedAt: Math.floor(NOW() / 1000) - 86_400,
    inputs,
    danteOut: outs.map(([out, text]) => ({ out, code: 4, index: 0, text })),
    changes: ["Dante out 17: — → Ch 9 Keys R direct out", "Ch 12 Vox Ld: input I/O Port 1 (Dante) 40 → I/O Port 1 (Dante) 41"],
  };
}

/** Three past Sundays of planned-vs-actual timing and SPL, for Analytics. */
function trackingHistory() {
  const data: Record<string, Record<string, unknown>> = {};
  const rnd = (seed: number) => {
    const x = Math.sin(seed * 999) * 10000;
    return x - Math.floor(x);
  };
  [1, 2, 3].forEach((w) => {
    const start = LAST_SUNDAY * 1000 - (w - 1) * 7 * 86_400_000 + 120_000;
    const date = new Date(start).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
    const bucket: Record<string, unknown> = {};
    let t = start;
    SONGS.forEach((it, i) => {
      const r = rnd(w * 31 + i);
      const actual = Math.round(it.len * (0.86 + r * 0.32));
      const song = it.type === "song";
      const avg = song ? 90 + r * 3 : it.type === "header" ? 78 : 68 + r * 3;
      const n = Math.max(1, Math.round(actual / 0.5));
      bucket[`h-${i}`] = { title: it.title, type: it.type, planned: it.len, actual, splPeak: avg + 5 + r * 2, splSum: avg * n, splCount: n, splEnergy: n * Math.pow(10, avg / 10), startedAt: null };
      t += actual * 1000;
    });
    bucket._meta = {
      planId: `demo-past-${w}`, timeId: "demo-time-1", planTitle: "Sunday Morning", planDate: date, timeName: "10:00 AM",
      rehearsal: false, savedAt: t, heartbeatAt: t, startedAt: start, endedAt: t,
      plan: SONGS.map((it, i) => ({ id: `h-${i}`, title: it.title, type: it.type, length: it.len })),
    };
    data[`demo-past-${w}::demo-time-1`] = bucket;
  });
  return data;
}

/** A believable stream-mix report: a 90-minute service, one row a second. */
function streamReport(start: number) {
  const rows: number[][] = [];
  const tilt = [4, 3.5, 1, 0, 0, -3.5, -4, -4.5, -5];
  const ref = [-10.3, -7.5, -6.7, -6.0, -6.5, -7.8, -10.3, -13.2, -15.2];
  const plan: [number, "music" | "talk"][] = [[1500, "music"], [420, "talk"], [360, "music"], [2100, "talk"], [540, "music"], [300, "talk"]];
  let t = start;
  for (const [secs, kind] of plan) {
    for (let i = 0; i < secs; i++, t++) {
      const music = kind === "music";
      const lufs = music ? -21.5 + Math.sin(i / 40) * 2.5 + (Math.random() - 0.5) * 2 : -26.5 + (Math.random() - 0.5) * 3;
      const bands = music ? ref.map((b, k) => b + tilt[k] + (Math.random() - 0.5)) : [-30, -20, -9, -6, -5, -7, -10, -16, -22].map((b) => b + (Math.random() - 0.5));
      rows.push([t, Math.round(lufs * 10) / 10, Math.round((lufs + 12) * 10) / 10, music ? 0.78 : 0.99, ...bands.map((b) => Math.round(b * 10) / 10)]);
    }
  }
  return rows;
}
const LAST_SUNDAY = (() => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 7) % 7 || 7));
  d.setHours(9, 58, 0, 0);
  return Math.floor(d.getTime() / 1000);
})();


// ------------------------------------------------------- ProPresenter library
// Public-domain hymn texts only (Heber 1826, Newton 1779, Spafford 1873,
// Byrne/Hull 1912) — screenshots must never carry copyrighted lyrics.

const PP_SONGS: { name: string; groups: [string, [number, number, number], string[]][] }[] = [
  { name: "Holy, Holy, Holy", groups: [
    ["Verse 1", [0.25, 0.5, 1], ["Holy, holy, holy! Lord God Almighty!\nEarly in the morning our song shall rise to Thee", "Holy, holy, holy, merciful and mighty!\nGod in three Persons, blessed Trinity!"]],
    ["Verse 2", [0.3, 0.8, 0.5], ["Holy, holy, holy! All the saints adore Thee,\nCasting down their golden crowns around the glassy sea"]],
  ] },
  { name: "Amazing Grace", groups: [
    ["Verse 1", [0.25, 0.5, 1], ["Amazing grace! how sweet the sound\nThat saved a wretch like me!", "I once was lost, but now am found,\nWas blind, but now I see."]],
    ["Verse 2", [0.3, 0.8, 0.5], ["’Twas grace that taught my heart to fear,\nAnd grace my fears relieved;", "How precious did that grace appear\nThe hour I first believed!"]],
  ] },
  { name: "It Is Well", groups: [
    ["Verse 1", [0.25, 0.5, 1], ["When peace like a river attendeth my way,\nWhen sorrows like sea billows roll;", "Whatever my lot, Thou hast taught me to say,\nIt is well, it is well with my soul."]],
    ["Chorus", [0.95, 0.35, 0.35], ["It is well with my soul,\nIt is well, it is well with my soul."]],
  ] },
  { name: "Be Thou My Vision", groups: [
    ["Verse 1", [0.25, 0.5, 1], ["Be Thou my Vision, O Lord of my heart;\nNaught be all else to me, save that Thou art", "Thou my best Thought, by day or by night,\nWaking or sleeping, Thy presence my light."]],
  ] },
];

function ppLibrary(path: string): unknown {
  const named = (names: string[], prefix: string) => names.map((name, index) => ({ id: { uuid: `${prefix}-${index}`, name, index } }));
  if (path === "looks") return named(["Default", "Worship", "Sermon", "Announcements"], "look");
  if (path === "look/current") return { id: { uuid: "look-1", name: "Worship", index: 1 } };
  if (path === "macros") return named(["Walk-in", "Worship Start", "Sermon", "Response", "Dismissal", "Clear to Logo"], "macro");
  if (path === "props") return named(["Lower Third", "Logo Bug", "Countdown Frame"], "prop");
  if (path === "messages") return named(["Parent Pickup", "Car Lights On", "Welcome Guests"], "msg");
  if (path === "timers") return named(["Service Countdown", "Sermon Clock", "Walk-in"], "timer");
  if (path === "status/screens")
    return [
      { id: { uuid: "scr-0", name: "Main Screens", index: 0 }, screen_type: "audience" },
      { id: { uuid: "scr-1", name: "Lobby TVs", index: 1 }, screen_type: "audience" },
      { id: { uuid: "scr-2", name: "Stage Display", index: 0 }, screen_type: "stage" },
    ];
  if (path === "playlists")
    return [
      { id: { uuid: "pl-sun", name: "Sunday Morning", index: 0 }, field_type: "playlist" },
      { id: { uuid: "pl-night", name: "Worship Night", index: 1 }, field_type: "playlist" },
      { id: { uuid: "pl-loop", name: "Announcements Loop", index: 2 }, field_type: "playlist" },
    ];
  if (path.startsWith("playlist/"))
    return {
      id: { uuid: path.slice(9), name: "Sunday Morning" },
      items: PP_SONGS.map((sg, i) => ({
        id: { uuid: `pli-${i}`, name: sg.name, index: i },
        type: "presentation",
        presentation_info: { presentation_uuid: `pp-song-${i}`, arrangement_uuid: "", arrangement_name: "" },
      })),
    };
  const m = path.match(/^presentation\/pp-song-(\d+)/);
  if (m) {
    const sg = PP_SONGS[Number(m[1])] ?? PP_SONGS[0];
    return {
      presentation: {
        id: { uuid: `pp-song-${m[1]}`, name: sg.name },
        groups: sg.groups.map(([name, [r, g, b], slides]) => ({ name, color: { red: r, green: g, blue: b, alpha: 1 }, slides: slides.map((text) => ({ text, enabled: true })) })),
        arrangements: [],
      },
    };
  }
  return null;
}

// -------------------------------------------------------------- the handler

const SETTINGS_OVERLAY: Record<string, unknown> = {
  pp_host: "10.0.1.42",
  pp_port: 51417,
  pp_auto_connect: true,
  // Both halves are needed: the store treats "has credentials" as app id AND
  // secret. These are placeholders — demo mode never reaches Planning Center.
  pco_app_id: "demo",
  pco_secret: "demo",
  pco_client_id: null,
  audio_mic_channels: { "1": 20, "2": 21, "3": 22 }, // Vox Ld, Vox 2, Vox 3 on the recorded inputs
  spl_time_weighting: "slow",
  spl_freq_weighting: "a",
  web_enabled: true,
  web_port: 8088,
  web_invite_token: "demotoken",
  device_name: "booth-mac",
  avantis_enabled: true,
  avantis_model: "avantis",
  avantis_host: "10.0.1.16",
  avantis_midi_base: 12,
  audio_input: "Demo Input (2ch)",
  spl_calibration: 125.7,
  ga4_property_id: "000000000",
  tap_enabled: true,
  // Collection-typed fields, so a browser demo (which has no real struct to
  // merge over) never hands a component `undefined` where it maps or filters.
  avantis_softkeys: [],
  avantis_scene_labels: {},
  web_member_password: "demo",
  public_url: "",
  tap_edge_url: "",
  keep_awake: true,
  alert_config: {},
  position_guides: {},
  multitrack_names: recNames().names,
  multitrack_sources: recNames().sources,
  multitrack_volume: "/Volumes/Recording SSD",
  multitrack_auto: false,
  multitrack_drop_silent: true,
  stream_report_on: true,
  stream_report_channels: [3, 4],
  stream_report_offset_db: 0,
  automix_bgv_ride: true,
  automix_feeds_on: true,
};

/**
 * Commands that CHANGE something. In demo mode they succeed and do nothing.
 * Deliberately matched on mutating verbs, not on module prefixes: an earlier
 * version used `page_`/`chat_`/`identity_` and swallowed the reads
 * (`page_list`, `chat_history`, `identity_list`) along with the writes.
 * Reads modelled below are answered first regardless.
 */
const WRITES =
  /^(update_settings|save_|web_start|web_stop|pco_(save|set|live|start|stop|sync)|pp_(connect|disconnect|trigger|clear|put|post|set|timer|focus|next|previous)|avantis_(set|recall)|tap_(override|save|test|check)|identity_(register|login|approve|remove|set_role|set_perms|heal|update)|invite_(create|revoke)|checkin_(set|geo|auto)|checklist_|push_(subscribe|unsubscribe)|page_(send|ack|rebuzz)|chat_(send|clear)|keepalive_(install|uninstall|relaunch)|keep_awake_set|backup_(export|import)|(start|stop)_audio_capture|ndi_(start|stop)|midi_(send|open)|relay_(start|stop|connect)|transcription_(start|stop)|diag_open_issue|gemini_)/;

/** Commands whose callers do `.filter`/`.map` — an unmodelled one must be []. */
const ARRAY_CMDS = new Set([
  "chat_history", "page_list", "identity_roles", "discover_services",
  "invite_list", "ndi_discover_sources", "posfile_list", "tap_check_links",
  "diag_recent_log", "list_audio_inputs", "list_midi_inputs", "list_midi_outputs",
  "load_knowledge", "assist_log_tail",
]);
/** Commands whose callers read fields off the result. */
const OBJECT_CMDS: Record<string, unknown> = {
  get_relay_status: { mode: "off", clients: 0, connected: false },
  transcription_status: { running: false, model: "", bin: "" },
  tap_mappings: { mappings: {}, default: "" },
  pco_live_controller: { controller: null, me: false },
  pp_is_connected: true,
  keysend_state: { enabled: true, midiPort: "Network Lyrics", midiConnected: true, oscHost: "", liveSong: "Great Are You Lord", liveKey: "G", lastKey: "G", lastProgram: 7, lastAt: Date.now() - 120_000, lastBy: "auto" },
  assist_status: { configured: false, model: "claude-sonnet-5", members: true, usedThisMonth: 0, monthlyCap: 500, knowledgeFiles: [], knowledgeDir: "" },
  audio_input_channels: 2,
  default_audio_input: "Demo Input (2ch)",
  web_status: { running: true, port: 8088 },
  follow_status: { modelReady: true, model: "large-v3-turbo", usedThisMonth: 14, monthlyCap: 500 },
  pco_oauth_status: { connected: true, who: "Renee Alvarez", scope: "services people", configured: true, own_app: false },
  automix_store_load: { maps: {}, homes: {}, obs: {}, songRules: {}, dismissed: [], names: {} },
};

// The real settings are fetched once, only to keep the full struct shape.
let settingsBase: Record<string, unknown> | null = null;

/** Answer one command from the sample world. Unknown reads get a benign empty. */
export async function demoInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const out = (v: unknown) => v as T;

  // Modelled reads win over every pattern below.
  switch (cmd) {
    case "get_settings": {
      // Merge over the REAL settings so every field keeps a valid shape and
      // nothing here has to know the full struct.
      if (settingsBase === null) {
        // Start from the app's own defaults (every field, right shape — see
        // settings.rs dump_defaults), so a browser with no booth still gets
        // a complete struct. On the desktop the real struct goes on top.
        const { default: defaults } = await import("./demoSettingsDefaults.json");
        settingsBase = { ...(defaults as Record<string, unknown>) };
        const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
        if (native) {
          const { realInvoke } = await import("./tauri");
          try {
            settingsBase = { ...settingsBase, ...((await realInvoke<Record<string, unknown>>("get_settings")) ?? {}) };
          } catch {
            /* keep the defaults */
          }
        }
      }
      return out({ ...settingsBase, ...SETTINGS_OVERLAY });
    }
    case "load_dashboards": {
      // Reuse the real starter templates — the demo shows what they'd get.
      const { DASHBOARD_TEMPLATES } = await import("./dashboards");
      return out(
        DASHBOARD_TEMPLATES.map((t, i) => ({
          id: `demo-dash-${i}`,
          name: t.name,
          widgets: t.build(),
        })),
      );
    }
    case "load_checklists": {
      const { buildStarterChecklists } = await import("./checklistTemplates");
      return out(buildStarterChecklists([]));
    }
    case "load_pco_data":
      // Stands in for a configured booth's pco.json. Without a saved
      // selection the store never loads plans, so the rundown stays empty.
      return out({
        selectedServiceTypeId: ST_ID,
        selectedPlanId: PLAN_ID,
        selectedServiceTimeId: "demo-time-1",
        keyOverrides: {},
        leaderOverrides: {},
        autoAdvance: false,
        followPro: true,
        micAssignments: { [PLAN_ID]: { "demo-tm-1": "1", "demo-tm-2": "2", "demo-tm-5": "15" } },
        micNameMap: {},
        checkinTimes: {},
        micCount: 16,
        micTemplate: {},
      });
    case "pco_test":
      return out({ data: { attributes: { name: "Demo Church" } } });
    case "pco_creds":
      return out({ app_id: "demo", known: true });
    case "pco_get": {
      const path = String(args?.path ?? "");
      // Most specific first: the items/team/times paths all CONTAIN "/plans"
      // (…/service_types/X/plans/Y/items), so a plans check must come last or
      // it answers every one of them with the plan list.
      if (path.includes("/items")) return out(pcoItems());
      if (path.includes("/team_members")) return out(pcoTeam());
      if (path.includes("/plan_times")) return out(pcoPlanTimes());
      if (path.endsWith("/live")) return out(pcoLive());
      if (path.includes("service_types?")) return out(pcoServiceTypes());
      if (path.includes("/plans")) return out(pcoPlans());
      return out({ data: [] });
    }
    case "avantis_state":
      return out(deskSnapshot());
    case "ga4_state": {
      const base = 30 + Math.round(12 * Math.sin(NOW() / 60_000));
      const history = Array.from({ length: 30 }, (_, i) => ({
        at: Math.floor(NOW() / 1000) - (29 - i) * 30,
        viewers: Math.max(0, base + Math.round(6 * Math.sin((NOW() / 30_000) - i / 3))),
      }));
      return out({ configured: true, viewers: base, updated: Math.floor(NOW() / 1000), error: null, history });
    }
    case "identity_list":
      return out(CREW);
    case "identity_roles":
      return out(Array.from(new Set(CREW.map((c) => c.role))));
    case "checkin_list": {
      const at: Record<string, number> = {};
      CREW.slice(0, 5).forEach((c, i) => (at[c.id] = NOW() - (40 - i * 6) * 60_000));
      return out({ at, serviceKey: "demo" });
    }
    case "web_whoami":
      // The demo booth is an admin: every grant, so every control shows.
      return out({ tier: "admin", perms: ["page", "stage", "control", "tap", "manage"], name: "Booth" });
    case "keepalive_status":
      return out({
        installed: true, program: "/Applications/ProDeck.app/Contents/MacOS/prodeck",
        matchesCurrent: true, underLaunchd: true, inApplications: true,
        exe: "/Applications/ProDeck.app/Contents/MacOS/prodeck", keepAwake: true,
      });
    case "pp_thumbnail": {
      const m = String(args?.uuid ?? args?.presentationUuid ?? "").match(/^pp-song-(\d+)/);
      const idx = Number(args?.index ?? args?.cueIndex ?? 0);
      if (m) {
        const slides = (PP_SONGS[Number(m[1])] ?? PP_SONGS[0]).groups.flatMap((g) => g[2]);
        return out(demoThumb(idx, slides[idx % slides.length]));
      }
      return out(demoThumb(idx));
    }
    case "pp_playlist_thumbnail":
      return out(demoThumb(Number(args?.index ?? args?.cueIndex ?? 0)));
    case "tap_edge_state":
      return out({ keyword: "give", url: "https://example.church/give", setAgo: 42, revertsIn: 172 });
    case "tap_stats":
    case "tap_stats_range":
      return out({ counts: { give: 132, connect: 41, groups: 18 }, days: 7 });
    case "list_audio_inputs":
      return out(["Demo Input (2ch)", "Dante Virtual Soundcard"]);
    case "discover_services":
      return out([{ kind: "propresenter", name: "Sanctuary Pro", host: "10.0.1.42", port: 51417, addresses: ["10.0.1.42"] }]);
    case "chat_history":
      return out([
        { id: 1, from: "Renee Alvarez", target: "team", channel: "team", text: "Doors open in 10.", ts: NOW() - 900_000 },
        { id: 2, from: "Sam Porter", target: "team", channel: "team", text: "Pulpit mic swapped, battery was low.", ts: NOW() - 480_000 },
        { id: 3, from: "Kayla Nguyen", target: "team", channel: "team", text: "Lyrics for the new song are in — slides 1–14.", ts: NOW() - 300_000 },
        { id: 4, from: "Booth", target: "team", channel: "team", text: "Walk-in music down at 9:58, countdown at 9:59.", ts: NOW() - 120_000 },
      ]);
    case "page_list":
      return out([]);
    case "diag_recent_log":
      return out(["(demo mode — the real log is hidden while sample data is on)"]);
    case "pp_get": {
      const v = ppLibrary(String(args?.path ?? "").replace(/^\/?(v1\/)?/, ""));
      if (v != null) return out(v);
      break;
    }
    case "checkin_wan_ip":
      return out(["203.0.113.24"]);
    case "load_tracking":
      return out(trackingHistory());
    case "multitrack_status":
      return out({
        recording: demoRec != null,
        live: demoRec != null ? recLive() : null,
        last: { recording: false, id: "r1", label: "Sunday Morning", dir: "/Volumes/Recording SSD/ProDeck Recordings/" + new Date(LAST_SUNDAY * 1000).toISOString().slice(0, 10) + " Sunday Morning", folders: [], secs: 5580, tracks: 26, silentRemoved: 38, markers: 41, dropped: 0, note: null },
      });
    case "multitrack_volumes":
      return out([
        { path: "", name: "This Mac (internal)", internal: true, folder: "~/Music/ProDeck Recordings", freeGb: 612, totalGb: 994 },
        { path: "/Volumes/Recording SSD", name: "Recording SSD", internal: false, folder: "/Volumes/Recording SSD/ProDeck Recordings", freeGb: 1718, totalGb: 2000 },
      ]);
    case "multitrack_sessions": {
      const day = (ago: number, label: string, secs: number, tracks: number, markers: number) => {
        const t = LAST_SUNDAY - ago * 86_400;
        const date = new Date(t * 1000).toISOString().slice(0, 10);
        return { dir: `/Volumes/Recording SSD/ProDeck Recordings/${date} ${label}`, folder: `${date} ${label}`, label, start: t, seconds: secs, tracks, markers, note: null };
      };
      return out([day(0, "Sunday Morning", 5580, 26, 41), day(2, "Worship Night (rehearsal)", 3120, 24, 18), day(7, "Sunday Morning", 5460, 25, 39), day(14, "Sunday Morning", 5700, 26, 44)]);
    }
    case "multitrack_start":
      demoRec = NOW();
      setTimeout(() => emit("multitrack:status", recLive()), 100);
      return out({ dir: "/Volumes/Recording SSD/ProDeck Recordings/demo", channels: 64, note: null });
    case "multitrack_stop":
      demoRec = null;
      setTimeout(() => emit("multitrack:status", { recording: false, id: "r2", label: "Sunday Morning", dir: "", folders: [], secs: 0, tracks: 26, silentRemoved: 38, markers: 0, dropped: 0, note: null }), 100);
      return out(null);
    case "dante_snapshot":
      return out(danteSnapshot());
    case "avantis_patch_get":
      return out(avantisPatch());
    case "stream_reports_list":
      return out([0, 7, 14, 21].map((w) => ({ id: `s${LAST_SUNDAY - w * 604_800}`, start: LAST_SUNDAY - w * 604_800, end: LAST_SUNDAY - w * 604_800 + 5220, soundSecs: 5220 })));
    case "stream_report_get": {
      const start = Number(String(args?.id ?? "").slice(1)) || LAST_SUNDAY;
      return out({ id: String(args?.id ?? ""), start, offsetDb: 0, rows: streamReport(start) });
    }
  }

  // Anything that changes state: succeed, change nothing.
  // Modelled writes: still nothing leaves the browser, but the demo reflects
  // the change so the widget can be seen working.
  if (cmd === "pp_set_stage_message") {
    const msg = String(args?.message ?? "");
    setTimeout(() => demoSetStageMessage(msg), 120);
    return out(null);
  }
  if (cmd === "pp_clear_stage_message") {
    setTimeout(() => demoSetStageMessage(""), 120);
    return out(null);
  }
  // Chat broadcasts, echoed back so the stage/confidence surfaces demonstrate
  // themselves. Same reasoning as the stage message: a control that visibly
  // does nothing in demo mode reads as broken, not as "saves nothing".
  if (cmd === "chat_send") {
    const a = (args ?? {}) as Record<string, unknown>;
    const msg = {
      id: Date.now(),
      from: String(a.from ?? "Booth"),
      text: String(a.text ?? ""),
      target: String(a.target ?? "team"),
      channel: String(a.channel ?? "team"),
      ts: Date.now(),
    };
    setTimeout(() => emit("chat:message", msg), 120);
    return out(msg);
  }
  if (cmd === "chat_clear_confidence") {
    setTimeout(() => emit("chat:confidence_clear", {}), 120);
    return out(null);
  }
  if (WRITES.test(cmd)) return out(null);
  // Reads we don't model return the SHAPE the caller expects — a demo that
  // hands back null where an array was expected crashes the page.
  if (ARRAY_CMDS.has(cmd)) return out([]);
  if (cmd in OBJECT_CMDS) return out(OBJECT_CMDS[cmd]);
  return out(null);
}

// -------------------------------------------------------------- live events

let demoRec: number | null = null;
function recLive() {
  const secs = demoRec != null ? (NOW() - demoRec) / 1000 + 1834 : 0;
  const levels = channelLevels();
  return { recording: true, id: "demo", dir: "/Volumes/Recording SSD/ProDeck Recordings/Sunday Morning", secs, channels: 64, withSignal: levels.filter((l) => l > -60).length, freeGb: 1716.4, hoursLeft: 51.8, dropped: 0, levels, error: null };
}

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
let ticking = false;

export function demoOn(event: string, cb: Handler): () => void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(cb);
  startTicker();
  return () => set!.delete(cb);
}

function emit(event: string, payload: unknown) {
  const set = handlers.get(event);
  if (!set) return;
  for (const h of set) {
    try {
      h(payload);
    } catch {
      /* one bad listener must not stop the demo */
    }
  }
}

function startTicker() {
  if (ticking) return;
  ticking = true;
  // Connected, immediately — the demo's whole point is a populated app.
  setTimeout(() => {
    emit("pp:connected", { host: "10.0.1.42", port: 51417 });
    emit("avantis:status", { connected: true });
    emit("avantis:state", deskSnapshot());
    for (const p of ppStatusPayloads()) emit("pp:status", p);
    // The real backend runs the Planning Center poller and announces it; the
    // health light and the rundown's "NOW" both key off these.
    emit("pco:sync_started", {});
    emit("pco:live", pcoLive());
  }, 60);

  // An RTA that looks like a band in songs and a voice in the message.
  setInterval(() => {
    const speaking = SONGS[liveIndex()].type !== "song";
    const n = 28; // the backend's band count
    const bands = Array.from({ length: n }, (_, i) => {
      const x = i / (n - 1);
      const shape = speaking ? -62 - 120 * Math.pow(x - 0.42, 2) : -44 - 20 * x + (x < 0.15 ? 4 : 0);
      return Math.round((shape + (Math.random() * 4 - 2)) * 10) / 10;
    });
    emit("audio:rta", bands);
  }, 200);

  // Per-input levels for the Recording page and the automix's ears.
  setInterval(() => {
    const lv = channelLevels();
    emit("audio:channels_rms", lv);
    // Peaks (0..1) — the mic-check and routing meters listen to these.
    emit("audio:channels", lv.map((db) => (db <= -119 ? 0 : Math.min(1, Math.pow(10, (db + 9) / 20)))));
    if (demoRec != null) emit("multitrack:status", recLive());
  }, 250);

  // Slides, layers and the desk move with the service clock.
  setInterval(() => {
    for (const p of ppStatusPayloads()) emit("pp:status", p);
    emit("avantis:state", deskSnapshot());
  }, 3000);

  // The live plan item walks the rundown, as the PCO poller would.
  setInterval(() => emit("pco:live", pcoLive()), 4000);

  // A believable SPL meter. These RMS values are chosen against the demo's
  // own 125.7 dB calibration to land near 92 dB in songs and 85 in the
  // message — a healthy Sunday. Louder values looked real but tripped the
  // genuine "sustained over 100 dB" alert, which is not a demo's job.
  setInterval(() => {
    const speaking = SONGS[liveIndex()].type !== "song";
    const target = speaking ? 0.0095 : 0.021;
    const rms = Math.max(0.0005, target * (0.8 + Math.random() * 0.4));
    emit("audio:level", { rms, peak: Math.min(1, rms * (1.5 + Math.random())) });
  }, 90);
}
