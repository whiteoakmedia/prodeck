import { describe, expect, it } from "vitest";
import { applyRow, chId, doorId, emptyMap, exampleMap, parsePatchList, type LiveView } from "../lib/routing";
import { canConnect, COLUMNS, filterMap, layoutGraph, newNodePos, paintFor, paintGraph, subFor } from "../lib/routingLayout";

const NOW = Date.parse("September 27, 2026 08:40:00");

function boothMap() {
  const map = emptyMap();
  const rows = parsePatchList(`1\tKick IN\tSLink\t1\tstage 1
39\tvox 3\tI/O Port 1\t43\tULXD4Q-5-8 07
53\tvox 3 (dup)\tI/O Port 1\t43\tULXD4Q-5-8 07
32\tFOH TB\tLocal\t10\tconsole rack XLR`).rows;
  for (const r of rows) applyRow(map, r);
  return map;
}

describe("layout by kind", () => {
  it("puts every node in its column, columns left to right", () => {
    const g = layoutGraph(exampleMap(), "all");
    const xs = new Map<string, Set<number>>();
    for (const n of g.nodes) xs.set(n.kind, (xs.get(n.kind) ?? new Set()).add(Math.round(n.x)));
    // One x per kind.
    for (const [, set] of xs) expect(set.size).toBe(1);
    const colX = (k: string) => [...(xs.get(k) ?? [])][0];
    expect(colX("source")).toBeLessThan(colX("door"));
    expect(colX("door")).toBeLessThan(colX("channel"));
  });
  it("never overlaps two nodes in a column", () => {
    const g = layoutGraph(exampleMap(), "all");
    const chans = g.nodes.filter((n) => n.kind === "channel").sort((a, b) => a.y - b.y);
    for (let i = 1; i < chans.length; i++) expect(chans[i].y - chans[i - 1].y).toBeGreaterThanOrEqual(36);
    expect(g.height).toBeGreaterThan(chans[chans.length - 1].y);
  });
  it("honours a manual nudge for that node only", () => {
    const map = exampleMap();
    map.nodes.find((n) => n.id === chId("1"))!.pos = { x: 999, y: 777 };
    const g = layoutGraph(map, "all");
    const moved = g.nodes.find((n) => n.id === chId("1"))!;
    expect(moved).toMatchObject({ x: 999, y: 777, pinned: true });
    const other = g.nodes.find((n) => n.id === chId("2"))!;
    expect(other.pinned).toBe(false);
    expect(other.x).not.toBe(999);
  });
  it("edges carry the socket as their label and inherit dead/unverified", () => {
    const map = boothMap();
    map.nodes.find((n) => n.id === "src:stage:1")!.dead = true;
    const g = layoutGraph(map, "all");
    const e = g.edges.find((x) => x.from === "src:stage:1")!;
    expect(e).toMatchObject({ label: "1", dead: true, unverified: true });
  });
});

describe("filters", () => {
  it("Only Dante keeps the Dante door, its sources and channels — nothing SLink", () => {
    const map = boothMap();
    const f = filterMap(map, "dante");
    const ids = f.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["ch:39", "ch:53", doorId("dante"), "src:ulxd4q-5-8:07"].sort());
    expect(f.edges.every((e) => e.transport === "dante")).toBe(true);
  });
  it("Only Local finds the rack XLR chain", () => {
    const f = filterMap(boothMap(), "local");
    expect(f.nodes.map((n) => n.id).sort()).toEqual(["ch:32", doorId("local"), "src:console-rack-xlr"].sort());
  });
  it("Show all is everything", () => {
    const map = boothMap();
    expect(filterMap(map, "all").nodes.length).toBe(map.nodes.length);
  });
});

describe("paint", () => {
  it("reads mute, fader and desk name for a channel", () => {
    const map = boothMap();
    const live: LiveView = { now: NOW, desk: { connected: true, mutes: { "input:39": true }, faders: { "input:53": -12 }, names: { "input:39": "Anna" } } };
    const n39 = map.nodes.find((n) => n.id === chId("39"))!;
    const n53 = map.nodes.find((n) => n.id === chId("53"))!;
    expect(paintFor(n39, live)).toMatchObject({ muted: true, deskName: "Anna" });
    expect(subFor(n39, paintFor(n39, live))).toBe("“Anna” · muted");
    expect(subFor(n53, paintFor(n53, live))).toBe("−12 dB");
  });
  it("shows signal on a captured node only while fresh", () => {
    const map = boothMap();
    const n = map.nodes.find((x) => x.id === chId("39"))!;
    n.bind = { capture: 2 };
    expect(paintFor(n, { now: NOW, capture: { peaks: [0, 0.3], at: NOW - 500 } }).signal).toBe(true);
    expect(paintFor(n, { now: NOW, capture: { peaks: [0, 0.3], at: NOW - 9000 } }).signal).toBeUndefined();
    const g = layoutGraph(map, "all");
    const p = paintGraph(map, g, { now: NOW, capture: { peaks: [0, 0.3], at: NOW - 500 } });
    expect(p.liveEdges.has(g.edges.find((e) => e.to === chId("39"))!.id)).toBe(true);
    expect(p.nodes.get(chId("39"))!.paint.signal).toBe(true);
    // Same live state → same keys, so nothing re-renders on an idle tick.
    const again = paintGraph(map, g, { now: NOW + 1500, capture: { peaks: [0, 0.3], at: NOW - 500 } });
    expect(again.nodes.get(chId("39"))!.key).toBe(p.nodes.get(chId("39"))!.key);
  });
});

describe("connecting", () => {
  it("allows one column forward and channel → output, nothing else", () => {
    expect(canConnect("source", "door")).toBe(true);
    expect(canConnect("door", "channel")).toBe(true);
    expect(canConnect("channel", "bus")).toBe(true);
    expect(canConnect("channel", "output")).toBe(true);
    expect(canConnect("source", "bus")).toBe(false);
    expect(canConnect("channel", "door")).toBe(false);
    expect(canConnect("door", "door")).toBe(false);
  });
  it("a new node lands at the bottom of its column", () => {
    const g = layoutGraph(exampleMap(), "all");
    const p = newNodePos(g, "channel");
    const col = g.nodes.filter((n) => n.kind === "channel");
    expect(p.x).toBe(col[0].x);
    expect(p.y).toBeGreaterThan(Math.max(...col.map((n) => n.y)));
    expect(COLUMNS).toHaveLength(6);
  });
});
