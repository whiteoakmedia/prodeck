import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { automixSetState, automixStoreLoad, automixStoreSave, avantisSetFader, avantisSetMute, followDebugLog, IS_WEB, on, type AvantisSnapshot } from "./lib/tauri";
import { useProDeck } from "./store";
import { usePco } from "./pcoStore";
import { BeatClock, type BeatEvent } from "./lib/rig";
import {
  barBeat,
  BgvRider,
  confirms,
  cueInfo,
  DEFAULT_RULES,
  effectiveRules,
  faderAt,
  FeedWatch,
  observe,
  parseFeeds,
  parseRules,
  recordSection,
  repeatBoost,
  repeatIndex,
  suggestions as findSuggestions,
  type MapSection,
  type Move,
  type Observations,
  type SongMap,
  type SongRules,
  type Suggestion,
} from "./lib/automix";
import { dbToRaw, rawToDb } from "./lib/autopilotMix";
import { setMixArmed } from "./lib/mixArm";

// The automix, live (lib/automix.ts has the logic, with tests). Armed by
// hand, never at launch. Booth only.
//
// Layers, summed per fader 20 times a second:
//   section — the rule's offset for the moment the guide called (or the
//             song's map scheduled), from home, faded to land on the
//             downbeat; repeats of a bridge/chorus climb by the "repeat" line
//   BGVs    — the group tucks when no backing singer is singing
//   nudges  — +2 dB for the instrument carrying an instrumental, −2 dB for
//             one that dug in well above itself (never drums or bass)
// Home is the operator's chorus mix: at Arm, then per song as learned.
// A person's hand on a fader lets go of it for the song; Hold freezes all.
// Every section the operator adjusts is remembered per song, and repeated
// corrections become suggestions to accept.

/** What the automix may move: DCAs, groups (mono and stereo), and input
 *  channels — those by number ("ch 10"), since desk names repeat. */
const MIXABLE = /^(dca|grp|sgrp|input):/;
const DEFAULT_FEEDS = "EGs: 17, 18; KEYs: 20; AGs: 19, 21; Drums: 9, 10, 12, 13, 14, 15; ch 10: 16";
/** Only these get feed nudges: drums and bass are the rock. */
const NUDGEABLE = ["EGs", "KEYs", "AGs"];

export interface DcaInfo {
  name: string;
  id: string;
  home: number | null; // dB
  now: number | null; // dB, last known
  letGo: boolean;
}
interface Store {
  maps: Record<string, SongMap>;
  homes: Record<string, Record<string, number>>;
  obs: Observations;
  songRules: SongRules;
  dismissed: string[];
  names: Record<string, string>;
}
interface Ctx {
  armed: boolean;
  held: boolean;
  arm: () => void;
  disarm: () => void;
  toggleHold: () => void;
  goHome: () => void;
  dcas: DcaInfo[];
  last: string;
  pending: { key: string; at: number } | null;
  bpm: number | null;
  song: string;
  section: string;
  bgv: { on: boolean; lead: string | null; singing: boolean };
  nudges: string[];
  log: { at: number; text: string }[];
  suggestions: Suggestion[];
  accept: (s: Suggestion) => void;
  dismiss: (s: Suggestion) => void;
}
const C = createContext<Ctx | null>(null);
export const useAutomix = () => useContext(C);

export function AutomixProvider({ children }: { children: ReactNode }) {
  const { settings, status: ppStatus } = useProDeck();
  const { liveItemId, items, micSceneMap } = usePco();
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  armedRef.current = armed;
  useEffect(() => setMixArmed(armed), [armed]);
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  heldRef.current = held;
  const [log, setLog] = useState<{ at: number; text: string }[]>([]);
  const [last, setLast] = useState("");
  const [pending, setPending] = useState<{ key: string; at: number } | null>(null);
  const [bpm, setBpm] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const clock = useRef(new BeatClock());
  const names = useRef<Record<string, string>>({}); // dca/group name, or "ch N" → id
  const deskName = useRef<Record<string, string>>({}); // input id → its name on the desk
  const faders = useRef<Record<string, number>>({}); // id → raw, reported this connection
  const home = useRef<Record<string, number>>({}); // name → dB
  const secHold = useRef<Record<string, number>>({}); // name → dB: the section layer now
  const sec = useRef<{ from: Record<string, number> | null; targets: Record<string, number>; at: number; fadeMs: number } | null>(null);
  const extraTarget = useRef<Record<string, number>>({});
  const extraNow = useRef<Record<string, number>>({});
  const bgvTarget = useRef(0);
  const bgvNow = useRef(0);
  const bgvState = useRef<{ lead: string | null; singing: boolean }>({ lead: null, singing: false });
  const rider = useRef(new BgvRider());
  const feed = useRef(new FeedWatch());
  const liftDone = useRef(false);
  const letGo = useRef(new Set<string>());
  const sent = useRef(new Map<string, { raw: number; t: number }>());
  const sceneRef = useRef<number | null>(null);
  const lastClockAt = useRef(0);
  const lastLine = useRef("");
  const cur = useRef<{ key: string; idx: number; startedAt: number; touched: Set<string> }>({ key: "", idx: 0, startedAt: 0, touched: new Set() });

  const cfg = useRef({ rules: parseRules(DEFAULT_RULES), fx: "All FX", bgvOn: true, bgvName: "BGVs", bgvTuck: -6, feedsOn: true, feeds: parseFeeds(DEFAULT_FEEDS), micChannels: {} as Record<string, number> });
  cfg.current = {
    rules: parseRules(settings?.automix_rules?.trim() || DEFAULT_RULES),
    fx: settings?.automix_fx_mute ?? "All FX",
    bgvOn: settings?.automix_bgv_ride ?? true,
    bgvName: settings?.automix_bgv_name || "BGVs",
    bgvTuck: settings?.automix_bgv_tuck ?? -6,
    feedsOn: settings?.automix_feeds_on ?? true,
    feeds: parseFeeds(settings?.automix_feeds?.trim() || DEFAULT_FEEDS),
    micChannels: settings?.audio_mic_channels ?? {},
  };
  const micScenes = useRef<Record<string, string>>({});
  micScenes.current = micSceneMap ?? {};

  // The song is whatever ProPresenter has up (rehearsal has no live plan).
  const songRef = useRef<{ id: string; name: string } | null>(null);
  {
    const p = (ppStatus.activePresentation as any)?.presentation?.id;
    songRef.current = p?.uuid ? { id: p.uuid, name: p.name ?? "" } : null;
  }
  // Per-song memory: section maps, chorus levels, corrections.
  const store = useRef<Store>({ maps: {}, homes: {}, obs: {}, songRules: {}, dismissed: [], names: {} });
  useEffect(() => {
    if (IS_WEB) return;
    automixStoreLoad()
      .then((v) => {
        store.current = { maps: v?.maps ?? {}, homes: v?.homes ?? {}, obs: v?.obs ?? {}, songRules: v?.songRules ?? {}, dismissed: v?.dismissed ?? [], names: v?.names ?? {} };
        setTick((x) => x + 1);
      })
      .catch(() => {});
  }, []);
  const saveStore = () => automixStoreSave(store.current).catch(() => {});
  // This run of the song (from Playback's Start).
  const run = useRef<{ startT: number; song: { id: string; name: string } | null; sections: MapSection[] } | null>(null);
  const schedule = useRef<(MapSection & { done: boolean })[] | null>(null);

  const say = (text: string) => {
    lastLine.current = text;
    setLog((l) => [{ at: Date.now(), text }, ...l].slice(0, 60));
    followDebugLog({ kind: "automix", text }).catch(() => {});
  };
  const song = () => run.current?.song ?? songRef.current;
  const songName = () => song()?.name || items.find((i) => i.id === liveItemId)?.title || "";
  const rulesNow = () => {
    const s = song();
    return effectiveRules(cfg.current.rules, s ? store.current.songRules[s.id] : undefined);
  };
  /** Every fader the automix drives: named in a rule, the BGV group, the nudgeable instruments. */
  const managed = () => {
    const set = new Set<string>();
    for (const m of Object.values(rulesNow())) for (const n of Object.keys(m)) set.add(n);
    if (cfg.current.bgvOn) set.add(cfg.current.bgvName);
    if (cfg.current.feedsOn) for (const n of Object.keys(cfg.current.feeds)) if (NUDGEABLE.includes(n)) set.add(n);
    return [...set].filter((n) => names.current[n]);
  };
  const posDb = (name: string) => {
    const id = names.current[name];
    const raw = id ? faders.current[id] : undefined;
    return raw != null ? rawToDb(raw) : null;
  };

  /** The FX DCA: muted between songs so reverb tails don't hang over the talking. */
  const fxMute = (muted: boolean, why: string) => {
    if (!armedRef.current || !cfg.current.fx) return;
    const id = names.current[cfg.current.fx];
    if (!id) return;
    avantisSetMute(id, muted)
      .then(() => say(`${muted ? "Muted" : "Unmuted"} ${cfg.current.fx}: ${why}.`))
      .catch(() => {});
  };

  /** A section ended: remember where the operator put what he touched in it. */
  const finishSection = () => {
    const c = cur.current;
    const s = song();
    if (!c.key || !s || !c.touched.size) return;
    const homes = (store.current.homes[s.id] ??= {});
    for (const name of c.touched) {
      const pos = posDb(name);
      if (pos == null) continue;
      if (c.key === "chorus") homes[name] = Math.round(pos * 10) / 10; // his chorus level = this song's home
      else {
        const h = homes[name] ?? home.current[name];
        if (h != null) store.current.obs = observe(store.current.obs, s.id, c.key, name, pos - h);
      }
    }
    store.current.names[s.id] = s.name;
  };

  /** A section begins (a guide call, or the song's map): the move fades
   *  from `at` over `fadeMs`. */
  const startSection = (key: string, n: number | null, at: number, fadeMs: number, why: string) => {
    finishSection();
    const idx = repeatIndex(cur.current.key, cur.current.idx, key, n);
    cur.current = { key, idx, startedAt: at, touched: new Set() };
    liftDone.current = false;
    // An instrumental lift lasts its section; dig-in trims stay until released.
    for (const k of Object.keys(extraTarget.current)) if (!feed.current.trimmed.has(k)) delete extraTarget.current[k];
    if (!armedRef.current) return;
    const c = cfg.current;
    const r = rulesNow();
    const base: Move = r[key] ?? {};
    const boost = repeatBoost(r, key, idx);
    const targets: Record<string, number> = {};
    for (const name of new Set([...Object.keys(base), ...Object.keys(boost)])) {
      if (home.current[name] == null || letGo.current.has(name)) continue;
      if (c.bgvOn && name === c.bgvName) continue; // the rider has the BGVs
      // An instrument that isn't playing: no point moving it.
      if (c.feedsOn && c.feeds[name] && feed.current.typical(name) != null && !feed.current.playing(name)) continue;
      targets[name] = home.current[name] + (base[name] ?? 0) + (boost[name] ?? 0);
    }
    if (!Object.keys(targets).length) {
      say(`${why} → ${key}: nothing to move.`);
      return;
    }
    sec.current = { from: null, targets, at, fadeMs };
    setPending({ key, at: at + fadeMs });
    const desc = Object.entries(targets)
      .map(([nm, db]) => `${nm} ${(db - home.current[nm]).toFixed(1)}`)
      .join(", ");
    const inS = (at + fadeMs - Date.now()) / 1000;
    say(`${why} → ${key}${idx > 1 ? ` (pass ${idx})` : ""}: ${desc} — ${inS > 0.1 ? `lands in ${inS.toFixed(1)} s` : "now"}.`);
  };

  /** Who's leading: the mic whose scene the desk last recalled. */
  const leadMic = (): string | null => {
    const sc = sceneRef.current;
    if (sc == null) return null;
    const hit = Object.entries(micScenes.current).find(([, s]) => String(s) === String(sc));
    return hit ? hit[0] : null;
  };

  // The desk: names, positions, scene, and a person's hand on a fader we drive.
  useEffect(() => {
    if (IS_WEB) return;
    const u = on<AvantisSnapshot>("avantis:state", (s) => {
      if (!s) return;
      const now = Date.now();
      sceneRef.current = s.scene ?? null;
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
        if (ours) continue;
        // A person moved it: learn from it, and (armed) let go of it.
        cur.current.touched.add(name);
        followDebugLog({ kind: "mix-touch", dca: name, from: prev != null ? rawToDb(prev) : null, to: rawToDb(raw as number), section: cur.current.key, song: songName(), songId: song()?.id ?? null }).catch(() => {});
        if (armedRef.current && home.current[name] != null && !letGo.current.has(name)) {
          letGo.current.add(name);
          say(`You moved ${name} — let go of it for the rest of this song.`);
        }
      }
      setTick((x) => x + 1);
    });
    return () => {
      u.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Levels (~12 a second): vocal mics for the BGV rider, instrument feeds.
  useEffect(() => {
    if (IS_WEB) return;
    const u = on<number[]>("audio:channels_rms", (lv) => {
      if (!Array.isArray(lv)) return;
      const now = Date.now();
      const c = cfg.current;
      if (c.bgvOn) {
        const levels: Record<string, number> = {};
        for (const [mic, ch] of Object.entries(c.micChannels)) if (lv[ch - 1] != null) levels[mic] = lv[ch - 1];
        const lead = leadMic();
        // Without a known lead, leave the BGVs where they are.
        const singing = lead && Object.keys(levels).length ? rider.current.update(levels, lead, now) : true;
        bgvState.current = { lead, singing };
        bgvTarget.current = singing ? 0 : c.bgvTuck;
      } else bgvTarget.current = 0;
      if (c.feedsOn) {
        const levels: Record<string, number> = {};
        for (const [name, chs] of Object.entries(c.feeds)) levels[name] = Math.max(...chs.map((ch) => lv[ch - 1] ?? -120));
        feed.current.update(levels, now);
      }
    });
    return () => {
      u.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The clock: MIDI Clock first, the audio click as backup; Playback's Start and Stop.
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
      finishSection();
      const sg = songRef.current;
      run.current = { startT: b.t, song: sg, sections: [] };
      cur.current = { key: "", idx: 0, startedAt: b.t, touched: new Set() };
      letGo.current.clear();
      schedule.current = null;
      sec.current = null;
      feed.current.reset();
      extraTarget.current = {};
      if (sg) store.current.names[sg.id] = sg.name;
      if (!armedRef.current) return;
      // Your chorus levels for this song, if it has seen you mix it.
      const h = sg ? store.current.homes[sg.id] : undefined;
      if (sg && h && Object.keys(h).length) {
        home.current = { ...home.current, ...h };
        say(`${sg.name}: home = your chorus levels from last time (${Object.entries(h).map(([n, db]) => `${n} ${db.toFixed(1)}`).join(", ")}).`);
      }
      secHold.current = { ...home.current }; // every song starts from home
      const map = sg ? store.current.maps[sg.id] : undefined;
      if (sg && map?.sections?.length) {
        schedule.current = map.sections.map((x) => ({ ...x, done: false }));
        say(`${sg.name}: moves will land on the beat from last time's map (${map.sections.length} sections); the guide checks it.`);
      }
    });
    const x = on("follow:mstop", () => {
      clock.current.onMidiStop();
      fxMute(true, "Playback stopped — the song ended");
      finishSection();
      const r = run.current;
      run.current = null;
      schedule.current = null;
      cur.current = { key: "", idx: 0, startedAt: 0, touched: new Set() };
      if (r?.song && r.sections.length >= 3) {
        store.current.maps[r.song.id] = { name: r.song.name, bpm: clock.current.bpm() ?? 0, sections: r.sections };
        say(`Learned ${r.song.name}'s map: ${r.sections.length} sections.`);
      }
      saveStore();
      setTick((t) => t + 1);
    });
    return () => {
      [a, m, s, x].forEach((u) => u.then((f) => f()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The guide: a moment called → a move that lands on its downbeat.
  useEffect(() => {
    if (IS_WEB) return;
    const u = on<{ text: string; t0: number; t1: number }>("follow:cue", (c) => {
      if (!c) return;
      const info = cueInfo(c.text);
      if (!info) return;
      setLast(`${c.text} → ${info.key}`);
      const P = clock.current.period ?? 600;
      const at = (clock.current.hasBar() ? clock.current.nextDownbeat(c.t0 + 1.5 * P) : null) ?? c.t1 + 4 * P;
      // Record it in this run's map (learned whether armed or not).
      const r = run.current;
      const beat = r && clock.current.period ? barBeat(at, r.startT, P, clock.current.meter) : null;
      if (r && beat != null) r.sections = recordSection(r.sections, { beat, key: info.key, n: info.n });
      // The map already has it: the move was (or will be) on the beat.
      if (schedule.current && beat != null && armedRef.current) {
        if (confirms(schedule.current, info.key, beat) >= 0) return;
        schedule.current = null;
        say(`The band went a different way (guide said "${c.text}", the map expected otherwise) — following the guide for the rest of this song.`);
      }
      const build = info.key === "build";
      const now = Date.now();
      // Land ON the downbeat: fade the bar before it when there's time, else
      // as fast as the time left allows (a build ramps over four bars).
      if (build) startSection(info.key, info.n, at, 16 * P, `Heard "${c.text}"`);
      else {
        const lead = Math.min(2 * P, Math.max(0, at - now - 50));
        startSection(info.key, info.n, at - lead, Math.max(lead, 400), `Heard "${c.text}"`);
      }
    });
    return () => {
      u.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new plan item: hand every fader back; and without Playback's clock,
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

  // Stream Deck keys (Companion → the gateway's deck actions).
  useEffect(() => {
    if (IS_WEB) return;
    const u = on<{ cmd: string }>("automix:command", (c) => {
      const cmd = c?.cmd;
      if (cmd === "toggle") (armedRef.current ? doDisarm : doArm)();
      else if (cmd === "arm" && !armedRef.current) doArm();
      else if (cmd === "disarm" && armedRef.current) doDisarm();
      else if (cmd === "hold" && armedRef.current) doHold();
      else if (cmd === "home" && armedRef.current) doHome();
    });
    return () => {
      u.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Publish the state for the Stream Deck's readout keys.
  useEffect(() => {
    if (IS_WEB) return;
    const iv = setInterval(() => {
      const p = sec.current;
      const now = Date.now();
      automixSetState({
        armed: armedRef.current,
        held: heldRef.current,
        song: songName(),
        section: cur.current.key,
        next: p && p.at + p.fadeMs > now ? { key: cur.current.key, inMs: p.at + p.fadeMs - now } : null,
        bgvTucked: bgvNow.current < -0.5,
        last: lastLine.current,
      }).catch(() => {});
    }, 500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The mixer: every layer summed, one write per fader that changed.
  useEffect(() => {
    if (!armed) return;
    let lastTrim = 0;
    const iv = setInterval(() => {
      const now = Date.now();
      const c = cfg.current;
      // The song's map: each move's fade ends ON its downbeat.
      const sch = schedule.current;
      const r = run.current;
      const P = clock.current.period;
      if (sch && r && P) {
        for (const x of sch) {
          if (x.done) continue;
          const due = r.startT + x.beat * P;
          const build = x.key === "build";
          const start = build ? due : due - 2 * P;
          if (now < start - 40) break;
          x.done = true;
          if (now - due > 4 * P) continue; // long gone (armed mid-song)
          startSection(x.key, x.n ?? null, start, build ? 16 * P : 2 * P, "On the beat (song map)");
        }
      }
      if (heldRef.current) return;
      // Feed nudges.
      if (c.feedsOn) {
        const nudgeable = NUDGEABLE.filter((n) => c.feeds[n] && names.current[n] && !letGo.current.has(n));
        if (cur.current.key === "instrumental" && !liftDone.current && now - cur.current.startedAt > 2000) {
          liftDone.current = true;
          const k = feed.current.leading(nudgeable);
          if (k) {
            extraTarget.current[k] = 2;
            say(`${k} is carrying the instrumental — up 2 dB for it.`);
          }
        }
        if (cur.current.key !== "instrumental" && now - lastTrim > 500) {
          lastTrim = now;
          const { trim, release } = feed.current.checkTrims(nudgeable, now);
          for (const k of trim) {
            extraTarget.current[k] = -2;
            say(`${k} dug in well above its usual level — trimmed 2 dB.`);
          }
          for (const k of release) {
            delete extraTarget.current[k];
            say(`${k} settled — trim released.`);
          }
        }
      }
      // Section layer.
      const s = sec.current;
      if (s && now >= s.at) {
        if (!s.from) {
          s.from = {};
          for (const n of Object.keys(s.targets)) s.from[n] = secHold.current[n] ?? home.current[n] ?? s.targets[n];
        }
        const v = faderAt({ key: "", at: s.at, fadeMs: s.fadeMs, targets: s.targets }, s.from, now);
        for (const [n, db] of Object.entries(v)) secHold.current[n] = db;
        if (now >= s.at + s.fadeMs) {
          sec.current = null;
          setPending(null);
        }
      }
      // Nudges glide at 2 dB/s; the BGVs come up fast and tuck gently.
      for (const n of new Set([...Object.keys(extraTarget.current), ...Object.keys(extraNow.current)])) {
        const t = extraTarget.current[n] ?? 0;
        const x = extraNow.current[n] ?? 0;
        extraNow.current[n] = Math.abs(t - x) <= 0.1 ? t : x + Math.sign(t - x) * 0.1;
        if (extraNow.current[n] === 0 && extraTarget.current[n] == null) delete extraNow.current[n];
      }
      {
        const t = bgvTarget.current;
        const x = bgvNow.current;
        const step = t > x ? 1.5 : 0.2; // up 30 dB/s, down 4 dB/s
        bgvNow.current = Math.abs(t - x) <= step ? t : x + Math.sign(t - x) * step;
      }
      // Write.
      for (const n of managed()) {
        if (letGo.current.has(n)) continue;
        const base = secHold.current[n] ?? home.current[n];
        if (base == null) continue;
        const total = Math.max(-54, Math.min(10, base + (extraNow.current[n] ?? 0) + (c.bgvOn && n === c.bgvName ? bgvNow.current : 0)));
        const id = names.current[n];
        const raw = dbToRaw(total);
        if (!id || faders.current[id] === raw) continue;
        sent.current.set(id, { raw, t: now });
        faders.current[id] = raw;
        avantisSetFader(id, raw).catch(() => {});
      }
    }, 50);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  function doArm() {
    home.current = {};
    letGo.current.clear();
    for (const n of managed()) {
      const db = posDb(n);
      if (db != null) home.current[n] = db;
    }
    secHold.current = { ...home.current };
    extraTarget.current = {};
    extraNow.current = {};
    bgvNow.current = 0;
    sec.current = null;
    armedRef.current = true;
    setArmed(true);
    heldRef.current = false;
    setHeld(false);
    say(`Armed. Home = your positions now (your chorus mix): ${Object.entries(home.current).map(([n, db]) => `${n} ${db.toFixed(1)}`).join(", ") || "none known — move each fader once"}.`);
  }
  function doDisarm() {
    armedRef.current = false;
    setArmed(false);
    heldRef.current = false;
    setHeld(false);
    sec.current = null;
    setPending(null);
    saveStore();
    say("Disarmed. The desk is all yours.");
  }
  function doHold() {
    const h = !heldRef.current;
    heldRef.current = h;
    setHeld(h);
    say(h ? "Hold — frozen where it is." : "Hold released — mixing again.");
  }
  function doHome() {
    extraTarget.current = {};
    sec.current = { from: null, targets: { ...home.current }, at: Date.now(), fadeMs: 1500 };
    say("Back to your positions.");
  }

  void tick;
  const dcas: DcaInfo[] = managed().map((name) => {
    const id = names.current[name];
    return {
      name: id.startsWith("input:") && deskName.current[id] ? `${name} ${deskName.current[id]}` : name,
      id,
      home: home.current[name] ?? null,
      now: faders.current[id] != null ? rawToDb(faders.current[id]) : null,
      letGo: letGo.current.has(name),
    };
  });
  const suggestions = findSuggestions(store.current.obs, cfg.current.rules, store.current.songRules, store.current.names, new Set(store.current.dismissed));

  const value: Ctx = {
    armed,
    held,
    arm: doArm,
    disarm: doDisarm,
    toggleHold: doHold,
    goHome: doHome,
    dcas,
    last,
    pending,
    bpm,
    song: songName(),
    section: cur.current.key,
    bgv: { on: cfg.current.bgvOn, lead: bgvState.current.lead, singing: bgvState.current.singing },
    nudges: Object.entries(extraTarget.current).map(([n, d]) => `${n} ${d > 0 ? "+" : ""}${d}`),
    log,
    suggestions,
    accept: (sg) => {
      const sr = (store.current.songRules[sg.song] ??= {});
      (sr[sg.key] ??= {})[sg.fader] = sg.suggested;
      saveStore();
      say(`${sg.songName}: ${sg.fader} in the ${sg.key} is now ${sg.suggested > 0 ? "+" : ""}${sg.suggested} dB for this song.`);
      setTick((x) => x + 1);
    },
    dismiss: (sg) => {
      store.current.dismissed.push(`${sg.song}|${sg.key}|${sg.fader}|${sg.suggested}`);
      saveStore();
      setTick((x) => x + 1);
    },
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
