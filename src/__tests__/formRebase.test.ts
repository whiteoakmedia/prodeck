import { describe, expect, it } from "vitest";
import { rebase } from "../lib/formRebase";

describe("rebase", () => {
  const base = { a: 1, b: "x", m: { "1": "Kick" } };
  it("takes a change saved elsewhere for a field left alone", () => {
    const next = { ...base, m: { "1": "Kick", "2": "Snare" } };
    expect(rebase({ ...base }, base, next).m).toEqual({ "1": "Kick", "2": "Snare" });
  });
  it("keeps an edit the person made in the form", () => {
    const next = { ...base, a: 5, b: "y" };
    const r = rebase({ ...base, a: 2 }, base, next);
    expect(r.a).toBe(2);
    expect(r.b).toBe("y");
  });
  it("picks up a field that didn't exist when the form opened", () => {
    const next = { ...base, c: true } as typeof base & { c: boolean };
    expect((rebase({ ...base }, base, next) as typeof next).c).toBe(true);
  });
});
