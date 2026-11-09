import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// The Names entrypoint is what prodeck-crew (crew-cloud/) asks; here it's
// reached the way that binding reaches it, straight into the registry.
const verify = (name: string, secret: string) =>
  (env as any).REGISTRY.get((env as any).REGISTRY.idFromName("registry"))
    .fetch("https://do/verify", { method: "POST", body: JSON.stringify({ name, secret }) })
    .then((r: Response) => r.json());

describe("names for the crew address", () => {
  it("says a claimed name's secret is its own, and nothing else is", async () => {
    const r = await SELF.fetch("https://x/v1/claim", { method: "POST", body: JSON.stringify({ name: "grace-church" }) });
    expect(r.status).toBe(201);
    const { secret } = (await r.json()) as { secret: string };
    expect(await verify("grace-church", secret)).toEqual({ ok: true });
    expect(await verify("grace-church", "wrong")).toEqual({ ok: false });
    expect(await verify("other-church", secret)).toEqual({ ok: false });
  });

  it("isn't reachable from the internet", async () => {
    const r = await SELF.fetch("https://x/verify", { method: "POST", body: JSON.stringify({ name: "a", secret: "b" }) });
    expect(r.status).toBe(404);
    const r2 = await SELF.fetch("https://x/v1/verify", { method: "POST", body: "{}" });
    expect(r2.status).toBe(404);
  });

  it("stops pointing a name anywhere but keeps it claimed", async () => {
    const r = await SELF.fetch("https://x/v1/claim", { method: "POST", body: JSON.stringify({ name: "hope-church" }) });
    const { secret } = (await r.json()) as { secret: string };
    const u = await SELF.fetch("https://x/v1/address", { method: "DELETE", body: JSON.stringify({ name: "hope-church", secret }) });
    expect(u.status).toBe(200);
    expect(await verify("hope-church", secret)).toEqual({ ok: true });
    const bad = await SELF.fetch("https://x/v1/address", { method: "DELETE", body: JSON.stringify({ name: "hope-church", secret: "no" }) });
    expect(bad.status).toBe(403);
  });
});

/** What the DNS stand-in holds (vitest.config.ts). */
const records = () => fetch("https://dns.test/").then((r) => r.json()) as Promise<{ id: string; type: string; name: string; content: string; proxied?: boolean; comment?: string }[]>;

let ip = 10;
async function claim(name: string) {
  // Claims are limited per address; each test booth gets its own.
  const r = await SELF.fetch("https://x/v1/claim", { method: "POST", headers: { "cf-connecting-ip": `198.51.100.${ip++}` }, body: JSON.stringify({ name }) });
  expect(r.status).toBe(201);
  return ((await r.json()) as { secret: string }).secret;
}
const crew = (name: string, secret: string, on: boolean) =>
  SELF.fetch("https://x/v1/crew", { method: "POST", body: JSON.stringify({ name, secret, on }) });

describe("crew address records", () => {
  it("says when the crew address service is open", async () => {
    const r = await SELF.fetch("https://x/v1/crew/ready");
    expect(await r.json()).toEqual({ ok: true, ready: true });
  });

  it("adds exactly <name>-crew.prodeck.live, proxied to nowhere, and takes it away", async () => {
    const secret = await claim("faith-church");
    const r = await crew("faith-church", secret, true);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, host: "faith-church-crew.prodeck.live" });
    const mine = (await records()).filter((x) => x.name === "faith-church-crew.prodeck.live");
    expect(mine).toEqual([expect.objectContaining({ type: "AAAA", content: "100::", proxied: true, comment: "prodeck crew" })]);
    // Asking again doesn't make a second one.
    await crew("faith-church", secret, true);
    expect((await records()).filter((x) => x.name === "faith-church-crew.prodeck.live")).toHaveLength(1);
    await crew("faith-church", secret, false);
    expect((await records()).some((x) => x.name === "faith-church-crew.prodeck.live")).toBe(false);
  });

  it("never takes over a record someone else made", async () => {
    const secret = await claim("taken");
    const r = await crew("taken", secret, true);
    expect(r.status).toBe(409);
    expect((await records()).find((x) => x.name === "taken-crew.prodeck.live")?.id).toBe("theirs");
  });

  it("only for the name's own booth", async () => {
    await claim("hope-two");
    expect((await crew("hope-two", "wrong", true)).status).toBe(403);
  });

  it("removes the crew record when the name is given back", async () => {
    const secret = await claim("joy-church");
    await crew("joy-church", secret, true);
    await SELF.fetch("https://x/v1/release", { method: "POST", body: JSON.stringify({ name: "joy-church", secret }) });
    expect((await records()).some((x) => x.name === "joy-church-crew.prodeck.live")).toBe(false);
  });
});
