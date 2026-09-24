import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { avantisSetFader, avantisSetMute, followDebugLog, IS_WEB, on, type AvantisSnapshot } from "./lib/tauri";
import { useProDeck } from "./store";
import { usePco } from "./pcoStore";
import { BeatClock, type BeatEvent } from "./lib/rig";
import { cueKey, DEFAULT_RULES, faderAt, parseRules, plan, type Planned } from "./lib/automix";
import { dbToRaw, rawToDb } from "./lib/autopilotMix";

/** What the automix may move: DCAs and groups (mono and stereo). */
const MIXABLE = /^(dca|grp|sgrp):/;

// The automix, live (see lib/automix.ts). Armed by hand, never at launch:
// arming captures the operator's current DCA positions as home. Booth only.

export interface DcaInfo {
  name: string;
  id: string;
  home: number | null; // dB, captured at arm
  now: number | null; // dB, last known
  letGo: boolean;
}
interface Ctx {
  armed: boolean;
  arm: () => void;
  disarm: () => void;
  goHome: () => void;
  dcas: DcaInfo[];
  last: string;
  pending: Planned | null;
  bpm: number | null;
  log: { at: number; text: string }[];
}
const C = createContext<Ctx | null>(null);
export const useAutomix = () => useContext(C);

export function AutomixProvider({ children }: { children: ReactNode }) {
  const { settings } = useProDeck();
  const { liveItemId, items } = usePco();
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  armedRef.current = armed;
  const [log, setLog] = useState<{ at: number; text: string }[]>([]);
  const [last, setLast] = useState("");
  const [pending, setPending] = useState<Planned | null>(null);
  const [bpm, setBpm] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const clock = useRef(new BeatClock());
  const names = useRef<Record<string, string>>({}); // dca name → id
  const faders = useRef<Record<string, number>>({}); // id → raw
  const home = useRef<Record<string, number>>({}); // name → dB
  const letGo = useRef(new Set<string>());
  const sent = useRef(new Map<string, { raw: number; t: number }>());
  const active = useRef<{ p: Planned; from: Record<string, number> | null } | null>(null);
  const lastKey = useRef("");
  const lastClockAt = useRef(0);
  const fxName = useRef("All FX");
  fxName.current = settings?.automix_fx_mute ?? "All FX";
  /** The FX DCA: muted between songs so reverb tails don't hang over the talking. */
  const fxMute = (muted: boolean, why: string) => {
    if (!armedRef.current || !fxName.current) return;
    const id = names.current[fxName.current];
    if (!id) return;
    avantisSetMute(id, muted)
      .then(() => say(`${muted ? "Muted" : "Unmuted"} ${fxName.current}: ${why}.`))
      .catch(() => {});
  };
  const rulesRef = useRef(parseRules(DEFAULT_RULES));
  rulesRef.current = parseRules(settings?.automix_rules?.trim() || DEFAULT_RULES);

  const say = (text: string) => {
    setLog((l) => [{ at: Date.now(), text }, ...l].slice(0, 50));
    followDebugLog({ kind: "automix", text }).catch(() => {});
  };
  const songName = () => items.find((i) => i.id === liveItemId)?.title ?? "";

  // The desk: names, positions, and a person's hand on a DCA we drive.
  useEffect(() => {
    if (IS_WEB) return;
    const u = on<AvantisSnapshot>("avantis:state", (s) => {
      if (!s) return;
      const now = Date.now();
      for (const [id, nm] of Object.entries(s.names ?? {})) if (MIXABLE.test(id) && nm) names.current[String(nm)] = id;
      const since = s.connectedAt ?? Infinity;
      for (const [id, raw] of Object.entries(s.faders ?? {})) {
        if (raw == null || !MIXABLE.test(id)) continue;
        // Only a position the desk reported this connection is the
        // operator's; a cached one may be days old.
        if ((s.faderSeen?.[id] ?? 0) < since) continue;
        const prev = faders.current[id];
        faders.current[id] = raw as number;
        const name = Object.keys(names.current).find((n) => names.current[n] === id);
        if (!name || prev === raw) continue;
        const mine = sent.current.get(id);
        const ours = mine && (now - mine.t < 1500 || Math.abs(mine.raw - (raw as number)) <= 1);
        if (!ours) {
          // A person moved it: learn from it, and (armed) let go of it.
          followDebugLog({ kind: "mix-touch", dca: name, from: prev != null ? rawToDb(prev) : null, to: rawToDb(raw as number), section: lastKey.current, song: songName() }).catch(() => {});
          if (armedRef.current && home.current[name] != null && !letGo.current.has(name)) {
            letGo.current.add(name);
            say(`You moved ${name} — let go of it for the rest of this song.`);
          }
        }
      }
      setTick((x) => x + 1);
    });
    return () => {
      u.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The clock: MIDI Clock first, the audio click as backup.
  useEffect(() => {
    if (IS_WEB) return;
    const a = on<BeatEvent>("follow:beat", (b) => b && clock.current.onBeat(b));
    const m = on<{ t: number; beat: number | null; bpm: number | null }>("follow:mbeat", (b) => {
      if (!b) return;
      lastClockAt.current = Date.now();
      clock.current.onMidiBeat(b.t, b.beat, b.bpm);
      setBpm(clock.current.bpm());
    });
    const s = on<{ t: number }>("follow:mstart", (b) => {
      if (!b) return;
      clock.current.onMidiStart(b.t);
      lastClockAt.current = Date.now();
      fxMute(false, "Playback started the song");
    });
    const x = on("follow:mstop", () => {
      clock.current.onMidiStop();
      fxMute(true, "Playback stopped — the song ended");
    });
    return () => {
      [a, m, s, x].forEach((u) => u.then((f) => f()));
    };
  }, []);

  // The guide: a moment called → a move planned for its downbeat.
  useEffect(() => {
    if (IS_WEB) return;
    const u = on<{ text: string; t0: number; t1: number }>("follow:cue", (c) => {
      if (!c) return;
      const key = cueKey(c.text);
      if (!key) return;
      setLast(`${c.text} → ${key}`);
      if (!armedRef.current) return;
      lastKey.current = key;
      const P = clock.current.period ?? 600;
      const at = (clock.current.hasBar() ? clock.current.nextDownbeat(c.t0 + 1.5 * P) : null) ?? c.t1 + 4 * P;
      const p = plan(key, rulesRef.current, home.current, letGo.current, at, P);
      if (!p) {
        say(`Heard "${c.text}" — no move for ${key}.`);
        return;
      }
      active.current = { p, from: null };
      setPending(p);
      const desc = Object.entries(p.targets)
        .map(([n, db]) => `${n} ${(db - (home.current[n] ?? db)).toFixed(1)}`)
        .join(", ");
      say(`Heard "${c.text}" → ${key}: ${desc} (from your positions) on the downbeat in ${Math.max(0, (at - Date.now()) / 1000).toFixed(1)} s.`);
    });
    return () => {
      u.then((f) => f());
    };
  }, []);

  // A new plan item: hand every DCA back; and without Playback's clock,
  // the plan says when songs start and end (for the FX mute).
  const wasSong = useRef<boolean | null>(null);
  useEffect(() => {
    if (letGo.current.size) letGo.current.clear();
    const isSong = items.find((i) => i.id === liveItemId)?.type === "song";
    const prev = wasSong.current;
    wasSong.current = isSong;
    if (prev == null) return;
    const clockLive = Date.now() - lastClockAt.current < 10_000;
    if (prev && !isSong) fxMute(true, "the plan left the songs");
    else if (!prev && isSong && !clockLive) fxMute(false, "the plan reached a song");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveItemId]);

  // Carry out the active move: 20 steps a second while fading.
  useEffect(() => {
    if (!armed) return;
    const iv = setInterval(() => {
      const a = active.current;
      if (!a) return;
      const now = Date.now();
      if (now < a.p.at) return;
      if (!a.from) {
        a.from = {};
        for (const n of Object.keys(a.p.targets)) {
          const id = names.current[n];
          const raw = id ? faders.current[id] : undefined;
          a.from[n] = raw != null ? rawToDb(raw) : a.p.targets[n];
        }
      }
      const want = faderAt(a.p, a.from, now);
      for (const [n, db] of Object.entries(want)) {
        const id = names.current[n];
        if (!id || letGo.current.has(n)) continue;
        const raw = dbToRaw(db);
        if (faders.current[id] === raw) continue;
        sent.current.set(id, { raw, t: now });
        faders.current[id] = raw;
        avantisSetFader(id, raw).catch(() => {});
      }
      if (now >= a.p.at + a.p.fadeMs) {
        active.current = null;
        setPending(null);
      }
    }, 50);
    return () => clearInterval(iv);
  }, [armed]);

  const dcas: DcaInfo[] = Object.entries(names.current)
    .filter(([n]) => Object.values(rulesRef.current).some((m) => n in m))
    .map(([name, id]) => ({
      name,
      id,
      home: home.current[name] ?? null,
      now: faders.current[id] != null ? rawToDb(faders.current[id]) : null,
      letGo: letGo.current.has(name),
    }));
  void tick;

  const value: Ctx = {
    armed,
    arm: () => {
      home.current = {};
      letGo.current.clear();
      for (const d of dcas) if (d.now != null) home.current[d.name] = d.now;
      setArmed(true);
      say(`Armed. Home = your positions now: ${Object.entries(home.current).map(([n, db]) => `${n} ${db.toFixed(1)}`).join(", ") || "none known — move each DCA once"}.`);
    },
    disarm: () => {
      setArmed(false);
      active.current = null;
      setPending(null);
      say("Disarmed. The desk is all yours.");
    },
    goHome: () => {
      const now = Date.now();
      active.current = { p: { key: "home", at: now, fadeMs: 1500, targets: { ...home.current } }, from: null };
      say("Back to your positions.");
    },
    dcas,
    last,
    pending,
    bpm,
    log,
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
