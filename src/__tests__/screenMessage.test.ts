import { describe, expect, it } from "vitest";
import { forThisScreen, screenChannel } from "../lib/screenMessage";

describe("screen messages", () => {
  it("reach every screen, or only the screens showing that dashboard", () => {
    expect(forThisScreen("screen:all", "Green Room")).toBe(true);
    expect(forThisScreen("screen:Green Room", "green room")).toBe(true);
    expect(forThisScreen("screen:Green Room", "Office")).toBe(false);
    expect(forThisScreen("team", "Green Room")).toBe(false);
    expect(forThisScreen("screen:", "Green Room")).toBe(false);
  });
  it("names the channel", () => {
    expect(screenChannel(null)).toBe("screen:all");
    expect(screenChannel("Green Room")).toBe("screen:Green Room");
  });
});
