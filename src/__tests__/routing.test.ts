import { describe, expect, it } from "vitest";
import {
  applyRow,
  channelRows,
  channelsForDesk,
  chId,
  doorId,
  emptyMap,
  exampleMap,
  migrateChains,
  normalizeMap,
  parsePatchList,
  panelViews,
  parsePort,
  parseUpstream,
  searchNodes,
  setSocketDead,
  toPatchList,
  traceUpstream,
  twinsOf,
  walk,
  type LiveView,
} from "../lib/routing";

// Real rows from a real building's patch list (channel numbers and sockets as
// photographed off the console). Names are this week's; numbers are forever.
const BOOTH = `CH\tNAME\tPORT\tSOCKET\tUPSTREAM
1\tKick IN\tSLink\t1\tstage 1
2\tKick Out\tSLink\t7\tstage 17
11-12\tLoop (st)\tI/O Port 1\t1+2\tPlayback-Mac 01+02
13\tSynth L\t—\t—\tnot patched
39\tvox 3\tI/O Port 1\t43\tULXD4Q-5-8 07
53\tvox 3 (dup)\tI/O Port 1\t43\tULXD4Q-5-8 07
32\tFOH TB\tLocal\t10\tconsole rack XLR`;

function boothMap() {
  const map = emptyMap();
  for (const r of parsePatchList(BOOTH).rows) applyRow(map, r);
  return map;
}

const NOW = Date.parse("September 27, 2026 08:40:00");
const blind: LiveView = { now: NOW };
const desk = (over: Partial<LiveView["desk"]> = {}): LiveView => ({
  now: NOW,
  desk: { connected: true, mutes: {}, faders: { "input:39": -4, "input:53": -8 }, names: { "input:39": "Anna" }, ...over },
});

describe("parsing the patch list", () => {
  it("reads tabs, drops the header, keeps stereo channel ranges", () => {
    const p = parsePatchList(BOOTH);
    expect(p.rows.map((r) => r.ch)).toEqual(["1", "2", "11-12", "13", "39", "53", "32"]);
    expect(p.skipped).toEqual([]);
  });
  it("reads commas and two-space columns too", () => {
    expect(parsePatchList("39,vox 3,Dante,43,ULXD4Q-5-8 07").rows[0].upstream).toBe("ULXD4Q-5-8 07");
    expect(parsePatchList("39  vox 3  Dante  43  ULXD4Q-5-8 07").rows[0].socket).toBe("43");
  });
  it("skips lines that are not channels and reports them", () => {
    const p = parsePatchList("notes about the desk\n39\tvox 3\tDante\t43\tULXD4Q-5-8 07");
    expect(p.rows).toHaveLength(1);
    expect(p.skipped).toEqual(["notes about the desk"]);
  });
  it("recognises the three doors by many names", () => {
    expect(parsePort("SLink")).toBe("slink");
    expect(parsePort("Stage box")).toBe("slink");
    expect(parsePort("I/O Port 1")).toBe("dante");
    expect(parsePort("Dante")).toBe("dante");
    expect(parsePort("Local")).toBe("local");
    expect(parsePort("—")).toBeNull();
    expect(parsePort("not patched")).toBeNull();
  });
  it("classifies the upstream cell by what it names", () => {
    expect(parseUpstream("ULXD4Q-5-8 07")).toMatchObject({ sourceKind: "wireless", port: "ULXD4Q-5-8", index: "07" });
    expect(parseUpstream("stage 41")).toMatchObject({ sourceKind: "socket", index: "41", label: "Stage socket 41" });
    expect(parseUpstream("Playback-Mac 01+02")).toMatchObject({ sourceKind: "playback", index: "01+02" });
    expect(parseUpstream("iPad 01")).toMatchObject({ sourceKind: "consumer" });
    expect(parseUpstream("console rack XLR")).toMatchObject({ sourceKind: "rackxlr", index: "" });
    expect(parseUpstream("not patched")).toBeNull();
  });
});

describe("rows in, graph out, rows back", () => {
  it("round-trips through the table", () => {
    const map = boothMap();
    const rows = channelRows(map);
    expect(rows.map((r) => r.ch)).toEqual(["1", "2", "11-12", "13", "32", "39", "53"]);
    const r39 = rows.find((r) => r.ch === "39")!;
    expect(r39).toMatchObject({ doorLabel: "I/O Port 1", socket: "43", upstream: "ULXD4Q-5-8 07", twins: ["53"] });
    expect(rows.find((r) => r.ch === "13")).toMatchObject({ door: "", upstream: "" });
    // Text out is text in.
    const again = emptyMap();
    for (const r of parsePatchList(toPatchList(map)).rows) applyRow(again, r);
    expect(channelRows(again)).toEqual(rows);
  });
  it("two channels off one socket share one source node — one preamp", () => {
    const map = boothMap();
    const sources = map.nodes.filter((n) => n.kind === "source" && n.ref?.port === "ULXD4Q-5-8");
    expect(sources).toHaveLength(1);
    expect(twinsOf(map, map.nodes.find((n) => n.id === chId("39"))!).map((n) => n.id)).toEqual([chId("53")]);
  });
  it("re-patching a channel replaces its edges and keeps its steps", () => {
    const map = boothMap();
    const ch = map.nodes.find((n) => n.id === chId("2"))!;
    ch.steps = ["Kick Out is the mic under the drum riser."];
    applyRow(map, { ch: "2", port: "SLink", socket: "17", upstream: "stage 17" });
    const r = channelRows(map).find((x) => x.ch === "2")!;
    expect(r.socket).toBe("17");
    expect(map.nodes.find((n) => n.id === chId("2"))!.steps).toEqual(["Kick Out is the mic under the drum riser."]);
    // The old stage-17-into-SLink-7 source is gone; nothing else used it.
    expect(map.edges.filter((e) => e.to === doorId("slink") && e.at === "7")).toHaveLength(0);
  });
  it("unpatching keeps the channel and drops the dangling socket", () => {
    const map = boothMap();
    applyRow(map, { ch: "1", port: "—", socket: "", upstream: "" });
    expect(channelRows(map).find((r) => r.ch === "1")).toMatchObject({ door: "", name: "Kick IN" });
    expect(map.nodes.some((n) => n.id === "src:stage:1")).toBe(false);
  });
});

describe("the walk", () => {
  it("traces a wireless vocal back to the pack, farthest first", () => {
    const map = boothMap();
    expect(traceUpstream(map, chId("39"))).toEqual(["src:ulxd4q-5-8:07", doorId("dante"), chId("39")]);
  });
  it("with no live data it is all walking, pack first, desk last", () => {
    const w = walk(boothMap(), chId("39"), blind)!;
    expect(w.blind).toBe(true);
    expect(w.checks).toEqual([]);
    expect(w.steps[0].text).toMatch(/pack switched on/i);
    expect(w.steps.some((s) => /shared by channels 39 and 53/.test(s.text) && s.rule)).toBe(true);
    expect(w.steps[w.steps.length - 1].text).toMatch(/assigned to the main mix/);
  });
  it("with the desk connected, the channel is a tick and the twin is explained", () => {
    const w = walk(boothMap(), chId("39"), desk({ mutes: { "input:53": true } }))!;
    expect(w.title).toBe("vox 3");
    expect(w.checks.map((c) => c.state)).toEqual(["ok", "ok", "ok"]);
    expect(w.checks[0].text).toBe("Channel 39 is open, fader at −4 dB (“Anna” on the desk).");
    expect(w.checks[1].text).toMatch(/twin, 53, is muted — normal/);
    expect(w.checks[2].text).toMatch(/Desk connected · I\/O Port 1 in 43 patched/);
    // Channel steps drop out: ProDeck already looked. Pack steps remain.
    expect(w.steps.some((s) => /unmuted/.test(s.text))).toBe(false);
    expect(w.steps[0].text).toMatch(/pack/i);
  });
  it("a muted channel is a ✗ with a desk fix, not a walk", () => {
    const w = walk(boothMap(), chId("39"), desk({ mutes: { "input:39": true } }))!;
    expect(w.checks[0]).toMatchObject({ state: "bad", fix: "Unmute channel 39." });
  });
  it("a remembered mute is a question, not a ✗", () => {
    const w = walk(boothMap(), chId("39"), desk({ mutes: { "input:39": true }, confirmed: {} }))!;
    expect(w.checks[0].state).toBe("unknown");
    expect(w.checks[0].text).toMatch(/last record says channel 39 is muted/);
    // Once the desk confirms it, it is a ✗ with a fix.
    const c = walk(boothMap(), chId("39"), desk({ mutes: { "input:39": true }, confirmed: { "input:39": true } }))!;
    expect(c.checks[0]).toMatchObject({ state: "bad", fix: "Unmute channel 39." });
  });
  it("a fader at the bottom is a ✗ too", () => {
    const w = walk(boothMap(), chId("39"), desk({ faders: { "input:39": -90 } }))!;
    expect(w.checks[0].state).toBe("bad");
    expect(w.checks[0].text).toMatch(/fader is all the way down/);
  });
  it("booth capture proves signal — or its absence — when it is fresh", () => {
    const map = boothMap();
    map.nodes.find((n) => n.id === chId("39"))!.bind = { capture: 7 };
    const peaks = new Array(8).fill(0);
    peaks[6] = 0.2;
    let w = walk(map, chId("39"), { now: NOW, capture: { peaks, at: NOW - 1000 } })!;
    expect(w.checks.some((c) => c.state === "ok" && /reaching the booth on input 7/.test(c.text))).toBe(true);
    peaks[6] = 0;
    w = walk(map, chId("39"), { now: NOW, capture: { peaks, at: NOW - 1000 } })!;
    expect(w.checks.some((c) => c.state === "bad" && /Nothing is reaching the booth/.test(c.text))).toBe(true);
    // Stale capture says nothing at all.
    w = walk(map, chId("39"), { now: NOW, capture: { peaks, at: NOW - 60_000 } })!;
    expect(w.checks).toEqual([]);
  });
  it("a dead socket on the path is called out and routed around", () => {
    const map = boothMap();
    map.nodes.find((n) => n.id === "src:stage:1")!.dead = true;
    const w = walk(map, chId("1"), blind)!;
    expect(w.checks[0]).toMatchObject({ state: "bad" });
    expect(w.checks[0].text).toMatch(/marked dead/);
    expect(w.steps[0].text).toMatch(/Move the cable off Stage socket 1/);
  });
  it("stereo channels get the odd/even rule", () => {
    const w = walk(boothMap(), chId("11-12"), blind)!;
    expect(w.steps.some((s) => /Odd socket is left/.test(s.text) && s.rule)).toBe(true);
  });
  it("watchlist entries on the path come back first", () => {
    const map = boothMap();
    map.watchlist.push({ id: "w1", severity: "fix", symptom: "vox 3 buzzes", detail: "Pack 7 has a loose belt clip.", nodes: ["src:ulxd4q-5-8:07"] });
    expect(walk(map, chId("39"), blind)!.watch.map((w) => w.id)).toEqual(["w1"]);
    expect(walk(map, chId("1"), blind)!.watch).toEqual([]);
  });
  it("verification age is the oldest stamp on the path", () => {
    const map = boothMap();
    map.nodes.find((n) => n.id === chId("39"))!.verified = NOW - 5 * 86_400_000;
    map.nodes.find((n) => n.id === "src:ulxd4q-5-8:07")!.verified = NOW - 40 * 86_400_000;
    expect(walk(map, chId("39"), blind)!.verifiedAt).toBe(NOW - 40 * 86_400_000);
  });
  it("walking to a place stops at the channels that feed it", () => {
    const map = boothMap();
    map.nodes.push({ id: "out:dante:39", kind: "output", label: "Dante out 39", transport: "dante" });
    map.nodes.push({ id: "dest:waves", kind: "destination", label: "Waves" });
    map.edges.push({ id: "e1", from: chId("39"), to: "out:dante:39" }, { id: "e2", from: "out:dante:39", to: "dest:waves" });
    expect(traceUpstream(map, "dest:waves")).toEqual([chId("39"), "out:dante:39", "dest:waves"]);
    const w = walk(map, "dest:waves", blind)!;
    expect(w.steps.some((s) => /pack/i.test(s.text))).toBe(false);
    expect(w.steps.some((s) => /Waves/.test(s.text))).toBe(true);
  });
  it("a person is found by the desk key their mic is mapped to", () => {
    const map = boothMap();
    expect(channelsForDesk(map, "input:39").map((n) => n.id)).toEqual([chId("39")]);
    expect(channelsForDesk(map, "input:64")).toEqual([]);
  });
  it("search finds numbers, map names and live desk names", () => {
    const map = boothMap();
    expect(searchNodes(map, "39").map((n) => n.id)).toEqual([chId("39")]);
    expect(searchNodes(map, "kick").map((n) => n.id)).toEqual([chId("1"), chId("2")]);
    expect(searchNodes(map, "anna", { "input:39": "Anna" }).map((n) => n.id)).toEqual([chId("39")]);
    expect(searchNodes(map, "ulxd").some((n) => n.kind === "source")).toBe(true);
  });
});

describe("migration from the schema-1 chains", () => {
  const legacy = {
    chains: [
      {
        id: "audio",
        name: "House audio",
        hops: [
          { from: "Stage mics", to: "Stage box", transport: "XLR / analog", steps: ["Plugged in?", "Swap the XLR."] },
          { from: "Stage box", to: "Mixer", transport: "Dante", watch: "desk" as const, steps: ["Dante Controller: online?"] },
          { from: "Mixer", to: "House speakers", transport: "Dante", steps: [] },
        ],
      },
    ],
  };
  it("keeps every hop's steps and guesses kinds from position", () => {
    const l = normalizeMap(legacy)!;
    expect(l.migrated).toBe(true);
    const kinds = l.map.nodes.map((n) => n.kind);
    expect(kinds).toEqual(["source", "door", "door", "destination"]);
    expect(l.map.nodes.every((n) => n.imported)).toBe(true);
    expect(l.map.edges.map((e) => e.steps)).toEqual([["Plugged in?", "Swap the XLR."], ["Dante Controller: online?"], []]);
    expect(l.map.edges[1].watch).toBe("desk");
  });
  it("the imported map still walks, using the hop steps", () => {
    const map = migrateChains(legacy.chains);
    const dest = map.nodes.find((n) => n.kind === "destination")!;
    const w = walk(map, dest.id, { now: NOW, subsystems: { desk: "ok" } })!;
    expect(w.checks.some((c) => c.state === "ok" && /Stage box → Mixer is live/.test(c.text))).toBe(true);
    expect(w.steps.some((s) => s.text === "Swap the XLR.")).toBe(true);
  });
  it("an absent or empty file seeds nothing; a schema-2 file passes through", () => {
    expect(normalizeMap(null)).toBeNull();
    expect(normalizeMap({})).toBeNull();
    const ex = exampleMap();
    const l = normalizeMap(JSON.parse(JSON.stringify(ex)))!;
    expect(l.migrated).toBe(false);
    expect(l.map.nodes.length).toBe(ex.nodes.length);
  });
  it("the example map is marked as one and walks end to end", () => {
    const ex = exampleMap();
    expect(ex.example).toBe(true);
    expect(channelRows(ex)).toHaveLength(15);
    const w = walk(ex, chId("12"), blind)!;
    expect(w.subtitle).toBe("channel 12 · Receiver B · pack 1");
    expect(walk(ex, chId("16"), blind)!.watch).toHaveLength(1);
  });
});

describe("stage pockets", () => {
  it("cross-references each socket through SLink to the console channel", () => {
    const map = emptyMap();
    for (const r of parsePatchList(`1\tKick IN\tSLink\t1\tstage 1
2\tKick Out\tSLink\t7\tstage 17
17-18\tEG1 (st)\tSLink\t19+20\tstage 41+42`).rows) applyRow(map, r);
    map.panels = [
      { id: "lb", label: "Stage left back", port: "stage", from: 1, to: 10 },
      { id: "rf", label: "Stage right front", port: "stage", from: 41, to: 50 },
    ];
    const [lb, rf] = panelViews(map);
    expect(lb.sockets).toHaveLength(10);
    expect(lb.live).toBe(1);
    expect(lb.sockets[0]).toMatchObject({ n: 1, free: false, dead: false });
    expect(lb.sockets[0].lands[0]).toMatchObject({ doorLabel: "SLink", at: "1", channelIndex: "1", channelLabel: "Kick IN", deskKey: "input:1" });
    expect(lb.sockets[4]).toMatchObject({ n: 5, free: true });
    // A stereo pair: 41 is the left half on SLink 19, 42 the right on 20.
    expect(rf.sockets[0].lands[0]).toMatchObject({ at: "19", stereoSide: "L", channelIndex: "17-18" });
    expect(rf.sockets[1].lands[0]).toMatchObject({ at: "20", stereoSide: "R" });
    expect(rf.live).toBe(2);
  });
  it("marks a socket dead even when nothing was patched from it, and keeps it", () => {
    const map = emptyMap();
    map.panels = [{ id: "p", label: "P", port: "stage", from: 1, to: 4 }];
    setSocketDead(map, "stage", 3, true);
    expect(panelViews(map)[0].sockets[2]).toMatchObject({ n: 3, dead: true, free: false });
    applyRow(map, { ch: "1", port: "SLink", socket: "1", upstream: "stage 1" }); // prunes orphans — the dead socket must survive
    expect(map.nodes.some((n) => n.id === "src:stage:3" && n.dead)).toBe(true);
    setSocketDead(map, "stage", 3, false);
    expect(panelViews(map)[0].sockets[2].dead).toBe(false);
  });
  it("lists an external insert on the channel a socket feeds", () => {
    const map = emptyMap();
    applyRow(map, { ch: "51", name: "vox 1 dup", port: "Dante", socket: "41", upstream: "ULXD4Q-5-8 05" });
    applyRow(map, { ch: "2", name: "Kick Out", port: "SLink", socket: "7", upstream: "stage 17" });
    map.nodes.push({ id: "out:dante:32", kind: "output", label: "Dante out 32" }, { id: "dest:waves", kind: "destination", label: "Waves LV1" });
    map.edges.push({ id: "e1", from: chId("2"), to: "out:dante:32" }, { id: "e2", from: "out:dante:32", to: "dest:waves" });
    map.panels = [{ id: "p", label: "Back", port: "stage", from: 11, to: 20 }];
    expect(panelViews(map)[0].sockets[6]).toMatchObject({ n: 17, inserts: ["Waves LV1"] });
  });
  it("the example ships with pockets", () => {
    const v = panelViews(exampleMap());
    expect(v.map((p) => p.panel.label)).toEqual(["Drum riser pocket", "Keys pocket"]);
    expect(v[0].live).toBe(7);
  });
});
