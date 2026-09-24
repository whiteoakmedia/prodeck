import { useEffect, useRef, useState } from "react";
import { useProDeck } from "../store";
import { useLyricFollow } from "../lyricFollow";
import { Icon } from "../components/Icon";
import {
  defaultAudioInput,
  injectCaption,
  listAudioInputs,
  startAudioCapture,
  startTranscription,
  stopAudioCapture,
  stopTranscription,
  transcriptionStatus,
  type TranscriptionConfig,
} from "../lib/tauri";

export function Captions() {
  const { captions, captionStatus, audioLevel, audioRunning, clearCaptions } =
    useProDeck();
  const [inputs, setInputs] = useState<string[]>([]);
  const [device, setDevice] = useState<string>("");
  const [cfg, setCfg] = useState<TranscriptionConfig | null>(null);
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listAudioInputs().then(setInputs);
    defaultAudioInput().then((d) => d && setDevice(d));
    transcriptionStatus().then(setCfg);
  }, []);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [captions]);

  async function start() {
    setError("");
    try {
      await startAudioCapture(device || null);
      await startTranscription();
    } catch (e) {
      setError(String(e));
    }
  }

  async function stop() {
    await stopTranscription();
    await stopAudioCapture();
  }

  const last = captions[captions.length - 1];

  return (
    <div className="page">
      <header className="page-head">
        <h1>Auto-Follow</h1>
        <span className={`chip ${audioRunning ? "online" : ""}`}>
          {captionStatus}
        </span>
      </header>

      <AutoFollowCard />

      {cfg && !cfg.configured && (
        <div className="banner warn">
          Live captions aren't set up on this Mac yet — that's a one-time admin
          job (a speech-to-text engine under Settings → Audio &amp; Captions).
          You can still test the on-screen caption bar with the manual input
          below.
        </div>
      )}

      <section className="card">
        <div className="controls-row">
          <select
            className="input"
            value={device}
            onChange={(e) => setDevice(e.target.value)}
          >
            {inputs.length === 0 && <option value="">Default input</option>}
            {inputs.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
          {audioRunning ? (
            <button className="btn danger" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="btn primary" onClick={start}>
              <Icon name="mic" size={15} /> Start Listening
            </button>
          )}
        </div>
        <div className="level-bar tall">
          <div
            className="level-fill"
            style={{ width: `${Math.min(100, audioLevel * 240)}%` }}
          />
        </div>
        {error && <p className="error">{error}</p>}
      </section>


      <section className="card lower-third-preview">
        <div className="card-head">
          <h3>Lower-Third Preview</h3>
        </div>
        <div className="lt-stage">
          {last ? <div className="lt-text">{last.text}</div> : null}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Transcript</h3>
          <button className="btn ghost small" onClick={clearCaptions}>
            Clear
          </button>
        </div>
        <div className="caption-feed" ref={feedRef}>
          {captions.length === 0 ? (
            <p className="muted">No captions yet.</p>
          ) : (
            captions.map((c, i) => (
              <p key={`${c.ts}-${i}`} className="caption-line">
                <span className="caption-time">
                  {new Date(c.ts).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                {c.text}
              </p>
            ))
          )}
        </div>
        <div className="field-row" style={{ marginTop: 12 }}>
          <input
            className="input"
            value={manual}
            placeholder="Type a caption to push to the lower-third…"
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && manual.trim()) {
                injectCaption(manual.trim());
                setManual("");
              }
            }}
          />
          <button
            className="btn"
            onClick={() => {
              if (manual.trim()) {
                injectCaption(manual.trim());
                setManual("");
              }
            }}
          >
            Push
          </button>
        </div>
      </section>
    </div>
  );
}

// Full-auto lyric follow: drives ProPresenter slides from the live audio.
function AutoFollowCard() {
  const lf = useLyricFollow();
  const v = lf.view;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!lf.armed) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [lf.armed]);
  const due = v.dueAt != null && v.slideStartedAt != null ? { left: Math.max(0, v.dueAt - now), frac: Math.min(1, (now - v.slideStartedAt) / Math.max(1, v.dueAt - v.slideStartedAt)) } : null;
  const via = { heard: "heard it", clock: "on the clock", model: "the model read the lyric", pro: "moved in ProPresenter" } as const;
  const hearing = { words: "hearing words", music: "music only", quiet: "quiet", idle: "idle" } as const;
  return (
    <section className="card">
      <div className="card-head">
        <h3>Auto‑Follow ProPresenter</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {lf.armed && <span className={`chip ${v.hearing === "words" ? "online" : ""}`}>{hearing[v.hearing]}</span>}
          <span
            className={`chip ${lf.modelReady ? "online" : ""}`}
            title={
              lf.modelReady
                ? "When two slides are equally likely, Follow asks Claude (Haiku) to read the lyric — a few times a song, on its own monthly budget."
                : "No Anthropic key (Settings → Troubleshooter): Follow decides by ear alone."
            }
          >
            {lf.modelReady ? "model on standby" : "by ear only"}
          </span>
          <span className={`chip ${lf.armed ? "online" : ""}`}>{lf.armed ? (lf.building ? "reading playlist…" : "following") : "off"}</span>
        </div>
      </div>
      {/* What it does, how to start, how to take it back. */}
      <p className="muted small">
        Follow listens to the board mix, finds the song in the playlist, and changes the slide as each slide's last line
        finishes — a beat early rather than late. It learns how long every slide lasts from rehearsal and Sunday, and uses
        each song's BPM from Planning Center. Choose the playlist and press <strong>Start auto‑follow</strong>. Clicking a
        slide in ProPresenter always wins; Follow picks up from there.
      </p>
      <div className="controls-row">
        <select className="input" value={lf.playlistId ?? ""} onChange={(e) => lf.setPlaylist(e.target.value || null)} disabled={lf.armed}>
          <option value="">Follow which playlist…</option>
          {lf.playlists.map((p) => (
            <option key={p.uuid} value={p.uuid}>
              {p.name}
            </option>
          ))}
        </select>
        {lf.armed ? (
          <button className="btn danger" onClick={lf.disarm}>
            Stop follow
          </button>
        ) : (
          <button className="btn primary" onClick={lf.arm} disabled={!lf.playlistId}>
            Start auto‑follow
          </button>
        )}
      </div>
      {lf.modelNote && (
        <p className="error" style={{ marginTop: 6 }}>
          ⚠ {lf.modelNote}
        </p>
      )}
      {lf.armed && (
        <div className="af-status">
          <div className="af-now">
            <span className="af-label">NOW</span>
            <span className="af-song">{v.song || "waiting for a song…"}</span>
            {v.slide != null && (
              <span className="af-slide">
                {v.section ? `${v.section} · ` : ""}slide {v.slide + 1}
              </span>
            )}
            {v.bpm ? <span className="af-conf">{Math.round(v.bpm)} BPM</span> : null}
          </div>
          <div className="af-bar" title={due ? "How far through this slide, by the learned clock" : "No learned length for this slide yet"}>
            <div className="af-fill" style={{ width: `${Math.round((due?.frac ?? 0) * 100)}%` }} />
          </div>
          <div className="af-next muted small">
            {due ? (due.left > 0 ? `next slide in ${(due.left / 1000).toFixed(1)} s` : "next slide due now") : v.song ? "next slide when its last line is heard" : ""}
            {v.lastVia ? ` · last move: ${via[v.lastVia]}${v.lastReason && v.lastVia !== "pro" ? ` (${v.lastReason})` : ""}` : ""}
          </div>
          <div className="af-heard">{v.heard || "listening…"}</div>
          <div className="controls-row">
            <button className="btn" onClick={() => lf.nudge(-1)} disabled={v.slide == null}>
              ◀ Back one
            </button>
            <button className="btn" onClick={() => lf.nudge(1)} disabled={v.slide == null}>
              Forward one ▶
            </button>
          </div>
          {lf.songs.length > 0 && (
            <ul className="af-songs">
              {lf.songs.map((s) => (
                <li key={s.name}>
                  <span className="af-song-name">{s.name}</span>
                  <span className="muted small">
                    {s.slides} lyric slides · {s.bpm ? `${Math.round(s.bpm)} BPM` : "no BPM in Planning Center"}
                    {s.learned ? ` · timing learned for ${s.learned}` : " · no timing yet"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!lf.ready && !lf.building && <div className="muted small">No songs found in that playlist.</div>}
        </div>
      )}
    </section>
  );
}
