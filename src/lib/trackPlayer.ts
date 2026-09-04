// In-app playback for song files (masters, stems, click refs). A module-level
// singleton like lib/listen: navigation never kills the track, and the shell
// shows a floating chip with pause/stop while anything is playing. One audio
// source at a time — starting a track stops the Listen stream and vice versa.

import { listenSnapshot, onListen, stopListen } from "./listen";

export type TrackState = "idle" | "loading" | "playing" | "paused";

let el: HTMLAudioElement | null = null;
let state: TrackState = "idle";
let title = "";
let err = "";
let pos = 0;
let dur = 0;
const subs = new Set<() => void>();

function emit() {
  subs.forEach((f) => f());
}

export function trackSnapshot(): {
  state: TrackState;
  title: string;
  err: string;
  pos: number;
  dur: number;
} {
  return { state, title, err, pos, dur };
}

export function onTrack(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

// If the booth Listen stream starts, the track yields (one source at a time).
onListen(() => {
  if (listenSnapshot().state !== "idle" && state !== "idle") stopTrack();
});

function ensure(): HTMLAudioElement {
  if (!el) {
    el = new Audio();
    el.preload = "auto";
    el.addEventListener("ended", () => {
      state = "idle";
      title = "";
      emit();
    });
    el.addEventListener("playing", () => {
      state = "playing";
      emit();
    });
    el.addEventListener("pause", () => {
      if (state === "playing") {
        state = "paused";
        emit();
      }
    });
    el.addEventListener("error", () => {
      if (state !== "idle") {
        state = "idle";
        err = "couldn't play this file";
        emit();
      }
    });
    // Position for the scrubber. timeupdate fires ~4×/s — plenty smooth,
    // no extra timer needed.
    el.addEventListener("timeupdate", () => {
      pos = el?.currentTime ?? 0;
      emit();
    });
    el.addEventListener("durationchange", () => {
      dur = Number.isFinite(el?.duration ?? NaN) ? el!.duration : 0;
      emit();
    });
  }
  return el;
}

export function playTrack(url: string, name: string) {
  stopListen();
  const a = ensure();
  title = name;
  err = "";
  state = "loading";
  emit();
  a.src = url;
  a.play()
    .then(() => {
      state = "playing";
      emit();
    })
    .catch((e: any) => {
      state = "idle";
      err = String(e?.message ?? e);
      emit();
    });
}

export function toggleTrack() {
  if (!el) return;
  if (state === "playing") el.pause();
  else if (state === "paused") el.play().catch(() => {});
}

export function stopTrack() {
  if (el) {
    el.pause();
    el.removeAttribute("src");
    el.load();
  }
  state = "idle";
  title = "";
  pos = 0;
  dur = 0;
  emit();
}

/** Jump to an absolute position (seconds) — the scrubber. */
export function seekTrack(sec: number) {
  if (!el || dur <= 0) return;
  el.currentTime = Math.max(0, Math.min(dur, sec));
  pos = el.currentTime;
  emit();
}

/** Skip relative (±seconds) — the ⏪/⏩ buttons. */
export function skipTrack(delta: number) {
  seekTrack((el?.currentTime ?? 0) + delta);
}

/** Audio by filename — the only metadata PCO gives us reliably. */
export function isAudioFile(name: string): boolean {
  return /\.(mp3|m4a|wav|aac|ogg|aiff?)(\?.*)?$/i.test(name);
}
