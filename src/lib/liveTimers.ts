import { useEffect, useRef, useState } from "react";
import { useProDeck } from "../store";
import { currentTimers, type TimerView } from "./status";
import { ppGet } from "./tauri";

function parseHMS(s: string): number {
  const neg = s.trim().startsWith("-");
  const parts = s.replace("-", "").split(":").map((p) => parseInt(p, 10) || 0);
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return neg ? -sec : sec;
}

function fmtHMS(total: number): string {
  const neg = total < 0;
  const t = Math.round(Math.abs(total));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const body = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return neg ? `-${body}` : body;
}

// uuid -> direction: -1 counts down, +1 counts up. Learned from /v1/timers.
const dirCache: Record<string, 1 | -1> = {};

/**
 * ProPresenter only streams timer updates on state changes, so the value would
 * otherwise freeze between pushes. This hook re-bases on every server push and
 * ticks locally (~4x/sec) so running timers stay smooth and current.
 */
export function useLiveTimers(): TimerView[] {
  const { status, connected } = useProDeck();
  const server = currentTimers(status);
  const [, force] = useState(0);
  const samples = useRef<Record<string, { sec: number; at: number }>>({});
  const sig = server.map((t) => `${t.id}:${t.time}:${t.state}`).join("|");

  // Learn each timer's direction once per connection.
  useEffect(() => {
    if (!connected) return;
    let cancel = false;
    ppGet("timers")
      .then((j: any) => {
        if (cancel || !Array.isArray(j)) return;
        for (const t of j) {
          const uuid = t?.id?.uuid;
          if (!uuid) continue;
          const up = "elapsed" in t || "count_up" in t;
          dirCache[uuid] = up ? 1 : -1;
        }
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [connected]);

  // Re-base the local clock whenever the server pushes new values.
  useEffect(() => {
    const now = Date.now();
    for (const t of server) samples.current[t.id] = { sec: parseHMS(t.time), at: now };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // Drive the local tick.
  useEffect(() => {
    const iv = setInterval(() => force((x) => x + 1), 250);
    return () => clearInterval(iv);
  }, []);

  return server.map((t) => {
    if (t.state !== "running") return t;
    const s = samples.current[t.id];
    if (!s) return t;
    const dir = dirCache[t.id] ?? -1;
    let sec = s.sec + dir * ((Date.now() - s.at) / 1000);
    if (dir < 0 && s.sec >= 0) sec = Math.max(0, sec);
    return { ...t, time: fmtHMS(sec) };
  });
}
