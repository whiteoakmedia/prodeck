import { useEffect, useRef, useState } from "react";
import {
  HYMNS,
  VERDICT_TEXT,
  judge,
  gapAfter,
  lineDuration,
  tempo,
  missed,
  nextLine,
  onTime,
  readBest,
  saveBest,
  wordsLit,
  type Verdict,
} from "../lib/nextSlide";

// Next Slide (lib/nextSlide.ts): a stage screen shows a lyric line lighting up
// word by word; tap Next slide as the last word lands. A confidence monitor
// strip underneath shows the line coming up, like the real one. Silent: no
// sound and no vibration, so it's safe in the room during a service.

type Phase = "ready" | "singing" | "result";

export function NextSlide({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [pos, setPos] = useState({ song: 0, line: 0 });
  const [streak, setStreak] = useState(0);
  // Slides shown this game: the song gets quicker with every one.
  const [slides, setSlides] = useState(0);
  const [best, setBest] = useState(readBest);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const start = useRef(0);
  const raf = useRef(0);

  const text = HYMNS[pos.song].lines[pos.line];
  const words = text.split(" ");
  const duration = lineDuration(words.length, slides, streak);
  const up = nextLine(pos.song, pos.line);
  const upText = HYMNS[up.song].lines[up.line];

  // The singing clock: runs while a line is being sung.
  useEffect(() => {
    if (phase !== "singing") return;
    start.current = performance.now();
    setElapsed(0);
    const tick = () => {
      const e = performance.now() - start.current;
      setElapsed(e);
      if (missed(e, duration)) return finish("missed", e);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, pos]);

  function finish(v: Verdict, at: number) {
    cancelAnimationFrame(raf.current);
    // The screen freezes where the tap landed: an early tap shows the words
    // the room never got to sing.
    setElapsed(at);
    setVerdict(v);
    setPhase("result");
    setSlides((n) => n + 1);
    if (onTime(v)) {
      const s = streak + 1;
      setStreak(s);
      if (s > best) {
        setBest(s);
        saveBest(s);
      }
    } else {
      setStreak(0);
    }
    // On to the next line by itself: a clean change keeps the song moving.
    window.setTimeout(
      () => {
        setPos((p) => nextLine(p.song, p.line));
        setVerdict(null);
        setPhase("singing");
      },
      gapAfter(onTime(v), slides, streak),
    );
  }

  function tap() {
    if (phase === "ready") return setPhase("singing");
    if (phase !== "singing") return;
    const at = performance.now() - start.current;
    finish(judge(at, duration), at);
  }

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const lit = phase === "ready" ? 0 : wordsLit(elapsed, duration, words.length);
  const good = verdict ? onTime(verdict) : true;

  return (
    <div className="ns-sheet" role="dialog" aria-label="Next Slide">
      <div className="ns-top">
        <div>
          <div className="ns-title">Next Slide</div>
          <div className="ns-song">{HYMNS[pos.song].title}</div>
        </div>
        <button className="ns-close" onClick={onClose} aria-label="Close the game">
          ✕
        </button>
      </div>

      <div className={`ns-screen${verdict && !good ? " off" : ""}`} aria-live="polite">
        {phase === "ready" ? (
          <p className="ns-intro">
            Change the slide right as the last word is sung. Too early cuts the line off. Too late leaves the room
            waiting.
          </p>
        ) : (
          <p className="ns-line">
            {words.map((w, i) => (
              <span key={i} className={i < lit ? "sung" : ""}>
                {w}{" "}
              </span>
            ))}
          </p>
        )}
        {verdict && <div className={`ns-verdict ${good ? "good" : "bad"}`}>{VERDICT_TEXT[verdict]}</div>}
      </div>

      <div className="ns-confidence">
        <span className="ns-next-label">Next</span>
        <span className="ns-next-text">{phase === "ready" ? text : upText}</span>
      </div>

      <div className="ns-stats">
        <div>
          <div className="ns-stat">{streak}</div>
          <div className="ns-stat-label">Streak</div>
        </div>
        <div>
          <div className="ns-stat">{tempo(slides, streak).toFixed(1)}x</div>
          <div className="ns-stat-label">Tempo</div>
        </div>
        <div>
          <div className="ns-stat">{best}</div>
          <div className="ns-stat-label">Your best</div>
        </div>
      </div>

      <button className="ns-go" onPointerDown={tap}>
        {phase === "ready" ? "Start" : "Next slide"}
      </button>
    </div>
  );
}
