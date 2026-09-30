// The Automix setup wizard's thinking (pure; tested in automixSetup.test.ts).
//
// The automix's rules name faders the way one church's desk does ("EGs",
// "KEYs", "Lead Voc"). Another desk says "Guitars" or "Elec Gtr". The wizard
// asks which fader plays each part, remembers the answer as a role map
// (settings.automix_roles), and rewrites the rules to this desk's names.

import { DEFAULT_RULES, parseRules, type Move } from "./automix";

export interface Role {
  id: string;
  /** What the operator sees. */
  label: string;
  /** The fader name the default rules use for this part. */
  base: string;
  /** Gets the automix's small lift/trim nudges from its own feed. */
  nudge?: boolean;
  /** Words in a desk name that suggest this part. */
  words: RegExp;
}

export const ROLES: Role[] = [
  { id: "eg", label: "Electric guitars", base: "EGs", nudge: true, words: /\b(eg|egs|e ?gtr|elec|electric|guitars?|gtrs?)\b/i },
  { id: "keys", label: "Keys", base: "KEYs", nudge: true, words: /\b(keys?|piano|synth|organ)\b/i },
  { id: "ag", label: "Acoustic guitars", base: "AGs", nudge: true, words: /\b(ag|ags|a ?gtr|acoustic|acc)\b/i },
  { id: "pad", label: "Pad", base: "Pad", words: /\bpads?\b/i },
  { id: "trx", label: "Tracks", base: "TRX", words: /\b(trx|tracks?|playback|mtx ?trk|stems?)\b/i },
  { id: "drums", label: "Drums", base: "Drums", words: /\b(drums?|kit|dr)\b/i },
  { id: "bass", label: "Bass", base: "ch 10", words: /\b(bass|bs|bgtr)\b/i },
  { id: "bgv", label: "Backing vocals", base: "BGVs", words: /\b(bgvs?|backing|bvs?|choir|vox ?grp|harmony)\b/i },
  { id: "lead", label: "Lead vocal", base: "Lead Voc", words: /\b(lead|ld|wl vox|main vox)\b/i },
  { id: "fx", label: "Effects", base: "All FX", words: /\b(fx|efx|effects?|verb|reverb|delay)\b/i },
];

/** The fader name each part uses now: the wizard's answer, else the default. */
export function roleNames(roles: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of ROLES) out[r.id] = roles?.[r.id] || r.base;
  return out;
}

/** The faders that get feed nudges, by this desk's names. */
export function nudgeNames(roles: Record<string, string> | undefined): string[] {
  const names = roleNames(roles);
  return ROLES.filter((r) => r.nudge && roles?.[r.id] !== "-").map((r) => names[r.id]);
}

/**
 * Best guess at which desk fader plays each part, from the names on the desk.
 * An exact match on the default name wins; then a fader whose name says the
 * part. A fader is used for one part at most, earlier parts first. Bass,
 * with no fader of its own, falls back to an input channel named for it.
 */
export function guessRoles(deskNames: string[], inputs: { no: string; name: string }[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  const exact = new Map(deskNames.map((n) => [n.trim().toLowerCase(), n]));
  for (const r of ROLES) {
    const hit = exact.get(r.base.toLowerCase());
    if (hit && !used.has(hit)) {
      out[r.id] = hit;
      used.add(hit);
    }
  }
  for (const r of ROLES) {
    if (out[r.id]) continue;
    const hit = deskNames.find((n) => !used.has(n) && r.words.test(n.replace(/[_.-]+/g, " ")));
    if (hit) {
      out[r.id] = hit;
      used.add(hit);
    }
  }
  // Bass is often a single channel, not a DCA: "ch 10" from its input name.
  if (!out.bass) {
    const bass = ROLES.find((r) => r.id === "bass")!;
    const hit = inputs.find((i) => i.no && bass.words.test(i.name.replace(/[_.-]+/g, " ")));
    if (hit) out.bass = `ch ${hit.no}`;
  }
  return out;
}

const fmtDb = (v: number) => (v > 0 ? `+${v}` : `${v}`);

/** Rules back to text, one moment per line, in the order they were written. */
export function formatRules(rules: Record<string, Move>): string {
  return Object.entries(rules)
    .filter(([, m]) => Object.keys(m).length > 0)
    .map(([k, m]) => `${k}: ${Object.entries(m).map(([n, v]) => `${n} ${fmtDb(v)}`).join(", ")}`)
    .join("\n");
}

/**
 * The rules with each part renamed from the fader it used (`from`) to this
 * desk's fader (`to`). A part set to "-" (not on this desk) is dropped from
 * every moment. Names that aren't a part are left alone.
 */
export function retargetRules(text: string, from: Record<string, string>, to: Record<string, string>): string {
  const rules = parseRules(text.trim() ? text : DEFAULT_RULES);
  const rename = new Map<string, string | null>();
  for (const r of ROLES) {
    const a = from[r.id] || r.base;
    const b = to[r.id];
    if (!b) continue;
    rename.set(a, b === "-" ? null : b);
  }
  const out: Record<string, Move> = {};
  for (const [k, move] of Object.entries(rules)) {
    const m: Move = {};
    for (const [n, v] of Object.entries(move)) {
      const nn = rename.has(n) ? rename.get(n)! : n;
      if (nn) m[nn] = v;
    }
    out[k] = m;
  }
  return formatRules(out);
}

/** "Guitars: 17, 18; Keys: 20", the automix_feeds format. */
export function formatFeeds(feeds: Record<string, number[]>): string {
  return Object.entries(feeds)
    .filter(([n, chs]) => n && chs.length)
    .map(([n, chs]) => `${n}: ${chs.join(", ")}`)
    .join("; ");
}

/** "17, 18" → [17, 18]; anything unreadable is skipped. */
export function parseChannels(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map((x) => parseInt(x, 10))
    .filter((x) => x > 0 && x <= 256);
}
