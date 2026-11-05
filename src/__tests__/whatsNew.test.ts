import { describe, expect, it } from "vitest";
import {
  ALSO_NEW,
  HEADLINERS,
  SEEN_KEY,
  SUPPORT,
  WHATS_NEW_EDITION,
  allCopy,
  decide,
  markSeen,
  readSeen,
  settingsTarget,
  type ShowContext,
} from "../lib/whatsNew";
import { HELP_BY_ID } from "../help/topics";
import { SECTIONS } from "../lib/settingsSections";

/**
 * The What's new showcase opens once on the booth after the update that
 * carries it, never on phones or kiosks, never over a service, and never as
 * the first thing a brand new install sees.
 */
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

const booth: ShowContext = {
  isWeb: false,
  kiosk: false,
  demo: false,
  freshInstall: false,
  inService: false,
  otherOverlay: false,
};

describe("what's new: when it shows", () => {
  it("shows once on an updated booth, then stays away", () => {
    const s = mem();
    expect(decide(readSeen(s), booth)).toBe("show");
    markSeen(s);
    expect(s.getItem(SEEN_KEY)).toBe(WHATS_NEW_EDITION);
    expect(decide(readSeen(s), booth)).toBe("skip");
  });

  it("comes back for a new edition only", () => {
    const s = mem();
    markSeen(s, "2026-01-old");
    expect(decide(readSeen(s), booth)).toBe("show");
    expect(decide(readSeen(s), booth, "2026-01-old")).toBe("skip");
  });

  it("never shows on phones, kiosks or in demo mode", () => {
    expect(decide(null, { ...booth, isWeb: true })).toBe("skip");
    expect(decide(null, { ...booth, kiosk: true })).toBe("skip");
    expect(decide(null, { ...booth, demo: true })).toBe("skip");
  });

  it("waits out a service and the startup wizard, then shows", () => {
    expect(decide(null, { ...booth, inService: true })).toBe("wait");
    expect(decide(null, { ...booth, otherOverlay: true })).toBe("wait");
    expect(decide(null, booth)).toBe("show");
  });

  it("waits for settings, and a new install is marked seen without showing", () => {
    expect(decide(null, { ...booth, freshInstall: null })).toBe("wait");
    expect(decide(null, { ...booth, freshInstall: true })).toBe("mark");
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("no storage");
      },
      setItem: () => {
        throw new Error("no storage");
      },
    };
    expect(readSeen(broken)).toBe(null);
    expect(() => markSeen(broken)).not.toThrow();
  });
});

describe("what's new: content", () => {
  const all = [...HEADLINERS, ...ALSO_NEW];

  it("follows the house rules for copy: no dashes, at most one exclamation mark", () => {
    const text = allCopy();
    for (const t of text) expect(t, t).not.toMatch(/[-‐-―−]/);
    expect(text.join(" ").split("!").length - 1).toBeLessThanOrEqual(1);
  });

  it("never links prodeck.live itself, only the local address names", () => {
    for (const t of allCopy()) {
      for (const m of t.matchAll(/[\w.]*prodeck\.live/g)) expect(m[0]).toMatch(/\.local\.prodeck\.live$/);
    }
  });

  it("every button goes somewhere real", () => {
    const cards = new Set(SECTIONS.flatMap((s) => s.cards));
    for (const f of all) {
      if (f.help) expect(HELP_BY_ID[f.help], `${f.id} help ${f.help}`).toBeTruthy();
      if (f.settings) expect(cards.has(f.settings), `${f.id} settings ${f.settings}`).toBe(true);
      if (f.settingsWithoutAtem) expect(cards.has(f.settingsWithoutAtem)).toBe(true);
      expect(f.steps.length).toBeGreaterThan(0);
    }
    expect(new Set(all.map((f) => f.id)).size).toBe(all.length);
  });

  it("asks for support at White Oak Media's own page, nothing else", () => {
    expect(SUPPORT.url).toBe("https://www.whiteoakmedia.io/tools/support");
  });

  it("sends tally setup to the ATEM card until a switcher is connected", () => {
    const tally = HEADLINERS.find((f) => f.id === "tally")!;
    expect(settingsTarget(tally, false)).toBe("set-atem");
    expect(settingsTarget(tally, true)).toBe("set-tally");
    const tv = HEADLINERS.find((f) => f.id === "tv")!;
    expect(settingsTarget(tv, false)).toBe("set-tv");
  });
});
