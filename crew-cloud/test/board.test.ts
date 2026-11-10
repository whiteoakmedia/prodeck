import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { nickProblem } from "../src/board";
import { verifier } from "../src/util";
import { weekKey, weekEnds } from "../../src/lib/weekKey";

const SALT = "pepper-salt-0123";
const host = (name: string) => `https://${name}-crew.prodeck.live`;
// The board is one shared object, and keeps what earlier tests put there: each
// test uses its own players and looks only at them.
let n = 0;
const player = () => `testplayer${String(++n).padStart(8, "0")}`;
const only = (rows: any[], nicks: string[]) => rows.filter((r) => nicks.includes(r.nick)).map(({ rank, ...r }: any) => r);

async function church(name: string) {
  const r = await SELF.fetch(`${host(name)}/_booth/sync`, {
    method: "POST",
    headers: { authorization: `Bearer secret-${name}`, "content-type": "application/json" },
    body: JSON.stringify({ sentMs: Date.now(), church: { name }, auth: { salt: SALT, admin: [], member: [await verifier("crew-pw", SALT)], sessions: {} } }),
  });
  expect(r.status).toBe(200);
}

const score = (name: string, b: Record<string, unknown>, token = "crew-pw") =>
  SELF.fetch(`${host(name)}/edge/game/score`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, ...b }) });
const board = (name: string, player: string, token = "crew-pw") =>
  SELF.fetch(`${host(name)}/edge/game/board?token=${token}&player=${player}`).then((r) => r.json() as Promise<any>);

describe("Next Slide leaderboard", () => {
  it("ranks players from every church, this week and all time, with only nickname, church and streak", async () => {
    const [a, b] = [player(), player()];
    await church("grace");
    await church("hope");
    expect((await score("grace", { player: a, nick: "Sam", week: 12, all: 30 })).status).toBe(200);
    expect((await score("hope", { player: b, nick: "Bri", week: 20, all: 20 })).status).toBe(200);
    const bd = await board("grace", a);
    expect(only(bd.week.top, ["Sam", "Bri"])).toEqual([
      { nick: "Bri", church: "hope", best: 20 },
      { nick: "Sam", church: "grace", best: 12 },
    ]);
    expect(only(bd.all.top, ["Sam", "Bri"]).map((r: any) => r.nick)).toEqual(["Sam", "Bri"]);
    expect(bd.week.you.best).toBe(12);
    expect(bd.week.key).toBe(weekKey(Date.now()));
    expect(JSON.stringify(bd)).not.toContain(b); // other players' ids never go out
  });

  it("keeps the best, takes a new nickname, and ties go to who got there first", async () => {
    const [a, b] = [player(), player()];
    await church("grace");
    await church("hope");
    await score("grace", { player: a, nick: "Tie One", week: 15, all: 15 });
    await score("hope", { player: b, nick: "Tie Two", week: 15, all: 15 });
    await score("grace", { player: a, nick: "Tie Uno", week: 3, all: 3 });
    const bd = await board("hope", b);
    expect(only(bd.week.top, ["Tie Uno", "Tie Two", "Tie One"])).toEqual([
      { nick: "Tie Uno", church: "grace", best: 15 },
      { nick: "Tie Two", church: "hope", best: 15 },
    ]);
    const first = bd.week.top.find((r: any) => r.nick === "Tie Uno").rank;
    expect(bd.week.you).toEqual({ rank: first + 1, best: 15 });
  });

  it("only for signed in crew, and the church is never the phone's to say", async () => {
    const a = player();
    await church("grace");
    expect((await score("grace", { player: a, nick: "Zed", week: 5 }, "wrong")).status).toBe(401);
    expect((await SELF.fetch(`${host("grace")}/edge/game/board?token=wrong&player=${a}`)).status).toBe(401);
    await score("grace", { player: a, nick: "Zed", week: 5, church: "hope" });
    const bd = await board("grace", a);
    expect(bd.week.top.find((r: any) => r.nick === "Zed").church).toBe("grace");
  });

  it("refuses rude or odd nicknames and impossible streaks", async () => {
    const a = player();
    await church("grace");
    expect((await score("grace", { player: a, nick: "x", week: 5 })).status).toBe(400);
    expect((await score("grace", { player: a, nick: "f u c k", week: 5 })).status).toBe(400);
    expect((await score("grace", { player: a, nick: "<script>", week: 5 })).status).toBe(400);
    expect((await score("grace", { player: "short", nick: "Sam", week: 5 })).status).toBe(400);
    await score("grace", { player: a, nick: "Big Number", week: 99999, all: 99999 });
    expect((await board("grace", a)).week.you.best).toBe(999);
    expect(nickProblem("Mary Jo")).toBe("");
    expect(nickProblem("José")).toBe("");
    expect(nickProblem("sh1t")).not.toBe("");
  });

  it("lets only White Oak Media take someone off, and they stay off", async () => {
    const a = player();
    await church("grace");
    await score("grace", { player: a, nick: "Rudey", week: 50, all: 50 });
    const no = await SELF.fetch("https://prodeck-crew.taplink-edge.workers.dev/_admin/board/remove", { method: "POST", body: JSON.stringify({ nick: "Rudey" }) });
    expect(no.status).toBe(401);
    const yes = await SELF.fetch("https://prodeck-crew.taplink-edge.workers.dev/_admin/board/remove", {
      method: "POST",
      headers: { authorization: "Bearer board-admin" },
      body: JSON.stringify({ nick: "Rudey", church: "grace" }),
    });
    expect(((await yes.json()) as any).removed).toBe(1);
    expect(only((await board("grace", a)).week.top, ["Rudey"])).toEqual([]);
    expect((await score("grace", { player: a, nick: "Nice", week: 5 })).status).toBe(403);
  });
});

describe("weeks", () => {
  it("start Monday 08:00 UTC, after every Sunday service", () => {
    expect(weekKey(Date.parse("2026-11-16T07:59:00Z"))).toBe("2026-11-09"); // Sunday night in California
    expect(weekKey(Date.parse("2026-11-16T08:00:00Z"))).toBe("2026-11-16");
    expect(weekKey(Date.parse("2026-11-12T12:00:00Z"))).toBe("2026-11-09");
    expect(weekEnds(Date.parse("2026-11-12T12:00:00Z"))).toBe(Date.parse("2026-11-16T08:00:00Z"));
  });
});
