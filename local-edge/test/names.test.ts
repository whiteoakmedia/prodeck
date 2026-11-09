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
