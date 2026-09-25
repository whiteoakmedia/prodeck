import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { automixStoreLoad, automixStoreSave, avantisSetFader, avantisSetMute, followDebugLog, IS_WEB, on, type AvantisSnapshot } from "./lib/tauri";
import { useProDeck } from "./store";
import { usePco } from "./pcoStore";
import { BeatClock, type BeatEvent } from "./lib/rig";
import { barBeat, confirms, cueKey, DEFAULT_RULES, faderAt, parseRules, plan, recordSection, type MapSection, type Planned, type SongMap } from "./lib/automix";
import { dbToRaw, rawToDb } from "./lib/autopilotMix";

/** What the automix may move: DCAs, groups (mono and stereo), and input
 *  channels — those by number ("ch 10"), since desk names repeat. */
const MIXABLE = /^(dca|grp|sgrp|input):/;

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
  const { settings, status: ppStatus } = useProDeck();
  // The song is whatever ProPresenter has up (rehearsal has no live plan).
  const songRef = useRef<{ id: string; name: string } | null>(null);
  {
    const p = (ppStatus.activePresentation as any)?.presentation?.id;
    songRef.current = p?.uuid ? { id: p.uuid, name: p.name ?? "" } : null;
  }
  // Per-song memory: section maps (beats from Play) and chorus levels.
  const store = useRef<{ maps: Record<string, SongMap>; homes: Record<string, Record<string, number>> }>({ maps: {}, homes: {} });
  useEffect(() => {
    if (IS_WEB) return;
    automixStoreLoad()
      .then((v) => (store.current = { maps: v?.maps ?? {}, homes: v?.homes ?? {} }))
      .catch(() => {});
  }, []);
  const saveStore = () => automixStoreSave(store.current).catch(() => {});
  // This run of the song (from Playback's Start).
  const run = useRef<{ startT: number; song: { id: string; name: string } | null; sections: MapSection[] } | null>(null);
  const schedule = useRef<(MapSection & { done: boolean })[] | null>(null);
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
  const names = useRef<Record<string, string>>({}); // dca/group name, or "ch N" → id
  const deskName = useRef<Record<string, string>>({}); // input id → its name on the desk
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
  const songName = () => run.current?.song?.name || songRef.current?.name || items.find((i) => i.id === liveItemId)?.title || "";

  /** Leaving a chorus: these are the operator's chorus levels for this song. */
  const sectionChanged = (next: string) => {
    const song = run.current?.song ?? songRef.current;
    if (lastKey.current === "chorus" && next !== "chorus" && song) {
      const snap: Record<string, number> = {};
      for (const [name, id] of Object.entries(names.current)) {
        if (!Object.values(rulesRef.current).some((m) => name in m)) continue;
        const raw = faders.current[id];
        if (raw != null) snap[name] = Math.round(rawToDb(raw) * 10) / 10;
      }
      if (Object.keys(snap).length) store.current.homes[song.id] = { ...(store.current.homes[song.id] ?? {}), ...snap };
    }
    lastKey.current = next;
  };

  /** Start a move now or on its downbeat. */
  const startMove = (key: string, at: number, why: string) => {
    const P = clock.current.period ?? 600;
    const p = plan(key, rulesRef.current, home.current, letGo.current, at, P);
    if (!p) {
      say(`${why} — no move for ${key}.`);
      return;
    }
    active.current = { p, from: null };
    setPending(p);
    const desc = Object.entries(p.targets)
      .map(([n, db]) => `${n} ${(db - (home.current[n] ?? db)).toFixed(1)}`)
      .join(", ");
    const inS = (at - Date.now()) / 1000;
    say(`${why} → ${key}: ${desc || "—"} ${inS > 0.05 ? `on the downbeat in ${inS.toFixed(1)} s` : "now"}.`);
  };

  // The desk: names, positions, and a person's hand on a DCA we drive.
  useEffect(() => {
    if (IS_WEB) return;
    const u = on<AvantisSnapshot>("avantis:state", (s) => {
      if (!s) return;
      const now = Date.now();
      for (const [id, nm] of Object.entries(s.names ?? {})) {
        if (id.startsWith("input:")) {
          names.current[`ch ${id.slice(6)}`] = id;
          deskName.current[id] = String(nm ?? "");
          continue;
        }
        if (!MIXABLE.test(id) || !nm) continue;
        // A DCA and a group can share a name ("Drums"): the DCA wins — that's
        // what the operator mixes from.
        const had = names.current[String(nm)];
        if (had && had.startsWith("dca:") && !id.startsWith("dca:")) continue;
        names.current[String(nm)] = id;
      }
      const since = s.connectedAt ?? Infinity;
      for (const [id, raw] of Object.entries(s.faders ?? {})) {
        if (raw == null || !MIXABLE.test(id)) continue;
        if (id.startsWith("input:") && !names.current[`ch ${id.slice(6)}`]) names.current[`ch ${id.slice(6)}`] = id;
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
      const song = songRef.current;
      run.current = { startT: b.t, song, sections: [] };
      lastKey.current = "";
      letGo.current.clear();
      schedule.current = null;
      if (!armedRef.current || !song) return;
      // Your chorus levels for this song, if it has seen you mix it.
      const h = store.current.homes[song.id];
      if (h) {
        home.current = { ...home.current, ...h };
        say(`${song.name}: home = your chorus levels from last time (${Object.entries(h).map(([n, db]) => `${n} ${db.toFixed(1)}`).join(", ")}).`);
      }
      const map = store.current.maps[song.id];
      if (map?.sections?.length) {
        schedule.current = map.sections.map((x) => ({ ...x, done: false }));
        say(`${song.name}: moves will land on the beat from last time's map (${map.sections.length} sections); the guide checks it.`);
      }
    });
    const x = on("follow:mstop", () => {
      clock.current.onMidiStop();
      fxMute(true, "Playback stopped — the song ended");
      const r = run.current;
      run.current = null;
      schedule.current = null;
      sectionChanged("");
      if (r?.song && r.sections.length >= 3) {
        store.current.maps[r.song.id] = { name: r.song.name, bpm: clock.current.bpm() ?? 0, sections: r.sections };
        say(`Learned ${r.song.name}'s map: ${r.sections.length} sections.`);
      }
      saveStore();
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
      const P = clock.current.period ?? 600;
      const at = (clock.current.hasBar() ? clock.current.nextDownbeat(c.t0 + 1.5 * P) : null) ?? c.t1 + 4 * P;
      // Record it in this run's map (learned whether armed or not).
      const r = run.current;
      const beat = r && clock.current.period ? barBeat(at, r.startT, P, clock.current.meter) : null;
      if (r && beat != null) r.sections = recordSection(r.sections, { beat, key });
      if (!armedRef.current) {
        sectionChanged(key);
        return;
      }
      // The map already has it: the move was (or will be) on the beat.
      if (schedule.current && beat != null) {
        const i = confirms(schedule.current, key, beat);
        if (i >= 0) return;
        schedule.current = null;
        say(`The band went a different way (guide said "${c.text}", the map expected otherwise) — following the guide for the rest of this song.`);
      }
      sectionChanged(key);
      startMove(key, at, `Heard "${c.text}"`);
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
      const now = Date.now();
      // The song's map: start each section's move on its downbeat.
      const sch = schedule.current;
      const r = run.current;
      const P = clock.current.period;
      if (sch && r && P) {
        for (const x of sch) {
          if (x.done) continue;
          const due = r.startT + x.beat * P;
          if (now < due - 40) break;
          x.done = true;
          if (now - due > 4 * P) continue; // long gone (armed mid-song)
          sectionChanged(x.key);
          startMove(x.key, due, "On the beat (song map)");
        }
      }
      const a = active.current;
      if (!a) return;
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
      name: id.startsWith("input:") && deskName.current[id] ? `${name} ${deskName.current[id]}` : name,
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
      for (const [name, id] of Object.entries(names.current)) {
        if (!Object.values(rulesRef.current).some((m) => name in m)) continue;
        const raw = faders.current[id];
        if (raw != null) home.current[name] = rawToDb(raw);
      }
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
