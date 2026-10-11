// Walk-in music on every screen.
//
// useMusic() reads what Spotify or Music is doing on the booth (`music:state`,
// from src-tauri/src/music.rs). <WalkInRunner/> runs on the booth only and
// fades the music out so it's silent as each Planning Center service time
// starts (lib/walkIn), once per service.

import { useEffect, useState } from "react";
import { usePco } from "./pcoStore";
import { useProDeck } from "./store";
import { IS_DEMO, IS_WEB, musicControl, musicState, on, type MusicState } from "./lib/tauri";
import { fadeDue } from "./lib/walkIn";

const DONE_KEY = "prodeck.walkInFaded";

export function useMusic(): MusicState | null {
  const [s, setS] = useState<MusicState | null>(null);
  useEffect(() => {
    let alive = true;
    musicState()
      .then((v) => alive && setS(v))
      .catch(() => {});
    const un = on<MusicState>("music:state", (v) => alive && setS(v));
    return () => {
      alive = false;
      un.then((f) => f());
    };
  }, []);
  return s;
}

function loadDone(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DONE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function WalkInRunner() {
  const { settings } = useProDeck();
  const { serviceTimes } = usePco();
  const on = !IS_WEB && !IS_DEMO && !!settings?.music_app && settings.music_auto_fade !== false;
  const secs = settings?.music_fade_secs ?? 15;

  useEffect(() => {
    if (!on) return;
    const tick = () => {
      const done = loadDone();
      const plan = fadeDue(serviceTimes, Date.now(), secs, done);
      if (!plan) return;
      // Recorded before fading, so a slow fade is never started twice.
      try {
        localStorage.setItem(DONE_KEY, JSON.stringify([...done, plan.timeId].slice(-30)));
      } catch {
        /* worst case it fades again next tick, which finds the music paused */
      }
      musicState()
        .then((m) => {
          if (m.state === "playing") return musicControl("fade_out", plan.secs);
        })
        .catch(() => {});
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [on, secs, serviceTimes]);

  return null;
}
