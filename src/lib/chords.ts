// Chord math for the in-app chart renderer. PCO stores one chord chart per
// arrangement in a single written key; the scheduled key comes from the plan
// item — so transposition happens here, on the phone, and works even when
// the chart arrives through the edge with the booth off.
//
// The chart format (verified against this church's real data) is ChordPro
// brackets in lyric lines — "[G]My Jesus, [D]my Saviour" — plus bar lines
// like "| G/// | C/// |" in intros/turnarounds.

const NOTES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const IDX: Record<string, number> = {
  C: 0, "B#": 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, "E#": 5,
  F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11,
};
// Major keys conventionally written with sharps; everything else gets flats.
const SHARP_KEYS = new Set(["C", "G", "D", "A", "E", "B", "F#", "C#"]);

export function parseKey(k: string): { root: string; minor: boolean } | null {
  const m = (k ?? "").trim().match(/^([A-G][#b]?)\s*(m(?!aj)|minor)?/i);
  if (!m) return null;
  const root = m[1][0].toUpperCase() + (m[1][1] ?? "").toLowerCase();
  if (!(root in IDX)) return null;
  return { root, minor: !!m[2] };
}

/** Semitone delta to move a chart written in `from` to `to`. */
export function keyDelta(from: string, to: string): number {
  const a = parseKey(from);
  const b = parseKey(to);
  if (!a || !b) return 0;
  return (((IDX[b.root] - IDX[a.root]) % 12) + 12) % 12;
}

function prefersSharps(targetKey: string): boolean {
  const k = parseKey(targetKey);
  if (!k) return true;
  // Minor keys borrow the relative major's spelling (Bm → D → sharps).
  const majorIdx = k.minor ? (IDX[k.root] + 3) % 12 : IDX[k.root];
  return SHARP_KEYS.has(NOTES_SHARP[majorIdx]) || SHARP_KEYS.has(NOTES_FLAT[majorIdx]);
}

function shiftRoot(root: string, delta: number, sharps: boolean): string {
  const i = IDX[root];
  if (i === undefined) return root;
  const j = (i + delta + 12) % 12;
  return sharps ? NOTES_SHARP[j] : NOTES_FLAT[j];
}

/** Transpose one chord token: "G", "Dsus", "D/F#", "G///" (bar rhythm). */
export function transposeChord(token: string, delta: number, sharps: boolean): string {
  const m = token.match(/^([A-G][#b]?)([^/\s]*)((?:\/[A-G][#b]?)?)(\/*)$/);
  if (!m) return token;
  const [, root, suffix, bass, rhythm] = m;
  const newRoot = shiftRoot(root, delta, sharps);
  const newBass = bass ? "/" + shiftRoot(bass.slice(1), delta, sharps) : "";
  return newRoot + suffix + newBass + rhythm;
}

const BAR_TOKEN = /(^|[\s|])([A-G][#b]?[^/\s|]*(?:\/[A-G][#b]?)?\/*)(?=[\s|]|$)/g;

/** Transpose a whole chart. Bracket chords always; bar-line tokens only on
 *  lines that contain "|" (so lyric words never get mangled). */
export function transposeChart(text: string, fromKey: string, toKey: string): string {
  const delta = keyDelta(fromKey, toKey);
  if (delta === 0) return text;
  const sharps = prefersSharps(toKey);
  return text
    .split("\n")
    .map((line) => {
      let out = line.replace(/\[([^\]\s]+)\]/g, (_, c) => `[${transposeChord(c, delta, sharps)}]`);
      if (out.includes("|")) {
        out = out.replace(BAR_TOKEN, (_, pre, tok) => pre + transposeChord(tok, delta, sharps));
      }
      return out;
    })
    .join("\n");
}

/** All twelve keys in the target's spelling, for the key stepper. */
export function keyOptions(reference: string): string[] {
  const sharps = prefersSharps(reference);
  return (sharps ? NOTES_SHARP : NOTES_FLAT).slice();
}
