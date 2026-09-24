import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  followComplete,
  followDebugLog,
  followStatus,
  followTimingLoad,
  followTimingSave,
  on,
  ppFocusTrigger,
  ppGet,
  ppPlaylistTrigger,
  startTranscription,
  stopTranscription,
  transcriptionSetPrompt,
} from "./lib/tauri";
import { useProDeck } from "./store";
import { usePco } from "./pcoStore";
import { matchPresentationToItem } from "./lib/proFollow";
import { askBody, FollowEngine, makeSlide, parsePick, type Action, type Cue, type FollowView, type FSong, type Heard } from "./lib/follow";
import type { BeatEvent } from "./lib/rig";

// Auto-Follow v2 (design/AUTOFOLLOW.md). This provider is the plumbing; the
// decisions live in lib/follow.ts. It builds the song list from the armed
// ProPresenter playlist (each item's own arrangement = the trigger order),
// takes each song's BPM from Planning Center, and feeds the engine three
// streams: Whisper windows (caption:heard), ProPresenter's live slide, and a
// 4 Hz tick. Every move goes THROUGH the playlist so Pro stays in the Sunday
// playlist with the item's arrangement and the slide's actions fire.

function flattenPlaylists(j: any): { uuid: string; name: string }[] {
  const arr = Array.isArray(j) ? j : Array.isArray(j?.playlists) ? j.playlists : [];
  const out: { uuid: string; name: string }[] = [];
  const walk = (nodes: any[]) => {
    for (const n of nodes) {
      const ft = (n?.field_type ?? n?.type ?? "").toString().toLowerCase();
      const kids = n?.children;
      if (ft.includes("group") || (Array.isArray(kids) && kids.length)) {
        if (Array.isArray(kids)) walk(kids);
      } else if (n?.id?.uuid) {
        out.push({ uuid: n.id.uuid, name: n.id.name ?? "Playlist" });
      }
    }
  };
  walk(arr);
  return out;
}

export interface FollowSongInfo {
  name: string;
  slides: number;
  bpm?: number;
  learned: number; // slides with a learned length
}

interface LyricFollowCtx {
  armed: boolean;
  ready: boolean;
  building: boolean;
  playlistId: string | null;
  playlists: { uuid: string; name: string }[];
  slideCount: number;
  songs: FollowSongInfo[];
  view: FollowView;
  modelReady: boolean;
  modelNote: string | null;
  setPlaylist: (id: string | null) => void;
  arm: () => void;
  disarm: () => void;
  /** Operator correction: one slide back / forward. Teaches the clock too. */
  nudge: (dir: -1 | 1) => void;
  /** Practice: listen and score, never move ProPresenter. */
  practice: boolean;
  setPractice: (on: boolean) => void;
  score: PracticeScore;
}

/** How Follow's would-be moves compared with the person's real clicks. */
export interface PracticeScore {
  /** ms, Follow minus person: negative = Follow would have been early. */
  deltas: number[];
  /** Follow would have gone somewhere the person didn't. */
  wrong: number;
  /** The person moved and Follow never would have (within 15 s). */
  missed: number;
}
const EMPTY_SCORE: PracticeScore = { deltas: [], wrong: 0, missed: 0 };

const IDLE_VIEW: FollowView = {
  song: null,
  songId: null,
  bpm: null,
  slide: null,
  section: "",
  dueAt: null,
  slideStartedAt: null,
  lastVia: null,
  lastReason: "",
  heard: "",
  hearing: "idle",
  confidence: 0,
  clickBpm: null,
  lastCue: "",
  cueTarget: null,
};
const Ctx = createContext<LyricFollowCtx | null>(null);

export function LyricFollowProvider({ children }: { children: ReactNode }) {
  const { connected, status: ppStatus } = useProDeck();
  const { items, effectiveLink } = usePco();
  const activeUuidRef = useRef<string | null>(null);
  activeUuidRef.current = ((ppStatus.activePresentation as any)?.presentation?.id?.uuid as string | undefined) ?? null;
  const [armed, setArmed] = useState(false);
  const [ready, setReady] = useState(false);
  const [building, setBuilding] = useState(false);
  const [playlistId, setPlaylistId] = useState<string | null>(() => localStorage.getItem("prodeck.followPlaylist"));
  const [playlists, setPlaylists] = useState<{ uuid: string; name: string }[]>([]);
  const [songs, setSongs] = useState<FollowSongInfo[]>([]);
  const [slideCount, setSlideCount] = useState(0);
  const [view, setView] = useState<FollowView>(IDLE_VIEW);
  const [modelReady, setModelReady] = useState(false);
  const [modelNote, setModelNote] = useState<string | null>(null);
  const [practice, setPracticeState] = useState(() => localStorage.getItem("prodeck.followPractice") === "1");
  const practiceRef = useRef(practice);
  practiceRef.current = practice;
  const [score, setScore] = useState<PracticeScore>(EMPTY_SCORE);
  // Practice bookkeeping: Follow's would-be moves and the person's moves it
  // hasn't matched yet, keyed "song:slide".
  const wouldAt = useRef(new Map<string, number>());
  const pendingPro = useRef(new Map<string, number>());

  const engineRef = useRef<FollowEngine | null>(null);
  const plRef = useRef<string | null>(null);
  const armedRef = useRef(false);
  armedRef.current = armed;
  const heardRaw = useRef("");
  const pcoRef = useRef({ items, effectiveLink });
  pcoRef.current = { items, effectiveLink };

  useEffect(() => {
    if (!connected) {
      setPlaylists([]);
      return;
    }
    ppGet("playlists")
      .then((j) => setPlaylists(flattenPlaylists(j)))
      .catch(() => setPlaylists([]));
  }, [connected]);

  const publish = () => {
    const e = engineRef.current;
    if (e) setView({ ...e.view });
  };

  function run(actions: Action[]) {
    const e = engineRef.current;
    if (!e || !armedRef.current) return;
    for (const a of actions) {
      if (a.type === "trigger") {
        const now = Date.now();
        const key = `${a.song.id}:${a.slide}`;
        followDebugLog({ kind: practiceRef.current ? "would" : "move", song: a.song.id, name: a.song.name, slide: a.slide, via: a.via, reason: a.reason, at: now }).catch(() => {});
        if (practiceRef.current) {
          const proAt = pendingPro.current.get(key);
          if (proAt != null && now - proAt < 15_000) {
            // The person got there first: Follow would have been late.
            pendingPro.current.delete(key);
            setScore((s) => ({ ...s, deltas: [...s.deltas, now - proAt] }));
          } else {
            wouldAt.current.set(key, now);
          }
          continue;
        }
        const plId = plRef.current;
        if (plId) ppPlaylistTrigger(plId, a.song.itemIdx, a.slide, a.song.id === activeUuidRef.current).catch(() => {});
        else ppFocusTrigger(a.song.id, a.slide).catch(() => {});
      } else if (a.type === "prompt") {
        transcriptionSetPrompt(a.text).catch(() => {});
      } else if (a.type === "ask") {
        followComplete(askBody(a, heardRaw.current))
          .then((reply) => {
            const pick = parsePick(reply);
            if (!pick) return engineRef.current?.modelFailed();
            setModelNote(null);
            run(engineRef.current?.onModel(a.song.id, pick.slide, pick.confidence, pick.noise, Date.now()) ?? []);
            publish();
          })
          .catch((err) => {
            engineRef.current?.modelFailed();
            setModelNote(`Model unavailable — following by ear only (${String(err).slice(0, 120)})`);
          });
      }
    }
  }

  async function buildSongs(plId: string): Promise<FSong[]> {
    const pl: any = await ppGet(`playlist/${encodeURIComponent(plId)}`);
    const list = pl?.items ?? pl?.playlist?.items ?? [];
    const out: FSong[] = [];
    // rawIdx = the item's position as the API returns it (headers included) —
    // the index playlist/focused/{n}/trigger expects.
    for (let rawIdx = 0; rawIdx < list.length; rawIdx++) {
      const it = list[rawIdx];
      const presUuid = it?.presentation_info?.presentation_uuid;
      const arrUuid = it?.presentation_info?.arrangement_uuid;
      const name = it?.id?.name ?? "";
      if (!presUuid) continue;
      try {
        const p: any = await ppGet(`presentation/${encodeURIComponent(presUuid)}`);
        const pres = p?.presentation ?? p ?? {};
        const groups = Array.isArray(pres.groups) ? pres.groups : [];
        const byUuid = new Map<string, any>();
        for (const g of groups) if (g?.uuid) byUuid.set(g.uuid, g);
        const arr = (pres.arrangements ?? []).find((a: any) => a?.id?.uuid === arrUuid);
        const seq = Array.isArray(arr?.groups)
          ? arr.groups.map((gu: any) => byUuid.get(typeof gu === "string" ? gu : gu?.uuid)).filter(Boolean)
          : [];
        const display = seq.length ? seq : groups;
        const slides = [];
        let i = 0;
        for (const g of display) {
          let first = true;
          for (const sl of Array.isArray(g?.slides) ? g.slides : []) {
            const made = makeSlide(i++, String(g?.name ?? ""), String(sl?.text ?? ""));
            // Each entry in the arrangement is its own section occurrence,
            // even "Chorus, Chorus" back to back — the guide calls each.
            if (first) made.groupStart = true;
            first = false;
            slides.push(made);
          }
        }
        // Tempo from Planning Center: the plan item this presentation is.
        const { items: pItems, effectiveLink: link } = pcoRef.current;
        const itemId = matchPresentationToItem(pItems, link, presUuid, name);
        const bpm = pItems.find((x) => x.id === itemId)?.bpm;
        out.push({ id: presUuid, name, itemIdx: rawIdx, slides, bpm });
      } catch {
        /* skip a presentation that won't load */
      }
    }
    return out;
  }

  async function start(plId: string) {
    setBuilding(true);
    setReady(false);
    plRef.current = plId;
    try {
      const [built, timing, st] = await Promise.all([
        buildSongs(plId),
        followTimingLoad().catch(() => ({})),
        followStatus().catch(() => null),
      ]);
      if (!armedRef.current) return;
      const ready = !!st?.modelReady;
      setModelReady(ready);
      const engine = new FollowEngine(built, timing as any, { modelReady: ready, prompt: "current" });
      engine.practice = practiceRef.current;
      engineRef.current = engine;
      // Everything a replay needs: the songs as Follow saw them.
      followDebugLog({
        kind: "arm",
        practice: practiceRef.current,
        playlist: plId,
        songs: built.map((s) => ({ id: s.id, name: s.name, itemIdx: s.itemIdx, bpm: s.bpm, slides: s.slides.map((x) => ({ section: x.section, text: x.text })) })),
      }).catch(() => {});
      setSongs(
        built.map((s) => ({
          name: s.name,
          slides: s.slides.filter((x) => x.tokens.length).length,
          bpm: s.bpm,
          learned: Object.keys((timing as any)[s.id]?.slides ?? {}).length,
        })),
      );
      setSlideCount(built.reduce((n, s) => n + s.slides.length, 0));
      setReady(built.length > 0);
      // Whatever Pro already shows is where we start.
      const si = (ppStatus.slideIndex as any)?.presentation_index;
      run(engine.onLive(si?.presentation_id?.uuid ?? null, typeof si?.index === "number" ? si.index : null, Date.now()));
      publish();
    } finally {
      setBuilding(false);
    }
  }

  // Whisper windows.
  useEffect(() => {
    const sub = on<Heard>("caption:heard", (h) => {
      const e = engineRef.current;
      if (!armedRef.current || !e || !h) return;
      if (h.text) heardRaw.current = `${heardRaw.current} ${h.text}`.split(/\s+/).filter(Boolean).slice(-40).join(" ");
      run(e.onHeard(h, Date.now()));
      publish();
    });
    return () => {
      sub.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The playback rig: clicks and guide cues.
  useEffect(() => {
    const b = on<BeatEvent>("follow:beat", (ev) => {
      const e = engineRef.current;
      if (!armedRef.current || !e || !ev) return;
      e.onBeat(ev);
      followDebugLog({ kind: "beat", t: ev.t, s: ev.strength, z: ev.zcr }).catch(() => {});
    });
    const c = on<Cue>("follow:cue", (cue) => {
      const e = engineRef.current;
      if (!armedRef.current || !e || !cue) return;
      followDebugLog({ kind: "cue", ...cue }).catch(() => {});
      run(e.onCue(cue, Date.now()));
      publish();
    });
    return () => {
      b.then((f) => f());
      c.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ProPresenter's live slide — ours or anyone's.
  const si = (ppStatus.slideIndex as any)?.presentation_index;
  const liveUuid: string | null = si?.presentation_id?.uuid ?? null;
  const liveIdx: number | null = typeof si?.index === "number" ? si.index : null;
  useEffect(() => {
    const e = engineRef.current;
    if (!armed || !e) return;
    const now = Date.now();
    followDebugLog({ kind: "live", song: liveUuid, slide: liveIdx, at: now }).catch(() => {});
    if (practiceRef.current && liveUuid && liveIdx != null) {
      const key = `${liveUuid}:${liveIdx}`;
      const w = wouldAt.current.get(key);
      // Anything Follow would have done that the person didn't do next was wrong.
      let wrong = 0;
      for (const [k, t] of wouldAt.current) if (k !== key && now - t < 20_000) wrong++;
      wouldAt.current.clear();
      if (w != null && now - w < 15_000) setScore((s) => ({ ...s, deltas: [...s.deltas, w - now], wrong: s.wrong + wrong }));
      else {
        pendingPro.current.set(key, now);
        setScore((s) => ({ ...s, wrong: s.wrong + wrong }));
      }
      // A person's move Follow never matched within 15 s is a miss.
      for (const [k, t] of pendingPro.current) {
        if (now - t > 15_000) {
          pendingPro.current.delete(k);
          setScore((s) => ({ ...s, missed: s.missed + 1 }));
        }
      }
    }
    run(e.onLive(liveUuid, liveIdx, now));
    publish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, liveUuid, liveIdx]);

  // The clock, and saving what it learns.
  useEffect(() => {
    if (!armed) return;
    const tick = setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      const acts = e.onTick(Date.now());
      if (acts.length) run(acts);
      publish();
    }, 250);
    const save = setInterval(() => {
      const e = engineRef.current;
      if (e?.timingDirty) {
        e.timingDirty = false;
        followTimingSave(e.timing).catch(() => {});
      }
    }, 10_000);
    return () => {
      clearInterval(tick);
      clearInterval(save);
      const e = engineRef.current;
      if (e?.timingDirty) followTimingSave(e.timing).catch(() => {});
    };
  }, [armed]);

  const value: LyricFollowCtx = {
    armed,
    ready,
    building,
    playlistId,
    playlists,
    slideCount,
    songs,
    view,
    modelReady,
    modelNote,
    setPlaylist: (id) => {
      setPlaylistId(id);
      if (id) localStorage.setItem("prodeck.followPlaylist", id);
      else localStorage.removeItem("prodeck.followPlaylist");
    },
    practice,
    setPractice: (on) => {
      setPracticeState(on);
      if (engineRef.current) engineRef.current.practice = on;
      localStorage.setItem("prodeck.followPractice", on ? "1" : "0");
      followDebugLog({ kind: "practice", on }).catch(() => {});
    },
    score,
    arm: () => {
      if (!playlistId) return;
      setScore(EMPTY_SCORE);
      wouldAt.current.clear();
      pendingPro.current.clear();
      heardRaw.current = "";
      setModelNote(null);
      armedRef.current = true;
      setArmed(true);
      startTranscription().catch((e) => setModelNote(`Listening didn't start: ${String(e)}`));
      start(playlistId);
    },
    disarm: () => {
      armedRef.current = false;
      setArmed(false);
      stopTranscription().catch(() => {});
      transcriptionSetPrompt("").catch(() => {});
      engineRef.current = null;
      setView(IDLE_VIEW);
    },
    nudge: (dir) => {
      const e = engineRef.current;
      const plId = plRef.current;
      if (!e || !plId || e.view.songId == null || e.view.slide == null) return;
      const song = e.songs.find((s) => s.id === e.view.songId);
      const to = e.view.slide + dir;
      if (!song || to < 0 || to >= song.slides.length) return;
      // Goes out as a person's move: onLive hears it back as "pro", which
      // resyncs Follow and (forward) teaches the clock.
      ppPlaylistTrigger(plId, song.itemIdx, to, song.id === activeUuidRef.current).catch(() => {});
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLyricFollow(): LyricFollowCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLyricFollow must be used within LyricFollowProvider");
  return ctx;
}
