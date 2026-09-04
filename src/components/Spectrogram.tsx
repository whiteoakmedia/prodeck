import { useEffect, useRef } from "react";
import { on } from "../lib/tauri";

// dB → heat color (near-silent deep blue → red for hot).
const STOPS = [
  [10, 14, 34],
  [22, 60, 130],
  [20, 165, 165],
  [45, 180, 75],
  [222, 200, 55],
  [232, 72, 48],
];
function heat(db: number): string {
  const t = Math.max(0, Math.min(1, (db + 72) / 60)); // -72..-12 → 0..1
  const x = t * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  const c = (k: number) => Math.round(a[k] + (b[k] - a[k]) * f);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
}

// Scrolling waterfall: x = time (newest at right), y = frequency (log; lows at
// the bottom), color = level. Shows tonal history over ~the last 20–30 seconds.
export function Spectrogram() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const w = Math.max(2, Math.floor(canvas.clientWidth));
      const h = Math.max(2, Math.floor(canvas.clientHeight));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        ctx.fillStyle = "#0b0e14";
        ctx.fillRect(0, 0, w, h);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const sub = on<number[]>("audio:rta", (bands) => {
      const w = canvas.width;
      const h = canvas.height;
      if (w < 2 || !bands || bands.length === 0) return;
      // Scroll existing image one pixel left, then paint the newest column.
      ctx.drawImage(canvas, -1, 0);
      const nb = bands.length;
      for (let y = 0; y < h; y++) {
        const frac = 1 - y / h; // bottom = 0 (low freq), top = 1 (high freq)
        const bi = Math.min(nb - 1, Math.max(0, Math.floor(frac * nb)));
        ctx.fillStyle = heat(bands[bi]);
        ctx.fillRect(w - 1, y, 1, 1);
      }
    });

    return () => {
      ro.disconnect();
      sub.then((f) => f());
    };
  }, []);

  return (
    <div className="w-spectrogram">
      <canvas ref={ref} className="spectrogram-canvas" />
      <div className="spectrogram-axis">
        <span>16k</span>
        <span>1k</span>
        <span>250</span>
        <span>63</span>
      </div>
    </div>
  );
}
