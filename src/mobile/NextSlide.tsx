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
import { nickProblem } from "../lib/boardNick";
import {
  loadBoard,
  recordRun,
  saveNick,
  savedNick,
  submit,
  suggestNick,
  type Board,
  type BoardRow,
} from "../lib/nextSlideBoard";

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
  const [board, setBoard] = useState(false);

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
      recordRun(s);
      if (s > best) {
        setBest(s);
        saveBest(s);
      }
    } else {
      // The run's over: its best goes on the board (once there's a nickname).
      if (streak > 0) post();
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

  /** Post this phone's bests to the all churches board, quietly. */
  function post() {
    submit().catch(() => {});
  }

  function close() {
    cancelAnimationFrame(raf.current);
    if (streak > 0) post();
    onClose();
  }

  function openBoard() {
    // The board pauses the game: the line being sung is let go.
    cancelAnimationFrame(raf.current);
    if (streak > 0) post();
    setStreak(0);
    setVerdict(null);
    setPhase("ready");
    setBoard(true);
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
        <div className="ns-top-actions">
          <button className="ns-board-btn" onClick={openBoard}>
            Leaderboard
          </button>
          <button className="ns-close" onClick={close} aria-label="Close the game">
            ✕
          </button>
        </div>
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
      {board && <BoardPanel onClose={() => setBoard(false)} />}
    </div>
  );
}

/**
 * The all churches leaderboard: this week (from Monday morning) and all time.
 * A player is on it once they save a nickname; their church shows as its
 * crew name. Everyone signed in sees it.
 */
function BoardPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"week" | "all">("week");
  const [data, setData] = useState<Board | null>(null);
  const [err, setErr] = useState("");
  const [nick, setNick] = useState(() => savedNick() || suggestNick(localStorage.getItem("prodeck.crewName") ?? ""));
  const [editing, setEditing] = useState(() => !savedNick());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadBoard()
      .then(setData)
      .catch((e) => setErr(String((e as Error)?.message ?? e)));
  }, []);

  const problem = nickProblem(nick);
  async function save() {
    if (problem || busy) return;
    setBusy(true);
    setErr("");
    try {
      saveNick(nick);
      const b = await submit(nick.trim().replace(/\s+/g, " "));
      if (b) setData(b);
      setEditing(false);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const view = data ? (tab === "week" ? data.week : data.all) : null;
  const you = view?.you ?? null;

  return (
    <div className="ns-board" role="dialog" aria-label="Leaderboard">
      <div className="ns-top">
        <div>
          <div className="ns-title">Leaderboard</div>
          <div className="ns-song">Every church on ProDeck</div>
        </div>
        <button className="ns-close" onClick={onClose} aria-label="Back to the game">
          ✕
        </button>
      </div>

      <div className="ns-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "week"} className={tab === "week" ? "on" : ""} onClick={() => setTab("week")}>
          This week
        </button>
        <button role="tab" aria-selected={tab === "all"} className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>
          All time
        </button>
      </div>

      <ol className="ns-rows">
        {view?.top.map((r: BoardRow) => (
          <li key={`${r.rank}${r.nick}${r.church}`} className="ns-row">
            <span className="ns-rank">{r.rank}</span>
            <span className="ns-who">
              <span className="ns-nick">{r.nick}</span>
              <span className="ns-church">{r.church}</span>
            </span>
            <span className="ns-best">{r.best}</span>
          </li>
        ))}
        {view && view.top.length === 0 && (
          <li className="ns-empty">{tab === "week" ? "Nobody yet this week. Be the first." : "Nobody yet."}</li>
        )}
        {!view && !err && <li className="ns-empty">Loading</li>}
      </ol>

      {you && (
        <div className="ns-you">
          You: {ordinal(you.rank)}, best {you.best}
        </div>
      )}

      {editing ? (
        <div className="ns-nick-card">
          <label htmlFor="ns-nick">Your name on the board</label>
          <div className="ns-nick-row">
            <input
              id="ns-nick"
              className="crew-input"
              value={nick}
              maxLength={16}
              onChange={(e) => setNick(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void save()}
            />
            <button className="ns-save" disabled={!!problem || busy} onClick={() => void save()}>
              {busy ? "Saving" : "Save"}
            </button>
          </div>
          {nick && problem && <p className="ns-nick-problem">{problem}</p>}
          <p className="ns-fine">
            Your nickname, your church's crew name and your best streak are shown to crew at every church using ProDeck.
          </p>
        </div>
      ) : (
        <div className="ns-nick-done">
          On the board as <strong>{savedNick()}</strong>
          <button className="crew-link" onClick={() => setEditing(true)}>
            Change
          </button>
        </div>
      )}
      {err && <p className="ns-nick-problem">{err}</p>}
    </div>
  );
}

function ordinal(n: number): string {
  const v = n % 100;
  const s = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}
