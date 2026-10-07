import { describe, expect, it } from "vitest";
import {
  CONSOLES,
  OTHER_CONSOLE,
  consoleInfo,
  consoleLabel,
  consoleNeedsMidi,
  deskControlSupported,
  midiBaseForSwitch,
  portForSwitch,
  setupChoiceFromSettings,
  setupFields,
} from "../lib/consoles";

/**
 * The console picker. A QL5 owner went through first run setup, found Avantis
 * already picked, and was asked for a "Base MIDI ch." that means nothing on a
 * Yamaha desk. These pin the fix: nothing preselected, fields only for the
 * desk that needs them, and an honest way out for desks ProDeck can't mirror.
 */
describe("console setup step", () => {
  it("starts with no desk picked and no fields", () => {
    expect(setupFields("")).toEqual({ form: false, midi: false, port: null, unsupported: false });
  });

  it("does not treat the default model as a choice on a fresh install", () => {
    // Every fresh install has avantis_model "avantis" and no host.
    expect(setupChoiceFromSettings({ avantis_model: "avantis", avantis_host: "" })).toBe("");
    expect(setupChoiceFromSettings(null)).toBe("");
    expect(setupChoiceFromSettings({ avantis_model: "yamaha", avantis_host: "10.0.0.5" })).toBe("yamaha");
    expect(setupChoiceFromSettings({ avantis_model: "nonsense", avantis_host: "10.0.0.5" })).toBe("avantis");
  });

  it("asks a Yamaha for an IP and nothing else", () => {
    expect(setupFields("yamaha")).toEqual({ form: true, midi: false, port: 49280, unsupported: false });
    expect(setupFields("x32")).toEqual({ form: true, midi: false, port: 10023, unsupported: false });
  });

  it("asks the A&H desks for a MIDI channel", () => {
    for (const id of ["avantis", "dlive", "sq"] as const) {
      expect(setupFields(id).midi).toBe(true);
      expect(setupFields(id).port).toBe(51325);
    }
  });

  it("offers a way out for desks ProDeck can't mirror, with no port or MIDI fields", () => {
    expect(setupFields("other")).toEqual({ form: false, midi: false, port: null, unsupported: true });
    expect(OTHER_CONSOLE.explain).toMatch(/can't mirror/);
    expect(OTHER_CONSOLE.explain).toMatch(/Everything else/);
  });

  it("keeps user facing copy free of dashes", () => {
    const copy = [OTHER_CONSOLE.name, OTHER_CONSOLE.hint, OTHER_CONSOLE.explain, ...CONSOLES.flatMap((c) => [c.hint, c.label])];
    for (const t of copy) expect(t).not.toMatch(/[–—]| - /);
    expect(copy.join(" ").split("!").length - 1).toBeLessThanOrEqual(1);
  });
});

describe("console metadata", () => {
  it("lists Yamaha as a mirrored, view only desk", () => {
    const y = consoleInfo("yamaha");
    expect(y?.label).toBe("Yamaha");
    expect(y?.option).toMatch(/CL.*QL.*TF/);
    expect(deskControlSupported("yamaha")).toBe(false);
    expect(consoleNeedsMidi("yamaha")).toBe(false);
  });

  it("keeps control on the desks that already had it", () => {
    for (const id of ["avantis", "dlive", "sq", "x32", undefined, ""]) expect(deskControlSupported(id)).toBe(true);
  });

  it("labels desks the way the backend parses them", () => {
    expect(consoleLabel("x32")).toBe("X32 / M32");
    expect(consoleLabel("YAMAHA")).toBe("Yamaha");
    expect(consoleLabel(undefined)).toBe("Avantis");
  });

  it("swaps a default port for the new desk's default and keeps one typed on purpose", () => {
    expect(portForSwitch("yamaha", 51325)).toBe(49280);
    expect(portForSwitch("yamaha", 10023)).toBe(49280);
    expect(portForSwitch("avantis", 49280)).toBe(51325);
    expect(portForSwitch("x32", 0)).toBe(10023);
    expect(portForSwitch("dlive", 51328)).toBe(51328); // a dLive Surface
    expect(portForSwitch("sq", 51328)).toBe(51325);
    expect(portForSwitch("yamaha", 50000)).toBe(50000);
  });

  it("keeps the MIDI channel inside what the desk allows", () => {
    expect(midiBaseForSwitch("avantis", 16)).toBe(12);
    expect(midiBaseForSwitch("sq", 16)).toBe(16);
    expect(midiBaseForSwitch("yamaha", 14)).toBe(14); // no MIDI: leave the saved value alone
  });
});
