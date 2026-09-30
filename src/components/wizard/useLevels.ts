import { useEffect, useRef, useState } from "react";
import { IS_WEB, on } from "../../lib/tauri";

/** ProDeck's audio input, each channel's level in dBFS, ~6 times a second. */
export function useLevels(enabled = true): number[] {
  const [levels, setLevels] = useState<number[]>([]);
  const pending = useRef<number[] | null>(null);
  useEffect(() => {
    if (IS_WEB || !enabled) return;
    const u = on<number[]>("audio:channels_rms", (lv) => {
      if (Array.isArray(lv)) pending.current = lv;
    });
    const iv = setInterval(() => {
      if (pending.current) {
        setLevels(pending.current);
        pending.current = null;
      }
    }, 160);
    return () => {
      clearInterval(iv);
      u.then((f) => f());
    };
  }, [enabled]);
  return levels;
}

/** The loudest a channel has been since this step opened: a guitar plays for
 *  two seconds and its row stays lit, so nobody has to watch the meters. */
export function usePeakHold(levels: number[]): number[] {
  const [held, setHeld] = useState<number[]>([]);
  useEffect(() => {
    if (!levels.length) return;
    setHeld((prev) => levels.map((v, i) => Math.max(v, prev[i] ?? -120)));
  }, [levels]);
  return held;
}
