// The playback rig, read: the click as a beat clock, the guide as section
// cues. Pure and clock-injected (tested in follow-rig.test.ts); the engine in
// follow.ts asks it "where does the next bar land?" and "which section did
// the guide just call?".

export interface BeatEvent {
  t: number; // ms epoch of the click
  strength: number;
  zcr: number; // pitch proxy — MultiTracks accents the downbeat with a higher click
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

export class BeatClock {
  private on: BeatEvent[] = [];
  /** ms per beat, once known. */
  period: number | null = null;
  /** A beat on the grid (anchor) and, when known, a downbeat. */
  private anchor: number | null = null;
  private downbeat: number | null = null;
  meter = 4;
  /** The song's BPM from Planning Center — picks quarter notes out of an
   *  eighth-note click. */
  prior: number | null = null;

  onBeat(b: BeatEvent) {
    this.on.push(b);
    if (this.on.length > 32) this.on.shift();
    const iois: number[] = [];
    for (let k = 1; k < this.on.length; k++) {
      const d = this.on[k].t - this.on[k - 1].t;
      if (d > 120 && d < 2000) iois.push(d);
    }
    if (iois.length < 3) return;
    const base = median(iois.slice(-12));
    // Which multiple of the click is the beat?
    let best = 1;
    let bestErr = Infinity;
    for (const k of [1, 2, 3, 4]) {
      const bpm = 60_000 / (base * k);
      const err = this.prior ? Math.abs(bpm - this.prior) / this.prior : bpm >= 60 && bpm <= 170 ? k * 0.01 : 10 + k;
      if (err < bestErr) (bestErr = err), (best = k);
    }
    this.period = base * best;
    // Which phase is the beat: the strongest class of onsets.
    const last = this.on[this.on.length - 1].t;
    const cls = new Map<number, { s: number; n: number; latest: number }>();
    for (const o of this.on.slice(-16)) {
      const idx = Math.round((last - o.t) / base);
      const c = ((idx % best) + best) % best;
      const e = cls.get(c) ?? { s: 0, n: 0, latest: 0 };
      e.s += o.strength;
      e.n++;
      e.latest = Math.max(e.latest, o.t);
      cls.set(c, e);
    }
    let pick = { s: -1, latest: last };
    for (const e of cls.values()) if (e.s / e.n > pick.s) pick = { s: e.s / e.n, latest: e.latest };
    this.anchor = pick.latest;
    this.findAccent();
  }

  /** A downbeat from the click's accent: every 4th (or 3rd) beat higher or louder. */
  private findAccent() {
    if (!this.period || this.anchor == null) return;
    const P = this.period;
    const beats = this.on.filter((o) => Math.abs(((o.t - this.anchor! + P * 100) % P) - 0) < P * 0.15 || Math.abs(((o.t - this.anchor! + P * 100) % P) - P) < P * 0.15);
    if (beats.length < 8) return;
    for (const m of [4, 3]) {
      for (const feat of ["zcr", "strength"] as const) {
        let best: { ratio: number; phase: number } | null = null;
        for (let ph = 0; ph < m; ph++) {
          const on: number[] = [];
          const off: number[] = [];
          for (const b of beats) {
            const i = Math.round((b.t - this.anchor) / P);
            (((i % m) + m) % m === ph ? on : off).push(b[feat]);
          }
          if (on.length < 2 || off.length < 3) continue;
          const ratio = median(on) / Math.max(1e-6, median(off));
          if (!best || ratio > best.ratio) best = { ratio, phase: ph };
        }
        if (best && best.ratio > 1.3) {
          this.meter = m;
          // The latest beat in the accented phase.
          const acc = beats.filter((b) => {
            const i = Math.round((b.t - this.anchor!) / P);
            return ((i % m) + m) % m === best!.phase;
          });
          this.downbeat = acc[acc.length - 1].t;
          return;
        }
      }
    }
  }

  running(now: number): boolean {
    const last = this.on[this.on.length - 1]?.t;
    return last != null && this.period != null && now - last < Math.max(1500, this.period * 2.5);
  }

  bpm(): number | null {
    return this.period ? 60_000 / this.period : null;
  }

  hasBar(): boolean {
    return this.downbeat != null;
  }

  /** Set the bar from outside (the guide's count-in: "1" is a downbeat). */
  setDownbeat(t: number) {
    this.downbeat = this.snap(t);
  }

  snap(t: number): number {
    if (!this.period || this.anchor == null) return t;
    return this.anchor + Math.round((t - this.anchor) / this.period) * this.period;
  }

  nextBeat(after: number): number | null {
    if (!this.period || this.anchor == null) return null;
    return this.anchor + Math.ceil((after - this.anchor) / this.period) * this.period;
  }

  nextDownbeat(after: number): number | null {
    if (!this.period || this.downbeat == null) return null;
    const bar = this.period * this.meter;
    return this.downbeat + Math.ceil((after - this.downbeat) / bar) * bar;
  }
}

// ---- sections ----------------------------------------------------------------

export type SectionKind = "verse" | "prechorus" | "chorus" | "bridge" | "tag" | "intro" | "outro" | "instrumental" | "refrain" | "vamp" | "blank";
export interface Section {
  kind: SectionKind;
  n?: number;
}

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, won: 1, to: 2, too: 2, for: 4 };

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/pre[\s-]*chorus/g, "prechorus")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const KINDS: [RegExp, SectionKind][] = [
  [/^prechorus$|^pre$|^lift$|^channel$/, "prechorus"],
  [/^verse$|^v$/, "verse"],
  [/^chorus$|^ch$|^hook$/, "chorus"],
  [/^bridge$|^b$/, "bridge"],
  [/^tag$/, "tag"],
  [/^intro$/, "intro"],
  [/^outro$|^ending$|^end$|^coda$/, "outro"],
  [/^instrumental$|^interlude$|^turnaround$|^solo$|^inst$/, "instrumental"],
  [/^refrain$/, "refrain"],
  [/^vamp$/, "vamp"],
];

/** "Verse 2", "Pre-Chorus", "CHORUS", "-", "" → a Section. */
export function parseSection(name: string): Section | null {
  const w = norm(name).split(" ").filter(Boolean);
  if (!w.length || /^blank$|^-+$/.test(name.trim())) return { kind: "blank" };
  for (let i = 0; i < w.length; i++) {
    const hit = KINDS.find(([re]) => re.test(w[i]));
    if (!hit) continue;
    const next = w[i + 1];
    const n = next ? (/^\d+$/.test(next) ? Number(next) : NUM[next]) : undefined;
    return n ? { kind: hit[1], n } : { kind: hit[1] };
  }
  return null;
}

/** What a guide cue said: a section, a count-in, or a band call to ignore
 *  ("Breakdown", "All in", "Build"). */
export function parseCue(text: string): { section?: Section; count?: boolean } {
  const w = norm(text);
  if (!w) return {};
  const toks = w.split(" ");
  if (toks.every((t) => /^[1-8]$/.test(t) || NUM[t] != null)) return { count: true };
  const s = parseSection(w);
  if (s && s.kind !== "blank") return { section: s };
  return {};
}

/** Does a slide group match what the guide called? Numbers only have to
 *  agree when both sides have one; instrumental calls land on blank slides. */
export function sectionMatches(group: Section | null, cue: Section): boolean {
  if (!group) return false;
  if (cue.kind === "instrumental" || cue.kind === "intro" || cue.kind === "outro") {
    return group.kind === cue.kind || group.kind === "blank" || group.kind === "instrumental";
  }
  if (group.kind !== cue.kind) return false;
  return group.n == null || cue.n == null || group.n === cue.n;
}
