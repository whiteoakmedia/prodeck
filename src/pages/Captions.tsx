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
        <h1>Captions</h1>
        <span className={`chip ${audioRunning ? "online" : ""}`}>
          {captionStatus}
        </span>
      </header>

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

      <AutoFollowCard />

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
  const conf = Math.round(lf.status.confidence * 100);
  return (
    <section className="card">
      <div className="card-head">
        <h3>Auto‑Follow ProPresenter</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            className={`chip ${lf.geminiEnabled ? "online" : ""}`}
            title={
              lf.geminiEnabled
                ? "Gemini smart matching is on (Settings → Gemini)"
                : "Using local word-overlap matching. Turn on Gemini in Settings for better accuracy."
            }
          >
            {lf.geminiEnabled ? "✨ Gemini" : "local match"}
          </span>
          <span className={`chip ${lf.armed ? "online" : ""}`}>
            {lf.armed ? (lf.building ? "indexing…" : "following") : "off"}
          </span>
        </div>
      </div>
      {/* Three sentences, in the order a volunteer needs them: what it does,
          how to start, how to take it back. Setup jargon stays in Settings. */}
      <p className="muted small">
        Auto-follow listens to the singing and advances ProPresenter slides by
        itself. To run it: press <strong>Start Listening</strong> above (pick
        the lead-vocal mic — a full band mix is hard to recognize), choose the
        playlist, then <strong>Start auto-follow</strong>. If it ever jumps to
        the wrong slide, press <strong>Stop follow</strong> and click slides
        yourself — nothing breaks.
      </p>
      <div className="controls-row">
        <select
          className="input"
          value={lf.playlistId ?? ""}
          onChange={(e) => lf.setPlaylist(e.target.value || null)}
          disabled={lf.armed}
        >
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
      <label className="af-sens">
        <span>Sensitivity</span>
        <input
          type="range"
          min={0.15}
          max={0.6}
          step={0.05}
          value={lf.sensitivity}
          onChange={(e) => lf.setSensitivity(parseFloat(e.target.value))}
        />
        <span className="muted small">
          {Math.round(lf.sensitivity * 100)}% sure before changing slides —
          drag left to switch faster, right to switch more carefully
        </span>
      </label>
      {lf.geminiNote && (
        <p className="error" style={{ marginTop: 6 }}>
          ⚠ {lf.geminiNote}
        </p>
      )}
      {lf.armed && (
        <div className="af-status">
          <div className="af-now">
            <span className="af-label">NOW</span>
            <span className="af-song">{lf.status.song || "—"}</span>
            {lf.status.slide != null && (
              <span className="af-slide">slide {lf.status.slide + 1}</span>
            )}
            <span className="af-conf" title={lf.status.via ? `matched by ${lf.status.via}` : ""}>
              {conf}%{lf.status.via === "gemini" ? " ✨" : ""}
            </span>
          </div>
          <div className="af-bar">
            <div className="af-fill" style={{ width: `${conf}%` }} />
          </div>
          <div className="af-heard">{lf.status.text || "listening…"}</div>
          <div className="muted small">
            {lf.ready
              ? `${lf.slideCount} slides indexed`
              : lf.building
                ? "Indexing slides…"
                : "No slides indexed yet"}
          </div>
        </div>
      )}
    </section>
  );
}
