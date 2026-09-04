import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  on,
  ppGet,
  ppFocusTrigger,
  ppPlaylistTrigger,
  startTranscription,
  stopTranscription,
  getSettings,
  geminiPickSlide,
} from "./lib/tauri";
import { useProDeck } from "./store";

// One triggerable slide with its lyric tokens.
interface SlideEntry {
  song: string;
  section: string; // group name (Verse 1 / Chorus / …)
  presUuid: string;
  itemIdx: number; // raw position of the item in the playlist (incl. headers)
  index: number; // display position within the item (playlist arrangement)
  text: string; // raw slide lyrics
  tokens: string[];
}
export interface FollowStatus {
  song: string | null;
  slide: number | null;
  confidence: number;
  text: string;
  via: "gemini" | "local" | null; // which matcher made the last decision
}

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

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

interface LyricFollowCtx {
  armed: boolean;
  ready: boolean;
  building: boolean;
  playlistId: string | null;
  playlists: { uuid: string; name: string }[];
  status: FollowStatus;
  sensitivity: number; // 0..1 match floor to act on
  slideCount: number;
  geminiEnabled: boolean; // Gemini smart matching configured + turned on
  geminiNote: string | null; // transient note when Gemini fell back to local
  setPlaylist: (id: string | null) => void;
  setSensitivity: (n: number) => void;
  arm: () => void;
  disarm: () => void;
}

const EMPTY: FollowStatus = {
  song: null,
  slide: null,
  confidence: 0,
  text: "",
  via: null,
};
const Ctx = createContext<LyricFollowCtx | null>(null);

export function LyricFollowProvider({ children }: { children: ReactNode }) {
  const { connected, status: ppStatus } = useProDeck();
  // Live presentation uuid + the playlist the index was built from, as refs so
  // evaluate() (captured once by the caption subscription) always reads current
  // values.
  const activeUuidRef = useRef<string | null>(null);
  activeUuidRef.current =
    ((ppStatus.activePresentation as any)?.presentation?.id?.uuid as string | undefined) ?? null;
  const armedPlaylistRef = useRef<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [ready, setReady] = useState(false);
  const [building, setBuilding] = useState(false);
  const [playlistId, setPlaylistId] = useState<string | null>(
    () => localStorage.getItem("prodeck.followPlaylist"),
  );
  const [playlists, setPlaylists] = useState<{ uuid: string; name: string }[]>([]);
  const [status, setStatus] = useState<FollowStatus>(EMPTY);
  const [sensitivity, setSensitivityState] = useState(
    () => Number(localStorage.getItem("prodeck.followSens")) || 0.3,
  );
  const [slideCount, setSlideCount] = useState(0);
  const [geminiEnabled, setGeminiEnabled] = useState(false);
  const [geminiNote, setGeminiNote] = useState<string | null>(null);

  const indexRef = useRef<SlideEntry[]>([]);
  const recent = useRef<string[]>([]);
  const recentRaw = useRef<string>(""); // recent raw caption words for Gemini
  const armedRef = useRef(false);
  const sensRef = useRef(sensitivity);
  const curKey = useRef<string | null>(null);
  const lastTrig = useRef(0);
  const inFlight = useRef(false); // a Gemini call is in progress
  const geminiRef = useRef(false);
  // When Gemini errors (esp. 429 quota / rate-limit), stop calling it for a
  // while and ride on the local matcher so we don't hammer a blocked quota.
  const geminiBackoffUntil = useRef(0);
  armedRef.current = armed;
  sensRef.current = sensitivity;
  geminiRef.current = geminiEnabled;

  // Learn whether Gemini matching is configured + enabled (once on mount).
  useEffect(() => {
    refreshGemini();
  }, []);

  // Load the playlist list whenever ProPresenter (re)connects. Doing this only
  // on mount left the dropdown permanently empty if the app started before PP
  // was reachable (the common case at the booth).
  useEffect(() => {
    if (!connected) {
      setPlaylists([]);
      return;
    }
    ppGet("playlists")
      .then((j) => setPlaylists(flattenPlaylists(j)))
      .catch(() => setPlaylists([]));
  }, [connected]);

  async function refreshGemini() {
    try {
      const s = await getSettings();
      setGeminiEnabled(!!s.gemini_match_enabled && !!s.gemini_api_key);
    } catch {
      setGeminiEnabled(false);
    }
  }

  async function buildIndex(plId: string) {
    setBuilding(true);
    setReady(false);
    armedPlaylistRef.current = plId;
    try {
      const pl: any = await ppGet(`playlist/${encodeURIComponent(plId)}`);
      const items = pl?.items ?? pl?.playlist?.items ?? [];
      const idx: SlideEntry[] = [];
      // rawIdx = the item's position in the playlist as the API returns it
      // (headers included) — the index playlist/focused/{n}/trigger expects.
      for (let rawIdx = 0; rawIdx < items.length; rawIdx++) {
        const it = items[rawIdx];
        const presUuid = it?.presentation_info?.presentation_uuid;
        const arrUuid = it?.presentation_info?.arrangement_uuid;
        const song = it?.id?.name ?? "";
        if (!presUuid) continue;
        try {
          const p: any = await ppGet(`presentation/${encodeURIComponent(presUuid)}`);
          const pres = p?.presentation ?? p ?? {};
          const groups = Array.isArray(pres.groups) ? pres.groups : [];
          const byUuid = new Map<string, any>();
          for (const g of groups) if (g?.uuid) byUuid.set(g.uuid, g);
          const resolveSeq = (s: any[]): any[] =>
            s.map((gu: any) => byUuid.get(typeof gu === "string" ? gu : gu?.uuid)).filter(Boolean);

          // Slides to follow: the playlist item's arrangement (what's on screen),
          // else stored order. Because triggering goes through the PLAYLIST
          // (which loads this same arrangement), the display position IS the cue
          // index — no remapping to the presentation's stored current_arrangement
          // (that was only needed when we fired the library copy directly).
          let displaySeq: any[] = groups;
          const dispArr = (pres.arrangements ?? []).find((a: any) => a?.id?.uuid === arrUuid);
          const dispRaw = Array.isArray(dispArr?.groups) ? resolveSeq(dispArr.groups) : [];
          if (dispRaw.length) displaySeq = dispRaw;

          let i = 0;
          for (const g of displaySeq) {
            const section = (g?.name ?? "").toString();
            const sl = Array.isArray(g?.slides) ? g.slides : [];
            for (let q = 0; q < sl.length; q++) {
              const text = (sl[q]?.text ?? "").toString();
              idx.push({
                song,
                section,
                presUuid,
                itemIdx: rawIdx,
                index: i,
                text,
                tokens: tokenize(text),
              });
              i++;
            }
          }
        } catch {
          /* skip a presentation that won't load */
        }
      }
      indexRef.current = idx;
      setSlideCount(idx.length);
      setReady(idx.length > 0);
    } finally {
      setBuilding(false);
    }
  }

  // Top-K slides by cheap local token overlap. Used directly when Gemini is off,
  // and to narrow the field to a short candidate list when Gemini is on.
  function topMatches(k: number): { entry: SlideEntry; score: number }[] {
    const recentSet = new Set(recent.current.slice(-10));
    if (recentSet.size === 0) return [];
    const denom = Math.max(3, Math.min(8, recentSet.size));
    const scored: { entry: SlideEntry; score: number }[] = [];
    for (const e of indexRef.current) {
      if (e.tokens.length === 0) continue;
      const et = new Set(e.tokens);
      let hit = 0;
      for (const t of recentSet) if (et.has(t)) hit++;
      if (hit > 0) scored.push({ entry: e, score: hit / denom });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  const entryKey = (e: SlideEntry) => `${e.presUuid}:${e.index}`;
  const curEntry = (): SlideEntry | null =>
    indexRef.current.find((e) => entryKey(e) === curKey.current) ?? null;

  // Build the short candidate list handed to Gemini: the whole current song
  // (so line-by-line advance is robust even when a line shares few words) plus
  // the global top matches (so a new song is in play), deduped + capped.
  function candidateSet(localTop: { entry: SlideEntry; score: number }[]): SlideEntry[] {
    const map = new Map<string, SlideEntry>();
    const add = (e: SlideEntry) => {
      const k = entryKey(e);
      if (!map.has(k)) map.set(k, e);
    };
    const curSong = curEntry()?.song ?? localTop[0]?.entry.song;
    if (curSong) for (const e of indexRef.current) if (e.song === curSong) add(e);
    for (const t of localTop) add(t.entry);
    return Array.from(map.values()).slice(0, 16);
  }

  // Decide which slide we're on for the latest transcript and trigger it.
  // With Gemini on, the local matcher narrows the field and Gemini makes the
  // fine pick; if Gemini is off or errors, the local match is used directly.
  async function evaluate(latestText: string) {
    const localTop = topMatches(8);
    if (localTop.length === 0) return;

    let chosen = localTop[0].entry;
    let confidence = localTop[0].score;
    let via: "gemini" | "local" = "local";

    if (geminiRef.current && Date.now() >= geminiBackoffUntil.current) {
      if (inFlight.current) return; // a Gemini decision is already pending
      const cands = candidateSet(localTop);
      inFlight.current = true;
      try {
        const res = await geminiPickSlide(
          recentRaw.current,
          cands.map((e) => ({ song: e.song, section: e.section, text: e.text })),
        );
        via = "gemini";
        geminiBackoffUntil.current = 0; // healthy again
        setGeminiNote(null);
        if (res && res.choice >= 0 && res.choice < cands.length) {
          chosen = cands[res.choice];
          confidence = res.confidence;
        } else {
          // Gemini saw no fit — don't fire on a stale local guess.
          confidence = 0;
        }
      } catch (e) {
        // Network / key / quota failure: fall back to the local guess and
        // back off so we don't keep hammering a blocked quota.
        via = "local";
        const msg = String(e);
        const quota = /429|quota|rate.?limit|resource_exhausted/i.test(msg);
        geminiBackoffUntil.current = Date.now() + (quota ? 120_000 : 20_000);
        setGeminiNote(
          quota
            ? "Gemini rate-limited (quota) — using local matching"
            : "Gemini unreachable — using local matching",
        );
      } finally {
        inFlight.current = false;
      }
    }

    if (!armedRef.current) return; // disarmed during the await
    setStatus({
      song: chosen.song,
      slide: chosen.index,
      confidence,
      text: latestText,
      via,
    });
    const key = entryKey(chosen);
    const now = Date.now();
    if (
      confidence >= sensRef.current &&
      key !== curKey.current &&
      now - lastTrig.current > 1500
    ) {
      // Trigger THROUGH the playlist (like the slide grid) so ProPresenter stays
      // in the Sunday playlist with the item's own arrangement/destination and the
      // slide's actions fire — firing the presentation directly grabbed the
      // LIBRARY copy and pulled Pro out of the playlist. alreadyActive skips
      // re-triggering the item (which would flash its first slide).
      const plId = armedPlaylistRef.current;
      if (plId) {
        ppPlaylistTrigger(
          plId,
          chosen.itemIdx,
          chosen.index,
          chosen.presUuid === activeUuidRef.current,
        ).catch(() => {});
      } else {
        ppFocusTrigger(chosen.presUuid, chosen.index).catch(() => {});
      }
      curKey.current = key;
      lastTrig.current = now;
    }
  }

  // Consume the transcription stream.
  useEffect(() => {
    const sub = on<{ text: string }>("caption:line", (c) => {
      if (!armedRef.current || !c?.text) return;
      recent.current = [...recent.current, ...tokenize(c.text)].slice(-14);
      recentRaw.current = `${recentRaw.current} ${c.text}`
        .split(/\s+/)
        .filter(Boolean)
        .slice(-40)
        .join(" ");
      void evaluate(c.text);
    });
    return () => {
      sub.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: LyricFollowCtx = {
    armed,
    ready,
    building,
    playlistId,
    playlists,
    status,
    sensitivity,
    slideCount,
    geminiEnabled,
    geminiNote,
    setPlaylist: (id) => {
      setPlaylistId(id);
      if (id) localStorage.setItem("prodeck.followPlaylist", id);
      else localStorage.removeItem("prodeck.followPlaylist");
    },
    setSensitivity: (n) => {
      setSensitivityState(n);
      localStorage.setItem("prodeck.followSens", String(n));
    },
    arm: () => {
      if (!playlistId) return;
      recent.current = [];
      recentRaw.current = "";
      curKey.current = null;
      inFlight.current = false;
      geminiBackoffUntil.current = 0;
      setGeminiNote(null);
      setArmed(true);
      refreshGemini(); // pick up any Settings change made before arming
      startTranscription().catch(() => {});
      buildIndex(playlistId);
    },
    disarm: () => {
      setArmed(false);
      stopTranscription().catch(() => {});
      setStatus(EMPTY);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLyricFollow(): LyricFollowCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLyricFollow must be used within LyricFollowProvider");
  return ctx;
}
