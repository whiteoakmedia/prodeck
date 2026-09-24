// Auto-Follow v2 — the decision engine (design/AUTOFOLLOW.md).
//
// Pure and clock-injected so it can be tested on recorded transcripts. The
// provider (lyricFollow.tsx) feeds it three streams and carries out what it
// returns:
//   onHeard  — every Whisper window (4 s, every 2 s) with its wall-clock span
//   onLive   — ProPresenter's current slide (whoever moved it)
//   onTick   — a heartbeat, so the clock can move a slide on time
// and it answers with Actions: trigger a slide, ask the model, or set the
// Whisper prompt.
//
// The rule Zach set: a slide two seconds late is a sin, one second early is
// forgivable.
//
// v3 (24 Sep, after the first live test lost "Build My Life" at the chorus):
// position is a WORD POINTER through the song's words in arrangement order,
// moved by aligning each Whisper window (with per-word times) to the lyric
// near it — a score follower. Order resolves what word sets can't: Verse 2
// ends on the same lines as Verse 1, and its last line repeats on two
// identical slides. The next slide is shown as the current slide's last
// word lands (words left × this slide's pace); blank slides move on their
// learned length.

export interface FSlide {
  index: number; // position in the playlist item's arrangement = trigger index
  section: string;
  text: string;
  tokens: string[];
  /** Tokens of the slide's last line — hearing these means it is ending. */
  tail: string[];
  /** First slide of a section occurrence (the same group repeated back to
   *  back — "Chorus, Chorus" — is two occurrences). */
  groupStart?: boolean;
}
export interface FSong {
  id: string; // presentation uuid
  name: string;
  itemIdx: number; // raw playlist position (trigger path)
  slides: FSlide[];
  bpm?: number;
}
export interface Heard {
  text: string;
  start: number;
  end: number;
  quiet?: boolean;
  langP?: number | null;
  logprob?: number | null;
  /** Per-word times (absolute ms) from Whisper, when it gives them. */
  words?: { w: string; t0: number; t1: number; p?: number }[];
}
export type Via = "heard" | "predicted" | "clock" | "cue" | "model" | "pro";
export type Action =
  | { type: "trigger"; song: FSong; slide: number; via: Via; reason: string }
  | { type: "ask"; song: FSong; current: number; transcript: string; expect: number | null }
  | { type: "prompt"; text: string };

/** Per song: the BPM it was learned at and recent dwell times per slide. */
export type Timing = Record<string, { bpm?: number; slides: Record<string, number[]> }>;

export interface FollowView {
  song: string | null;
  songId: string | null;
  bpm: number | null;
  slide: number | null;
  section: string;
  /** When the clock expects the next slide (ms epoch), if it knows. */
  dueAt: number | null;
  slideStartedAt: number | null;
  lastVia: Via | null;
  lastReason: string;
  heard: string;
  hearing: "words" | "music" | "quiet" | "idle";
  confidence: number;
  /** The rig: click tempo (null = no click), last guide cue, and the
   *  section it called with when that lands. */
  clickBpm: number | null;
  lastCue: string;
  cueTarget: { slide: number; section: string; at: number } | null;
}

import { BeatClock, parseCue, parseSection, sectionMatches, type BeatEvent, type Section } from "./rig";

/** A guide cue from the playback rig, with its times. */
export interface Cue {
  text: string;
  t0: number;
  t1: number;
  words?: { w: string; t0: number; t1: number }[];
}

// ---- words ----------------------------------------------------------------

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9' \n]+/g, " ")
    .replace(/'/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => (w.length > 5 && w.endsWith("ing") ? w.slice(0, -3) : w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

export function tailOf(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = tokenize(lines[lines.length - 1] ?? "");
  if (last.length >= 3) return last;
  const all = tokenize(text);
  return all.slice(-4);
}

/** Whisper's repetition loop ("the name of the Lord is the name of the Lord
 *  is…"), or more words than four seconds of singing can hold. */
export function looksLooped(text: string): boolean {
  const t = tokenize(text);
  if (t.length > 18) return true;
  const seen = new Map<string, number>();
  for (let i = 0; i + 2 < t.length; i++) {
    const k = `${t[i]} ${t[i + 1]} ${t[i + 2]}`;
    const n = (seen.get(k) ?? 0) + 1;
    if (n >= 3) return true;
    seen.set(k, n);
  }
  return false;
}

export function makeSlide(index: number, section: string, text: string): FSlide {
  return { index, section, text, tokens: tokenize(text), tail: tailOf(text) };
}

/** Inverse document frequency over every slide in the playlist, so "you",
 *  "the" and "lord" count for little and "excelsis" counts for a lot. */
export function buildIdf(songs: FSong[]): (t: string) => number {
  const df = new Map<string, number>();
  let n = 0;
  for (const s of songs)
    for (const sl of s.slides) {
      if (!sl.tokens.length) continue;
      n++;
      for (const t of new Set(sl.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
    }
  // A word in no lyric at all is an ad-lib ("oh", "yeah") or a mishearing:
  // it should dilute a match a little, not outweigh the rarest real word.
  const unknown = 0.5 * Math.log((n + 1) / 1.5);
  return (t) => {
    const d = df.get(t);
    return d ? Math.log((n + 1) / (d + 0.5)) : unknown;
  };
}

/** How much of what was heard this text explains (0..1), idf-weighted. */
function explains(heard: Set<string>, text: Set<string>, idf: (t: string) => number): { score: number; hits: number; mass: number } {
  let num = 0;
  let den = 0;
  let hits = 0;
  for (const t of heard) {
    const w = idf(t);
    den += w;
    if (text.has(t)) {
      num += w;
      hits++;
    }
  }
  return { score: den > 0 ? num / den : 0, hits, mass: num };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---- alignment -------------------------------------------------------------

/** How alike two words are, 0..1 — Whisper hears "pain" for "plains". */
export function wordSim(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 3 || b.length < 3) return 0;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return 0.8;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  const s = 1 - prev[n] / Math.max(m, n);
  return s >= 0.66 ? s : 0;
}

/** A song as one run of words in arrangement order, each tagged with its slide. */
export interface Flat {
  toks: string[];
  slide: number[];
  /** Global line number of each word (a slide's text lines, in order). */
  line: number[];
  lineFirst: number[];
  weight: number[];
  first: Map<number, number>;
  last: Map<number, number>;
}

export function flatten(song: FSong, idf: (t: string) => number): Flat {
  const f: Flat = { toks: [], slide: [], line: [], lineFirst: [], weight: [], first: new Map(), last: new Map() };
  for (const sl of song.slides) {
    for (const ln of sl.text.split(/\r?\n/)) {
      const ts = tokenize(ln);
      if (!ts.length) continue;
      f.lineFirst.push(f.toks.length);
      const L = f.lineFirst.length - 1;
      for (const t of ts) {
        if (!f.first.has(sl.index)) f.first.set(sl.index, f.toks.length);
        f.last.set(sl.index, f.toks.length);
        f.toks.push(t);
        f.slide.push(sl.index);
        f.line.push(L);
        // Order does the work; rarity only nudges. (Weighting by rarity
        // alone scored a perfectly sung chorus — the song's most repeated
        // words — below the bar.)
        f.weight.push(Math.max(0.8, Math.min(1.5, 0.8 + idf(t) / 4)));
      }
    }
  }
  return f;
}

export interface HeardTok {
  tok: string;
  t0: number;
  t1: number;
}

export interface Alignment {
  score: number;
  matches: number;
  /** [heard index, lyric index] for each matched word, in order. */
  path: [number, number][];
}

/** Local alignment (Smith–Waterman) of heard words against lyric words
 *  lo..hi. Among equally good placements — a repeated line — the one whose
 *  end is nearest `expect` wins. */
export function align(
  heard: HeardTok[],
  f: Flat,
  lo: number,
  hi: number,
  expect: number,
  prefer?: (path: [number, number][]) => number,
): Alignment | null {
  const m = heard.length;
  lo = Math.max(0, lo);
  hi = Math.min(f.toks.length - 1, hi);
  if (!m || hi < lo) return null;
  const n = hi - lo + 1;
  const S = Array.from({ length: m + 1 }, () => new Float32Array(n + 1));
  const B = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1)); // 1 diag-match 2 diag-miss 3 up 4 left
  let best = 0;
  const cells: [number, number, number][] = [];
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const lj = lo + j - 1;
      const sim = wordSim(heard[i - 1].tok, f.toks[lj]);
      const diag = S[i - 1][j - 1] + (sim > 0 ? f.weight[lj] * sim : -0.7);
      const up = S[i - 1][j] - 0.5; // a heard word that isn't in the lyric
      const left = S[i][j - 1] - 0.35; // a lyric word Whisper didn't catch
      let v = 0;
      let b = 0;
      if (diag > v) (v = diag), (b = sim > 0 ? 1 : 2);
      if (up > v) (v = up), (b = 3);
      if (left > v) (v = left), (b = 4);
      S[i][j] = v;
      B[i][j] = b;
      if (b === 1) {
        if (v > best) best = v;
        cells.push([v, i, j]);
      }
    }
  }
  if (best <= 0) return null;
  const trace = (i: number, j: number) => {
    const path: [number, number][] = [];
    while (i > 0 && j > 0 && S[i][j] > 0) {
      const b = B[i][j];
      if (b === 1) path.push([i - 1, lo + j - 1]);
      if (b === 1 || b === 2) (i--, j--);
      else if (b === 3) i--;
      else if (b === 4) j--;
      else break;
    }
    return path.reverse();
  };
  // Every placement about as good as the best is a candidate (a repeated
  // line gives several); the caller's `prefer` — or nearness to `expect` —
  // decides between them.
  let pick: { score: number; path: [number, number][]; cost: number } | null = null;
  for (const [v, i, j] of cells) {
    if (v < best - 0.3) continue;
    const path = trace(i, j);
    if (!path.length) continue;
    const cost = prefer ? prefer(path) : Math.abs(path[path.length - 1][1] - expect);
    if (!pick || cost < pick.cost - 1e-6 || (Math.abs(cost - pick.cost) <= 1e-6 && v > pick.score)) pick = { score: v, path, cost };
  }
  if (!pick) return null;
  // A match that leaps more than three lyric words between two heard words
  // has skipped a phrase to reach a look-alike: keep only what came before.
  let path = pick.path;
  let score = pick.score;
  for (let k = 1; k < path.length; k++) {
    if (path[k][1] - path[k - 1][1] > 4) {
      score = (score * k) / path.length;
      path = path.slice(0, k);
      break;
    }
  }
  return { score, matches: path.length, path };
}

/** A window's words with times: Whisper's per-word times when present,
 *  else spread evenly across the window. */
export function heardTokens(h: Heard): HeardTok[] {
  const out: HeardTok[] = [];
  if (h.words?.length) {
    // Words Whisper invented to finish a line it only half heard come back
    // squashed into the last instant of the window, several at one time.
    // Keep the first of such a tail cluster, drop the rest.
    const ws = [...h.words];
    let k = ws.length - 1;
    while (k > 0 && h.end - ws[k].t0 < 800 && Math.abs(ws[k].t0 - ws[k - 1].t0) < 100) k--;
    if (k < ws.length - 2) ws.length = k + 1;
    for (const w of ws) for (const tok of tokenize(w.w)) out.push({ tok, t0: w.t0, t1: w.t1 });
    return out;
  }
  const toks = tokenize(h.text);
  const span = Math.max(1, h.end - h.start);
  toks.forEach((tok, k) => out.push({ tok, t0: h.start + (span * k) / toks.length, t1: h.start + (span * (k + 1)) / toks.length }));
  return out;
}

// ---- the engine ------------------------------------------------------------

export const TUNING = {
  /** Whisper's own confidence: below these it was guessing at a band. */
  // Latin and held vowels ("Gloria… excelsis") score low as English, so the
  // gate is loose; a window still has to line up with the lyric to count.
  minLangP: 0.3,
  minLogprob: -1.0,
  /** Locking onto a song from nothing wants cleaner hearing. */
  lockLangP: 0.5,
  strongLangP: 0.5,
  lockScore: 0.4,
  lockGap: 0.15,
  lockHits: 3,
  /** Alignment needed to move the pointer: ~three words in order. */
  minAlign: 2.2,
  minMatches: 2,
  /** A weak window (Whisper unsure) must line up better than that. */
  weakAlign: 3.2,
  /** Going back, or jumping far ahead, wants this — twice. */
  strongAlign: 3.5,
  farAhead: 40,
  /** Show the next slide this long before its last word is due to end. */
  lead: 400,
  /** Beyond a blank slide's learned length, move on without hearing it. */
  clockGrace: 1500,
  minGap: 1200,
  relockGap: 0.25,
  silenceRelease: 60_000,
  askEvery: 5000,
  /** Lost this many windows running while singing → ask the model. */
  lostWindows: 3,
};

export class FollowEngine {
  private idf: (t: string) => number;
  private byId = new Map<string, FSong>();
  private flats = new Map<string, Flat>();
  private windows: { tokens: Set<string>; start: number; end: number; weak: boolean }[] = [];
  private song: FSong | null = null;
  private cur: number | null = null;
  private startedAt: number | null = null;
  /** The word pointer: index of the last word known sung, and when. */
  private p = -1;
  private pTime = 0;
  private lastCommitT = 0;
  /** When each line (global index) was first heard starting, this run. */
  private lineStarts = new Map<number, number>();
  private pPrev = -1;
  private lastAligned = 0;
  private lost = 0;
  private lastTrigger = 0;
  private ourTarget: { songId: string; slide: number; at: number; via: Via } | null = null;
  private clockOnly = 0;
  private lastWords = 0;
  private lastSound = 0;
  private relockStreak: { id: string; n: number } | null = null;
  private jumpStreak: { p: number; n: number; at: number } | null = null;
  private lastAsk = 0;
  private asking = false;
  private lastPrompt = "";
  timingDirty = false;
  /** Practice: every ProPresenter move is a person's (Follow moves nothing). */
  practice = false;
  private pro: { songId: string; slide: number; at: number } | null = null;
  /** Optional trace (replay harness / debug log). */
  debug?: (msg: string) => void;
  view: FollowView = {
    song: null,
    songId: null,
    bpm: null,
    slide: null,
    section: "",
    dueAt: null,
    slideStartedAt: null,
    lastVia: null,
    lastReason: "",
    heard: "",
    hearing: "idle",
    confidence: 0,
    clickBpm: null,
    lastCue: "",
    cueTarget: null,
  };
  /** The click, as a clock. */
  clock = new BeatClock();
  private jump: { songId: string; slide: number; at: number; cue: string; t0: number } | null = null;
  private lastCueFor: { songId: string; slide: number; t0: number } | null = null;
  private cueHeardAt = -Infinity;

  constructor(
    public songs: FSong[],
    public timing: Timing,
    private opts: { modelReady?: boolean; prompt?: "none" | "current" } = {},
  ) {
    this.idf = buildIdf(songs);
    for (const s of songs) this.byId.set(s.id, s);
  }

  private flat(song: FSong): Flat {
    let f = this.flats.get(song.id);
    if (!f) this.flats.set(song.id, (f = flatten(song, this.idf)));
    return f;
  }

  // ---- the clock ----

  /** Learned length of a slide (ms), rescaled if the song's tempo changed. */
  dwell(song: FSong, slide: number): number | null {
    const t = this.timing[song.id];
    const xs = t?.slides[String(slide)];
    if (!xs || xs.length < 1) return null;
    const m = median(xs)!;
    return t.bpm && song.bpm && t.bpm !== song.bpm ? (m * t.bpm) / song.bpm : m;
  }

  /** How long one sung line lasts: the slide's learned length over its
   *  lines (from people's clicks), else this run's measured line starts,
   *  else two bars at the BPM. Lines are the steady unit — a held word can
   *  last four seconds, but lines keep the song's phrase length. */
  lineMs(song: FSong, slide: number): number {
    const f = this.flat(song);
    const a = f.first.get(slide);
    const b = f.last.get(slide);
    const d = this.dwell(song, slide);
    if (d != null && a != null && b != null) return clamp(d / (f.line[b] - f.line[a] + 1), 1200, 20_000);
    const gaps: number[] = [];
    const ks = [...this.lineStarts.keys()].sort((x, y) => x - y);
    for (let k = 1; k < ks.length; k++) {
      if (ks[k] !== ks[k - 1] + 1) continue;
      const dt = this.lineStarts.get(ks[k])! - this.lineStarts.get(ks[k - 1])!;
      if (dt >= 1200 && dt <= 20_000) gaps.push(dt);
    }
    if (gaps.length) return median(gaps)!;
    return song.bpm ? (8 * 60_000) / song.bpm : 4000;
  }

  private msPerWord(song: FSong, slide: number): number {
    const f = this.flat(song);
    const a = f.first.get(slide);
    const b = f.last.get(slide);
    const words = a != null && b != null ? (b - a + 1) / (f.line[b] - f.line[a] + 1) : 6;
    return clamp(this.lineMs(song, slide) / Math.max(1, words), 150, 4000);
  }

  private learn(song: FSong, slide: number, ms: number) {
    if (ms < 1200 || ms > 90_000) return;
    const t = (this.timing[song.id] ??= { bpm: song.bpm, slides: {} });
    if (t.bpm && song.bpm && t.bpm !== song.bpm) {
      const k = t.bpm / song.bpm;
      for (const key of Object.keys(t.slides)) t.slides[key] = t.slides[key].map((x) => Math.round(x * k));
      t.bpm = song.bpm;
    }
    if (!t.bpm && song.bpm) t.bpm = song.bpm;
    const xs = (t.slides[String(slide)] ??= []);
    xs.push(Math.round(ms));
    if (xs.length > 6) xs.shift();
    this.timingDirty = true;
  }

  // ---- inputs ----

  /** ProPresenter says this slide is live (our move or anyone's). */
  onLive(songId: string | null, slide: number | null, now: number): Action[] {
    const song = songId ? this.byId.get(songId) ?? null : null;
    if (!song || slide == null) {
      if (song == null && songId) this.release("Pro left the playlist");
      this.pro = null;
      return [];
    }
    const ours = !this.practice && !!this.ourTarget && this.ourTarget.songId === song.id && this.ourTarget.slide === slide && now - this.ourTarget.at < 3000;
    // Slide lengths are learned from people only — a clock learned from
    // Follow's own (slightly early) moves drags earlier every week — and
    // only from one person's move to the next slide after another.
    if (!ours && this.pro && this.pro.songId === song.id && slide === this.pro.slide + 1) this.learn(song, this.pro.slide, now - this.pro.at);
    this.pro = ours ? null : { songId: song.id, slide, at: now };
    // A person landed the section a cue called: learn how many beats after
    // the cue they like it.
    if (!ours && this.lastCueFor && this.lastCueFor.songId === song.id && this.lastCueFor.slide === slide && this.clock.period) {
      const beats = (now - this.lastCueFor.t0) / this.clock.period;
      if (beats > 0 && beats < 16) {
        const t = (this.timing["__rig"] ??= { slides: {} });
        const xs = (t.slides["cueBeats"] ??= []);
        xs.push(Math.round(beats * 100) / 100);
        if (xs.length > 12) xs.shift();
        this.timingDirty = true;
      }
      this.lastCueFor = null;
    }
    if (this.song?.id === song.id && this.cur === slide) return [];
    if (!ours) {
      this.view.lastVia = "pro";
      this.view.lastReason = "moved in ProPresenter";
      this.clockOnly = 0;
    }
    this.setPosition(song, slide, now);
    return this.promptAction();
  }

  onHeard(h: Heard, now: number): Action[] {
    if (h.quiet) {
      this.view.hearing = "quiet";
      if (this.song && now - Math.max(this.lastSound, this.lastWords) > TUNING.silenceRelease) this.release("quiet for a minute");
      return [];
    }
    this.lastSound = now;
    const sung =
      !!h.text.trim() &&
      !looksLooped(h.text) &&
      (h.langP == null || h.langP >= (this.song ? TUNING.minLangP : TUNING.lockLangP)) &&
      (h.logprob == null || h.logprob >= TUNING.minLogprob);
    const toks = sung ? heardTokens(h) : [];
    if (!toks.length) {
      this.view.hearing = "music";
      return this.clockCheck(now);
    }
    this.view.hearing = "words";
    this.view.heard = h.text;
    this.lastWords = now;
    const weak = (h.langP != null && h.langP < TUNING.strongLangP) || (h.logprob != null && h.logprob < -0.6);
    this.windows.push({ tokens: new Set(toks.map((t) => t.tok)), start: h.start, end: h.end, weak });
    while (this.windows.length && this.windows[0].end < h.end - 20_000) this.windows.shift();

    if (!this.song) return this.tryLock(now);
    const relock = this.checkSong(now);
    if (relock) return relock;
    return [...this.follow(toks, weak, now), ...this.clockCheck(now)];
  }

  onTick(now: number): Action[] {
    return this.clockCheck(now);
  }

  /** A click from the playback rig. */
  onBeat(b: BeatEvent) {
    this.clock.onBeat(b);
    this.view.clickBpm = this.clock.bpm();
  }

  /** A cue from the guide track: a section call lands that section's first
   *  slide just before its first downbeat. */
  onCue(c: Cue, now: number): Action[] {
    this.view.lastCue = c.text;
    const parsed = parseCue(c.text);
    if (parsed.count) {
      // A count-in: "1" is a downbeat.
      const one = [...(c.words ?? [])].reverse().find((w) => /^(1|one|won)[.,!]?$/i.test(w.w.trim()));
      if (one) this.clock.setDownbeat(one.t0);
      return [];
    }
    const song = this.song;
    if (!parsed.section || !song || this.cur == null) return [];
    this.cueHeardAt = now;
    const groups = this.groups(song);
    const gi = groups.findIndex((g) => g.start <= this.cur! && this.cur! <= g.end);
    // The next matching section within the next four, never behind us.
    const target = groups.slice(gi + 1, gi + 5).find((g) => sectionMatches(g.section, parsed.section!));
    if (!target) {
      this.debug?.(`cue "${c.text}" matches nothing ahead of slide ${this.cur}`);
      return [];
    }
    const at = this.landing(c.t0);
    this.jump = { songId: song.id, slide: target.start, at, cue: c.text, t0: c.t0 };
    this.lastCueFor = { songId: song.id, slide: target.start, t0: c.t0 };
    this.view.cueTarget = { slide: target.start, section: song.slides[target.start]?.section ?? "", at };
    this.debug?.(`cue "${c.text}" → slide ${target.start} at ${(at / 1000).toFixed(1)}`);
    return this.clockCheck(now);
  }

  /** When the section a cue called begins. Learned from people's clicks
   *  (beats after the cue) when there's enough; otherwise the first downbeat
   *  at least a beat and a half after the cue started (MultiTracks speaks the
   *  cue in the bar before); without a bar, four beats after it. */
  private landing(t0: number): number {
    const P = this.clock.period;
    const learned = this.timing["__rig"]?.slides["cueBeats"];
    if (P && learned && learned.length >= 2) {
      const t = t0 + median(learned)! * P;
      return this.clock.hasBar() ? this.clock.nextDownbeat(t - P / 2)! : this.clock.snap(t);
    }
    if (P && this.clock.hasBar()) return this.clock.nextDownbeat(t0 + 1.5 * P)!;
    if (P) return this.clock.snap(t0) + 4 * P;
    return t0 + 2500;
  }

  private groupCache = new Map<string, { start: number; end: number; section: Section | null }[]>();
  /** Runs of slides that belong to one section occurrence, in order. */
  groups(song: FSong) {
    let g = this.groupCache.get(song.id);
    if (g) return g;
    g = [];
    for (const sl of song.slides) {
      const last = g[g.length - 1];
      const firstOfGroup = sl.index === 0 || song.slides[sl.index - 1].section !== sl.section || sl.groupStart;
      if (!last || firstOfGroup) g.push({ start: sl.index, end: sl.index, section: parseSection(sl.section) });
      else last.end = sl.index;
    }
    this.groupCache.set(song.id, g);
    return g;
  }

  /** The model's answer to an "ask". */
  onModel(songId: string, slide: number | null, confidence: number, noise: boolean, now: number): Action[] {
    this.asking = false;
    if (!this.song || this.song.id !== songId || noise || slide == null || confidence < 0.6) return [];
    if (slide === this.cur || !this.song.slides[slide]) return [];
    return this.trigger(this.song, slide, "model", `model picked it (${Math.round(confidence * 100)}%)`, now);
  }

  modelFailed() {
    this.asking = false;
  }

  // ---- song lock (bag of words across the playlist) ----

  private recent(ms: number): Set<string> {
    const out = new Set<string>();
    const last = this.windows[this.windows.length - 1]?.end ?? 0;
    for (const w of this.windows) if (w.end >= last - ms) for (const t of w.tokens) out.add(t);
    return out;
  }

  private songScores(heard: Set<string>): { song: FSong; score: number; hits: number }[] {
    return this.songs
      .map((song) => {
        const all = new Set(song.slides.flatMap((s) => s.tokens));
        return { song, ...explains(heard, all, this.idf) };
      })
      .sort((a, b) => b.score - a.score);
  }

  /** Where in `song` the recent words line up, over the whole song. */
  private placeIn(song: FSong): number | null {
    const f = this.flat(song);
    const toks: HeardTok[] = [];
    for (const w of this.windows.slice(-3)) for (const tok of w.tokens) toks.push({ tok, t0: w.end, t1: w.end });
    const a = align(toks, f, 0, f.toks.length - 1, 0);
    return a && a.score >= TUNING.minAlign ? a.path[a.path.length - 1][1] : null;
  }

  private tryLock(now: number): Action[] {
    const [a, b] = this.songScores(this.recent(20_000));
    if (!a) return [];
    this.view.confidence = a.score;
    if (a.score >= TUNING.lockScore && a.hits >= TUNING.lockHits && a.score - (b?.score ?? 0) >= TUNING.lockGap) {
      const f = this.flat(a.song);
      const at = this.placeIn(a.song);
      const slide = at != null ? f.slide[at] : firstLyric(a.song);
      if (slide == null) return [];
      const acts = this.trigger(a.song, slide, "heard", `heard ${a.song.name}`, now);
      if (at != null) this.commit(at, now, now);
      return acts;
    }
    return [];
  }

  /** A different song clearly outscoring the locked one, twice running. */
  private checkSong(now: number): Action[] | null {
    const scores = this.songScores(this.recent(12_000));
    const mine = scores.find((s) => s.song.id === this.song!.id)?.score ?? 0;
    const top = scores[0];
    if (top && top.song.id !== this.song!.id && top.hits >= TUNING.lockHits && top.score - mine >= TUNING.relockGap) {
      this.relockStreak = this.relockStreak?.id === top.song.id ? { id: top.song.id, n: this.relockStreak.n + 1 } : { id: top.song.id, n: 1 };
      if (this.relockStreak.n >= 2) {
        this.relockStreak = null;
        const f = this.flat(top.song);
        const at = this.placeIn(top.song);
        const slide = at != null ? f.slide[at] : firstLyric(top.song);
        if (slide != null) {
          const acts = this.trigger(top.song, slide, "heard", `switched to ${top.song.name}`, now);
          if (at != null) this.commit(at, now, now);
          return acts;
        }
      }
    } else this.relockStreak = null;
    return null;
  }

  // ---- the word pointer ----

  private commit(p: number, t: number, now: number) {
    this.p = p;
    this.pTime = t;
    this.lastAligned = now;
  }

  /** Between placements of a repeated line, prefer the line that should be
   *  starting when its first heard word was sung: lines keep the song's
   *  phrase length, word rates don't (held notes). */
  private linePrefer(toks: HeardTok[], f: Flat, song: FSong) {
    let Lk = -1;
    let tk = 0;
    for (const [L, t] of this.lineStarts) if (t > tk) (Lk = L), (tk = t);
    if (Lk < 0 || this.cur == null) return undefined;
    const lm = this.lineMs(song, this.cur);
    return (path: [number, number][]) => {
      const [hi, li] = path[0];
      const L = f.line[li];
      const next = f.lineFirst[L + 1] ?? f.toks.length;
      const frac = (li - f.lineFirst[L]) / Math.max(1, next - f.lineFirst[L]);
      const expected = Lk + (toks[hi].t0 - tk) / lm;
      return Math.abs(L + frac - expected);
    };
  }

  /** Note line starts from matched words: the line's first or second word,
   *  and at least two words of that line matched (one stray "and" isn't a
   *  line). */
  private noteLines(path: [number, number][], toks: HeardTok[], f: Flat, rate: number) {
    const per = new Map<number, number>();
    for (const [, li] of path) per.set(f.line[li], (per.get(f.line[li]) ?? 0) + 1);
    for (const [hi, li] of path) {
      const L = f.line[li];
      const off = li - f.lineFirst[L];
      if (off > 1 || this.lineStarts.has(L) || (per.get(L) ?? 0) < 2) continue;
      this.lineStarts.set(L, toks[hi].t0 - off * rate);
    }
    if (this.lineStarts.size > 80) {
      const ks = [...this.lineStarts.keys()].sort((x, y) => x - y);
      for (const k of ks.slice(0, ks.length - 80)) this.lineStarts.delete(k);
    }
  }

  private follow(toks: HeardTok[], weak: boolean, now: number): Action[] {
    const song = this.song!;
    const f = this.flat(song);
    if (!f.toks.length || this.cur == null) return [];
    const rate = this.msPerWord(song, this.cur);
    // Where the singers should be as of the LAST WORD IN THIS WINDOW — not
    // "now", which includes Whisper's second of processing. Measured from
    // now, a re-heard line looked like the next identical line and the
    // pointer skipped a whole line (the "Gloria… Gloria…" slide).
    const tLast = toks[toks.length - 1].t0;
    const expect = Math.min(this.p + 20, Math.max(this.p, this.p + (tLast - this.pTime) / rate));
    const lostLong = this.lost >= TUNING.lostWindows;
    const prefer = this.linePrefer(toks, f, song);
    const a = lostLong ? align(toks, f, 0, f.toks.length - 1, expect, prefer) : align(toks, f, this.p - 30, this.p + 90, expect, prefer);
    const need = weak ? TUNING.weakAlign : TUNING.minAlign;
    if (!a || a.score < need || a.matches < TUNING.minMatches) {
      this.lost++;
      this.view.confidence = a ? Math.min(1, a.score / 6) : 0;
      return this.maybeAsk(now);
    }
    this.lost = 0;
    this.view.confidence = Math.min(1, a.score / 6);
    // Only words sung since the last one counted can move the pointer: the
    // windows overlap by two seconds, so a line is heard twice.
    const prevCommit = this.lastCommitT;
    const fresh = a.path.filter(([hi]) => toks[hi].t0 > this.lastCommitT - 150);
    this.lastCommitT = Math.max(this.lastCommitT, ...toks.map((t) => t.t0));
    if (!fresh.length) {
      this.lastAligned = now;
      return [];
    }
    const [hiEnd, np] = fresh[fresh.length - 1];
    const t = toks[hiEnd].t1;
    this.debug?.(`align p=${this.p} expect=${expect.toFixed(1)} rate=${Math.round(rate)} score=${a.score.toFixed(2)} path=${a.path.map(([h, l]) => `${toks[h].tok}@${(toks[h].t0 / 1000).toFixed(1)}→${l}`).join(" ")} fresh→${np} lastCommit=${(prevCommit / 1000).toFixed(1)}`);
    // Whisper unsure of its words (in a break it "recalls" the song's
    // lyrics at exactly this confidence): it may confirm the next few words,
    // never skip ahead.
    if (weak && np > this.p + 4) return [];
    const back = np < this.p - 2;
    const far = np > this.p + TUNING.farAhead;
    if (back || far) {
      // Going back (a repeat) or leaping ahead (a skipped section): strong
      // and twice, near the same place.
      if (a.score < TUNING.strongAlign || now - this.lastTrigger < 4000) return [];
      this.jumpStreak =
        this.jumpStreak && Math.abs(this.jumpStreak.p - np) <= 6 && now - this.jumpStreak.at < 8000
          ? { p: np, n: this.jumpStreak.n + 1, at: this.jumpStreak.at }
          : { p: np, n: 1, at: now };
      if (this.jumpStreak.n < 2) return [];
      this.jumpStreak = null;
      this.commit(np, t, now);
      return this.trigger(song, f.slide[np], "heard", back ? "went back" : "jumped ahead", now, true);
    }
    this.jumpStreak = null;
    if (np <= this.p) {
      this.lastAligned = now;
      return [];
    }
    this.pPrev = this.p;
    this.commit(np, t, now);
    // Line starts only from words that moved the pointer forward.
    this.noteLines(fresh.filter(([, li]) => li > this.pPrev && li <= np), toks, f, rate);
    this.clockOnly = 0;
    const sp = f.slide[np];
    if (sp > this.cur) {
      // Words from a later slide: we are late. Go now.
      return this.trigger(song, sp, "heard", sp === this.cur + 1 ? "heard the next slide" : "caught up", now, true);
    }
    return [];
  }

  private maybeAsk(now: number): Action[] {
    const song = this.song!;
    if (!this.opts.modelReady || this.asking || this.lost < TUNING.lostWindows || now - this.lastAsk < TUNING.askEvery || this.cur == null) return [];
    this.asking = true;
    this.lastAsk = now;
    return [{ type: "ask", song, current: this.cur, transcript: this.transcript(), expect: this.cur + 1 < song.slides.length ? this.cur + 1 : null }];
  }

  private clockCheck(now: number): Action[] {
    const song = this.song;
    const cur = this.cur;
    this.view.dueAt = null;
    if (!song || cur == null || this.startedAt == null) return [];
    // A section the guide called: land it just before its downbeat.
    if (this.jump && this.jump.songId === song.id) {
      const lead = Math.min(900, this.clock.period ?? 900);
      if (now >= this.jump.at - lead && now - this.lastTrigger >= 300) {
        const j = this.jump;
        this.jump = null;
        this.view.cueTarget = null;
        if (j.slide !== cur) return this.trigger(song, j.slide, "cue", `guide said "${j.cue}"`, now);
      }
      this.view.dueAt = this.jump?.at ?? null;
      if (this.jump) return [];
    }
    const next = cur + 1 < song.slides.length ? cur + 1 : null;
    if (next == null) return [];
    const f = this.flat(song);
    const last = f.last.get(cur);
    // With the guide talking, a new section is the guide's call: the words
    // alone don't cross into it until a bar past their own estimate.
    const guideOn = now - this.cueHeardAt < 120_000;
    const crossing = this.groups(song).some((g) => g.start === next);
    const hold = guideOn && crossing ? 4 * (this.clock.period ?? 600) : 0;
    if (last != null) {
      // A slide with words ends one line-length after its last line starts.
      // Needs the pointer on this slide (or at the very end of the one
      // before) and the singing to be recent.
      const first = f.first.get(cur)!;
      if (this.p < first - 1 || this.p > last) return [];
      const lm = this.lineMs(song, cur);
      const lastLine = f.line[last];
      let due: number;
      const learned = this.dwell(song, cur);
      if (this.p >= first) {
        // Anchor on the latest line of this slide we saw start. Until the
        // LAST line has been heard starting, only a learned length (from
        // people's clicks) may move it — a tempo guess alone fired a whole
        // line early in testing.
        let L = f.line[this.p];
        while (L > f.line[first] && !this.lineStarts.has(L)) L--;
        const t0 = this.lineStarts.get(L) ?? this.startedAt;
        const onLastLine = f.line[this.p] === lastLine || (this.p + 1 <= last && f.line[this.p + 1] === lastLine && this.lineStarts.has(lastLine));
        due = onLastLine || this.lineStarts.has(lastLine) ? t0 + (lastLine - L + 1) * lm : learned != null ? this.startedAt + learned : Infinity;
        // Heard the last word itself: it may be held (three or four seconds
        // is common) or the line may simply be short. Late is the sin, so
        // take the earlier of "a line after it started" and half a line
        // after its last word.
        if (this.p === last) due = Math.min(due, this.pTime + 0.5 * lm);
      } else {
        due = learned != null ? this.startedAt + learned : this.startedAt + (lastLine - f.line[first] + 1) * lm;
      }
      due += hold;
      this.view.dueAt = Number.isFinite(due) ? due : null;
      if (now - this.lastAligned > 8000) return []; // nobody's singing it: hold
      if (now < due - TUNING.lead || now - this.lastTrigger < TUNING.minGap) return [];
      if (this.p < first) {
        // Not one word of this slide heard yet: a prediction, one slide
        // only, and only if the slide before was heard right to its end.
        if (this.clockOnly >= 1 || this.p < 0 || this.pTime < this.startedAt - 3000) return [];
        this.clockOnly++;
        return this.trigger(song, next, "predicted", "on time by the song's pace", now);
      }
      return this.trigger(song, next, "heard", this.p === last ? "heard the last word" : "last line ending now", now);
    }
    // A blank slide (instrumental): its learned length, then the next.
    const d = this.dwell(song, cur);
    if (d == null) return [];
    const due = this.startedAt + d;
    this.view.dueAt = due;
    if (now < due - TUNING.lead || now - this.lastTrigger < TUNING.minGap || this.clockOnly >= 1) return [];
    if (now - this.lastSound > 4000) return []; // the band stopped: hold
    this.clockOnly++;
    return this.trigger(song, next, "clock", "on time by the clock", now);
  }

  // ---- effects ----

  private trigger(song: FSong, slide: number, via: Via, reason: string, now: number, keepPointer = false): Action[] {
    if (now - this.lastTrigger < TUNING.minGap && this.song?.id === song.id && via !== "heard") return [];
    if (this.song?.id === song.id && this.cur === slide) return [];
    if (via === "heard" || via === "model") this.clockOnly = 0;
    this.lastTrigger = now;
    this.ourTarget = { songId: song.id, slide, at: now, via };
    this.view.lastVia = via;
    this.view.lastReason = reason;
    this.setPosition(song, slide, now, keepPointer);
    return [{ type: "trigger", song, slide, via, reason }, ...this.promptAction()];
  }

  private setPosition(song: FSong, slide: number, now: number, keepPointer = false) {
    const sameSong = this.song?.id === song.id;
    if (!sameSong) {
      this.windows = this.windows.slice(-1);
      this.relockStreak = null;
      this.lineStarts.clear();
      this.p = -1;
    }
    if (!sameSong) {
      this.jump = null;
      this.view.cueTarget = null;
      this.clock.prior = song.bpm ?? null;
    }
    this.song = song;
    this.cur = slide;
    this.startedAt = now;
    this.jumpStreak = null;
    // The pointer stays if it already sits on (or just before) this slide;
    // otherwise it moves to just before the slide's first word.
    const f = this.flat(song);
    const first = f.first.get(slide);
    const last = f.last.get(slide);
    if (!keepPointer) {
      if (first != null) {
        if (this.p < first - 1 || this.p > last!) {
          this.p = first - 1;
          this.pTime = now;
        }
      } else {
        // Blank slide: the pointer rests at the end of the words before it.
        let q = -1;
        for (let k = 0; k < f.toks.length && f.slide[k] < slide; k++) q = k;
        if (this.p < q - 1 || this.p > q) {
          this.p = q;
          this.pTime = now;
        }
      }
    }
    const sl = song.slides[slide];
    Object.assign(this.view, { song: song.name, songId: song.id, bpm: song.bpm ?? null, slide, section: sl?.section ?? "", slideStartedAt: now });
  }

  private release(why: string) {
    if (!this.song) return;
    this.song = null;
    this.cur = null;
    this.startedAt = null;
    this.windows = [];
    this.p = -1;
    this.lineStarts.clear();
    Object.assign(this.view, { song: null, songId: null, bpm: null, slide: null, section: "", dueAt: null, slideStartedAt: null, lastReason: why });
  }

  /** Whisper hears better when it knows the words on screen. Never the
   *  lines still to come: prompted with those it "hears" them early. */
  private promptAction(): Action[] {
    const song = this.song;
    const text = song && this.cur != null && this.opts.prompt === "current" ? song.slides[this.cur]?.text.replace(/\s+/g, " ").trim() ?? "" : "";
    if (text === this.lastPrompt) return [];
    this.lastPrompt = text;
    return [{ type: "prompt", text }];
  }

  private transcript(): string {
    return this.windows
      .slice(-6)
      .map((w) => [...w.tokens].join(" "))
      .join(" / ");
  }
}

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function firstLyric(song: FSong): number | null {
  return song.slides.find((s) => s.tokens.length)?.index ?? null;
}

// ---- the model's question ----------------------------------------------------

/** The Messages request for an "ask": whole lyric, where we think we are,
 *  what was heard. Answer is one line of JSON. */
export function askBody(a: Extract<Action, { type: "ask" }>, heardRaw: string) {
  const lyric = a.song.slides
    .map((s) => `[${s.index}]${s.section ? ` (${s.section})` : ""} ${s.text.replace(/\s+/g, " ").trim() || "(blank)"}`)
    .join("\n");
  return {
    max_tokens: 60,
    system:
      "You follow a live worship song and say which lyric slide is being sung right now. The transcript comes from speech recognition of a live band — words will be misheard. Repeated sections (choruses) appear more than once; prefer the one at or just after the current slide. Answer with ONE line of JSON only: {\"slide\": <number or null>, \"confidence\": <0..1>, \"noise\": <true if the transcript is not these lyrics>}.",
    messages: [
      {
        role: "user",
        content: `Song: ${a.song.name}\n\nSlides:\n${lyric}\n\nCurrent slide: ${a.current}${a.expect != null ? `\nExpected next: ${a.expect}` : ""}\n\nHeard in the last few seconds (oldest first):\n${heardRaw}`,
      },
    ],
  };
}

export function parsePick(reply: any): { slide: number | null; confidence: number; noise: boolean } | null {
  const text: string = (reply?.content ?? []).map((b: any) => (b?.type === "text" ? b.text : "")).join("");
  const m = text.match(/\{[^}]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return {
      slide: typeof j.slide === "number" ? j.slide : null,
      confidence: Number(j.confidence) || 0,
      noise: !!j.noise,
    };
  } catch {
    return null;
  }
}
