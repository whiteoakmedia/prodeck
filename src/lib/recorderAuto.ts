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

/** Same calendar day, here. */
export function sameLocalDay(iso: string | undefined, now: number): boolean {
  if (!iso) return false;
  const a = new Date(iso);
  const b = new Date(now);
  return !isNaN(+a) && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** The service's name for a folder: the plan's own title when it has one
 *  ("Men's Conference"), with the service type in front when that adds
 *  something ("Sunday Services – Grace, week 3"). A title that is only the
 *  date, or PCO's "Untitled plan", isn't a name. */
export function serviceLabel(serviceType: string | null | undefined, planTitle: string | null | undefined, planDates?: string): string {
  const st = (serviceType ?? "").trim();
  let t = (planTitle ?? "").trim();
  if (!t || t === "Untitled plan" || (planDates && t === planDates.trim()) || /^\w+ \d{1,2}(,? \d{4})?$/.test(t)) t = "";
  let out = !t ? st : !st || t.toLowerCase().includes(st.toLowerCase()) ? t : st.toLowerCase().includes(t.toLowerCase()) ? st : `${st} – ${t}`;
  out = out.replace(/[/:\\]/g, "-").trim();
  return out.slice(0, 60) || "Recording";
}

/** A plan from Planning Center's JSON, as the recorder needs it. */
export interface PlanPick {
  title: string;
  dates: string;
  sortDate: string;
}
export function plansFromJson(j: any): PlanPick[] {
  const data = j?.data;
  if (!Array.isArray(data)) return [];
  return data.map((d: any) => ({ title: d.attributes?.title ?? "", dates: d.attributes?.dates ?? "", sortDate: d.attributes?.sort_date ?? "" }));
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
