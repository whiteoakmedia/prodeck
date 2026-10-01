import { beforeEach, describe, expect, it, vi } from "vitest";
import { automixAcknowledged, setAutomixAcknowledged } from "../lib/automixAck";

describe("automix acknowledgement", () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) });
  });
  it("asks until someone confirms, then remembers", () => {
    expect(automixAcknowledged()).toBe(false);
    setAutomixAcknowledged();
    expect(automixAcknowledged()).toBe(true);
  });
  it("asks again rather than failing when storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(automixAcknowledged()).toBe(false);
    expect(() => setAutomixAcknowledged()).not.toThrow();
  });
});
