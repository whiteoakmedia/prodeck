// When the multitrack recorder starts and stops by itself (booth, with
// "Record every service" on). Pure, clock-injected; tested.
//
// Busy = Planning Center LIVE has an item up, or Playback is running (its MIDI
// clock, the click heard on the click channel, or a guide call).
// Busy starts a recording. It stops 20 minutes after the last busy moment,
// and only a recording it started itself (a manual one is yours to stop).
// Stopping by hand while busy keeps it from starting again until things
// have been quiet for 5 minutes.

export const STOP_AFTER_MS = 20 * 60_000;
export const REARM_AFTER_MS = 5 * 60_000;

export interface AutoState {
  recording: boolean;
  autoStarted: boolean;
  /** Last moment the service was busy (ms). */
  lastBusy: number;
  /** Set when the operator stopped it by hand (or the disk guard did) while busy. */
  suppressed: boolean;
}

export function decide(s: AutoState, busy: boolean, now: number): { action: "start" | "stop" | null; state: AutoState } {
  const st = { ...s };
  if (busy) st.lastBusy = now;
  if (st.suppressed && !busy && now - st.lastBusy >= REARM_AFTER_MS) st.suppressed = false;
  if (!st.recording && busy && !st.suppressed) return { action: "start", state: st };
  if (st.recording && st.autoStarted && !busy && now - st.lastBusy >= STOP_AFTER_MS) return { action: "stop", state: st };
  return { action: null, state: st };
}

/** A folder label: the plan's title when there's a live plan, else Rehearsal. */
export function sessionLabel(planTitle: string | null | undefined, planLive: boolean): string {
  if (planLive && planTitle?.trim()) return planTitle.trim();
  return planLive ? "Service" : "Rehearsal";
}

/** Track names ProDeck can already work out from its own settings. */
export function namesFromSettings(s: {
  audio_measure_channels?: number[];
  stream_report_channels?: number[];
  follow_click_channel?: number;
  follow_guide_channel?: number;
  autopilot_lapel_audio?: number;
  autopilot_mc_audio?: number;
  audio_mic_channels?: Record<string, number>;
  automix_feeds?: string;
}): Record<string, string> {
  const out: Record<string, string> = {};
  const pair = (chs: number[] | undefined, base: string) => {
    if (!chs?.length) return;
    if (chs.length === 2) {
      out[String(chs[0])] = `${base} L`;
      out[String(chs[1])] = `${base} R`;
    } else chs.forEach((c, i) => (out[String(c)] = chs.length > 1 ? `${base} ${i + 1}` : base));
  };
  pair(s.audio_measure_channels, "Room");
  pair(s.stream_report_channels, "Stream");
  if (s.follow_click_channel) out[String(s.follow_click_channel)] = "Click";
  if (s.follow_guide_channel) out[String(s.follow_guide_channel)] = "Guide";
  if (s.autopilot_lapel_audio) out[String(s.autopilot_lapel_audio)] = "Lapel";
  if (s.autopilot_mc_audio) out[String(s.autopilot_mc_audio)] = "8 MC";
  for (const [mic, ch] of Object.entries(s.audio_mic_channels ?? {})) out[String(ch)] = `Vox ${mic}`;
  for (const part of (s.automix_feeds ?? "").split(/[;\n]/)) {
    const [k, v] = part.split(":");
    if (!v) continue;
    const chs = v.split(",").map((x) => parseInt(x.trim(), 10)).filter((x) => x > 0);
    chs.forEach((c, i) => {
      if (!out[String(c)]) out[String(c)] = chs.length > 1 ? `${k.trim()} ${i + 1}` : k.trim();
    });
  }
  return out;
}

/** "9: Kick IN" lines ⇄ the names map. */
export function parseNames(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(\d+)\s*[:=]\s*(.+?)\s*$/);
    if (m && +m[1] >= 1 && +m[1] <= 128) out[String(+m[1])] = m[2];
  }
  return out;
}
export function formatNames(names: Record<string, string>): string {
  return Object.entries(names)
    .sort((a, b) => +a[0] - +b[0])
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}
