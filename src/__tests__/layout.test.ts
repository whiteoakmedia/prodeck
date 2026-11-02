import { describe, expect, it } from "vitest";
import { crewLayout } from "../lib/layout";

const base = { isWeb: true, shotPhone: false, narrow: false, pref: null };

describe("which layout a screen gets", () => {
  it("goes by width until the device chooses", () => {
    expect(crewLayout({ ...base, narrow: true })).toBe(true);
    expect(crewLayout({ ...base, narrow: false })).toBe(false);
  });

  // An iPad is wide, but on a camera or at the director's desk it wants
  // comms and the tally light from the crew layout.
  it("lets a wide tablet choose the crew layout, and switch back", () => {
    expect(crewLayout({ ...base, pref: "crew" })).toBe(true);
    expect(crewLayout({ ...base, narrow: true, pref: "full" })).toBe(false);
  });

  it("never gives the booth computer the crew layout", () => {
    expect(crewLayout({ ...base, isWeb: false, pref: "crew" })).toBe(false);
    expect(crewLayout({ ...base, isWeb: false, narrow: true })).toBe(false);
    // Except the phone screenshots, which render the crew layout on purpose.
    expect(crewLayout({ ...base, isWeb: false, shotPhone: true, narrow: true })).toBe(true);
  });
});
