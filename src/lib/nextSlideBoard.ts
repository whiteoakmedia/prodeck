// The Next Slide leaderboard across every church, phone side. The board lives
// on the crew server (crew-cloud/src/board.ts); this phone keeps a random
// player id, the nickname the player chose, and this week's best. Nothing is
// posted until the player saves a nickname once. Shown to crew at every
// church: nickname, the church's crew name and the best streak.

import { crewUrl, edgeFetch, getWebToken } from "./tauri";
import { readBest } from "./nextSlide";
import { weekKey } from "./weekKey";

const PLAYER_KEY = "prodeck.nextSlidePlayer";
const NICK_KEY = "prodeck.nextSlideNick";
const WEEK_KEY = "prodeck.nextSlideWeek";

const get = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const set = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private storage: lasts this visit */
  }
};

/** This phone's random player id (nothing about the person in it). */
export function playerId(): string {
  let id = get(PLAYER_KEY);
  if (!/^[a-z0-9]{16,40}$/.test(id)) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    set(PLAYER_KEY, id);
  }
  return id;
}

export const savedNick = () => get(NICK_KEY);
export const saveNick = (nick: string) => set(NICK_KEY, nick.trim().replace(/\s+/g, " "));

/** A first suggestion: the first name the crew app already knows. */
export function suggestNick(crewName: string): string {
  return (crewName.trim().split(/\s+/)[0] ?? "").slice(0, 16);
}

/** This week's best on this phone, given what's stored and the time now. */
export function weekBestFrom(stored: string, now: number): number {
  try {
    const v = JSON.parse(stored) as { week?: string; best?: number };
    return v.week === weekKey(now) && Number.isFinite(v.best) ? Number(v.best) : 0;
  } catch {
    return 0;
  }
}
export const weekBest = (now = Date.now()) => weekBestFrom(get(WEEK_KEY), now);

/** A run ended with this streak: keep this week's best. */
export function recordRun(streak: number, now = Date.now()) {
  if (streak > weekBest(now)) set(WEEK_KEY, JSON.stringify({ week: weekKey(now), best: streak }));
}

export interface BoardRow {
  rank: number;
  nick: string;
  church: string;
  best: number;
}
export interface Board {
  week: { key: string; top: BoardRow[]; you: { rank: number; best: number } | null };
  all: { top: BoardRow[]; you: { rank: number; best: number } | null };
}

/**
 * The crew server, wherever this page is: the church's crew address first
 * (the board is only there, not on a church's own domain), then the usual
 * places the booth-off copy comes from.
 */
async function boardFetch(path: string, init?: RequestInit): Promise<Response> {
  const crew = crewUrl();
  if (crew) {
    try {
      const r = await fetch(`${crew}/edge${path}`, init);
      if ((r.headers.get("content-type") ?? "").includes("json")) return r;
    } catch {
      /* try the page's own server */
    }
  }
  return edgeFetch(path, init);
}

export async function loadBoard(): Promise<Board> {
  const r = await boardFetch(`/game/board?token=${encodeURIComponent(getWebToken())}&player=${playerId()}`);
  const j = (await r.json()) as Board & { error?: string };
  if (!r.ok) throw new Error(j.error || "The leaderboard isn't reachable right now.");
  return j;
}

/** Post this phone's bests. Only once a nickname is saved. */
export async function submit(nick = savedNick()): Promise<Board | null> {
  if (!nick) return null;
  const r = await boardFetch("/game/score", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: getWebToken(), player: playerId(), nick, week: weekBest(), all: readBest() }),
  });
  const j = (await r.json()) as Board & { error?: string };
  if (!r.ok) throw new Error(j.error || "That didn't reach the leaderboard.");
  return j;
}
