import { describe, expect, it } from "vitest";
import { offersTally, readTallyMode, writeTallyMode, TALLY_MODE_KEY } from "../lib/tallyMode";
import type { AtemSnapshot } from "../lib/tauri";

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

const snap = (over: Partial<AtemSnapshot>): AtemSnapshot =>
  ({ connected: false, ready: false, product: "", me: 0, mes: 1, program: null, preview: null, inTransition: false, inputs: [], error: null, ...over }) as AtemSnapshot;

describe("tally mode on a crew phone", () => {
  // A phone on a camera reloads by itself (the booth restarts, iOS evicts
  // the page); it must come back as the tally, not the Home tab.
  it("is remembered until turned off", () => {
    const s = memStore();
    expect(readTallyMode(s)).toBe(false);
    writeTallyMode(true, s);
    expect(readTallyMode(s)).toBe(true);
    writeTallyMode(false, s);
    expect(readTallyMode(s)).toBe(false);
    expect(s.m.has(TALLY_MODE_KEY)).toBe(false);
  });

  it("survives storage that throws", () => {
    const bad = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readTallyMode(bad)).toBe(false);
    expect(() => writeTallyMode(true, bad)).not.toThrow();
  });

  it("is only offered when the booth has a switcher", () => {
    expect(offersTally(null)).toBe(false);
    expect(offersTally(snap({}))).toBe(false);
    expect(offersTally(snap({ connected: true }))).toBe(true);
    // The link dropped but the cameras are known: still worth offering.
    expect(offersTally(snap({ inputs: [{ id: 1, name: "Camera 1", short: "CAM1" } as never] }))).toBe(true);
  });
});
