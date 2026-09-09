import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Planning Center pagination.
 *
 * Nothing in the app ever followed links.next, and every list asked for
 * per_page=200 — above PCO's cap of 100, which it silently honours as 100. The
 * tail of a long collection was dropped with no error anywhere. It bit first on
 * chord charts: past the hundredth attachment they simply were not there.
 */
// Under jsdom there is no __TAURI_INTERNALS__, so the app is in web mode and
// every invoke() goes out as POST /api/cmd. Stubbing fetch therefore exercises
// the real path a phone takes, which is the one that was dropping rows.
const invoke = vi.fn();

function reply(body: unknown) {
  return { ok: true, status: 200, json: async () => ({ result: body }) } as Response;
}

beforeEach(() => {
  invoke.mockReset();
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const { cmd, args } = JSON.parse(String(init.body));
    return reply(await invoke(cmd, args));
  });
});

describe("pcoGetAll", () => {
  async function load() {
    const mod = await import("../lib/tauri");
    return mod.pcoGetAll;
  }

  it("follows links.next and merges data and included", async () => {
    invoke
      .mockResolvedValueOnce({ data: [1, 2], included: ["a"], links: { next: "page2" } })
      .mockResolvedValueOnce({ data: [3], included: ["b"], links: {} });
    const pcoGetAll = await load();
    const out = (await pcoGetAll("start")) as { data: number[]; included: string[] };
    expect(out.data).toEqual([1, 2, 3]);
    expect(out.included).toEqual(["a", "b"]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("asks once when there is no next page", async () => {
    invoke.mockResolvedValueOnce({ data: [1], links: {} });
    const pcoGetAll = await load();
    await pcoGetAll("only");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("stops rather than looping forever on a self-referential next link", async () => {
    // A malformed links.next that points at itself must not hang the app.
    // A fresh object per call, as a real HTTP response would be.
    invoke.mockImplementation(async () => ({ data: [1], links: { next: "same" } }));
    const pcoGetAll = await load();
    const out = (await pcoGetAll("same")) as { data: number[] };
    expect(invoke.mock.calls.length).toBeLessThanOrEqual(20);
    expect(out.data.length).toBeGreaterThan(0);
  });

  it("propagates a failure instead of returning a short list", async () => {
    // Silently returning page one would look exactly like the bug this fixes.
    invoke
      .mockResolvedValueOnce({ data: [1], links: { next: "page2" } })
      .mockRejectedValueOnce(new Error("PCO/429 rate limited"));
    const pcoGetAll = await load();
    await expect(pcoGetAll("start")).rejects.toThrow(/rate limited/);
  });
});
