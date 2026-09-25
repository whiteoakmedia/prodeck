// The weekly stream report, judged: the recorder (src-tauri/src/streamrep.rs)
// keeps one row a second of the stream mix; this turns a service of rows into
// the numbers that matter for the people watching at home and what to change.
//
// Row: [t, lufs (1 s), peak dBFS, L/R correlation, 9 octave bands in dB
// relative to the whole (60 Hz … 12 kHz)].

export type Row = number[];
export interface StreamReportData {
  id: string;
  start: number;
  offsetDb?: number;
  rows: Row[];
}
export interface StreamReportMeta {
  id: string;
  start: number;
  end: number;
  soundSecs: number;
}

export const BAND_LABELS = ["60", "125", "250", "500", "1k", "2k", "4k", "8k", "12k"];
/** A professionally mixed worship record (MWS "Gloria"), same bands, same
 *  measurement — the tone to aim the stream at. */
export const REFERENCE_BANDS = [-10.3, -7.5, -6.7, -6.0, -6.5, -7.8, -10.3, -13.2, -15.2];
/** What YouTube and most platforms normalise to. */
export const TARGET_LUFS = -14;

const SOUND = -60;
const e = (lufs: number) => Math.pow(10, lufs / 10);
const l = (energy: number) => (energy > 0 ? 10 * Math.log10(energy) : -99);
const r1 = (x: number) => Math.round(x * 10) / 10;

/** BS.1770-style gated loudness over 1 s blocks. */
export function integrated(lufs: number[]): number | null {
  const a = lufs.filter((x) => x > -70);
  if (!a.length) return null;
  const ungated = l(a.reduce((s, x) => s + e(x), 0) / a.length);
  const b = a.filter((x) => x > ungated - 10);
  return b.length ? l(b.reduce((s, x) => s + e(x), 0) / b.length) : ungated;
}

/** Loudness range: the spread (10th → 95th percentile) of 3 s loudness. */
export function loudnessRange(lufs: number[]): number | null {
  const st: number[] = [];
  for (let i = 2; i < lufs.length; i++) st.push(l((e(lufs[i]) + e(lufs[i - 1]) + e(lufs[i - 2])) / 3));
  const I = integrated(lufs);
  if (I == null) return null;
  const g = st.filter((x) => x > -70 && x > I - 20).sort((a, b) => a - b);
  if (g.length < 10) return null;
  const p = (q: number) => g[Math.min(g.length - 1, Math.floor(q * g.length))];
  return p(0.95) - p(0.1);
}

/** Music or talking, per second. A band is wide (the stream mix pans it)
 *  and has a bottom end; the lapel is one mono voice. Smoothed over ~20 s so
 *  a sung a-cappella line or a pause doesn't flip it. */
export function classify(rows: Row[]): boolean[] {
  const raw = rows.map((r) => r[3] < 0.93 || r[4] > -16);
  const out: boolean[] = [];
  const W = 10;
  for (let i = 0; i < raw.length; i++) {
    let m = 0;
    let n = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(raw.length - 1, i + W); j++) {
      n++;
      if (raw[j]) m++;
    }
    out.push(m * 2 > n);
  }
  return out;
}

export interface Tip {
  level: "good" | "warn" | "bad";
  text: string;
}
export interface StreamSummary {
  start: number;
  end: number;
  minutes: number;
  /** All loudness figures in stream terms (the feed + the encoder offset). */
  overall: number | null;
  worship: number | null;
  message: number | null;
  /** Message minus worship, LU. */
  gap: number | null;
  worshipRange: number | null;
  messageRange: number | null;
  peak: number;
  worshipMinutes: number;
  messageMinutes: number;
  /** Worship tone vs the reference, dB per band (+ = more than the reference). */
  bands: number[] | null;
  bandDiff: number[] | null;
  timeline: { t: number; lufs: number; music: boolean }[];
  tips: Tip[];
}

export function summarize(d: StreamReportData, offsetDb = d.offsetDb ?? 0): StreamSummary {
  const rows = d.rows.filter((r) => r[1] > SOUND);
  const music = classify(rows);
  const off = (x: number | null) => (x == null ? null : r1(x + offsetDb));
  const mRows = rows.filter((_, i) => music[i]);
  const sRows = rows.filter((_, i) => !music[i]);
  const overall = off(integrated(rows.map((r) => r[1])));
  const worship = off(integrated(mRows.map((r) => r[1])));
  const message = off(integrated(sRows.map((r) => r[1])));
  const gap = worship != null && message != null ? r1(message - worship) : null;
  const wr = loudnessRange(mRows.map((r) => r[1]));
  const mr = loudnessRange(sRows.map((r) => r[1]));
  const peak = rows.length ? r1(Math.max(...rows.map((r) => r[2])) + offsetDb) : -99;
  let bands: number[] | null = null;
  let bandDiff: number[] | null = null;
  if (mRows.length >= 60) {
    bands = REFERENCE_BANDS.map((_, b) => r1(l(mRows.reduce((s, r) => s + e(r[4 + b]), 0) / mRows.length)));
    bandDiff = bands.map((x, b) => r1(x - REFERENCE_BANDS[b]));
  }
  // One point a minute for the timeline.
  const timeline: StreamSummary["timeline"] = [];
  for (let i = 0; i < rows.length; ) {
    const t0 = rows[i][0];
    const chunk: number[] = [];
    let m = 0;
    while (i < rows.length && rows[i][0] < t0 + 60) {
      chunk.push(rows[i][1]);
      if (music[i]) m++;
      i++;
    }
    const v = integrated(chunk);
    if (v != null) timeline.push({ t: t0, lufs: r1(v + offsetDb), music: m * 2 > chunk.length });
  }

  const tips: Tip[] = [];
  if (overall != null) {
    const under = TARGET_LUFS - overall;
    if (under > 1.5) {
      const room = -1 - (peak + under);
      tips.push({
        level: under > 4 ? "bad" : "warn",
        text: `${r1(under)} dB under the ${TARGET_LUFS} LUFS YouTube plays at — viewers turn it up to hear it.${room < 0 ? ` Raising it that much needs a limiter first (peaks would reach ${r1(peak + under)} dBFS).` : ` There's headroom to raise the stream feed ${r1(under)} dB.`}`,
      });
    } else if (under < -1.5) tips.push({ level: "warn", text: `${r1(-under)} dB over ${TARGET_LUFS} LUFS — YouTube turns it down, squashing nothing but costing punch.` });
    else tips.push({ level: "good", text: `Right at YouTube's ${TARGET_LUFS} LUFS.` });
  }
  if (gap != null) {
    if (gap < -3) tips.push({ level: gap < -5 ? "bad" : "warn", text: `The message sits ${r1(-gap)} LU under the worship — people at home ride their volume between them. Bring the lapel up in the stream mix (or compress it harder).` });
    else if (gap > 2) tips.push({ level: "warn", text: `The message is ${r1(gap)} LU louder than the worship — the band could come up in the stream mix.` });
    else tips.push({ level: "good", text: `Message and worship sit within ${Math.abs(gap).toFixed(1)} LU of each other.` });
  }
  if (mr != null && mr > 6) tips.push({ level: "warn", text: `The message swings ${r1(mr)} LU loud-to-soft — a little more compression on the lapel's stream send keeps quiet moments audible.` });
  if (wr != null && wr < 3) tips.push({ level: "warn", text: `The worship barely moves (${r1(wr)} LU range) — it's over-compressed; builds and breakdowns disappear at home.` });
  if (bandDiff) {
    const avg = (ix: number[]) => ix.reduce((s, i) => s + bandDiff![i], 0) / ix.length;
    const low = avg([0, 1]);
    const pres = avg([5, 6]);
    const air = avg([7, 8]);
    const mud = bandDiff[2];
    if (low > 3) tips.push({ level: "warn", text: `Bass-heavy: ${r1(low)} dB more 60–125 Hz than the reference. Phones and laptops turn that into mud — shelve the low end of the stream bus.` });
    if (low < -3) tips.push({ level: "warn", text: `Thin: ${r1(-low)} dB less 60–125 Hz than the reference.` });
    if (mud > 3) tips.push({ level: "warn", text: `${r1(mud)} dB extra at 250 Hz — boxy; a wide cut there clears the vocals.` });
    if (pres < -3) tips.push({ level: "warn", text: `${r1(-pres)} dB short at 2–4 kHz — vocals and guitars lose their edge; lift the presence on the stream bus.` });
    if (air < -3) tips.push({ level: "warn", text: `${r1(-air)} dB short at 8–12 kHz — dull; a high shelf adds the air the room gives in person.` });
    if (Math.max(Math.abs(low), Math.abs(pres), Math.abs(air), Math.abs(mud)) <= 3) tips.push({ level: "good", text: "The worship's tone is within 3 dB of the reference in every region." });
  }
  const start = d.rows[0]?.[0] ?? d.start;
  const end = d.rows[d.rows.length - 1]?.[0] ?? start;
  return {
    start,
    end,
    minutes: Math.round(rows.length / 60),
    overall,
    worship,
    message,
    gap,
    worshipRange: wr != null ? r1(wr) : null,
    messageRange: mr != null ? r1(mr) : null,
    peak,
    worshipMinutes: Math.round(mRows.length / 60),
    messageMinutes: Math.round(sRows.length / 60),
    bands,
    bandDiff,
    timeline,
    tips,
  };
}
