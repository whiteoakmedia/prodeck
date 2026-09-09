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

export const IS_DEMO: boolean = (() => {
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
  ["dca:1", "Drums"], ["dca:2", "Band"], ["dca:3", "Vocals"], ["dca:4", "Speech"],
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
  return {
    data: {
      relationships: { item: { data: { id: `demo-item-${liveIndex() + 1}`, type: "Item" } } },
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

/** A slide-shaped SVG so thumbnails aren't grey boxes. */
function demoThumb(index: number): string {
  const lines = ["Great are You, Lord", "You give life, You are love", "You bring light to the darkness"];
  const text = lines[index % lines.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#10151f"/><text x="240" y="140" font-family="system-ui,sans-serif" font-size="26" fill="#eef3fa" text-anchor="middle">${text.replace(/[<>&]/g, "")}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
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
  return {
    model: "avantis",
    namesSupported: true,
    maxScene: 500,
    connected: true,
    scene: speaking ? 4 : 2,
    mutes,
    faders,
    names,
    colors: {},
    watchLog: [],
  };
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
};

/**
 * Commands that CHANGE something. In demo mode they succeed and do nothing.
 * Deliberately matched on mutating verbs, not on module prefixes: an earlier
 * version used `page_`/`chat_`/`identity_` and swallowed the reads
 * (`page_list`, `chat_history`, `identity_list`) along with the writes.
 * Reads modelled below are answered first regardless.
 */
const WRITES =
  /^(update_settings|save_|web_start|web_stop|pco_(save|set|live|start|stop|sync)|pp_(connect|disconnect|trigger|clear|put|post|set|timer|focus|next|previous)|avantis_(set|recall)|tap_(override|save|test|check)|identity_(register|login|approve|remove|set_role|heal|update)|invite_(create|revoke)|checkin_(set|geo|auto)|checklist_|push_(subscribe|unsubscribe)|page_(send|ack|rebuzz)|chat_(send|clear)|keepalive_(install|uninstall|relaunch)|keep_awake_set|backup_(export|import)|(start|stop)_audio_capture|ndi_(start|stop)|midi_(send|open)|relay_(start|stop|connect)|transcription_(start|stop)|diag_open_issue|gemini_)/;

/** Commands whose callers do `.filter`/`.map` — an unmodelled one must be []. */
const ARRAY_CMDS = new Set([
  "chat_history", "page_list", "identity_list", "identity_roles", "discover_services",
  "invite_list", "ndi_discover_sources", "posfile_list", "tap_check_links",
  "diag_recent_log", "list_audio_inputs", "list_midi_inputs", "list_midi_outputs",
]);
/** Commands whose callers read fields off the result. */
const OBJECT_CMDS: Record<string, unknown> = {
  get_relay_status: { mode: "off", clients: 0, connected: false },
  transcription_status: { running: false, model: "", bin: "" },
  tap_mappings: { mappings: {}, default: "" },
  pco_live_controller: { controller: null, me: false },
  pp_is_connected: true,
  audio_input_channels: 2,
  default_audio_input: "Demo Input (2ch)",
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
        settingsBase = {};
        // On the desktop the backend is in-process, so borrowing the real
        // struct keeps every field shape valid. In a browser there may be no
        // booth at all — and asking would 401 and bounce us to the sign-in
        // screen — so the overlay stands on its own there.
        const { realInvoke, IS_WEB } = await import("./tauri");
        if (!IS_WEB) {
          try {
            settingsBase = (await realInvoke<Record<string, unknown>>("get_settings")) ?? {};
          } catch {
            settingsBase = {};
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
      return out({ tier: "admin" });
    case "keepalive_status":
      return out({
        installed: true, program: "/Applications/ProDeck.app/Contents/MacOS/prodeck",
        matchesCurrent: true, underLaunchd: true, inApplications: true,
        exe: "/Applications/ProDeck.app/Contents/MacOS/prodeck", keepAwake: true,
      });
    case "pp_thumbnail":
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
        { id: 1, from: "Renee Alvarez", target: "team", body: "Doors open in 10.", ts: NOW() - 900_000 },
        { id: 2, from: "Sam Porter", target: "team", body: "Pulpit mic swapped, battery was low.", ts: NOW() - 480_000 },
      ]);
    case "page_list":
      return out([]);
    case "diag_recent_log":
      return out(["(demo mode — the real log is hidden while sample data is on)"]);
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
