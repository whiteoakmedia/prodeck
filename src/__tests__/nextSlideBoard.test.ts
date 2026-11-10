import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
});
const { playerId, recordRun, savedNick, saveNick, submit, suggestNick, weekBest, weekBestFrom } = await import("../lib/nextSlideBoard");

describe("Next Slide leaderboard on the phone", () => {
  beforeEach(() => store.clear());

  it("makes one random player id per phone, with nothing about the person in it", () => {
    const a = playerId();
    expect(a).toMatch(/^[a-f0-9]{24}$/);
    expect(playerId()).toBe(a);
  });

  it("suggests a first name, and keeps the nickname the player saves", () => {
    expect(suggestNick("Sam Lee")).toBe("Sam");
    expect(suggestNick("")).toBe("");
    expect(savedNick()).toBe("");
    saveNick("  Lyrics   Guy ");
    expect(savedNick()).toBe("Lyrics Guy");
  });

  it("keeps this week's best, and starts again on Monday morning", () => {
    const thu = Date.parse("2026-11-12T12:00:00Z");
    recordRun(7, thu);
    recordRun(4, thu);
    expect(weekBest(thu)).toBe(7);
    expect(weekBest(Date.parse("2026-11-16T09:00:00Z"))).toBe(0);
    expect(weekBestFrom("garbage", thu)).toBe(0);
  });

  it("posts nothing until a nickname is saved", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await submit()).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
