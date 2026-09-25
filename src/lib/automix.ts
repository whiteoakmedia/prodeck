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

export const DEFAULT_RULES = `verse: EGs -3, KEYs -2, Pad -2, TRX -2, AGs 0, BGVs -2, Lead Voc +1, All FX 0
prechorus: EGs -1.5, KEYs -1, Pad -1, TRX -1, BGVs -1, Lead Voc +0.5
chorus: EGs 0, KEYs 0, Pad 0, Drums 0, ch 10 0, TRX 0, AGs 0, BGVs 0, Lead Voc 0, All FX 0
bridge: EGs 0, KEYs 0, Pad 0, TRX 0, AGs 0, BGVs +1, Lead Voc 0, All FX +1
breakdown: Drums -2, ch 10 -2, EGs -4, KEYs -1, TRX -3, AGs +1, BGVs -1, Lead Voc +1, All FX +2
build: EGs 0, KEYs 0, Pad 0, Drums 0, ch 10 0, TRX 0, AGs 0, BGVs 0, Lead Voc 0, All FX 0
allin: EGs 0, KEYs 0, Pad 0, Drums 0, ch 10 0, TRX 0, AGs 0, BGVs 0, Lead Voc 0, All FX 0
intro: EGs 0, KEYs 0, Pad 0, TRX 0, AGs 0
instrumental: EGs 0, KEYs 0, Pad 0, TRX 0, AGs 0, Lead Voc 0
outro: TRX -2, All FX -3
repeat: EGs +1, KEYs +0.5, BGVs +1, All FX +0.5`;

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
      // "ch10", "channel 10", "Ch 10" → "ch 10"
      if (m) move[m[1].trim().replace(/^(?:ch|channel)\s*(\d+)$/i, "ch $1")] = Math.max(-12, Math.min(3, Number(m[2])));
    }
    out[key] = move;
  }
  return out;
}

/** A guide call's rule key and its number ("Bridge 2" → bridge, 2). */
export function cueInfo(text: string): { key: string; n: number | null } | null {
  const key = cueKey(text);
  if (!key) return null;
  const p = parseCue(text);
  return { key, n: p.section?.n ?? null };
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

// ---- the song's map: where each section starts, in beats from Play --------

/** One section as it happened: the beat (from Playback's Start) it began
 *  on, and what it was. Playback plays the same arrangement at the same
 *  tempo every time, so next time the move can start ON the downbeat
 *  instead of after the guide's call is read. */
export interface MapSection {
  beat: number;
  key: string;
  n?: number | null;
}
export interface SongMap {
  name: string;
  bpm: number;
  sections: MapSection[];
}

/** The bar line (from Start) nearest a time. */
export function barBeat(t: number, startT: number, beatMs: number, meter = 4): number {
  return Math.max(0, Math.round((t - startT) / beatMs / meter) * meter);
}

/** Add a section to this run's map, ignoring the guide repeating itself
 *  ("Interlude." … "Interlude." a bar later is still one interlude). */
export function recordSection(run: MapSection[], s: MapSection): MapSection[] {
  const last = run[run.length - 1];
  if (last && last.key === s.key && s.beat - last.beat <= 8) return run;
  return [...run, s];
}

/** Does a guide call agree with the map? A scheduled section of the same
 *  kind within four bars of where the call lands. */
export function confirms(map: MapSection[], key: string, beat: number): number {
  return map.findIndex((s) => s.key === key && Math.abs(s.beat - beat) <= 16);
}

// ---- repeats: a section sung again climbs a little each time ------------

/** Which pass this is of a repeating section: the guide's own number
 *  ("Bridge 3") if it gave one, else how many times in a row it's come. */
export function repeatIndex(prevKey: string, prevIdx: number, key: string, n: number | null): number {
  if (n && n >= 1) return n;
  return key === prevKey ? prevIdx + 1 : 1;
}

/** Extra dB per fader for pass `idx` of a bridge or chorus: the rules'
 *  "repeat" line × (idx − 1), at most +3. */
export function repeatBoost(rules: Record<string, Move>, key: string, idx: number): Move {
  const per = rules.repeat;
  if (!per || idx <= 1 || !(key === "bridge" || key === "chorus")) return {};
  const out: Move = {};
  for (const [f, d] of Object.entries(per)) out[f] = Math.max(-3, Math.min(3, d * (idx - 1)));
  return out;
}

// ---- per-song learning from the operator's corrections ------------------

/** song id → section key → fader → the operator's offsets from the song's
 *  chorus levels, one per section he touched it in (the last six). */
export type Observations = Record<string, Record<string, Record<string, number[]>>>;
/** song id → section key → fader → offset: moves accepted for that song. */
export type SongRules = Record<string, Record<string, Move>>;

export function observe(obs: Observations, song: string, key: string, fader: string, offset: number): Observations {
  const s = (obs[song] ??= {});
  const k = (s[key] ??= {});
  const xs = (k[fader] ??= []);
  xs.push(Math.round(offset * 2) / 2);
  if (xs.length > 6) xs.shift();
  return obs;
}

/** The moves for a song: the global rules with that song's accepted
 *  changes laid over them. */
export function effectiveRules(global: Record<string, Move>, song?: Record<string, Move>): Record<string, Move> {
  if (!song) return global;
  const out: Record<string, Move> = {};
  for (const [k, m] of Object.entries(global)) out[k] = { ...m };
  for (const [k, m] of Object.entries(song)) out[k] = { ...(out[k] ?? {}), ...m };
  return out;
}

export interface Suggestion {
  song: string;
  songName: string;
  key: string;
  fader: string;
  current: number;
  suggested: number;
  n: number;
}

const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Where the operator keeps putting a fader somewhere other than the move
 *  (by 1.5 dB or more, at least twice), suggest his number for that song. */
export function suggestions(obs: Observations, global: Record<string, Move>, songRules: SongRules, names: Record<string, string>, dismissed: Set<string>): Suggestion[] {
  const out: Suggestion[] = [];
  for (const [song, keys] of Object.entries(obs)) {
    const rules = effectiveRules(global, songRules[song]);
    for (const [key, faders] of Object.entries(keys)) {
      for (const [fader, xs] of Object.entries(faders)) {
        if (xs.length < 2) continue;
        const current = rules[key]?.[fader] ?? 0;
        const suggested = Math.round(med(xs) * 2) / 2;
        if (Math.abs(suggested - current) < 1.5) continue;
        const id = `${song}|${key}|${fader}|${suggested}`;
        if (dismissed.has(id)) continue;
        out.push({ song, songName: names[song] ?? song, key, fader, current, suggested, n: xs.length });
      }
    }
  }
  return out.sort((a, b) => a.songName.localeCompare(b.songName) || a.key.localeCompare(b.key));
}

// ---- the BGV rider: up when the backing singers sing ---------------------

/** Tracks each vocal mic's floor and says whether any backing singer (every
 *  mic but the lead's) is singing. Attack is instant, release waits 2.5 s so
 *  a breath between lines doesn't duck them. */
export class BgvRider {
  private floor: Record<string, number> = {};
  private lastSung = -Infinity;
  constructor(public releaseMs = 2500) {}

  /** levels: mic number → RMS dBFS (100 ms). */
  update(levels: Record<string, number>, lead: string | null, now: number): boolean {
    let any = false;
    for (const [mic, db] of Object.entries(levels)) {
      const f = this.floor[mic] ?? db;
      // The floor follows quiet slowly, loud not at all (bleed, not singing).
      this.floor[mic] = db < f ? f * 0.9 + db * 0.1 : f + 0.02;
      if (mic === lead) continue;
      if (db > Math.max(-40, this.floor[mic] + 12)) any = true;
    }
    if (any) this.lastSung = now;
    return now - this.lastSung < this.releaseMs;
  }
}

// ---- instruments by their own feeds --------------------------------------

/** "EGs: 17, 18; KEYs: 20" → { EGs: [17, 18], KEYs: [20] } (input channels). */
export function parseFeeds(text: string): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const part of text.split(/[;\n]/)) {
    const [k, v] = part.split(":");
    if (!v) continue;
    const name = k.trim().replace(/^(?:ch|channel)\s*(\d+)$/i, "ch $1");
    const chs = v.split(",").map((x) => parseInt(x.trim(), 10)).filter((x) => x > 0);
    if (name && chs.length) out[name] = chs;
  }
  return out;
}

/** Per instrument: its level now against its own typical level this song.
 *  Decides the two small nudges — lift the one carrying an instrumental,
 *  trim one that's dug in well above itself — and knows a silent one. */
export class FeedWatch {
  private now: Record<string, number> = {};
  private hist: Record<string, number[]> = {};
  private hotSince: Record<string, number> = {};
  private coolSince: Record<string, number> = {};
  trimmed = new Set<string>();

  reset() {
    this.hist = {};
    this.hotSince = {};
    this.coolSince = {};
    this.trimmed.clear();
  }

  /** levels: instrument → loudest of its channels, RMS dBFS. */
  update(levels: Record<string, number>, t: number) {
    for (const [k, db] of Object.entries(levels)) {
      const prev = this.now[k] ?? db;
      this.now[k] = prev * 0.9 + db * 0.1; // ~1 s smoothing at 12 Hz
      if (this.now[k] > -55) {
        const h = (this.hist[k] ??= []);
        h.push(this.now[k]);
        if (h.length > 12 * 240) h.shift(); // four minutes
      }
    }
    void t;
  }

  typical(k: string): number | null {
    const h = this.hist[k];
    return h && h.length > 12 * 20 ? med(h) : null; // after 20 s of playing
  }

  playing(k: string): boolean {
    return (this.now[k] ?? -100) > -60;
  }

  /** The instrument most above its own typical level (≥ +3 dB), if any. */
  leading(among: string[]): string | null {
    let best: string | null = null;
    let bestD = 3;
    for (const k of among) {
      const ty = this.typical(k);
      if (ty == null || !this.playing(k)) continue;
      const d = (this.now[k] ?? -100) - ty;
      if (d >= bestD) (best = k), (bestD = d);
    }
    return best;
  }

  /** Dug in: ≥ +5 dB over typical for 4 s → trim; back under +2 for 4 s → release. */
  checkTrims(among: string[], t: number): { trim: string[]; release: string[] } {
    const trim: string[] = [];
    const release: string[] = [];
    for (const k of among) {
      const ty = this.typical(k);
      if (ty == null) continue;
      const d = (this.now[k] ?? -100) - ty;
      if (!this.trimmed.has(k)) {
        if (d >= 5) {
          this.hotSince[k] ??= t;
          if (t - this.hotSince[k] >= 4000) {
            this.trimmed.add(k);
            trim.push(k);
            delete this.hotSince[k];
          }
        } else delete this.hotSince[k];
      } else if (d < 2) {
        this.coolSince[k] ??= t;
        if (t - this.coolSince[k] >= 4000) {
          this.trimmed.delete(k);
          release.push(k);
          delete this.coolSince[k];
        }
      } else delete this.coolSince[k];
    }
    return { trim, release };
  }
}
