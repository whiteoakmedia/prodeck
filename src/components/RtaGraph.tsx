import { useEffect, useRef, useState } from "react";

// Matches the backend band range (compute_bands: 31.5 Hz .. 16 kHz log-spaced).
const FMIN = 31.5;
const FMAX = 16000;
const FREQS = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
// Fixed display floor: the noise floor of a quiet room sits around −115 dB and
// below, so anything under FLOOR reads as empty (no fake "sub" from amplified
// noise). Real program material is far above this and still fills the graph.
const FLOOR = -105;
const MIN_RANGE = 45; // never compress tighter than this many dB
const SIGNAL_DB = -95; // a band must beat this to count as real signal (not noise)

const xPct = (f: number) =>
  ((Math.log(f) - Math.log(FMIN)) / (Math.log(FMAX) - Math.log(FMIN))) * 100;
const flabel = (f: number) => (f >= 1000 ? `${f / 1000}k` : `${f}`);

// Canvas spectrum analyzer: full-height gradient bars with fast-attack/slow-decay
// motion, auto-gain (so it always fills the graph), peak-hold caps, and an
// optional long-term average "tonal balance" trace.
export function RtaGraph({ bands, axis = true }: { bands: number[]; axis?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bandsRef = useRef<number[]>(bands);
  bandsRef.current = bands;

  const disp = useRef<number[]>([]); // smoothed bar heights (0..1)
  const peak = useRef<number[]>([]); // peak-hold (0..1)
  const top = useRef<number>(-25); // rolling loudest band (dB) for auto-gain
  const avgSum = useRef<number[]>([]);
  const avgN = useRef(0);
  const showAvgRef = useRef(true);

  const [showAvg, setShowAvg] = useState(true);
  const [resetTick, setResetTick] = useState(0);
  const [tilt, setTilt] = useState<{ label: string; cls: string } | null>(null);
  showAvgRef.current = showAvg;

  // Accumulate the long-term average in the power domain + derive tonal tilt.
  useEffect(() => {
    const b = bands;
    if (!b.length) return;
    if (avgSum.current.length !== b.length) {
      avgSum.current = new Array(b.length).fill(0);
      avgN.current = 0;
    }
    for (let i = 0; i < b.length; i++) avgSum.current[i] += Math.pow(10, b[i] / 10);
    avgN.current += 1;
    if (avgN.current % 8 === 0) {
      const n = avgN.current;
      const adb = b.map((_, i) => 10 * Math.log10(avgSum.current[i] / n + 1e-12));
      // Only judge tonal balance when there's real signal — a bare noise floor
      // is meaningless (and naturally low-heavy), so don't label it.
      if (Math.max(...adb) < SIGNAL_DB) {
        setTilt(null);
      } else {
        const third = Math.floor(adb.length / 3);
        const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
        const d = mean(adb.slice(0, third)) - mean(adb.slice(adb.length - third));
        setTilt(
          d > 6
            ? { label: "Low‑heavy", cls: "lo" }
            : d < -6
              ? { label: "High‑heavy", cls: "hi" }
              : { label: "Balanced", cls: "ok" },
        );
      }
    }
  }, [bands]);

  useEffect(() => {
    avgSum.current = [];
    avgN.current = 0;
    setTilt(null);
  }, [resetTick]);

  // Animation loop — smooth 60fps motion off the ~15fps data.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (cw < 2 || ch < 2) return;
      const W = Math.round(cw * dpr);
      const H = Math.round(ch * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      const b = bandsRef.current;
      const nb = b.length;
      ctx.clearRect(0, 0, W, H);
      if (nb === 0) return;
      if (disp.current.length !== nb) {
        disp.current = new Array(nb).fill(0);
        peak.current = new Array(nb).fill(0);
      }

      // Fixed floor + adaptive top: the top tracks the signal (so it stays lively
      // across program levels) but the FLOOR is fixed, so a quiet noise floor
      // reads as empty instead of being stretched to fill the graph.
      let curMax = -160;
      for (let i = 0; i < nb; i++) if (b[i] > curMax) curMax = b[i];
      const target = curMax + 4; // a little headroom above the loudest band
      top.current = target > top.current ? target : top.current - 0.04;
      const dispTop = Math.max(FLOOR + MIN_RANGE, Math.min(-18, top.current));
      const range = dispTop - FLOOR;
      const norm = (db: number) => Math.max(0, Math.min(1, (db - FLOOR) / range));

      // dB grid.
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      for (const p of [0.25, 0.5, 0.75]) {
        const y = Math.round(H * (1 - p)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      // Full-height gradient (green low → yellow → red hot); each bar reveals the
      // slice of the gradient up to its height — the classic analyzer look.
      const grad = ctx.createLinearGradient(0, H, 0, 0);
      grad.addColorStop(0.0, "#19c37d");
      grad.addColorStop(0.5, "#8fe04a");
      grad.addColorStop(0.78, "#f5c518");
      grad.addColorStop(1.0, "#ff4d4d");

      const slot = W / nb;
      const gap = Math.max(1 * dpr, slot * 0.16);
      const bw = Math.max(1, slot - gap);
      const r = Math.min(bw / 2, 3 * dpr);

      for (let i = 0; i < nb; i++) {
        const t = norm(b[i]);
        // Fast attack, slow decay for fluid motion.
        disp.current[i] = t > disp.current[i] ? t : disp.current[i] * 0.84 + t * 0.16;
        peak.current[i] =
          disp.current[i] > peak.current[i]
            ? disp.current[i]
            : Math.max(disp.current[i], peak.current[i] - 0.012);

        const x = i * slot + gap / 2;
        const bh = Math.max(1, disp.current[i] * H);
        const y = H - bh;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x, H);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.lineTo(x + bw - r, y);
        ctx.arcTo(x + bw, y, x + bw, y + r, r);
        ctx.lineTo(x + bw, H);
        ctx.closePath();
        ctx.fill();

        // Peak-hold cap.
        const py = H - peak.current[i] * H;
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillRect(x, py - 1.5 * dpr, bw, 1.5 * dpr);
      }

      // Average tonal-balance trace.
      if (showAvgRef.current && avgN.current > 4 && avgSum.current.length === nb) {
        const n = avgN.current;
        ctx.beginPath();
        for (let i = 0; i < nb; i++) {
          const adb = 10 * Math.log10(avgSum.current[i] / n + 1e-12);
          const x = i * slot + slot / 2;
          const y = H - norm(adb) * H;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "rgba(170,200,255,0.95)";
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="rta-graph">
      <div className="rta-canvas-wrap">
        <canvas ref={canvasRef} className="rta-canvas" />
        <div className="rta-tools" onMouseDown={(e) => e.stopPropagation()}>
          {tilt && (
            <span className={`rta-tilt ${tilt.cls}`} title="Average tonal balance since reset">
              {tilt.label}
            </span>
          )}
          <button
            className={`rta-btn ${showAvg ? "on" : ""}`}
            title="Show/hide the average tonal-balance curve"
            onClick={() => setShowAvg((v) => !v)}
          >
            avg
          </button>
          <button
            className="rta-btn"
            title="Reset the average (e.g. at the start of a song)"
            onClick={() => setResetTick((t) => t + 1)}
          >
            ⟲
          </button>
        </div>
      </div>
      {axis && (
        <div className="rta-axis">
          {FREQS.map((f) => (
            <span key={f} className="rta-freq" style={{ left: `${xPct(f)}%` }}>
              {flabel(f)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
