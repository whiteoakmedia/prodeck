import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SECTIONS, cardMatches, isDirty, sectionOf } from "../lib/settingsSections";

describe("settings sections", () => {
  // The old jump bar quietly missed every card added after it was written.
  // Every card on the page must be filed under a section, and every filed
  // card must exist.
  it("files every card on the Settings page under exactly one section", () => {
    const src = readFileSync("src/pages/Settings.tsx", "utf8");
    const onPage = [...src.matchAll(/<Sec id="([^"]+)">/g)].map((m) => m[1]);
    const filed = SECTIONS.flatMap((s) => s.cards);
    expect(onPage.length).toBeGreaterThan(20);
    expect(onPage.filter((id) => !filed.includes(id))).toEqual([]);
    expect(filed.filter((id) => !onPage.includes(id))).toEqual([]);
    expect(new Set(filed).size).toBe(filed.length);
  });

  it("knows where a card lives", () => {
    expect(sectionOf("set-crew")).toBe("crew");
    expect(sectionOf("set-chop")).toBe("online");
    expect(sectionOf("set-unknown")).toBe("app");
  });

  it("matches every word typed, in any order, ignoring case", () => {
    const card = "Walk-in music. Control the music playing on this computer. Fade length (seconds)";
    expect(cardMatches(card, "fade music")).toBe(true);
    expect(cardMatches(card, "MUSIC")).toBe(true);
    expect(cardMatches(card, "music volume dante")).toBe(false);
    expect(cardMatches(card, "   ")).toBe(true);
  });

  it("spots unsaved changes", () => {
    expect(isDirty({ a: 1 }, { a: 1 })).toBe(false);
    expect(isDirty({ a: 2 }, { a: 1 })).toBe(true);
    expect(isDirty(null, { a: 1 })).toBe(false);
  });
});
