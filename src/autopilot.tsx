import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { avantisSetMute, followDebugLog, IS_WEB, on, type AvantisSnapshot } from "./lib/tauri";
import { useProDeck } from "./store";
import { usePco } from "./pcoStore";
import { DEFAULT_LAPEL_WORDS, DEFAULT_MC_WORDS, micFor, parseWords, SpeechKeeper, type SpeechAction, type SpeechMic } from "./lib/speechMics";

// Autopilot, part 1: the speech mics follow the plan. The lead-vocal scene
// per song already lives in pcoStore (Desk Scenes toggle). Booth only — a
// web client never drives the desk.

export interface AutopilotLogLine {
  at: number;
  text: string;
}
interface Ctx {
  log: AutopilotLogLine[];
  need: SpeechMic | null;
}
const C = createContext<Ctx>({ log: [], need: null });
export const useAutopilot = () => useContext(C);

export function AutopilotProvider({ children }: { children: ReactNode }) {
  const { settings } = useProDeck();
  const { liveItemId, items: displayItems } = usePco();
  const [log, setLog] = useState<AutopilotLogLine[]>([]);
  const [need, setNeed] = useState<SpeechMic | null>(null);
  const on_ = !IS_WEB && !!settings?.autopilot_speech;
  const cfgRef = useRef({ lapel: "input:44", mc: "input:43", lapelAudio: 0, mcAudio: 0 });
  cfgRef.current = {
    lapel: settings?.autopilot_lapel || "input:44",
    mc: settings?.autopilot_mc || "input:43",
    lapelAudio: settings?.autopilot_lapel_audio ?? 0,
    mcAudio: settings?.autopilot_mc_audio ?? 0,
  };
  const keeper = useRef<SpeechKeeper | null>(null);
  const firstItem = useRef<string | null | undefined>(undefined);

  const say = (text: string) => {
    setLog((l) => [{ at: Date.now(), text }, ...l].slice(0, 30));
    followDebugLog({ kind: "autopilot", text }).catch(() => {});
  };
  const act = (acts: SpeechAction[]) => {
    for (const a of acts) {
      const id = a.mic === "lapel" ? cfgRef.current.lapel : cfgRef.current.mc;
      const name = a.mic === "lapel" ? "Lapel" : "8 MC";
      if (a.type === "remind") {
        say(`${name} is still open — ${a.reason}.`);
        continue;
      }
      avantisSetMute(id, a.type === "close")
        .then(() => say(`${a.type === "open" ? "Opened" : "Closed"} ${name}: ${a.reason}.`))
        .catch((e) => say(`Couldn't ${a.type} ${name}: ${String(e)}`));
    }
  };

  useEffect(() => {
    if (!on_) {
      keeper.current = null;
      return;
    }
    keeper.current = new SpeechKeeper({ lapel: cfgRef.current.lapelAudio > 0, mc: cfgRef.current.mcAudio > 0 });
    firstItem.current = undefined;
  }, [on_, settings?.autopilot_lapel_audio, settings?.autopilot_mc_audio]);

  // The live plan item.
  useEffect(() => {
    const k = keeper.current;
    if (!k) return;
    // Skip the first observation after launch/arming: a mid-service restart
    // must not reopen a mic someone just closed.
    if (firstItem.current === undefined) {
      firstItem.current = liveItemId;
      return;
    }
    if (firstItem.current === liveItemId) return;
    firstItem.current = liveItemId;
    const item = displayItems.find((i) => i.id === liveItemId) ?? null;
    const cfg = { lapelWords: parseWords(settings?.autopilot_lapel_words, DEFAULT_LAPEL_WORDS), mcWords: parseWords(settings?.autopilot_mc_words, DEFAULT_MC_WORDS) };
    const n = micFor(item, cfg);
    setNeed(n);
    act(k.onItem(n, Date.now()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveItemId, on_]);

  // The desk's mute reports (a person's press takes that mic over) and the
  // mics' own feeds (quiet → safe to close).
  useEffect(() => {
    if (!on_) return;
    const seen: Record<string, number> = {};
    const u1 = on<AvantisSnapshot>("avantis:state", (s) => {
      const k = keeper.current;
      if (!k || !s?.muteSeen) return;
      for (const m of ["lapel", "mc"] as SpeechMic[]) {
        const id = m === "lapel" ? cfgRef.current.lapel : cfgRef.current.mc;
        const t = s.muteSeen[id];
        if (t && seen[id] && t > seen[id]) k.onDeskMute(m, Date.now());
        if (t) seen[id] = t;
      }
    });
    const u2 = on<number[]>("audio:channels", (lv) => {
      const k = keeper.current;
      if (!k || !Array.isArray(lv)) return;
      const now = Date.now();
      const { lapelAudio, mcAudio } = cfgRef.current;
      if (lapelAudio > 0) k.onLevel("lapel", lv[lapelAudio - 1] ?? 0, now);
      if (mcAudio > 0) k.onLevel("mc", lv[mcAudio - 1] ?? 0, now);
    });
    const tick = setInterval(() => {
      const k = keeper.current;
      if (k) act(k.onTick(Date.now()));
    }, 1000);
    return () => {
      u1.then((f) => f());
      u2.then((f) => f());
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on_]);

  return <C.Provider value={{ log, need }}>{children}</C.Provider>;
}
