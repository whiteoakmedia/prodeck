// Routing — the building's signal map as data, and the walk that answers
// "why is there no sound" from it. Spec: design/ROUTING.md.
//
// The one idea everything here rests on: channel NAMES change every service,
// NUMBERS don't. Console channel 39 is channel 39 every week; who is singing
// into it arrives live from Planning Center and the desk mirror. So the map
// is keyed by numbers — socket, port index, channel — and never by a person.
//
// Pure functions only. No React, no Tauri: the store loads and saves, the
// pages render, this file decides. Everything in here is unit-tested.

export type NodeKind = "source" | "door" | "channel" | "bus" | "output" | "destination";

/** What kind of thing a source is decides what to walk to and look at. */
export type SourceKind =
  | "wireless" // a pack on someone's belt + a receiver in the rack
  | "socket" // a stage panel socket / tie line
  | "playback" // a computer running tracks / click
  | "consumer" // Spotify, a phone, a consumer source
  | "rackxlr" // an XLR straight into the rack
  | "dante" // a Dante device with no further story
  | "other";

export type Transport = "slink" | "dante" | "local" | "me" | "analog" | "other";

export interface RNode {
  id: string;
  kind: NodeKind;
  label: string;
  sourceKind?: SourceKind;
  /** For doors: the transport they carry. */
  transport?: Transport;
  /** The number that doesn't move: a stage socket, a receiver slot, a console
   *  channel. `port` names the numbering space ("stage", "ULXD4Q-5-8", "ch"). */
  ref?: { port: string; index: string };
  /** Live overlay hooks. `desk` is a mirror key like "input:39"; `capture` is
   *  a 1-based channel on the booth's own audio input. */
  bind?: { desk?: string; capture?: number };
  /** Church-edited checklist for when this node is the suspect. Falls back to
   *  the template for its kind. */
  steps?: string[];
  /** Free text shown with the node — "insert loop, not a source". */
  note?: string;
  verified?: number;
  /** Looks perfectly normal, goes nowhere. Dashed in the graph, skipped in the walk. */
  dead?: boolean;
  pos?: { x: number; y: number };
  /** Set by migration: kinds were guessed, someone should look. */
  imported?: boolean;
}

export interface REdge {
  id: string;
  from: string;
  to: string;
  /** Which input of the `to` node this lands on — the door's socket number
   *  ("41", or "1+2" for a stereo pair). Two channels off one socket share
   *  one preamp; the walk says so. */
  at?: string;
  transport?: Transport;
  label?: string;
  steps?: string[];
  /** Legacy: which ProDeck subsystem lit this hop in the schema-1 map. */
  watch?: "audio" | "pp" | "stage" | "desk";
  verified?: number;
  dead?: boolean;
}

export interface Rule {
  id: string;
  /** When the walk should bring this rule up. */
  when: "shared-socket" | "stereo-pair" | "names-change" | "always";
  text: string;
}

export interface KnownIssue {
  id: string;
  /** What the volunteer would notice. Matched against the walk's path. */
  symptom: string;
  detail: string;
  nodes?: string[];
  severity: "fix" | "know";
}

/** A stage pocket / panel / floor box: a named run of sockets in one
 *  numbering space. The wall, as the volunteer sees it. */
export interface Panel {
  id: string;
  label: string;
  /** Numbering space of the sockets, matching source `ref.port` ("stage"). */
  port: string;
  from: number;
  to: number;
  note?: string;
}

export interface RoutingMap {
  schema: 2;
  /** Shipped example, not this church's map. UI says so until the first edit. */
  example?: boolean;
  verified?: { at: number; by?: string };
  nodes: RNode[];
  edges: REdge[];
  rules: Rule[];
  watchlist: KnownIssue[];
  panels?: Panel[];
}

/* ------------------------------------------------------------ helpers */

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const uid = () => Math.random().toString(36).slice(2, 9);

export const chId = (n: string) => `ch:${n}`;
export const doorId = (t: Transport | string) => `door:${t}`;

export function emptyMap(): RoutingMap {
  return { schema: 2, nodes: [], edges: [], rules: builtinRules(), watchlist: [] };
}

export function builtinRules(): Rule[] {
  return [
    {
      id: "rule-gain-socket",
      when: "shared-socket",
      text: "Gain and 48V belong to the socket, not the channel — two channels on one socket share one preamp. Set gain on the input, not on either channel.",
    },
    {
      id: "rule-stereo-pair",
      when: "stereo-pair",
      text: "A stereo channel takes an odd/even socket pair. Odd is always the left. If only one side is missing, it is that side's cable or socket.",
    },
    {
      id: "rule-names",
      when: "names-change",
      text: "Channel names change every service. Trust the numbers on this sheet, not the name on the desk.",
    },
  ];
}

export function node(map: RoutingMap, id: string): RNode | undefined {
  return map.nodes.find((n) => n.id === id);
}

export function edgesInto(map: RoutingMap, id: string): REdge[] {
  return map.edges.filter((e) => e.to === id);
}
export function edgesOutOf(map: RoutingMap, id: string): REdge[] {
  return map.edges.filter((e) => e.from === id);
}

/** "39" → 39, "11-12" → 11, "vox" → NaN. Channel sort and desk binding. */
export function firstIndex(ref: string | undefined): number {
  const m = /(\d+)/.exec(ref ?? "");
  return m ? parseInt(m[1], 10) : NaN;
}

export function isStereo(ref: string | undefined): boolean {
  return /\d\s*[-–+]\s*\d/.test(ref ?? "");
}

/** Mirror key a channel node reads live state from. Explicit bind wins, else
 *  channel number → "input:N", which is how every supported desk is keyed. */
export function deskKeyFor(n: RNode): string | undefined {
  if (n.bind?.desk) return n.bind.desk;
  if (n.kind === "channel") {
    const i = firstIndex(n.ref?.index);
    if (!isNaN(i)) return `input:${i}`;
  }
  return undefined;
}

/* --------------------------------------------------------- templates */

/** Default checklists per source kind — second person, one action per line,
 *  name the physical thing. A church edits these into its own building. */
export const SOURCE_TEMPLATES: Record<SourceKind, string[]> = {
  wireless: [
    "Is the pack switched on? Look for its display.",
    "On the receiver, is the RF light for this slot lit? No RF means the pack, not the desk.",
    "Battery — the usual one. Swap it even if it says half.",
    "Still nothing: swap the pack for a spare. Keep the receiver — it is almost never the receiver.",
  ],
  socket: [
    "Is the cable in the right socket? Dashed sockets on the map go nowhere.",
    "Try a different cable — the same socket, a known-good lead.",
    "Try the free socket beside it and tell the booth which one you used.",
  ],
  playback: [
    "Is the playback app open and actually playing? Look for moving meters.",
    "Is the app's output device the right one? It resets after updates and reboots.",
    "Is the track's channel routed to the right output on the machine?",
  ],
  consumer: [
    "Is the source app playing, and not paused on a Bluetooth device somewhere else?",
    "Is its output device set to the interface, not the built-in speakers?",
    "Volume on the source itself — all the way up, the desk does the rest.",
  ],
  rackxlr: ["Is the XLR seated at both ends? Swap the cable.", "Is the device itself powered and outputting?"],
  dante: [
    "In Dante Controller, is the device online (green)?",
    "Is its channel subscribed to the console — a green tick, not a warning?",
    "Clock: one device is master. A red clock icon means the network, not the mic.",
  ],
  other: ["Is it powered, plugged in and switched on?", "Try a different cable."],
};

export const DOOR_TEMPLATES: Record<Transport, string[]> = {
  slink: [
    "Is the stage box powered and its SLink light steady? Blinking means no link to the desk.",
    "One Cat5 carries every stage channel. If several are dead at once, it is this cable or the box.",
  ],
  dante: [
    "Is the console's Dante card online in Dante Controller?",
    "Is the source still subscribed to this port input? A re-patch can drop it silently.",
    "Network switch: link lights on, and PoE if the device needs it.",
  ],
  local: ["Is the XLR seated in the rack socket? Swap the cable."],
  me: ["Is the ME hub powered and the Cat5 to the desk seated?"],
  analog: ["Swap the cable.", "Check both ends are in the right socket."],
  other: ["Is the link between these two powered and connected?"],
};

export const CHANNEL_TEMPLATE = (n: string) => [
  `On the desk, is channel ${n} unmuted, and is the fader up?`,
  `Is channel ${n} still patched to the socket on this sheet? A scene recall can move it.`,
  `Is the channel assigned to the main mix?`,
];

export function stepsFor(map: RoutingMap, n: RNode): string[] {
  if (n.steps && n.steps.length) return n.steps;
  if (n.kind === "source") return SOURCE_TEMPLATES[n.sourceKind ?? "other"];
  if (n.kind === "door") return DOOR_TEMPLATES[n.transport ?? "other"];
  if (n.kind === "channel") return CHANNEL_TEMPLATE(n.ref?.index ?? n.label);
  if (n.kind === "bus") return [`Is the ${n.label} bus unmuted and its master up?`];
  if (n.kind === "output") return [`Is the ${n.label} output patched and its cable seated?`];
  if (n.kind === "destination") return [`Is ${n.label} powered on and its input selected?`];
  void map;
  return [];
}

/* ----------------------------------------------------- the table view */

/** One row of the patch list: how a map gets built fast. */
export interface ChannelRow {
  /** Channel number(s) as written: "39", "11-12". */
  ch: string;
  name: string;
  /** Door node id, or "" for not patched. */
  door: string;
  doorLabel: string;
  socket: string;
  upstream: string;
  upstreamId?: string;
  nodeId: string;
  verified?: number;
  /** Other channels fed from the same door socket (shared preamp). */
  twins: string[];
}

export function channelRows(map: RoutingMap): ChannelRow[] {
  const rows: ChannelRow[] = [];
  for (const n of map.nodes.filter((x) => x.kind === "channel")) {
    const ins = edgesInto(map, n.id).filter((e) => node(map, e.from)?.kind === "door");
    if (ins.length === 0) {
      rows.push({
        ch: n.ref?.index ?? "",
        name: n.label,
        door: "",
        doorLabel: "",
        socket: "",
        upstream: "",
        nodeId: n.id,
        verified: n.verified,
        twins: [],
      });
      continue;
    }
    const e = ins[0];
    const door = node(map, e.from)!;
    const up = e.at ? edgesInto(map, door.id).filter((x) => x.at === e.at) : [];
    const upNodes = up.map((x) => node(map, x.from)).filter(Boolean) as RNode[];
    const twins = map.edges
      .filter((x) => x.from === door.id && x.at === e.at && x.to !== n.id)
      .map((x) => node(map, x.to)?.ref?.index ?? x.to);
    rows.push({
      ch: n.ref?.index ?? "",
      name: n.label,
      door: door.id,
      doorLabel: door.label,
      socket: e.at ?? "",
      upstream: upNodes.map(sourceText).join(" + "),
      upstreamId: upNodes[0]?.id,
      nodeId: n.id,
      verified: n.verified,
      twins,
    });
  }
  return rows.sort((a, b) => firstIndex(a.ch) - firstIndex(b.ch));
}

/** "ULXD4Q-5-8 05" / "stage 41" — the upstream cell, reconstructed. */
export function sourceText(n: RNode): string {
  if (!n.ref) return n.label;
  return `${n.ref.port} ${n.ref.index}`;
}

/* ---------------------------------------------------------- doors */

export const DOOR_LABELS: Record<Transport, string> = {
  slink: "SLink",
  dante: "I/O Port 1",
  local: "Local",
  me: "ME",
  analog: "Analog",
  other: "Other",
};

/** Recognise a port cell: "SLink", "I/O Port 1", "Dante", "Local", "—". */
export function parsePort(text: string): Transport | null {
  const t = text.trim().toLowerCase();
  if (!t || t === "-" || t === "—" || t === "–" || /^not/.test(t) || t === "none") return null;
  if (/slink|s-link|dsnake|stage ?box|aes50|stage/.test(t)) return "slink";
  if (/dante|i\/o|io ?port|port ?1|network/.test(t)) return "dante";
  if (/local|rack|xlr/.test(t)) return "local";
  if (/\bme\b|personal/.test(t)) return "me";
  if (/analog|copper/.test(t)) return "analog";
  return "other";
}

export function ensureDoor(map: RoutingMap, t: Transport, label?: string): RNode {
  const id = doorId(t);
  let d = node(map, id);
  if (!d) {
    d = { id, kind: "door", label: label ?? DOOR_LABELS[t], transport: t };
    map.nodes.push(d);
  }
  return d;
}

/* ------------------------------------------------------- upstream cell */

export interface Upstream {
  sourceKind: SourceKind;
  /** Numbering space: "stage", "ULXD4Q-5-8", "Playback-Mac". */
  port: string;
  index: string;
  label: string;
}

/** The UPSTREAM cell → what kind of thing it is and its number. */
export function parseUpstream(text: string): Upstream | null {
  const raw = text.trim();
  if (!raw || /^not patched|^—$|^-$|^none$/i.test(raw)) return null;
  // "<device> <NN>" or "<device> <NN>+<NN>" — number at the end.
  const m = /^(.*?)[\s#]*([0-9]+(?:\s*[-+–]\s*[0-9]+)?)$/.exec(raw);
  const port = (m ? m[1] : raw).trim().replace(/[:,]$/, "") || raw;
  const index = m ? m[2].replace(/\s+/g, "").replace(/–/g, "-") : "";
  const l = port.toLowerCase();
  let sourceKind: SourceKind = "other";
  if (/ulxd|qlxd|slx|axient|receiver|\brx\b|wireless|pack|sennheiser|ew-?d/.test(l)) sourceKind = "wireless";
  else if (/^stage|panel|wall|tie|floor|socket/.test(l)) sourceKind = "socket";
  else if (/macbook|playback|ableton|tracks|laptop|\bmac\b|\bpc\b|computer|multitrack/.test(l))
    sourceKind = "playback";
  else if (/spotify|command|phone|ipad|consumer|apple ?tv|bluetooth/.test(l)) sourceKind = "consumer";
  else if (/rack|xlr|console/.test(l)) sourceKind = "rackxlr";
  else if (/dante|avio|bridge|da2ex|dvs/.test(l)) sourceKind = "dante";
  const label =
    sourceKind === "socket" && index
      ? `Stage socket ${index}`
      : sourceKind === "wireless" && index
        ? `${port} · pack ${index.replace(/^0+/, "")}`
        : index
          ? `${port} ${index}`
          : port;
  return { sourceKind, port, index, label };
}

export function ensureSource(map: RoutingMap, u: Upstream): RNode {
  const id = `src:${slug(u.port)}${u.index ? ":" + slug(u.index) : ""}`;
  let s = node(map, id);
  if (!s) {
    s = { id, kind: "source", label: u.label, sourceKind: u.sourceKind, ref: { port: u.port, index: u.index } };
    map.nodes.push(s);
  }
  return s;
}

/* ------------------------------------------------- row → graph edits */

export interface RowInput {
  ch: string;
  name?: string;
  port?: string;
  socket?: string;
  upstream?: string;
}

/**
 * Write one patch-list row into the graph. Idempotent: the channel node is
 * created or updated; its door edge and the door's upstream edge for that
 * socket are replaced. Steps, notes, verification and bindings on an existing
 * channel survive — only the patch changes.
 */
export function applyRow(map: RoutingMap, row: RowInput): RNode {
  const ch = row.ch.trim().replace(/\s+/g, "").replace(/–/g, "-");
  const id = chId(ch);
  let n = node(map, id);
  if (!n) {
    n = { id, kind: "channel", label: "", ref: { port: "ch", index: ch } };
    map.nodes.push(n);
  }
  if (row.name !== undefined) n.label = row.name.trim();
  // Drop this channel's old door edge (and the upstream that only it used).
  const oldIns = edgesInto(map, id).filter((e) => node(map, e.from)?.kind === "door");
  for (const e of oldIns) {
    map.edges = map.edges.filter((x) => x.id !== e.id);
    const stillUsed = map.edges.some((x) => x.from === e.from && x.at === e.at && x.to !== id);
    if (!stillUsed) map.edges = map.edges.filter((x) => !(x.to === e.from && x.at === e.at));
  }
  const t = parsePort(row.port ?? "");
  if (!t) {
    pruneOrphanSources(map);
    return n;
  }
  const door = ensureDoor(map, t);
  const at = (row.socket ?? "").trim().replace(/\s+/g, "").replace(/–/g, "-") || undefined;
  map.edges.push({ id: `e:${door.id}>${id}`, from: door.id, to: id, at, transport: t });
  const up = parseUpstream(row.upstream ?? "");
  if (up && at) {
    const src = ensureSource(map, up);
    const exists = map.edges.some((x) => x.from === src.id && x.to === door.id && x.at === at);
    if (!exists) map.edges.push({ id: `e:${src.id}>${door.id}@${at}`, from: src.id, to: door.id, at, transport: t });
  }
  pruneOrphanSources(map);
  return n;
}

/** Sources feeding nothing were a typo or a re-patch; they go. Sources with
 *  their own steps or a note were written on purpose and stay. */
export function pruneOrphanSources(map: RoutingMap) {
  map.nodes = map.nodes.filter(
    (n) => n.kind !== "source" || n.dead || n.steps?.length || n.note || map.edges.some((e) => e.from === n.id),
  );
}

export function removeChannel(map: RoutingMap, nodeId: string) {
  const ins = edgesInto(map, nodeId);
  map.edges = map.edges.filter((e) => e.to !== nodeId && e.from !== nodeId);
  for (const e of ins) {
    const stillUsed = map.edges.some((x) => x.from === e.from && x.at === e.at);
    if (!stillUsed) map.edges = map.edges.filter((x) => !(x.to === e.from && x.at === e.at));
  }
  map.nodes = map.nodes.filter((n) => n.id !== nodeId);
  pruneOrphanSources(map);
}

/* ---------------------------------------------------------- paste */

export interface ParsedPaste {
  rows: RowInput[];
  skipped: string[];
}

/**
 * A patch list pasted from a spreadsheet or the console's own export.
 * Columns: CH · NAME · PORT · SOCKET · UPSTREAM. Tabs, commas or two-plus
 * spaces separate cells; a header row is recognised and dropped.
 */
export function parsePatchList(text: string): ParsedPaste {
  const rows: RowInput[] = [];
  const skipped: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  for (const line of lines) {
    let cells: string[];
    if (line.includes("\t")) cells = line.split("\t");
    else if (line.includes(",")) cells = splitCsv(line);
    else cells = line.split(/\s{2,}/);
    cells = cells.map((c) => c.trim());
    const [ch, name = "", port = "", socket = "", ...rest] = cells;
    if (!ch || /^ch(annel)?s?\b/i.test(ch) || /^#/.test(ch)) continue; // header / comment
    if (!/^\d+(\s*[-+–]\s*\d+)?$/.test(ch)) {
      skipped.push(line);
      continue;
    }
    rows.push({ ch, name, port, socket, upstream: rest.join(" ").trim() });
  }
  return { rows, skipped };
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** The current map as paste-able text — round-trips through parsePatchList. */
export function toPatchList(map: RoutingMap): string {
  const head = "CH\tNAME\tPORT\tSOCKET\tUPSTREAM";
  return [head, ...channelRows(map).map((r) => [r.ch, r.name, r.doorLabel || "—", r.socket || "—", r.upstream || "not patched"].join("\t"))].join("\n");
}

/* ---------------------------------------------------------- migration */

interface LegacyHop {
  from: string;
  to: string;
  transport?: string;
  watch?: "audio" | "pp" | "stage" | "desk" | null;
  steps?: string[];
}
interface LegacyChain {
  id: string;
  name: string;
  hops: LegacyHop[];
}

export interface Loaded {
  map: RoutingMap;
  /** Converted from schema 1 — write only after the person has seen it. */
  migrated: boolean;
}

/**
 * Whatever routing.json holds → a schema-2 map. `null` input means no file:
 * the caller seeds the example. A schema-1 file (linear chains of prose hops)
 * becomes untyped nodes with every hop's steps kept and kinds guessed from
 * position, flagged `imported` so the Routing page asks for a look. Nothing
 * is dropped.
 */
export function normalizeMap(raw: unknown): Loaded | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.schema === 2 && Array.isArray(r.nodes) && Array.isArray(r.edges)) {
    const map: RoutingMap = {
      schema: 2,
      example: !!r.example,
      verified: (r.verified as RoutingMap["verified"]) ?? undefined,
      nodes: r.nodes as RNode[],
      edges: r.edges as REdge[],
      rules: Array.isArray(r.rules) ? (r.rules as Rule[]) : builtinRules(),
      watchlist: Array.isArray(r.watchlist) ? (r.watchlist as KnownIssue[]) : [],
      panels: Array.isArray(r.panels) ? (r.panels as Panel[]) : undefined,
    };
    return { map, migrated: false };
  }
  if (Array.isArray(r.chains)) return { map: migrateChains(r.chains as LegacyChain[]), migrated: true };
  return null;
}

export function migrateChains(chains: LegacyChain[]): RoutingMap {
  const map = emptyMap();
  for (const c of chains) {
    if (!Array.isArray(c.hops)) continue;
    const ids: string[] = [];
    const names = [...c.hops.map((h) => h.from), c.hops[c.hops.length - 1]?.to].filter(Boolean) as string[];
    names.forEach((name, i) => {
      const kind: NodeKind = i === 0 ? "source" : i === names.length - 1 ? "destination" : "door";
      const id = `imp:${slug(c.id || c.name)}:${slug(name)}`;
      if (!node(map, id)) {
        map.nodes.push({
          id,
          kind,
          label: name,
          sourceKind: kind === "source" ? "other" : undefined,
          transport: kind === "door" ? "other" : undefined,
          note: i === 0 ? `Imported from “${c.name}” — assign kinds` : undefined,
          imported: true,
        });
      }
      ids.push(id);
    });
    c.hops.forEach((h, i) => {
      const from = ids[i];
      const to = ids[i + 1];
      if (!from || !to) return;
      map.edges.push({
        id: `e:${from}>${to}`,
        from,
        to,
        transport: parsePort(h.transport ?? "") ?? "other",
        label: h.transport,
        steps: h.steps?.filter(Boolean),
        watch: h.watch ?? undefined,
      });
    });
  }
  return map;
}

/* ---------------------------------------------------------- the walk */

export interface DeskView {
  connected: boolean;
  mutes: Record<string, boolean>;
  /** Mutes the desk has reported since this connection. When present, a mute
   *  in `mutes` but not here is only remembered from before — a guess, not a fact. */
  confirmed?: Record<string, boolean>;
  faders: Record<string, number>;
  names: Record<string, string>;
  /** Last scene the desk announced, if any. */
  scene?: number | null;
}

export interface LiveView {
  desk?: DeskView | null;
  /** Per-channel peaks (0..1) from the booth's own audio input, index 0 = channel 1. */
  capture?: { peaks: number[]; at: number } | null;
  /** ProDeck's own subsystem lights, for legacy `watch` edges. */
  subsystems?: Record<string, string>;
  now: number;
}

export type CheckState = "ok" | "bad" | "unknown";

export interface Check {
  state: CheckState;
  text: string;
  /** What to do about a ✗, when it is a desk action rather than a walk. */
  fix?: string;
  nodeId?: string;
}

export interface Step {
  n: number;
  text: string;
  /** A rule that explains this step, shown inline. */
  rule?: string;
  nodeId?: string;
}

export interface WalkResult {
  target: RNode;
  title: string;
  subtitle: string;
  /** Known faults on this path — shown before anything else. */
  watch: KnownIssue[];
  checks: Check[];
  steps: Step[];
  /** Node ids, farthest source first, target last. */
  path: string[];
  verifiedAt?: number;
  /** Nothing on this path can be seen live; it is all walking. */
  blind: boolean;
}

const SIGNAL_FLOOR_DB = -60;
const FADER_DOWN_DB = -70;
const CAPTURE_FRESH_MS = 5000;

const peakDb = (p: number) => (p > 0 ? 20 * Math.log10(p) : -Infinity);

/** Everything upstream of `id`, farthest first. Buses are a boundary: from a
 *  destination we stop at the bus rather than fan out across every channel. */
export function traceUpstream(map: RoutingMap, id: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  // Walking to a place (an output or destination) stops at the channels and
  // buses that feed it: "the stream is silent" is about the bus, the output
  // and the box at the end, not about every singer's pack on the way.
  const target = node(map, id);
  const stopAtChannel = target?.kind === "output" || target?.kind === "destination";
  // `at` is the socket we arrived through. A door has every socket feeding
  // it; only the one this channel is patched from is on this channel's path.
  const visit = (nid: string, at?: string) => {
    if (seen.has(nid)) return;
    seen.add(nid);
    const n = node(map, nid);
    if (n && n.kind !== "bus" && !(stopAtChannel && n.kind === "channel")) {
      for (const e of edgesInto(map, nid)) {
        if (n.kind === "door" && at && e.at && e.at !== at) continue;
        visit(e.from, e.at);
      }
    }
    order.push(nid);
  };
  visit(id);
  return order;
}

/** Channel nodes sharing a door socket with `n` — the same preamp. */
export function twinsOf(map: RoutingMap, n: RNode): RNode[] {
  const ins = edgesInto(map, n.id).filter((e) => e.at && node(map, e.from)?.kind === "door");
  const out: RNode[] = [];
  for (const e of ins) {
    for (const x of map.edges) {
      if (x.from === e.from && x.at === e.at && x.to !== n.id) {
        const t = node(map, x.to);
        if (t && t.kind === "channel") out.push(t);
      }
    }
  }
  return out;
}

const fmtDb = (v: number) => (v <= FADER_DOWN_DB ? "−∞" : `${v > 0 ? "+" : "−"}${Math.abs(Math.round(v))} dB`);

export function walk(map: RoutingMap, targetId: string, live: LiveView): WalkResult | null {
  const target = node(map, targetId);
  if (!target) return null;
  const path = traceUpstream(map, targetId);
  const pathSet = new Set(path);
  const checks: Check[] = [];
  const steps: Step[] = [];
  const desk = live.desk?.connected ? live.desk : null;
  let deskUnknownSaid = false;

  const ruleText = (when: Rule["when"]) =>
    (map.rules.find((r) => r.when === when) ?? builtinRules().find((r) => r.when === when))?.text;

  // Which nodes still need walking to, in path order (source first).
  const toWalk: RNode[] = [];

  // Checks read target-first — the desk channel, then the door, then the
  // source — because that is the order a person at the desk would look.
  for (const nid of [...path].reverse()) {
    const n = node(map, nid)!;
    if (n.dead) {
      checks.push({ state: "bad", text: `${n.label} is marked dead on the map — it looks normal and goes nowhere.`, nodeId: n.id });
      steps.push({ n: 0, text: `Move the cable off ${n.label} to a live socket and tell the booth.`, nodeId: n.id });
      continue;
    }
    let seen = false;

    // Desk-bound channel: mute + fader are the two things a desk can tell us.
    const key = n.kind === "channel" || n.kind === "bus" ? deskKeyFor(n) : n.bind?.desk;
    if (key) {
      if (desk) {
        seen = true;
        const num = n.ref?.index ?? n.label;
        const name = (desk.names[key] ?? "").trim();
        const who = name ? ` (“${name}” on the desk)` : "";
        const fader = desk.faders[key];
        // A remembered mute (from before the desk reconnected) is exactly the
        // thing that showed "muted" on ProDeck while the desk was open. Say
        // what we remember, but send them to look, and don't call it a fact.
        const remembered = !!desk.confirmed && !(key in desk.confirmed) && desk.mutes[key] !== undefined;
        if (remembered && desk.mutes[key] === true) {
          checks.push({
            state: "unknown",
            text: `ProDeck's last record says channel ${num} is muted${who}, but the desk hasn't confirmed that since it reconnected — look at the mute button on ${num} first.`,
            nodeId: n.id,
          });
        } else if (desk.mutes[key] === true) {
          checks.push({ state: "bad", text: `Channel ${num} is muted on the desk${who}.`, fix: `Unmute channel ${num}.`, nodeId: n.id });
        } else if (typeof fader === "number" && fader <= FADER_DOWN_DB) {
          checks.push({ state: "bad", text: `Channel ${num} is open but its fader is all the way down${who}.`, fix: `Bring channel ${num}'s fader up.`, nodeId: n.id });
        } else {
          const f = typeof fader === "number" ? `, fader at ${fmtDb(fader)}` : "";
          const asSeen = remembered ? " (as last seen — the desk hasn't confirmed it since reconnecting)" : "";
          checks.push({ state: "ok", text: `Channel ${num} is open${f}${who}${asSeen}.`, nodeId: n.id });
        }
        if (n.kind === "channel") {
          for (const t of twinsOf(map, n)) {
            const tk = deskKeyFor(t);
            const tn = t.ref?.index ?? t.label;
            if (tk && desk.mutes[tk] === true) {
              checks.push({ state: "ok", text: `Its twin, ${tn}, is muted — normal if it is the duplicate.`, nodeId: t.id });
            } else if (tk) {
              checks.push({ state: "ok", text: `Its twin, ${tn}, is open too — they share one socket and one gain.`, nodeId: t.id });
            }
          }
        }
      } else if (live.desk && !deskUnknownSaid) {
        // A desk is configured and unreachable. No desk at all says nothing:
        // the church simply has nothing for ProDeck to look at here.
        deskUnknownSaid = true;
        checks.push({ state: "unknown", text: "ProDeck can't see the desk right now, so mute and fader are yours to check." });
      }
    }

    // Booth capture: the one place ProDeck hears signal itself.
    if (n.bind?.capture) {
      const cap = live.capture;
      const fresh = cap && live.now - cap.at < CAPTURE_FRESH_MS;
      const p = cap?.peaks[n.bind.capture - 1];
      if (fresh && typeof p === "number") {
        seen = true;
        if (peakDb(p) > SIGNAL_FLOOR_DB) checks.push({ state: "ok", text: `Signal is reaching the booth on input ${n.bind.capture}.`, nodeId: n.id });
        else checks.push({ state: "bad", text: `Nothing is reaching the booth on input ${n.bind.capture} — the fault is upstream of it.`, nodeId: n.id });
      }
    }

    // A door the desk is talking through is at least a door the desk can see.
    if (n.kind === "door" && desk && (n.transport === "slink" || n.transport === "dante" || n.transport === "me")) {
      const e = edgesOutOf(map, n.id).find((x) => pathSet.has(x.to));
      checks.push({ state: "ok", text: `Desk connected · ${n.label}${e?.at ? ` in ${e.at}` : ""} patched.`, nodeId: n.id });
      // A door the desk is talking through drops out of the walk: the pack,
      // the socket and the cable are where a person can do something. A
      // dropped Dante subscription is real but rare, and the door's own steps
      // are one click away on the Routing page.
      seen = true;
    }

    // Legacy watched hop: ProDeck's own subsystem light.
    for (const e of edgesInto(map, nid)) {
      if (e.watch && live.subsystems) {
        const s = live.subsystems[e.watch === "stage" ? "cam" : e.watch];
        if (s === "ok") checks.push({ state: "ok", text: `${node(map, e.from)?.label ?? e.from} → ${n.label} is live.`, nodeId: n.id });
        else if (s === "bad" || s === "warn") checks.push({ state: "bad", text: `${node(map, e.from)?.label ?? e.from} → ${n.label} is down as far as ProDeck can see.`, nodeId: n.id });
        if (s === "ok") seen = true;
      }
    }

    if (!seen) toWalk.push(n);
  }

  // Order the walk. For a channel: sources first (most likely, and the only
  // place a person can actually do something), then doors, then the desk
  // channel itself. For a place — an output or a destination — the other
  // way round: the box at the end, then the output, then the buses and
  // channels feeding it, which collapse into one desk check.
  const rank: Record<NodeKind, number> = { source: 0, door: 1, channel: 2, bus: 3, output: 4, destination: 5 };
  const toPlace = target.kind === "output" || target.kind === "destination";
  toWalk.sort((a, b) => (toPlace ? rank[b.kind] - rank[a.kind] : rank[a.kind] - rank[b.kind]));
  const twins = target.kind === "channel" ? twinsOf(map, target) : [];
  const stereo = isStereo(target.ref?.index);
  const feeding = toPlace ? toWalk.filter((n) => n.kind === "channel") : [];
  let feedingSaid = false;
  for (const n of toWalk) {
    if (toPlace && n.kind === "channel" && feeding.length > 1) {
      if (!feedingSaid) {
        feedingSaid = true;
        const nums = feeding.map((c) => c.ref?.index ?? c.label).join(", ");
        steps.push({ n: 0, text: `On the desk: are channels ${nums} unmuted, faders up, and still sending to this output?`, nodeId: n.id });
      }
      continue;
    }
    const own = stepsFor(map, n);
    own.forEach((text) => steps.push({ n: 0, text, nodeId: n.id }));
    for (const e of edgesOutOf(map, n.id).filter((x) => pathSet.has(x.to))) {
      (e.steps ?? []).forEach((text) => steps.push({ n: 0, text, nodeId: n.id }));
    }
    if (n.kind === "source" && twins.length) {
      const rt = ruleText("shared-socket");
      const tn = twins.map((t) => t.ref?.index ?? t.label).join(" and ");
      steps.push({
        n: 0,
        text: `Gain is set once for this socket and shared by channels ${target.ref?.index} and ${tn} — check it on the input, not the channel.`,
        rule: rt,
        nodeId: n.id,
      });
    }
    if (n.kind === "source" && stereo) {
      steps.push({ n: 0, text: "Only one side missing? Odd socket is left, even is right — it is that side's cable.", rule: ruleText("stereo-pair"), nodeId: n.id });
    }
  }
  steps.forEach((s, i) => (s.n = i + 1));

  const watch = map.watchlist.filter((w) => (w.nodes ?? []).some((id) => pathSet.has(id)));
  const stamps = path.map((id) => node(map, id)?.verified).filter((v): v is number => typeof v === "number");
  const verifiedAt = stamps.length ? Math.min(...stamps) : map.verified?.at;

  const src = path.map((id) => node(map, id)!).find((n) => n.kind === "source");
  const subtitle = [
    target.kind === "channel" ? `channel ${target.ref?.index ?? ""}`.trim() : target.kind,
    src ? src.label : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const liveName = target.kind === "channel" && desk ? (desk.names[deskKeyFor(target) ?? ""] ?? "").trim() : "";
  const title = target.label || liveName || `Channel ${target.ref?.index ?? ""}`;

  return {
    target,
    title,
    subtitle,
    watch,
    checks,
    steps,
    path,
    verifiedAt,
    blind: !checks.some((c) => c.state !== "unknown"),
  };
}

/* ------------------------------------------------------- entry points */

/** Channel nodes bound to a desk key such as "input:39". */
export function channelsForDesk(map: RoutingMap, deskKey: string): RNode[] {
  return map.nodes.filter((n) => n.kind === "channel" && deskKeyFor(n) === deskKey);
}

export function channelByNumber(map: RoutingMap, n: number): RNode | undefined {
  return map.nodes.find((x) => x.kind === "channel" && firstIndex(x.ref?.index) === n);
}

/** Free-text entry: a number, a name on the map, a live desk name, a place. */
export function searchNodes(map: RoutingMap, q: string, deskNames?: Record<string, string>): RNode[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const num = /^\d+$/.test(t) ? parseInt(t, 10) : NaN;
  return map.nodes
    .filter((n) => n.kind === "channel" || n.kind === "destination" || n.kind === "source")
    .filter((n) => {
      if (!isNaN(num) && n.kind === "channel" && firstIndex(n.ref?.index) === num) return true;
      if (n.label.toLowerCase().includes(t)) return true;
      const k = deskKeyFor(n);
      if (k && deskNames && (deskNames[k] ?? "").toLowerCase().includes(t)) return true;
      return !!n.ref && `${n.ref.port} ${n.ref.index}`.toLowerCase().includes(t);
    })
    .slice(0, 12);
}

/** "3 weeks ago" — the map's age, for the nag. */
export function ageText(at: number | undefined, now: number): string {
  if (!at) return "never verified";
  const d = Math.floor((now - at) / 86_400_000);
  if (d < 1) return "verified today";
  if (d < 14) return `verified ${d} day${d === 1 ? "" : "s"} ago`;
  const w = Math.floor(d / 7);
  if (w < 9) return `verified ${w} weeks ago`;
  return `verified ${Math.floor(d / 30)} months ago`;
}

export const STALE_AFTER_MS = 90 * 86_400_000;

/* ------------------------------------------------------- stage pockets */

/** One socket on the wall, cross-referenced through the map. */
export interface SocketView {
  n: number;
  /** The source node for this socket, if any channel is patched from it. */
  sourceId?: string;
  dead: boolean;
  /** Nothing on the map uses it: free at the desk — or a tie line nobody wrote down. */
  free: boolean;
  /** Where it lands: door + door socket + console channel(s). Usually one; two when a socket feeds a shared preamp. */
  lands: { doorId: string; doorLabel: string; at: string; channelId: string; channelIndex: string; channelLabel: string; deskKey?: string; stereoSide?: "L" | "R" }[];
  /** Console channels on this socket that are inserted through an external rig (an output edge to a destination). */
  inserts: string[];
}

export interface PanelView {
  panel: Panel;
  sockets: SocketView[];
  live: number;
}

/** The wall: every socket of every panel, with what the map knows about it. */
export function panelViews(map: RoutingMap): PanelView[] {
  const panels = map.panels ?? [];
  return panels.map((panel) => {
    const sockets: SocketView[] = [];
    for (let n = panel.from; n <= panel.to; n++) {
      const src = map.nodes.find((x) => x.kind === "source" && x.ref?.port === panel.port && socketCovers(x.ref.index, n));
      const view: SocketView = { n, sourceId: src?.id, dead: !!src?.dead, free: !src, lands: [], inserts: [] };
      if (src) {
        for (const e of edgesOutOf(map, src.id)) {
          const door = node(map, e.to);
          if (!door || door.kind !== "door" || !e.at) continue;
          for (const dc of map.edges.filter((x) => x.from === door.id && x.at === e.at)) {
            const ch = node(map, dc.to);
            if (!ch || ch.kind !== "channel") continue;
            const side = sideOf(src.ref!.index, n);
            view.lands.push({ doorId: door.id, doorLabel: door.label, at: side ? sideAt(e.at, side) : e.at, channelId: ch.id, channelIndex: ch.ref?.index ?? "", channelLabel: ch.label, deskKey: deskKeyFor(ch), stereoSide: side });
            for (const out of edgesOutOf(map, ch.id)) {
              const o = node(map, out.to);
              if (o?.kind === "output") {
                const dest = edgesOutOf(map, o.id).map((x) => node(map, x.to)).find((d) => d?.kind === "destination");
                if (dest && !view.inserts.includes(dest.label)) view.inserts.push(dest.label);
              }
            }
          }
        }
      }
      sockets.push(view);
    }
    return { panel, sockets, live: sockets.filter((s) => !s.free && !s.dead).length };
  });
}

/** "41+42" covers 41 and 42; "17" covers 17. */
function socketCovers(index: string, n: number): boolean {
  return index
    .split(/\s*[+\-–]\s*/)
    .map((x) => parseInt(x, 10))
    .includes(n);
}
function sideOf(index: string, n: number): "L" | "R" | undefined {
  const parts = index.split(/\s*[+\-–]\s*/).map((x) => parseInt(x, 10));
  if (parts.length < 2) return undefined;
  return parts[0] === n ? "L" : "R";
}
/** The door socket for one side of a stereo pair: "19+20" → L 19, R 20. */
function sideAt(at: string, side: "L" | "R"): string {
  const parts = at.split(/\s*[+\-–]\s*/);
  return parts.length < 2 ? at : side === "L" ? parts[0] : parts[1];
}

/** Mark a socket dead (or not). Creates the source node if the map has never heard of it. */
export function setSocketDead(map: RoutingMap, port: string, n: number, dead: boolean) {
  let src = map.nodes.find((x) => x.kind === "source" && x.ref?.port === port && socketCovers(x.ref.index, n));
  if (!src) {
    if (!dead) return;
    src = { id: `src:${slug(port)}:${n}`, kind: "source", label: port === "stage" ? `Stage socket ${n}` : `${port} ${n}`, sourceKind: "socket", ref: { port, index: String(n) } };
    map.nodes.push(src);
  }
  src.dead = dead || undefined;
}

/* ------------------------------------------------------- the example */

/**
 * The shipped seed: a sixteen-channel church. A stage box on the network, a
 * playback laptop, two wireless receivers. Clearly an example — replace it.
 */
export function exampleMap(): RoutingMap {
  const map = emptyMap();
  map.example = true;
  const rows: RowInput[] = [
    { ch: "1", name: "Kick", port: "Stage box", socket: "1", upstream: "stage 1" },
    { ch: "2", name: "Snare", port: "Stage box", socket: "2", upstream: "stage 2" },
    { ch: "3", name: "OH L", port: "Stage box", socket: "3", upstream: "stage 3" },
    { ch: "4", name: "OH R", port: "Stage box", socket: "4", upstream: "stage 4" },
    { ch: "5", name: "Bass", port: "Stage box", socket: "5", upstream: "stage 5" },
    { ch: "6", name: "EG", port: "Stage box", socket: "6", upstream: "stage 6" },
    { ch: "7", name: "AG", port: "Stage box", socket: "7", upstream: "stage 7" },
    { ch: "8", name: "Keys L", port: "Stage box", socket: "9", upstream: "stage 9" },
    { ch: "9", name: "Keys R", port: "Stage box", socket: "10", upstream: "stage 10" },
    { ch: "10", name: "Vox 1", port: "Dante", socket: "1", upstream: "Receiver A 1" },
    { ch: "11", name: "Vox 2", port: "Dante", socket: "2", upstream: "Receiver A 2" },
    { ch: "12", name: "Vox 3", port: "Dante", socket: "3", upstream: "Receiver B 1" },
    { ch: "13", name: "Pastor", port: "Dante", socket: "4", upstream: "Receiver B 2" },
    { ch: "14-15", name: "Tracks (st)", port: "Dante", socket: "9+10", upstream: "Playback laptop 1+2" },
    { ch: "16", name: "Click", port: "Dante", socket: "11", upstream: "Playback laptop 3" },
  ];
  for (const r of rows) applyRow(map, r);
  const d = node(map, doorId("slink"));
  if (d) d.label = "Stage box";
  map.panels = [
    { id: "pan-drums", label: "Drum riser pocket", port: "stage", from: 1, to: 8 },
    { id: "pan-keys", label: "Keys pocket", port: "stage", from: 9, to: 12 },
  ];
  map.watchlist.push({
    id: "w-example",
    severity: "know",
    symptom: "Click in the house",
    detail: "Channel 16 must stay out of the main mix — it is for in-ears only. If the room hears a click, that assignment moved.",
    nodes: [chId("16")],
  });
  return map;
}
