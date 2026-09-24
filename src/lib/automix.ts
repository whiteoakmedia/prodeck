// The automix: instrument moves at the right musical moments (pure; tested
// in automix.test.ts). Not cruise control — nothing here reacts to loudness.
//
// The guide says where the song is going ("Verse", "Chorus", "Breakdown",
// "Build", "All in"); the MIDI clock says where the next downbeat is. A move
// is a set of DCA offsets from the operator's own positions (captured when
// the automix is armed), landing on the section's first downbeat with a
// one-bar fade. "Build" ramps home over four bars. A person's hand on a DCA
// makes the automix let go of that DCA for the rest of the song.

import { parseCue, parseSection, type Section } from "./rig";

/** Offsets in dB per DCA name, for one kind of moment. */
export type Move = Record<string, number>;

export const DEFAULT_RULES = `verse: EGs -3, KEYs -2, Pad -2, Drums -1
prechorus: EGs -1.5, KEYs -1, Pad -1
chorus: EGs 0, KEYs 0, Pad 0, Drums 0
bridge: EGs 0, KEYs 0, Pad 0, Drums 0
breakdown: Drums -8, EGs -4, KEYs -1
build: EGs 0, KEYs 0, Pad 0, Drums 0
allin: EGs 0, KEYs 0, Pad 0, Drums 0
intro: EGs 0, KEYs 0, Pad 0, Drums 0
instrumental: EGs 0, KEYs 0, Pad 0, Drums 0
outro: Drums -2`;

/** "verse: EGs -3, KEYs -2" lines → { verse: { EGs: -3, KEYs: -2 } }. */
export function parseRules(text: string): Record<string, Move> {
  const out: Record<string, Move> = {};
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [k, rest] = line.split(":");
    if (!rest) continue;
    const key = k.trim().toLowerCase().replace(/[\s-]+/g, "");
    const move: Move = {};
    for (const part of rest.split(",")) {
      const m = part.trim().match(/^(.+?)\s+([+-]?\d+(?:\.\d+)?)$/);
      if (m) move[m[1].trim()] = Math.max(-12, Math.min(3, Number(m[2])));
    }
    out[key] = move;
  }
  return out;
}

/** The rule key a guide cue maps to (sections by kind; band calls by name). */
export function cueKey(text: string): string | null {
  const p = parseCue(text);
  if (p.dynamic) return p.dynamic;
  if (p.section) return p.section.kind === "refrain" || p.section.kind === "vamp" || p.section.kind === "tag" ? "chorus" : p.section.kind;
  return null;
}

export interface Planned {
  key: string;
  at: number; // ms — the section's first downbeat
  fadeMs: number;
  targets: Record<string, number>; // DCA name → dB
}

/** Plan a move: targets = home + offset for each DCA the rule names and the
 *  automix has a home for (and hasn't let go of). */
export function plan(key: string, rules: Record<string, Move>, home: Record<string, number>, letGo: Set<string>, at: number, beatMs: number): Planned | null {
  const move = rules[key];
  if (!move) return null;
  const targets: Record<string, number> = {};
  for (const [dca, off] of Object.entries(move)) {
    if (home[dca] == null || letGo.has(dca)) continue;
    targets[dca] = home[dca] + off;
  }
  if (!Object.keys(targets).length) return null;
  const bar = beatMs * 4;
  return { key, at, fadeMs: key === "build" ? bar * 4 : bar, targets };
}

/** Where each DCA should be at time t, given where it started and the plan. */
export function faderAt(p: Planned, from: Record<string, number>, t: number): Record<string, number> {
  const k = Math.max(0, Math.min(1, (t - p.at) / p.fadeMs));
  const out: Record<string, number> = {};
  for (const [dca, target] of Object.entries(p.targets)) {
    const f = from[dca] ?? target;
    out[dca] = f + (target - f) * k;
  }
  return out;
}

export { parseSection, type Section };
