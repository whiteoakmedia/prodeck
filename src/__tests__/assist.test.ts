import { describe, expect, it } from "vitest";
import { applyRow, chId, emptyMap, parsePatchList, type LiveView } from "../lib/routing";
import { ask, buildSystem, cites, resolveCite, runTool, TOOLS, type AssistCtx } from "../lib/assist";

const NOW = Date.parse("September 27, 2026 08:40:00");

function ctx(over: Partial<AssistCtx> = {}): AssistCtx {
  const map = emptyMap();
  for (const r of parsePatchList(`1\tKick IN\tSLink\t1\tstage 1
39\tvox 3\tI/O Port 1\t43\tULXD4Q-5-8 07
53\tvox 3 (dup)\tI/O Port 1\t43\tULXD4Q-5-8 07`).rows) applyRow(map, r);
  map.panels = [{ id: "p", label: "Stage left back", port: "stage", from: 1, to: 10 }];
  map.nodes.push({ id: "dest:waves", kind: "destination", label: "Waves LV1", steps: ["Is Waves-PC on?"] });
  map.watchlist.push({ id: "w", severity: "know", symptom: "vocals quiet together", detail: "Waves is down", nodes: ["dest:waves"] });
  const live: LiveView = { now: NOW, desk: { connected: true, mutes: { "input:53": true }, faders: { "input:39": -4 }, names: { "input:39": "Anna" } } };
  return {
    map,
    live,
    people: [{ name: "Anna Brooks", position: "Vocals", mic: "3", channelIds: [chId("39"), chId("53")] }],
    status: { deskConnected: true, ppConnected: true, meterRunning: true, service: "Sunday 10am" },
    knowledge: [{ name: "SYSTEM.md", text: "Scene 19 Waves Off is safe to recall." }],
    asker: "phone",
    ...over,
  };
}

describe("the troubleshooter's tools", () => {
  it("find resolves a person to her channels and a socket to its node", () => {
    const c = ctx();
    const r = runTool(c, "find", { query: "anna" }) as any;
    expect(r.people[0]).toMatchObject({ person: "Anna Brooks", mic: "3", channel_ids: [chId("39"), chId("53")] });
    // Live desk name "Anna" also matches channel 39.
    expect(r.nodes.some((n: any) => n.node_id === chId("39"))).toBe(true);
    const s = runTool(c, "find", { query: "stage 1" }) as any;
    expect(s.nodes.some((n: any) => n.node_id === "src:stage:1")).toBe(true);
    expect((runTool(c, "find", { query: "zzzz" }) as any).hint).toMatch(/Nothing on the map/);
  });
  it("walk returns ticks, steps and the path with refs", () => {
    const w = runTool(ctx(), "walk", { node_id: chId("39") }) as any;
    expect(w.title).toBe("vox 3");
    expect(w.checked[0]).toMatchObject({ result: "ok" });
    expect(w.steps[0].text).toMatch(/pack/i);
    expect(w.path.map((p: any) => p.ref)).toEqual(["ULXD4Q-5-8 07", "I/O Port 1", "ch 39"]);
  });
  it("channel gives patch, live state and twins", () => {
    const c = runTool(ctx(), "channel", { number: 53 }) as any;
    expect(c).toMatchObject({ channel: "53", muted: true, door: "I/O Port 1", door_socket: "43", upstream: "ULXD4Q-5-8 07", twins_sharing_preamp: ["39"] });
    expect((runTool(ctx(), "channel", { number: 99 }) as any).error).toMatch(/no channel 99/);
  });
  it("socket answers by number and by pocket", () => {
    const one = runTool(ctx(), "socket", { socket: 1 }) as any;
    expect(one).toMatchObject({ pocket: "Stage left back", state: "live" });
    expect(one.feeds[0]).toMatchObject({ door: "SLink", at: "1", channel: "1" });
    const pocket = runTool(ctx(), "socket", { pocket: "left back" }) as any;
    expect(pocket.sockets).toHaveLength(10);
    expect(pocket.sockets[4].state).toBe("free");
    expect((runTool(ctx(), "socket", { socket: 77 }) as any).error).toMatch(/not in any pocket/);
  });
  it("status and watchlist are plain facts", () => {
    const s = runTool(ctx(), "status", {}) as any;
    expect(s).toMatchObject({ desk_connected: true, service: "Sunday 10am" });
    expect(s.people_on_mics[0].channels).toEqual(["39", "53"]);
    expect((runTool(ctx(), "watchlist", {}) as any)[0].symptom).toBe("vocals quiet together");
  });
  it("every tool the model is offered exists", () => {
    for (const t of TOOLS) expect((runTool(ctx(), t.name, {}) as any)?.error ?? "").not.toMatch(/unknown tool/);
  });
});

describe("the prompt", () => {
  it("carries the doctrine, the map digest, the knowledge and the live state", () => {
    const sys = buildSystem(ctx());
    expect(sys).toMatch(/How to troubleshoot a live sound system/);
    expect(sys).toMatch(/39 vox 3 ← I\/O Port 1 43 ← ULXD4Q-5-8 07 \(shares preamp with 53\)/);
    expect(sys).toMatch(/Stage left back: stage 1–10/);
    expect(sys).toMatch(/### SYSTEM.md\nScene 19 Waves Off is safe/);
    expect(sys).toMatch(/Desk mirror: connected/);
    expect(sys).toMatch(/Anna Brooks \(Vocals, mic 3 → 39\/53\)/);
    expect(sys).toMatch(/a volunteer on a phone/);
  });
});

describe("citations", () => {
  it("resolve channel, socket, label and pocket brackets to nodes", () => {
    const { map } = ctx();
    expect(resolveCite(map, "ch 39")).toBe(chId("39"));
    expect(resolveCite(map, "channel 53")).toBe(chId("53"));
    expect(resolveCite(map, "stage 1")).toBe("src:stage:1");
    expect(resolveCite(map, "Waves LV1")).toBe("dest:waves");
    expect(resolveCite(map, "ULXD4Q-5-8 07")).toBe("src:ulxd4q-5-8:07");
    expect(resolveCite(map, "nothing here")).toBeUndefined();
    // A raw id still links; a "bus X" prefix is tolerated.
    expect(resolveCite(map, "dest:waves")).toBe("dest:waves");
    expect(resolveCite(map, "place Waves LV1")).toBe("dest:waves");
    map.nodes.find((n) => n.id === "dest:waves")!.label = "Waves LV1 (Waves-PC)";
    expect(resolveCite(map, "Waves LV1")).toBe("dest:waves");
    const c = cites(ctx(), "Channel 39 is open [ch 39]. Check the pack [ULXD4Q-5-8 07]. If Waves is down [Waves LV1]… [ch 39] again.");
    expect(c.map((x) => x.nodeId)).toEqual([chId("39"), "src:ulxd4q-5-8:07", "dest:waves"]);
  });
});

describe("the loop", () => {
  it("runs tools the model asks for, feeds results back, and returns the final text", async () => {
    const calls: any[] = [];
    const complete = async (body: any) => {
      calls.push(body);
      if (calls.length === 1) {
        return { stop_reason: "tool_use", content: [{ type: "text", text: "Let me look." }, { type: "tool_use", id: "t1", name: "find", input: { query: "anna" } }] };
      }
      if (calls.length === 2) {
        const last = body.messages[body.messages.length - 1];
        expect(last.role).toBe("user");
        expect(last.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
        expect(JSON.parse(last.content[0].content).people[0].person).toBe("Anna Brooks");
        return { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "walk", input: { node_id: chId("39") } }] };
      }
      return { stop_reason: "end_turn", content: [{ type: "text", text: "Channel 39 is open [ch 39]. Check pack 7 first [ULXD4Q-5-8 07]." }] };
    };
    const r = await ask(ctx(), [], "ruth's mic is dead", complete);
    expect(r.toolCalls).toBe(2);
    expect(r.text).toMatch(/Check pack 7/);
    expect(r.cites.map((c) => c.nodeId)).toEqual([chId("39"), "src:ulxd4q-5-8:07"]);
    expect(calls[0].system).toMatch(/How to troubleshoot/);
    expect(calls[0].tools).toHaveLength(6);
    expect(calls[0].messages[0]).toEqual({ role: "user", content: "ruth's mic is dead" });
  });
  it("gives up cleanly after the round limit", async () => {
    const complete = async () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "x", name: "status", input: {} }] });
    const r = await ask(ctx(), [], "hmm", complete);
    expect(r.text).toMatch(/ran out of steps/);
  });
});
