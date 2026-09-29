// "Ask ProDeck" — the troubleshooter's agent loop. Pure: no React, no Tauri;
// the caller passes the context and a `complete` function (the booth proxy).
//
// The model may only speak from what the tools return, the knowledge files
// and the doctrine. Tools are the routing engine's own functions, so every
// fact it can cite is a fact the map already holds. Spec: design/TROUBLESHOOTER.md.

import doctrine from "../assist/doctrine.md?raw";
import {
  ageText,
  channelByNumber,
  channelRows,
  deskKeyFor,
  edgesOutOf,
  firstIndex,
  node,
  panelViews,
  searchNodes,
  twinsOf,
  walk,
  type LiveView,
  type RNode,
  type RoutingMap,
} from "./routing";

export interface AssistPerson {
  name: string;
  position: string;
  mic: string;
  channelIds: string[];
}

export interface AssistStatusCtx {
  deskConnected: boolean;
  ppConnected: boolean;
  meterRunning: boolean;
  /** Planning Center plan / service label if one is selected. */
  service?: string;
  /** Outboard rig state from the last scene recall, when the church has configured the scenes. */
  waves?: "on" | "off" | "unknown";
}

export interface AssistCtx {
  map: RoutingMap;
  live: LiveView;
  people: AssistPerson[];
  status: AssistStatusCtx;
  knowledge: { name: string; text: string }[];
  /** Who is asking, for the model's tone ("a volunteer on a phone"). */
  asker: "booth" | "phone";
}

export type Msg = { role: "user" | "assistant"; content: unknown };

export interface AssistResult {
  text: string;
  /** Node ids the answer cited, in order, for the UI to link. */
  cites: { label: string; nodeId: string }[];
  toolCalls: number;
}

export const MAX_ROUNDS = 6;

/* ------------------------------------------------------------- tools */

export const TOOLS = [
  {
    name: "find",
    description: "Find people (this week's team, by name), console channels (by number, map name or live desk name), sources (packs, sockets, machines) and places (outputs/destinations) on the routing map. Returns node ids to use with walk/channel.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "A name, a channel number, a socket like 'stage 41', a receiver, a place" } }, required: ["query"] },
  },
  {
    name: "walk",
    description: "The deterministic troubleshooting walk for one node: what ProDeck already checked live (ticks/crosses) and the steps left to walk to, most likely first, with the building's own step text. Use this for the channel or place the person means.",
    input_schema: { type: "object", properties: { node_id: { type: "string" } }, required: ["node_id"] },
  },
  {
    name: "channel",
    description: "One console channel: its patch (door, socket, upstream source), live desk mute/fader/name, shared-preamp twins, external inserts (Waves) and notes.",
    input_schema: { type: "object", properties: { number: { type: "integer" } }, required: ["number"] },
  },
  {
    name: "socket",
    description: "One stage socket by number, or a whole pocket by name: what it feeds, live/free/dead.",
    input_schema: { type: "object", properties: { socket: { type: "integer" }, pocket: { type: "string" } } },
  },
  {
    name: "watchlist",
    description: "Known issues and deliberate oddities the church has written down, with the nodes they touch.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "status",
    description: "What ProDeck can see right now: desk connected, ProPresenter connected, meter running, who is on which mic this week, map age.",
    input_schema: { type: "object", properties: {} },
  },
];

function nodeRef(n: RNode): string {
  if (n.kind === "channel") return `ch ${n.ref?.index ?? ""}`.trim();
  if (n.kind === "source" && n.ref) return `${n.ref.port} ${n.ref.index}`.trim();
  return n.label;
}

function channelInfo(ctx: AssistCtx, n: RNode) {
  const row = channelRows(ctx.map).find((r) => r.nodeId === n.id);
  const key = deskKeyFor(n);
  const desk = ctx.live.desk?.connected ? ctx.live.desk : null;
  const inserts = edgesOutOf(ctx.map, n.id)
    .map((e) => node(ctx.map, e.to))
    .filter((o): o is RNode => !!o && o.kind === "output")
    .map((o) => {
      const dest = edgesOutOf(ctx.map, o.id).map((x) => node(ctx.map, x.to)).find((d) => d?.kind === "destination");
      return { output: o.label, to: dest?.label ?? null, note: o.note ?? null };
    });
  return {
    node_id: n.id,
    channel: n.ref?.index,
    name: n.label || null,
    desk_name: key && desk ? (desk.names[key] ?? "").trim() || null : null,
    muted: key && desk ? desk.mutes[key] === true : null,
    mute_confidence: key && desk ? (desk.mutes[key] === undefined ? "unknown" : desk.confirmed ? (key in desk.confirmed ? "confirmed" : "remembered") : "confirmed") : null,
    fader_db: key && desk && typeof desk.faders[key] === "number" ? (desk.faders[key] === -Infinity ? "-inf" : Math.round(desk.faders[key])) : null,
    door: row?.doorLabel || null,
    door_socket: row?.socket || null,
    upstream: row?.upstream || null,
    upstream_id: row?.upstreamId ?? null,
    twins_sharing_preamp: twinsOf(ctx.map, n).map((t) => t.ref?.index),
    inserts,
    note: n.note ?? null,
    dead: !!n.dead,
    verified: n.verified ? ageText(n.verified, ctx.live.now) : "never",
  };
}

export function runTool(ctx: AssistCtx, name: string, input: Record<string, unknown>): unknown {
  switch (name) {
    case "find": {
      const q = String(input.query ?? "").trim();
      const ql = q.toLowerCase();
      const people = ctx.people.filter((p) => p.name.toLowerCase().includes(ql) || p.position.toLowerCase().includes(ql)).map((p) => ({ person: p.name, position: p.position, mic: p.mic, channel_ids: p.channelIds }));
      const nodes = searchNodes(ctx.map, q, ctx.live.desk?.names).map((n) => ({ node_id: n.id, kind: n.kind, ref: nodeRef(n), label: n.label, dead: !!n.dead }));
      const pockets = (ctx.map.panels ?? []).filter((p) => p.label.toLowerCase().includes(ql)).map((p) => ({ pocket: p.label, sockets: `${p.from}–${p.to}` }));
      return { people, nodes, pockets, hint: people.length + nodes.length + pockets.length === 0 ? "Nothing on the map matches. Ask one clarifying question or use the generic checklist." : undefined };
    }
    case "walk": {
      const id = String(input.node_id ?? "");
      const w = walk(ctx.map, id, ctx.live);
      if (!w) return { error: `no node ${id}` };
      return {
        title: w.title,
        subtitle: w.subtitle,
        known_issues: w.watch.map((k) => ({ severity: k.severity, symptom: k.symptom, detail: k.detail })),
        checked: w.checks.map((c) => ({ result: c.state, text: c.text, fix: c.fix ?? null })),
        steps: w.steps.map((s) => ({ n: s.n, text: s.text, rule: s.rule ?? null, node_id: s.nodeId ?? null })),
        path: w.path.map((pid) => ({ node_id: pid, ref: node(ctx.map, pid) ? nodeRef(node(ctx.map, pid)!) : pid })),
        map_verified: ageText(w.verifiedAt, ctx.live.now),
        blind: w.blind,
      };
    }
    case "channel": {
      const n = channelByNumber(ctx.map, Number(input.number));
      return n ? channelInfo(ctx, n) : { error: `no channel ${input.number} on the map` };
    }
    case "socket": {
      const views = panelViews(ctx.map);
      if (input.pocket) {
        const pl = String(input.pocket).toLowerCase();
        const v = views.find((x) => x.panel.label.toLowerCase().includes(pl));
        if (!v) return { error: "no such pocket", pockets: views.map((x) => x.panel.label) };
        return { pocket: v.panel.label, note: v.panel.note ?? null, live: v.live, sockets: v.sockets.map((s) => ({ socket: s.n, state: s.dead ? "dead" : s.free ? "free" : "live", feeds: s.lands.map((l) => `${l.doorLabel} ${l.at} → ch ${l.channelIndex}${l.channelLabel ? " " + l.channelLabel : ""}${l.stereoSide ? " (" + l.stereoSide + ")" : ""}`), inserts: s.inserts })) };
      }
      const n = Number(input.socket);
      for (const v of views) {
        const s = v.sockets.find((x) => x.n === n);
        if (s) return { pocket: v.panel.label, socket: n, state: s.dead ? "dead" : s.free ? "free" : "live", source_id: s.sourceId ?? null, feeds: s.lands.map((l) => ({ door: l.doorLabel, at: l.at, channel: l.channelIndex, name: l.channelLabel, channel_id: l.channelId, side: l.stereoSide ?? null })), inserts: s.inserts };
      }
      return { error: `socket ${n} is not in any pocket on the map`, pockets: views.map((x) => `${x.panel.label} ${x.panel.from}–${x.panel.to}`) };
    }
    case "watchlist":
      return ctx.map.watchlist.map((w) => ({ severity: w.severity, symptom: w.symptom, detail: w.detail, node_ids: w.nodes ?? [] }));
    case "status":
      return {
        desk_connected: ctx.status.deskConnected,
        propresenter_connected: ctx.status.ppConnected,
        meter_running: ctx.status.meterRunning,
        waves_rig: ctx.status.waves ?? "unknown",
        last_scene: ctx.live.desk?.scene ?? null,
        service: ctx.status.service ?? null,
        people_on_mics: ctx.people.map((p) => ({ person: p.name, position: p.position, mic: p.mic, channels: p.channelIds.map((id) => node(ctx.map, id)?.ref?.index ?? id) })),
        map_verified: ageText(ctx.map.verified?.at, ctx.live.now),
        pockets: (ctx.map.panels ?? []).map((p) => `${p.label} (${p.port} ${p.from}–${p.to})`),
      };
    default:
      return { error: `unknown tool ${name}` };
  }
}

/* ------------------------------------------------------------- prompt */

function digest(ctx: AssistCtx): string {
  const m = ctx.map;
  const kinds = (k: RNode["kind"]) => m.nodes.filter((n) => n.kind === k);
  const doors = kinds("door").map((d) => `${d.label}${d.note ? ` — ${d.note}` : ""}`);
  const buses = kinds("bus").map((b) => `${b.label}${b.note ? ` — ${b.note}` : ""}`);
  const dests = kinds("destination").map((d) => `${d.label}${d.note ? ` — ${d.note}` : ""}`);
  const outs = kinds("output").filter((o) => o.note || o.dead).map((o) => `${o.label}${o.dead ? " (DEAD)" : ""}${o.note ? ` — ${o.note}` : ""}`);
  const chans = channelRows(m).map((r) => `${r.ch}${r.name ? " " + r.name : ""} ← ${r.doorLabel || "unpatched"}${r.socket ? " " + r.socket : ""}${r.upstream ? " ← " + r.upstream : ""}${r.twins.length ? ` (shares preamp with ${r.twins.join(",")})` : ""}`);
  const pockets = (m.panels ?? []).map((p) => `${p.label}: ${p.port} ${p.from}–${p.to}${p.note ? ` — ${p.note}` : ""}`);
  return [
    `Map verified: ${ageText(m.verified?.at, ctx.live.now)}${m.verified?.by ? ` (${m.verified.by})` : ""}.`,
    `Doors (how signal enters the console):\n- ${doors.join("\n- ")}`,
    `Console channels (number name ← door socket ← upstream):\n- ${chans.join("\n- ")}`,
    pockets.length ? `Stage pockets:\n- ${pockets.join("\n- ")}` : "",
    buses.length ? `Buses/groups:\n- ${buses.join("\n- ")}` : "",
    outs.length ? `Outputs with notes:\n- ${outs.join("\n- ")}` : "",
    dests.length ? `Destinations (places):\n- ${dests.join("\n- ")}` : "",
    `Known issues: ${m.watchlist.length} (use the watchlist tool).`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildSystem(ctx: AssistCtx): string {
  const live = [
    `Desk mirror: ${ctx.status.deskConnected ? "connected (mutes, faders and names are live)" : "NOT connected — mute and fader state is unknown"}.`,
    `ProPresenter: ${ctx.status.ppConnected ? "connected" : "not connected"}.`,
    `Booth audio meter: ${ctx.status.meterRunning ? "running" : "not running"}.`,
    ctx.status.waves && ctx.status.waves !== "unknown" ? `Outboard rig (Waves): ${ctx.status.waves.toUpperCase()} according to the last scene recall${ctx.live.desk?.scene ? ` (scene ${ctx.live.desk.scene})` : ""}.` : "",
    // Remembered mutes are guesses: say so once so the model doesn't assert them.
    ctx.live.desk?.confirmed ? `Desk mutes: the tools mark a mute as confirmed only if the desk reported it since connecting; treat others as "last remembered".` : "",
    ctx.status.service ? `Service selected: ${ctx.status.service}.` : "",
    ctx.people.length ? `On mics this week: ${ctx.people.map((p) => `${p.name} (${p.position}, mic ${p.mic}${p.channelIds.length ? " → " + p.channelIds.map((id) => node(ctx.map, id)?.ref?.index ?? id).join("/") : ""})`).join("; ")}.` : "No mic assignments are known for this week.",
    `The person asking is ${ctx.asker === "phone" ? "a volunteer on a phone, probably not at the desk" : "at the booth"}.`,
  ]
    .filter(Boolean)
    .join("\n");
  const knowledge = ctx.knowledge.map((k) => `### ${k.name}\n${k.text}`).join("\n\n");
  return [
    doctrine.trim(),
    "## This building — the routing map digest\n\n" + digest(ctx),
    knowledge ? "## This building — the knowledge files\n\n" + knowledge : "## This building — knowledge files\n\n(None written yet. Rely on the map digest and tools.)",
    "## Right now\n\n" + live,
    "## Tools\n\nUse `find` first when the person names a person, a thing or a place. Use `walk` on the node they mean before answering about it; put its ticks and crosses first. Use `channel`, `socket`, `watchlist`, `status` as needed. Do not answer from memory about this building.",
  ].join("\n\n");
}

/* --------------------------------------------------------------- loop */

type Complete = (body: Record<string, unknown>) => Promise<any>;

/** Run the conversation one user turn forward. `history` is prior turns
 *  (user/assistant text only); returns the assistant's final text. */
export async function ask(ctx: AssistCtx, history: Msg[], question: string, complete: Complete): Promise<AssistResult> {
  const system = buildSystem(ctx);
  const messages: Msg[] = [...history, { role: "user", content: question }];
  let toolCalls = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await complete({ system, messages, tools: TOOLS, max_tokens: 1500 });
    const content: any[] = Array.isArray(res?.content) ? res.content : [];
    const uses = content.filter((b) => b.type === "tool_use");
    if (uses.length === 0 || res?.stop_reason !== "tool_use") {
      const text = content.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n").trim();
      return { text: text || "I couldn't put an answer together. Try asking about the person, channel or place by name.", cites: cites(ctx, text), toolCalls };
    }
    messages.push({ role: "assistant", content });
    const results = uses.map((u) => {
      toolCalls++;
      let out: unknown;
      try {
        out = runTool(ctx, String(u.name), (u.input ?? {}) as Record<string, unknown>);
      } catch (e) {
        out = { error: String(e) };
      }
      return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out).slice(0, 20_000) };
    });
    messages.push({ role: "user", content: results });
  }
  return { text: "I ran out of steps looking that up. Ask again with the channel number or the person's name.", cites: [], toolCalls };
}

/** Bracketed citations → node ids: [ch 39], [stage 41], [Waves LV1], [pocket Stage right front]. */
export function cites(ctx: AssistCtx, text: string): { label: string; nodeId: string }[] {
  const out: { label: string; nodeId: string }[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/\[([^\]\n]{1,60})\]/g)) {
    const label = m[1].trim();
    const id = resolveCite(ctx.map, label);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push({ label, nodeId: id });
    }
  }
  return out;
}

export function resolveCite(map: RoutingMap, label: string): string | undefined {
  const l = label.toLowerCase();
  // A raw node id slipped through — still link it.
  if (map.nodes.some((x) => x.id === label)) return label;
  let m = /^(?:ch|channel)\s*(\d+(?:\s*[-–+]\s*\d+)?)$/.exec(l);
  if (m) {
    const n = channelByNumber(map, parseInt(m[1], 10));
    return n?.id;
  }
  m = /^(?:stage(?: socket)?|socket)\s*(\d+)$/.exec(l);
  if (m) {
    const n = map.nodes.find((x) => x.kind === "source" && x.ref?.port === "stage" && x.ref.index.split(/\s*[+\-–]\s*/).includes(m![1]));
    return n?.id;
  }
  const byLabel = map.nodes.find((x) => x.label.toLowerCase() === l.replace(/^pocket\s+/, "").replace(/^(?:bus|place|destination|output)\s+/, ""));
  if (byLabel) return byLabel.id;
  const byRef = map.nodes.find((x) => x.ref && `${x.ref.port} ${x.ref.index}`.toLowerCase() === l);
  if (byRef) return byRef.id;
  const loose = map.nodes.find((x) => x.label && l.includes(x.label.toLowerCase()) && x.label.length > 3);
  if (loose) return loose.id;
  // "[Waves LV1]" for a node labelled "Waves LV1 (Waves-PC)": the cite is a
  // prefix or a substring of the label. Only for cites long enough to be
  // unambiguous.
  if (l.length > 4) {
    const within = map.nodes.find((x) => x.label.toLowerCase().includes(l));
    if (within) return within.id;
  }
  void firstIndex;
  return undefined;
}
