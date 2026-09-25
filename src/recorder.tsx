import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { IS_WEB, pcoGet, multitrackMarker, multitrackReveal, multitrackStart, multitrackStatus, multitrackStop, on, type RecLast, type RecLive } from "./lib/tauri";
import { useProDeck } from "./store";
import { usePco } from "./pcoStore";
import { decide, plansFromJson, sameLocalDay, serviceLabel, type AutoState } from "./lib/recorderAuto";

// The multitrack recorder, booth side (the recording itself is Rust:
// src-tauri/src/multitrack.rs). Starts and stops with the service when
// "Record every service" is on, and stamps markers: plan items, songs as
// Playback starts them, the guide's section calls.

interface Ctx {
  recording: boolean;
  /** What the next recording's folder will be called (today's PCO service). */
  label: string;
  live: RecLive | null;
  last: RecLast | null;
  error: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  marker: (text?: string) => Promise<void>;
  reveal: () => void;
}
const C = createContext<Ctx | null>(null);
export const useRecorder = () => useContext(C);

export function RecorderProvider({ children }: { children: ReactNode }) {
  const { settings, status: ppStatus } = useProDeck();
  const { liveItemId, items, plans, selectedPlanId, serviceTypes, selectedServiceTypeId } = usePco();
  const [live, setLive] = useState<RecLive | null>(null);
  const [last, setLast] = useState<RecLast | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const auto = useRef<AutoState>({ recording: false, autoStarted: false, lastBusy: 0, suppressed: false });
  const clockAt = useRef(0);
  const retryAt = useRef(0);
  const liveRef = useRef<string | null>(null);
  liveRef.current = liveItemId;
  const [label, setLabel] = useState("Recording");
  const labelRef = useRef("Recording");
  labelRef.current = label;
  const autoOn = useRef(false);
  autoOn.current = !!settings?.multitrack_auto;
  const songRef = useRef("");
  songRef.current = ((ppStatus.activePresentation as any)?.presentation?.id?.name as string) ?? "";

  const mark = (text: string) => {
    if (auto.current.recording) multitrackMarker(text).catch(() => {});
  };

  useEffect(() => {
    if (IS_WEB) return;
    multitrackStatus()
      .then((s) => {
        auto.current.recording = s.recording;
        setRecording(s.recording);
        setLive(s.live);
        setLast(s.last);
      })
      .catch(() => {});
    const a = on<RecLive | RecLast>("multitrack:status", (v) => {
      if (!v) return;
      if (v.recording) {
        setLive(v as RecLive);
        setRecording(true);
        auto.current.recording = true;
      } else {
        // A stop we didn't ask for (disk guard, 8 hours) mustn't restart at once.
        if (auto.current.recording && liveRef.current) auto.current.suppressed = true;
        setLast(v as RecLast);
        setLive(null);
        setRecording(false);
        auto.current = { ...auto.current, recording: false, autoStarted: false };
      }
    });
    const b = on<string | null>("multitrack:error", (e) => e && setError(e));
    // Playback running: its MIDI clock, or the click heard on the click channel.
    const c = on("follow:mbeat", () => (clockAt.current = Date.now()));
    const g = on("follow:beat", () => (clockAt.current = Date.now()));
    const d = on("follow:mstart", () => {
      clockAt.current = Date.now();
      mark(`▶ ${songRef.current || "Playback started"}`);
    });
    const e = on("follow:mstop", () => mark("■ Playback stopped"));
    const f = on<{ text: string }>("follow:cue", (c) => {
      if (!c?.text) return;
      clockAt.current = Date.now();
      mark(`Guide: ${c.text.trim()}`);
    });
    return () => {
      [a, b, c, d, e, f, g].forEach((u) => u.then((x) => x()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A marker at every plan item.
  useEffect(() => {
    const it = items.find((i) => i.id === liveItemId);
    if (it) mark(`${it.type === "song" ? "Song" : "Item"}: ${it.title}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveItemId]);

  // Today's service, by its Planning Center name: the plan the booth is on
  // if it's today's, else whichever service type has a plan today (21 types
  // here — Men's Conference isn't the Sunday one). No plan today: the
  // booth's plan, marked as a rehearsal.
  useEffect(() => {
    if (IS_WEB) return;
    let dead = false;
    const resolve = async () => {
      const now = Date.now();
      const stName = (id: string | null) => serviceTypes.find((t) => t.id === id)?.name ?? "";
      const sel = plans.find((p) => p.id === selectedPlanId);
      if (sel && sameLocalDay(sel.sortDate, now)) {
        setLabel(serviceLabel(stName(selectedServiceTypeId), sel.title, sel.date));
        return;
      }
      for (const st of serviceTypes) {
        if (dead) return;
        try {
          const [fut, past] = await Promise.all([
            pcoGet(`services/v2/service_types/${st.id}/plans?filter=future&order=sort_date&per_page=1`).catch(() => null),
            pcoGet(`services/v2/service_types/${st.id}/plans?filter=past&order=-sort_date&per_page=1`).catch(() => null),
          ]);
          const hit = [...plansFromJson(fut), ...plansFromJson(past)].find((p) => sameLocalDay(p.sortDate, now));
          if (hit) {
            if (!dead) setLabel(serviceLabel(st.name, hit.title, hit.dates));
            return;
          }
        } catch {
          /* PCO offline — keep looking, then fall back */
        }
      }
      if (!dead) setLabel(sel ? `${serviceLabel(stName(selectedServiceTypeId), sel.title, sel.date)} (rehearsal)` : "Recording");
    };
    resolve();
    const iv = setInterval(resolve, 15 * 60_000);
    return () => {
      dead = true;
      clearInterval(iv);
    };
  }, [serviceTypes, plans, selectedPlanId, selectedServiceTypeId]);

  async function doStart(autoStarted: boolean) {
    const label = labelRef.current;
    try {
      const r = await multitrackStart(label);
      auto.current = { ...auto.current, recording: true, autoStarted };
      setRecording(true);
      setError(r.note ?? "");
      const it = items.find((i) => i.id === liveRef.current);
      if (it) multitrackMarker(`${it.type === "song" ? "Song" : "Item"}: ${it.title}`).catch(() => {});
    } catch (e) {
      setError(String(e));
      // Not recording after all. An automatic start tries again in 15 s: at
      // launch Planning Center LIVE is back before audio capture is running.
      auto.current = { ...auto.current, recording: false, autoStarted: false };
      if (autoStarted) retryAt.current = Date.now() + 15_000;
    }
  }
  async function doStop(byHand: boolean) {
    const busy = !!liveRef.current || Date.now() - clockAt.current < 15_000;
    if (byHand && busy) auto.current.suppressed = true;
    try {
      await multitrackStop();
    } catch (e) {
      setError(String(e));
    }
  }

  // Record every service.
  useEffect(() => {
    if (IS_WEB) return;
    const iv = setInterval(() => {
      if (!autoOn.current) return;
      const now = Date.now();
      if (now < retryAt.current) return;
      const busy = !!liveRef.current || now - clockAt.current < 15_000;
      const r = decide(auto.current, busy, now);
      auto.current = r.state;
      if (r.action === "start") {
        auto.current.recording = true; // no double start while the call is in flight
        doStart(true);
      } else if (r.action === "stop") doStop(false);
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: Ctx = {
    recording,
    label,
    live,
    last,
    error,
    start: () => doStart(false),
    stop: () => doStop(true),
    marker: async (text?: string) => {
      await multitrackMarker(text?.trim() || "Marker").catch((e) => setError(String(e)));
    },
    reveal: () => multitrackReveal().catch((e) => setError(String(e))),
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}

export const fmtClock = (secs: number) => {
  const s = Math.floor(secs);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
