// Autopilot: the speech mics follow the plan (pure; tested in speech-mics.test.ts).
//
// The lapel is for preaching, 8 MC for the moments of transition. When the
// live Planning Center item needs one, it opens. Closing is the dangerous
// half — a pastor still talking over the first chorus — so a mic is only
// closed once its own feed has been quiet for a while after its item ended;
// with no feed routed, Autopilot never closes a mic, it reminds instead.
// A person touching that mic's mute on the desk takes it over until the next
// item.

export type SpeechMic = "lapel" | "mc";

export interface SpeechConfig {
  lapelWords: string[];
  mcWords: string[];
}

export const DEFAULT_LAPEL_WORDS = ["message", "sermon", "preach", "preaching", "teaching", "the word"];
export const DEFAULT_MC_WORDS = ["welcome", "announcement", "announcements", "offering", "giving", "tithe", "transition", "host", "mc", "communion", "baptism", "benediction", "closing", "dismissal", "greeting", "prayer"];

export function parseWords(s: string | undefined, fallback: string[]): string[] {
  const w = (s ?? "")
    .split(/[,\n]/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return w.length ? w : fallback;
}

/** Which speech mic a plan item needs, if any. Songs never do. */
export function micFor(item: { type?: string; title?: string; description?: string } | null | undefined, cfg: SpeechConfig): SpeechMic | null {
  if (!item || item.type === "song" || item.type === "header") return null;
  const text = ` ${(item.title ?? "").toLowerCase()} ${(item.description ?? "").toLowerCase()} `;
  const has = (w: string) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(text);
  if (cfg.lapelWords.some(has)) return "lapel";
  if (cfg.mcWords.some(has)) return "mc";
  return null;
}

export type SpeechAction = { type: "open" | "close"; mic: SpeechMic; reason: string } | { type: "remind"; mic: SpeechMic; reason: string };

interface MicState {
  /** A person took this mic over (their own mute press) until the next item. */
  manual: boolean;
  /** The live item that last needed it ended at… (ms), and hasn't been closed. */
  releasedAt: number | null;
  lastLoud: number;
  reminded: boolean;
}

/** Quiet this long after its item ended → close it. */
export const CLOSE_AFTER_QUIET_MS = 8000;
/** No feed routed: remind after this long instead. */
export const REMIND_AFTER_MS = 45_000;

export class SpeechKeeper {
  private mics: Record<SpeechMic, MicState> = {
    lapel: { manual: false, releasedAt: null, lastLoud: 0, reminded: false },
    mc: { manual: false, releasedAt: null, lastLoud: 0, reminded: false },
  };
  private need: SpeechMic | null = null;
  /** Our own mute/unmute, so the desk echo isn't taken for a person's. */
  private ours: Record<SpeechMic, number> = { lapel: 0, mc: 0 };

  constructor(public hasFeed: Record<SpeechMic, boolean>) {}

  /** The live plan item changed. */
  onItem(need: SpeechMic | null, now: number): SpeechAction[] {
    const out: SpeechAction[] = [];
    for (const m of ["lapel", "mc"] as SpeechMic[]) this.mics[m].manual = false;
    const prev = this.need;
    this.need = need;
    if (prev && prev !== need) {
      const s = this.mics[prev];
      s.releasedAt = now;
      s.reminded = false;
    }
    if (need) {
      this.mics[need].releasedAt = null;
      this.ours[need] = now;
      out.push({ type: "open", mic: need, reason: need === "lapel" ? "the message started" : "a transition started" });
    }
    return out;
  }

  /** The desk reported this mic's mute changing. */
  onDeskMute(mic: SpeechMic, now: number) {
    if (now - this.ours[mic] > 2500) this.mics[mic].manual = true;
  }

  /** The mic's own feed level (0..1 peak), when routed. */
  onLevel(mic: SpeechMic, peak: number, now: number) {
    if (peak > 0.02) this.mics[mic].lastLoud = now; // ≈ −34 dBFS: someone talking
  }

  onTick(now: number): SpeechAction[] {
    const out: SpeechAction[] = [];
    for (const m of ["lapel", "mc"] as SpeechMic[]) {
      const s = this.mics[m];
      if (s.releasedAt == null || s.manual || this.need === m) continue;
      if (this.hasFeed[m]) {
        const quietSince = Math.max(s.releasedAt, s.lastLoud);
        if (now - quietSince >= CLOSE_AFTER_QUIET_MS) {
          s.releasedAt = null;
          this.ours[m] = now;
          out.push({ type: "close", mic: m, reason: `quiet for ${Math.round(CLOSE_AFTER_QUIET_MS / 1000)} s after its moment ended` });
        }
      } else if (!s.reminded && now - s.releasedAt >= REMIND_AFTER_MS) {
        s.reminded = true;
        out.push({ type: "remind", mic: m, reason: "the plan moved on and this mic is still open" });
      }
    }
    return out;
  }
}
