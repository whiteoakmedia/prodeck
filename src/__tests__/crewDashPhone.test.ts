import { describe, expect, it } from "vitest";
import { phoneWidgets } from "../mobile/CrewDash";

const w = (type: string, x: number, y: number) => ({ type, x, y });

describe("booth dashboards on a phone", () => {
  const dash = [w("atem", 0, 0), w("clock", 4, 0), w("video_input", 0, 4), w("checklist", 0, 2)];

  it("never shows camera feeds, and hides booth controls from crew members", () => {
    expect(phoneWidgets(dash, false).map((x) => x.type)).toEqual(["clock", "checklist"]);
  });

  it("shows an admin the controls, still no camera feeds, top to bottom", () => {
    expect(phoneWidgets(dash, true).map((x) => x.type)).toEqual(["atem", "clock", "checklist"]);
  });
});
