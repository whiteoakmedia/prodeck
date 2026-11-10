// Next Slide: the lyrics operator's job as a game, for the booth-off screen
// (src/mobile/NextSlide.tsx). A line lights up word by word as if it's being
// sung; tap Next slide right as the last word lands. Too early cuts the room
// off mid line, too late leaves them singing to an old slide. Silent, one
// thumb, a personal best kept on the phone. Pure, so it's tested here.
//
// Every lyric is from a hymn in the public domain.

export const HYMNS: { title: string; lines: string[] }[] = [
  {
    title: "Amazing Grace",
    lines: ["Amazing grace how sweet the sound", "That saved a wretch like me", "I once was lost but now am found", "Was blind but now I see"],
  },
  {
    title: "It Is Well",
    lines: ["When peace like a river attendeth my way", "When sorrows like sea billows roll", "Whatever my lot thou hast taught me to say", "It is well it is well with my soul"],
  },
  {
    title: "Holy Holy Holy",
    lines: ["Holy holy holy Lord God Almighty", "Early in the morning our song shall rise to thee", "Holy holy holy merciful and mighty", "God in three persons blessed Trinity"],
  },
  {
    title: "Come Thou Fount",
    lines: ["Come thou fount of every blessing", "Tune my heart to sing thy grace", "Streams of mercy never ceasing", "Call for songs of loudest praise"],
  },
  {
    title: "Doxology",
    lines: ["Praise God from whom all blessings flow", "Praise him all creatures here below", "Praise him above ye heavenly host", "Praise Father Son and Holy Ghost"],
  },
  {
    title: "Be Thou My Vision",
    lines: ["Be thou my vision O Lord of my heart", "Naught be all else to me save that thou art", "Thou my best thought by day or by night", "Waking or sleeping thy presence my light"],
  },
];

/** Within this of the last word: a clean change. */
export const PERFECT_MS = 160;
/** Within this (before or after): still on time. */
export const GOOD_MS = 380;

export type Verdict = "perfect" | "good" | "early" | "late" | "missed";

/**
 * How fast the song is going: quicker with every slide shown this game (a
 * mistake doesn't slow it back down), a little quicker again while the
 * streak holds. 1 = the opening pace; tops out at 2.4 times.
 */
export function tempo(slides: number, streak: number): number {
  return Math.min(2.4, 1 + Math.max(0, slides) * 0.05 + Math.max(0, streak) * 0.02);
}

/** How long a line takes to sing at that tempo, never under 750 ms. */
export function lineDuration(words: number, slides: number, streak: number): number {
  return Math.max(750, Math.round((700 + 360 * Math.max(1, words)) / tempo(slides, streak)));
}

/** The pause before the next line, shorter as the tempo climbs. */
export function gapAfter(onTimeTap: boolean, slides: number, streak: number): number {
  const t = tempo(slides, streak);
  return onTimeTap ? Math.round(Math.max(180, 450 / t)) : 1400;
}

/** How many words are lit `elapsed` ms into a line of `words` words. */
export function wordsLit(elapsed: number, duration: number, words: number): number {
  if (elapsed <= 0) return 0;
  return Math.min(words, Math.ceil((elapsed / duration) * words));
}

/** A tap `elapsed` ms into a line that ends at `duration`. */
export function judge(elapsed: number, duration: number): Verdict {
  const off = elapsed - duration;
  if (Math.abs(off) <= PERFECT_MS) return "perfect";
  if (off < -GOOD_MS) return "early";
  if (off > GOOD_MS) return "late";
  return "good";
}

/** Has the line run so long that nobody tapped in time? */
export function missed(elapsed: number, duration: number): boolean {
  return elapsed - duration > GOOD_MS * 2;
}

export const onTime = (v: Verdict) => v === "perfect" || v === "good";

/** Plain words for each verdict, shown over the stage screen. */
export const VERDICT_TEXT: Record<Verdict, string> = {
  perfect: "Clean change",
  good: "On time",
  early: "Too early: they were still singing that line",
  late: "Late: the room waited on the slide",
  missed: "Missed it: the room sang to an old slide",
};

/** The line after (song, line), walking every hymn in order and around. */
export function nextLine(song: number, line: number): { song: number; line: number } {
  const s = HYMNS[song % HYMNS.length];
  if (line + 1 < s.lines.length) return { song: song % HYMNS.length, line: line + 1 };
  return { song: (song + 1) % HYMNS.length, line: 0 };
}

const BEST_KEY = "prodeck.nextSlideBest";

export function readBest(): number {
  try {
    const n = Number(localStorage.getItem(BEST_KEY) ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function saveBest(n: number) {
  try {
    if (n > readBest()) localStorage.setItem(BEST_KEY, String(n));
  } catch {
    /* private storage: the best lasts this visit */
  }
}
