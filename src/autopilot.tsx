import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { avantisSetFader, avantisSetMute, followDebugLog, IS_WEB, on, type AvantisSnapshot } from "./lib/tauri";
import { useProDeck } from "./store";
import { usePco } from "./pcoStore";
import { toDbfs } from "./lib/audioMeter";
import { DEFAULT_LAPEL_WORDS, DEFAULT_MC_WORDS, micFor, parseWords, SpeechKeeper, type SpeechAction, type SpeechMic } from "./lib/speechMics";
import { dbToRaw, LapelRide, rawToDb, RoomHold } from "./lib/autopilotMix";

// Autopilot. Part 1: the speech mics follow the plan (lapel by fader, MC by
// mute). Part 2: the lapel is ridden while he preaches (steady speech, the
// room at 65–70, a feedback pull) and the room is held at 90–93 in songs
// with LR + Sub. Everything lets go the moment a person touches that fader.
// The lead-vocal scene per song lives in pcoStore (Desk Scenes). Booth only.

export interface AutopilotLogLine {
  at: number;
  text: string;
}
interface Ctx {
  log: AutopilotLogLine[];
  need: SpeechMic | null;
  spl: number | null;
  let_go: string[];
}
const C = createContext<Ctx>({ log: [], need: null, spl: null, let_go: [] });
export const useAutopilot = () => useContext(C);

export function AutopilotProvider({ children }: { children: ReactNode }) {
  const { settings } = useProDeck();
  const { liveItemId, items: displayItems } = usePco();
  const [log, setLog] = useState<AutopilotLogLine[]>([]);
  const [need, setNeed] = useState<SpeechMic | null>(null);
  const [spl, setSpl] = useState<number | null>(null);
  const [letGo, setLetGo] = useState<string[]>([]);
  const speechOn = !IS_WEB && !!settings?.autopilot_speech;
  const roomOn = !IS_WEB && !!settings?.autopilot_room;
  const cfg = useRef({
    lapel: "input:44",
    mc: "input:43",
    lapelAudio: 0,
    mcAudio: 0,
    lapelHome: -5,
    roomFader: "dca:16",
    roomHome: 0,
    worship: [90, 93] as [number, number],
    message: [65, 70] as [number, number],
    cal: 100,
  });
  cfg.current = {
    lapel: settings?.autopilot_lapel || "input:44",
    mc: settings?.autopilot_mc || "input:43",
    lapelAudio: settings?.autopilot_lapel_audio ?? 0,
    mcAudio: settings?.autopilot_mc_audio ?? 0,
    lapelHome: settings?.autopilot_lapel_home_db ?? -5,
    roomFader: settings?.autopilot_room_fader || "dca:16",
    roomHome: settings?.autopilot_room_home_db ?? 0,
    worship: [settings?.autopilot_worship_min ?? 90, settings?.autopilot_worship_max ?? 93],
    message: [settings?.autopilot_message_min ?? 65, settings?.autopilot_message_max ?? 70],
    cal: settings?.spl_calibration ?? 100,
  };
  const keeper = useRef<SpeechKeeper | null>(null);
  const ride = useRef<LapelRide | null>(null);
  const hold = useRef<RoomHold | null>(null);
  const firstItem = useRef<string | null | undefined>(undefined);
  const isSong = useRef(false);
  // What we last sent each fader, to tell our moves from a person's.
  const sent = useRef(new Map<string, { raw: number; t: number }>());
  const frozen = useRef(new Set<string>());
  const talkingAt = useRef(0);

  const say = (text: string) => {
    setLog((l) => [{ at: Date.now(), text }, ...l].slice(0, 40));
    followDebugLog({ kind: "autopilot", text }).catch(() => {});
  };
  const setFader = (id: string, raw: number) => {
    sent.current.set(id, { raw, t: Date.now() });
    return avantisSetFader(id, raw);
  };
  /** A short fade instead of a jump. */
  const ramp = async (id: string, from: number, to: number, ms = 500) => {
    const steps = Math.max(1, Math.round(ms / 50));
    for (let k = 1; k <= steps; k++) {
      await setFader(id, Math.round(from + ((to - from) * k) / steps)).catch(() => {});
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  const lastRaw = useRef(new Map<string, number>());

  /** A desk command, retried every 2 s for up to 30 s — after a ProDeck
   *  restart the desk link takes a moment, and a transition mic must still
   *  open (rehearsal, 24 Sep: "not connected to the console", twice). */
  const retry = async (f: () => Promise<unknown>, what: string) => {
    for (let k = 0; k < 15; k++) {
      try {
        await f();
        return true;
      } catch (e) {
        if (k === 0) say(`${what} — the desk isn't answering yet, retrying.`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    say(`${what} — gave up after 30 s: ${"the desk never answered"}.`);
    return false;
  };
  const act = (acts: SpeechAction[]) => {
    for (const a of acts) {
      const c = cfg.current;
      const name = a.mic === "lapel" ? "Lapel" : "8 MC";
      if (a.type === "remind") {
        say(`${name} is still open — ${a.reason}.`);
        continue;
      }
      if (a.mic === "lapel") {
        // The lapel lives on its fader: parked down, preaching at home.
        const from = lastRaw.current.get(c.lapel) ?? 0;
        if (a.type === "open") {
          frozen.current.delete(c.lapel);
          setLetGo((l) => l.filter((x) => x !== c.lapel));
          ride.current = new LapelRide(c.lapelHome, c.message);
          retry(() => avantisSetMute(c.lapel, false), "Unmuting the lapel");
          ramp(c.lapel, from, dbToRaw(c.lapelHome)).then(() => say(`Lapel up to ${c.lapelHome} dB: ${a.reason}.`));
        } else {
          ride.current = null;
          ramp(c.lapel, from, 0, 1000).then(() => say(`Lapel down: ${a.reason}.`));
        }
        continue;
      }
      retry(() => avantisSetMute(c.mc, a.type === "close"), `${a.type === "open" ? "Opening" : "Closing"} ${name}`).then((ok) => {
        if (ok) say(`${a.type === "open" ? "Opened" : "Closed"} ${name}: ${a.reason}.`);
      });
    }
  };

  useEffect(() => {
    keeper.current = speechOn ? new SpeechKeeper({ lapel: cfg.current.lapelAudio > 0, mc: cfg.current.mcAudio > 0 }) : null;
    firstItem.current = undefined;
  }, [speechOn, settings?.autopilot_lapel_audio, settings?.autopilot_mc_audio]);
  useEffect(() => {
    hold.current = roomOn ? new RoomHold(cfg.current.roomHome, cfg.current.worship) : null;
    frozen.current.delete(cfg.current.roomFader);
  }, [roomOn, settings?.autopilot_room_home_db]);

  // The live plan item.
  useEffect(() => {
    const item = displayItems.find((i) => i.id === liveItemId) ?? null;
    isSong.current = item?.type === "song";
    if (isSong.current) {
      hold.current?.reset();
      if (frozen.current.delete(cfg.current.roomFader)) setLetGo((l) => l.filter((x) => x !== cfg.current.roomFader));
    }
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
    const words = { lapelWords: parseWords(settings?.autopilot_lapel_words, DEFAULT_LAPEL_WORDS), mcWords: parseWords(settings?.autopilot_mc_words, DEFAULT_MC_WORDS) };
    const n = micFor(item, words);
    setNeed(n);
    act(k.onItem(n, Date.now()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveItemId, speechOn]);

  // Readings: the desk, the speech feeds, feedback, the room.
  useEffect(() => {
    if (!speechOn && !roomOn) return;
    const seen: Record<string, number> = {};
    const u1 = on<AvantisSnapshot>("avantis:state", (s) => {
      if (!s) return;
      const now = Date.now();
      for (const [id, raw] of Object.entries(s.faders ?? {})) {
        if (raw == null) continue;
        lastRaw.current.set(id, raw as number);
        // A fader we drive moved somewhere we didn't send it: a person's
        // hand. Let go of it.
        const mine = sent.current.get(id);
        const driven = id === cfg.current.roomFader || id === cfg.current.lapel;
        if (driven && mine && now - mine.t > 1500 && Math.abs((raw as number) - mine.raw) > 1 && !frozen.current.has(id)) {
          frozen.current.add(id);
          setLetGo((l) => [...l, id]);
          if (id === cfg.current.lapel) ride.current = null;
          say(`You moved ${id === cfg.current.lapel ? "the lapel" : "LR + Sub"} — Autopilot let go of it${id === cfg.current.lapel ? " until the next message" : " until the next song"}.`);
        }
      }
      const k = keeper.current;
      if (k && s.muteSeen) {
        for (const m of ["lapel", "mc"] as SpeechMic[]) {
          const id = m === "lapel" ? cfg.current.lapel : cfg.current.mc;
          const t = s.muteSeen[id];
          if (t && seen[id] && t > seen[id]) k.onDeskMute(m, now);
          if (t) seen[id] = t;
        }
      }
    });
    const u2 = on<{ mic: SpeechMic; db: number }>("autopilot:speech", (e) => {
      if (!e) return;
      const now = Date.now();
      keeper.current?.onLevel(e.mic, e.db, now);
      if (e.mic === "lapel") {
        if (e.db > -45) talkingAt.current = now;
        ride.current?.onSpeech(e.db, now);
      }
    });
    const u3 = on<{ mic: SpeechMic; hz: number; db: number }>("autopilot:ring", (e) => {
      if (!e || e.mic !== "lapel" || !ride.current || frozen.current.has(cfg.current.lapel)) return;
      const db = ride.current.onRing(Date.now());
      setFader(cfg.current.lapel, dbToRaw(db)).catch(() => {});
      say(`Feedback on the lapel at ${Math.round(e.hz)} Hz — pulled it to ${db.toFixed(1)} dB for 20 s.`);
    });
    const u4 = on<{ slowA?: number }>("audio:level", (m) => {
      if (typeof m?.slowA !== "number") return;
      const now = Date.now();
      const dbA = toDbfs(m.slowA) + cfg.current.cal;
      setSpl(dbA);
      ride.current?.onRoom(dbA, now, now - talkingAt.current < 1000);
      if (isSong.current) hold.current?.onRoom(dbA, now);
    });
    const tick = setInterval(() => {
      const now = Date.now();
      const k = keeper.current;
      if (k) act(k.onTick(now));
      const c = cfg.current;
      if (ride.current && k?.isOpen("lapel") && !frozen.current.has(c.lapel)) {
        const db = ride.current.tick(now);
        if (db != null) setFader(c.lapel, dbToRaw(db)).catch(() => {});
      }
      if (hold.current && isSong.current && !frozen.current.has(c.roomFader)) {
        const db = hold.current.tick(now);
        if (db != null) {
          const from = lastRaw.current.get(c.roomFader);
          setFader(c.roomFader, dbToRaw(db))
            .then(() => say(`Room ${from != null ? `${rawToDb(from).toFixed(1)} → ` : ""}${db.toFixed(1)} dB on LR + Sub to stay in ${c.worship[0]}–${c.worship[1]}.`))
            .catch(() => {});
        }
      }
    }, 500);
    return () => {
      u1.then((f) => f());
      u2.then((f) => f());
      u3.then((f) => f());
      u4.then((f) => f());
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speechOn, roomOn]);

  return <C.Provider value={{ log, need, spl, let_go: letGo }}>{children}</C.Provider>;
}
