import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { verifier } from "../src/util";

const SALT = "pepper-salt-0123";
const host = (name: string) => `https://${name}.crew.prodeck.live`;

async function copy(over: Record<string, unknown> = {}) {
  return {
    sentMs: Date.parse("2026-11-08T21:14:00Z"),
    church: { name: "Grace Church" },
    plan: {
      plan: { id: "p1", date: "November 9, 2026", title: "Sunday" },
      items: [
        { id: "i1", title: "Build My Life", sequence: 1, length: 300, type: "song", key: "G", leader: "Anna" },
        { id: "i2", title: "Welcome", sequence: 2, length: 120, type: "item", key: "", leader: "" },
      ],
      serviceTimes: [{ id: "t1", name: "9:00", type: "service", ts: Date.parse("2026-11-09T14:00:00Z") }],
      team: [{ name: "Sam Lee", position: "Camera 1", status: "C", timeIds: ["t1"] }],
      extras: { checkinTimes: {}, positionGuides: { "Camera 1": "Wide on the band." } },
    },
    checklists: [
      { id: "l1", name: "Cameras", visibility: "all", items: [{ id: "a", text: "Batteries", done: false }, { id: "h", text: "Setup", header: true }] },
      { id: "l2", name: "Admin", visibility: "admin", items: [{ id: "b", text: "Lock up", done: false }] },
    ],
    crew: [{ id: "u1", name: "Sam Lee", role: "Camera 1" }],
    auth: {
      salt: SALT,
      admin: [await verifier("admin-pw", SALT)],
      member: [await verifier("crew-pw", SALT)],
      sessions: { [await sha("sess-sam-0123456789")]: "u1" },
    },
    names: ["Sam Lee", "Pat Kim"],
    msgs: [],
    sinceSeq: 0,
    ...over,
  };
}

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function sync(name: string, body: unknown, secret = `secret-${name}`) {
  return SELF.fetch(`${host(name)}/_booth/sync`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const plan = (name: string, token: string, ip = "198.51.100.1") =>
  SELF.fetch(`${host(name)}/edge/plan?token=${encodeURIComponent(token)}`, { headers: { "cf-connecting-ip": ip } });

const post = (name: string, path: string, body: unknown) =>
  SELF.fetch(`${host(name)}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("the booth", () => {
  it("can't push without its name's secret", async () => {
    const r = await sync("grace", await copy(), "wrong");
    expect(r.status).toBe(403);
    const r2 = await sync("grace", await copy(), "secret-other");
    expect(r2.status).toBe(403);
  });

  it("pushes a copy phones then read with the crew password, booth off", async () => {
    expect((await sync("grace", await copy())).status).toBe(200);
    const r = await plan("grace", "crew-pw");
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const j = (await r.json()) as any;
    expect(j.source).toBe("booth");
    expect(j.boothOnline).toBe(false);
    expect(j.sentMs).toBe(Date.parse("2026-11-08T21:14:00Z"));
    expect(j.plan.date).toBe("November 9, 2026");
    expect(j.items.map((i: any) => i.title)).toEqual(["Build My Life", "Welcome"]);
    expect(j.items[0].key).toBe("G");
    expect(j.extras.positionGuides["Camera 1"]).toBe("Wide on the band.");
    expect(j.crew).toEqual([{ name: "Sam Lee", role: "Camera 1" }]);
    // The crew password doesn't see admin lists; the admin password does.
    expect(j.checklists.map((l: any) => l.id)).toEqual(["l1"]);
    const a = (await (await plan("grace", "admin-pw")).json()) as any;
    expect(a.checklists.map((l: any) => l.id)).toEqual(["l1", "l2"]);
  });

  it("keeps each church's copy to itself", async () => {
    await sync("grace", await copy());
    const r = await plan("hope", "crew-pw");
    expect(r.status).toBe(401);
  });

  it("refuses a wrong password, and throttles one address guessing many", async () => {
    await sync("grace", await copy());
    expect((await plan("grace", "nope")).status).toBe(401);
    // Repeating the same stale password never locks anyone out.
    for (let i = 0; i < 15; i++) expect((await plan("grace", "nope", "203.0.113.9")).status).toBe(401);
    for (let i = 0; i < 10; i++) await plan("grace", `guess-${i}`, "203.0.113.7");
    expect((await plan("grace", "guess-x", "203.0.113.7")).status).toBe(429);
    // Others, and the right password already known, are unaffected.
    expect((await plan("grace", "crew-pw", "203.0.113.8")).status).toBe(200);
  });

  it("forgets the old church's copy when the name changes hands", async () => {
    await sync("grace", await copy());
    await post("grace", "/edge/chat", { token: "crew-pw", from: "Sam", text: "old church message" });
    expect((await plan("grace", "crew-pw")).status).toBe(200);
    // Released and claimed again by another booth (a different secret).
    const r = await sync("grace", { sentMs: Date.now(), church: { name: "New Church" } }, "secret2-grace");
    expect(r.status).toBe(200);
    // The old church's password and copy are gone.
    expect((await plan("grace", "crew-pw")).status).toBe(401);
    expect(((await r.json()) as any).edgeMsgs).toEqual([]);
  });
});

describe("switching it off", () => {
  it("deletes the church's copy, chat and queued ticks", async () => {
    await sync("grace", await copy());
    await post("grace", "/edge/chat", { token: "crew-pw", from: "Sam", text: "hello" });
    const f = await SELF.fetch(`${host("grace")}/_booth/forget`, { method: "POST", headers: { authorization: "Bearer secret-grace" } });
    expect(f.status).toBe(200);
    expect((await plan("grace", "crew-pw")).status).toBe(401);
    const bad = await SELF.fetch(`${host("grace")}/_booth/forget`, { method: "POST", headers: { authorization: "Bearer nope" } });
    expect(bad.status).toBe(403);
  });
});

describe("booth off: what phones do waits for the booth", () => {
  it("queues checklist ticks, shows them at once, and hands them to the booth", async () => {
    await sync("grace", await copy());
    const t = await post("grace", "/edge/checklist", { token: "crew-pw", session: "sess-sam-0123456789", listId: "l1", itemId: "a", done: true });
    expect(t.status).toBe(200);
    // A header can't be ticked; an admin list can't be ticked with the crew password.
    expect((await post("grace", "/edge/checklist", { token: "crew-pw", listId: "l1", itemId: "h", done: true })).status).toBe(400);
    expect((await post("grace", "/edge/checklist", { token: "crew-pw", listId: "l2", itemId: "b", done: true })).status).toBe(403);
    expect((await post("grace", "/edge/checklist", { token: "bad", listId: "l1", itemId: "a", done: true })).status).toBe(401);

    const j = (await (await plan("grace", "crew-pw")).json()) as any;
    expect(j.checklists[0].items[0].done).toBe(true);

    // The booth's next sync carries its (older) lists; the tick still shows,
    // and the booth is handed it with who did it.
    const s = (await (await sync("grace", await copy())).json()) as any;
    expect(s.ticks).toHaveLength(1);
    expect(s.ticks[0]).toMatchObject({ listId: "l1", itemId: "a", done: true, by: "Sam Lee" });
    const j2 = (await (await plan("grace", "crew-pw")).json()) as any;
    expect(j2.checklists[0].items[0].done).toBe(true);

    // Applied and acknowledged: gone.
    const s2 = (await (await sync("grace", await copy({ ackTicks: [s.ticks[0].id] }))).json()) as any;
    expect(s2.ticks).toHaveLength(0);
  });

  it("keeps team chat, names the sender from their session, and hands it down once", async () => {
    await sync("grace", await copy());
    const m = await post("grace", "/edge/chat", { token: "crew-pw", session: "sess-sam-0123456789", from: "Somebody Else", text: "Running late" });
    expect(m.status).toBe(200);
    const mj = (await m.json()) as any;
    expect(mj.msg.from).toBe("Sam Lee");

    const s = (await (await sync("grace", await copy())).json()) as any;
    expect(s.edgeMsgs.map((x: any) => x.text)).toEqual(["Running late"]);
    const s2 = (await (await sync("grace", await copy({ sinceSeq: s.edgeSeq }))).json()) as any;
    expect(s2.edgeMsgs).toEqual([]);

    // The booth's own messages are mirrored up for phones to read.
    await sync("grace", await copy({ sinceSeq: s.edgeSeq, msgs: [{ id: 7, from: "Booth", text: "Doors at 8:30", channel: "team", ts: 1 }] }));
    const h = (await (await SELF.fetch(`${host("grace")}/edge/chat?token=crew-pw&since=0`)).json()) as any;
    expect(h.msgs.map((x: any) => x.text)).toEqual(["Running late", "Doors at 8:30"]);
  });

  it("takes a booth-off signup the booth adopts", async () => {
    await sync("grace", await copy());
    const taken = await post("grace", "/edge/register", { token: "crew-pw", name: "pat kim", pin: "1234" });
    expect(taken.status).toBe(409);
    const r = await post("grace", "/edge/register", { token: "crew-pw", name: "Jo Park", pin: "1234", role: "Lyrics" });
    expect(r.status).toBe(200);
    const s = (await (await sync("grace", await copy())).json()) as any;
    expect(s.pendingJoins.map((j: any) => j.name)).toEqual(["Jo Park"]);
    expect(s.pendingJoins[0].pinHash).toHaveLength(64);
    const s2 = (await (await sync("grace", await copy({ consumedJoins: [s.pendingJoins[0].id] }))).json()) as any;
    expect(s2.pendingJoins).toEqual([]);
  });
});

describe("booth off: the app still opens", () => {
  it("answers /api calls with a clean failure the app understands", async () => {
    const r = await SELF.fetch(`${host("grace")}/api/cmd`, { method: "POST", body: "{}" });
    expect(r.status).toBe(503);
    expect(r.headers.get("x-prodeck-fallback")).toBe("cloud");
  });

  it("serves the app shell for pages and real files for files", async () => {
    const page = await SELF.fetch(`${host("grace")}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("ProDeck");
    expect(page.headers.get("x-prodeck-fallback")).toBe("cloud");
    const deep = await SELF.fetch(`${host("grace")}/checklist`);
    expect(await deep.text()).toContain("<div id=\"root\">");
    const js = await SELF.fetch(`${host("grace")}/assets/app-abc123.js`);
    expect(js.status).toBe(200);
    const missing = await SELF.fetch(`${host("grace")}/assets/gone-999.js`);
    expect(missing.status).toBe(404);
  });

  it("says nothing for an address that isn't a church", async () => {
    const r = await SELF.fetch("https://crew.prodeck.live/");
    expect(r.status).toBe(404);
  });
});

/** Stand in for the booth's relay (crewcloud.rs): answer each request with `answer`. */
async function linkBooth(name: string, answer: (f: any, ws: WebSocket) => void) {
  const r = await SELF.fetch(`${host(name)}/_booth/link`, {
    headers: { upgrade: "websocket", authorization: `Bearer secret-${name}` },
  });
  expect(r.status).toBe(101);
  const ws = r.webSocket!;
  ws.accept();
  ws.addEventListener("message", (e) => {
    const f = JSON.parse(String(e.data));
    if (f.t === "req") answer(f, ws);
  });
  ws.send(JSON.stringify({ t: "hello", version: "test" }));
  return ws;
}

const b64 = (s: string) => btoa(s);

describe("booth on: the relay", () => {
  it("won't link a booth without its secret", async () => {
    const r = await SELF.fetch(`${host("grace")}/_booth/link`, { headers: { upgrade: "websocket", authorization: "Bearer nope" } });
    expect(r.status).toBe(403);
  });

  it("carries /api/cmd to the booth and back, with the phone's address and nothing forged", async () => {
    let seen: any = null;
    const ws = await linkBooth("grace", (f, ws) => {
      seen = f;
      ws.send(JSON.stringify({ t: "head", id: f.id, status: 200, headers: { "Content-Type": "application/json", Connection: "close" } }));
      ws.send(JSON.stringify({ t: "data", id: f.id, b: b64('{"result":') }));
      ws.send(JSON.stringify({ t: "data", id: f.id, b: b64('"ok"}') }));
      ws.send(JSON.stringify({ t: "end", id: f.id }));
    });
    const r = await SELF.fetch(`${host("grace")}/api/cmd`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.23", "x-prodeck-peer": "10.0.0.9", cookie: "x=1" },
      body: JSON.stringify({ cmd: "get_settings", token: "crew-pw" }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ result: "ok" });
    expect(r.headers.get("x-prodeck-via")).toBe("relay");
    expect(seen.method).toBe("POST");
    expect(seen.path).toBe("/api/cmd");
    expect(seen.ip).toBe("198.51.100.23");
    expect(seen.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(atob(seen.b))).toEqual({ cmd: "get_settings", token: "crew-pw" });
    // The copy says the booth is linked.
    const st = (await (await SELF.fetch(`${host("grace")}/edge/status`)).json()) as any;
    expect(st.boothOnline).toBe(true);
    ws.close();
  });

  it("streams the event stream as the booth writes it", async () => {
    const ws = await linkBooth("grace", (f, ws) => {
      ws.send(JSON.stringify({ t: "head", id: f.id, status: 200, headers: { "Content-Type": "text/event-stream" } }));
      ws.send(JSON.stringify({ t: "data", id: f.id, b: b64(": connected\n\n") }));
      setTimeout(() => {
        ws.send(JSON.stringify({ t: "data", id: f.id, b: b64('data: {"event":"gateway:ping","payload":null}\n\n') }));
        ws.send(JSON.stringify({ t: "end", id: f.id }));
      }, 20);
    });
    const r = await SELF.fetch(`${host("grace")}/api/events?token=crew-pw`);
    expect(r.headers.get("content-type")).toBe("text/event-stream");
    const text = await r.text();
    expect(text).toContain(": connected");
    expect(text).toContain("gateway:ping");
    ws.close();
  });

  it("keeps TV pairing and overflow audio off the relay", async () => {
    let asked = false;
    const ws = await linkBooth("grace", () => {
      asked = true;
    });
    const r = await SELF.fetch(`${host("grace")}/api/tv/hello?code=1234`);
    expect(r.status).toBe(503);
    expect(asked).toBe(false);
    ws.close();
  });

  it("falls back cleanly when the booth errors before answering", async () => {
    const ws = await linkBooth("grace", (f, ws) => ws.send(JSON.stringify({ t: "error", id: f.id, message: "The gateway is off." })));
    const r = await SELF.fetch(`${host("grace")}/api/cmd`, { method: "POST", body: "{}" });
    expect(r.status).toBe(503);
    expect(r.headers.get("x-prodeck-fallback")).toBe("cloud");
    expect(((await r.json()) as any).error).toBe("The gateway is off.");
    ws.close();
  });

  it("serves hashed app files itself even while the booth is linked", async () => {
    let asked = false;
    const ws = await linkBooth("grace", () => {
      asked = true;
    });
    const r = await SELF.fetch(`${host("grace")}/assets/app-abc123.js`);
    expect(r.status).toBe(200);
    expect(asked).toBe(false);
    ws.close();
  });
});
