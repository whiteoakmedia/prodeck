import { describe, expect, it } from "vitest";
import { isCrewSplit, isCrewWide, WIDE_QUERY } from "../mobile/useCrewWide";

describe("crew layout on a big screen", () => {
  it("goes wide on iPhone Duo opened up and on an iPad", () => {
    expect(isCrewWide(626, 890)).toBe(true); // iPhone Duo inner display, portrait
    expect(isCrewWide(890, 626)).toBe(true); // inner display, turned
    expect(isCrewWide(820, 1180)).toBe(true); // iPad Air
  });

  it("keeps the phone layout on phones, closed or on their side", () => {
    expect(isCrewWide(466, 678)).toBe(false); // iPhone Duo closed
    expect(isCrewWide(678, 466)).toBe(false); // closed, on its side: wide but short
    expect(isCrewWide(440, 956)).toBe(false); // a large iPhone
    expect(isCrewWide(956, 440)).toBe(false); // a large iPhone on its side
  });

  it("uses the same numbers in the media query the hook listens to", () => {
    expect(WIDE_QUERY).toBe("(min-width: 600px) and (min-height: 560px)");
  });

  it("puts More's list beside its screens only when both fit", () => {
    expect(isCrewSplit(626, 890)).toBe(false); // Duo opened, upright: sidebar only
    expect(isCrewSplit(890, 626)).toBe(true); // Duo opened, turned
    expect(isCrewSplit(820, 1180)).toBe(true); // iPad
  });
});
