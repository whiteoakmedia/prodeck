import { describe, expect, it } from "vitest";
import { ndiForScreen } from "../lib/ndiMatch";

describe("Slide Preview finds a screen's NDI output", () => {
  const sources = [{ name: "PRO-MAC (Side Screens)" }, { name: "PRO-MAC (ProDeckNDI)" }, { name: "CAM-PC (Camera 1)" }];
  it("by the screen name in brackets", () => {
    expect(ndiForScreen(sources, "ProDeckNDI")).toBe("PRO-MAC (ProDeckNDI)");
    expect(ndiForScreen(sources, "side screens")).toBe("PRO-MAC (Side Screens)");
  });
  it("and says so when a screen has none", () => {
    expect(ndiForScreen(sources, "Stage Display")).toBeNull();
    expect(ndiForScreen(sources, "")).toBeNull();
  });
});
