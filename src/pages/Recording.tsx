import { useEffect, useRef, useState } from "react";
import { danteSnapshot, getSettings, IS_WEB, listAudioInputs, multitrackOpen, type DanteSnapshot, multitrackSessions, multitrackVolumes, on, updateSettings, type RecSession, type RecVolume } from "../lib/tauri";
import { useProDeck } from "../store";
import { fmtClock, useRecorder } from "../recorder";
import { requestWizard } from "../lib/wizards";

// The multitrack recorder: what every input is and where it comes from, live,
// and the services recorded so far. The recording itself is Rust
// (multitrack.rs); starting and stopping with the service is recorder.tsx.

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type State = "signal" | "idle" | "none";
const stateOf = (db: number | undefined): State => (db == null || db <= -118 ? "none" : db > -60 ? "signal" : "idle");
const STATE_TEXT: Record<State, string> = { signal: "Signal", idle: "Connected, quiet", none: "No audio" };

export function RecordingPage() {
  const rec = useRecorder();
  const { settings, refreshSettings } = useProDeck();
  const [levels, setLevels] = useState<number[]>([]);
  const [vols, setVols] = useState<RecVolume[]>([]);
  const [inputs, setInputs] = useState<string[]>([]);
  const [sessions, setSessions] = useState<RecSession[]>([]);
  const [show, setShow] = useState<"all" | "signal" | "none">("all");
  const pending = useRef<number[] | null>(null);
  // What each input is actually subscribed to, read live from Dante.
  const [dante, setDante] = useState<DanteSnapshot | null>(null);
  useEffect(() => {
    if (IS_WEB) return;
    danteSnapshot().then(setDante).catch(() => {});
    const u = on<DanteSnapshot>("routing:dante", (d) => d && setDante(d));
    return () => {
      u.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (IS_WEB) return;
    const u = on<number[]>("audio:channels_rms", (lv) => {
      if (Array.isArray(lv)) pending.current = lv;
    });
    // ~6 redraws a second is plenty for a meter list of 64
    const iv = setInterval(() => {
      if (pending.current) {
        setLevels(pending.current);
        pending.current = null;
      }
    }, 160);
    multitrackVolumes().then(setVols).catch(() => {});
    listAudioInputs().then(setInputs).catch(() => {});
    return () => {
      clearInterval(iv);
      u.then((f) => f());
    };
  }, []);
  useEffect(() => {
    if (!IS_WEB) multitrackSessions().then(setSessions).catch(() => {});
  }, [rec?.recording]);

  if (IS_WEB || !rec) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>Recording</h1>
        </header>
        <p className="muted">The multitrack recorder runs on the booth Mac.</p>
      </div>
    );
  }

  const names = settings?.multitrack_names ?? {};
  const me = dante?.devices.find((d) => d.name === dante.localName);
  const subs = new Map((me?.rx ?? []).map((r) => [r.ch, r]));
  const sources = settings?.multitrack_sources ?? {};
  // While recording, the recorder's own levels (it may be a different device than the meters').
  const shownLevels = rec.recording && rec.live?.levels?.length ? rec.live.levels : levels;
  const n = Math.max(shownLevels.length, rec.recording && rec.live?.channels ? 0 : 64);
  const rows = Array.from({ length: n }, (_, i) => {
    const k = String(i + 1);
    const db = shownLevels[i];
    return { i: i + 1, name: names[k] || `In ${k.padStart(2, "0")}`, named: !!names[k], source: sources[k] ?? "", db, state: stateOf(db), sub: subs.get(i + 1) };
  });
  const counts = { signal: rows.filter((r) => r.state === "signal").length, idle: rows.filter((r) => r.state === "idle").length, none: rows.filter((r) => r.state === "none").length };
  const shown = rows.filter((r) => show === "all" || (show === "signal" ? r.state !== "none" : r.state === "none"));

  async function save(field: "multitrack_names" | "multitrack_sources" | "multitrack_volume" | "multitrack_device", key: string, value: string) {
    const cur = await getSettings();
    if (field === "multitrack_volume") await updateSettings({ ...cur, multitrack_volume: value });
    else if (field === "multitrack_device") await updateSettings({ ...cur, multitrack_device: value || null });
    else {
      const m = { ...(cur[field] ?? {}) };
      if (value.trim()) m[key] = value.trim();
      else delete m[key];
      await updateSettings({ ...cur, [field]: m });
    }
    await refreshSettings();
  }

  const chosen = settings?.multitrack_volume ?? "";
  const live = rec.live;
  return (
    <div className="page rec-page">
      <header className="page-head">
        <h1>Recording</h1>
        <div className="grow" style={{ flex: 1 }} />
        <button className="btn ghost small" disabled={rec.recording} onClick={() => requestWizard("recording")}>
          Set up
        </button>
        <button className="btn ghost small" onClick={rec.reveal}>
          Show in Finder
        </button>
      </header>

      <section className={`card rec-hero ${rec.recording ? "on" : ""}`}>
        <button className={`btn rec-big ${rec.recording ? "on" : ""}`} onClick={rec.recording ? rec.stop : rec.start}>
          <span className="rec-big-dot" aria-hidden="true" />
          {rec.recording ? "Stop" : "Record"}
        </button>
        <div className="rec-hero-main">
          <div className="rec-hero-clock mono">{rec.recording ? fmtClock(live?.secs ?? 0) : "0:00:00"}</div>
          <div className="rec-hero-folder">
            {rec.recording ? (
              <>
                Recording to <span className="mono">{live?.dir?.split("/").slice(-1)[0]}</span>
              </>
            ) : (
              <>
                Next folder: <strong>{localDate()} {rec.label}</strong>
              </>
            )}
          </div>
          <div className="rec-hero-sub muted small">
            {rec.recording && live
              ? `${live.withSignal ?? 0} of ${live.channels ?? 0} inputs with signal · ${live.freeGb} GB free (~${live.hoursLeft} h)${live.dropped ? ` · ${live.dropped} blocks dropped` : ""}`
              : settings?.multitrack_auto
                ? "Starts by itself when Planning Center LIVE or Playback starts; stops 20 minutes after both go quiet."
                : "Automatic recording is off (Settings → Multitrack recording)."}
          </div>
          {rec.error && <div className="error small">{rec.error}</div>}
        </div>
        <div className="rec-hero-side">
          <label className="field">
            <span>Record from</span>
            <select className="input" id="rec-src" value={settings?.multitrack_device ?? ""} disabled={rec.recording} onChange={(e) => save("multitrack_device", "", e.target.value)}>
              <option value="">ProDeck's audio input{settings?.audio_input ? ` (${settings.audio_input})` : ""}</option>
              {inputs
                .filter((d) => d !== settings?.audio_input)
                .map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              {settings?.multitrack_device && !inputs.includes(settings.multitrack_device) && (
                <option value={settings.multitrack_device}>{settings.multitrack_device} — not connected</option>
              )}
            </select>
          </label>
          <label className="field">
            <span>Record to</span>
            <select className="input" id="rec-dest" value={chosen} disabled={rec.recording} onChange={(e) => save("multitrack_volume", "", e.target.value)}>
              {vols.map((v) => (
                <option key={v.path} value={v.path}>
                  {v.name}
                  {v.freeGb != null ? ` · ${v.freeGb.toFixed(0)} GB free` : ""}
                </option>
              ))}
              {chosen && !vols.some((v) => v.path === chosen) && <option value={chosen}>{chosen.replace(/^\/Volumes\//, "")} — not connected</option>}
            </select>
          </label>
          {rec.recording && (
            <button className="btn small" onClick={() => rec.marker()}>
              Add marker
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Inputs</h3>
          <div className="rec-filter" role="group" aria-label="Show">
            {(
              [
                ["all", `All ${rows.length}`],
                ["signal", `Connected ${counts.signal + counts.idle}`],
                ["none", `No audio ${counts.none}`],
              ] as const
            ).map(([k, t]) => (
              <button key={k} className={`btn small ${show === k ? "primary" : "ghost"}`} onClick={() => setShow(k)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <p className="muted small">
          Every input of the chosen device is recorded — a Dante card, or a console's USB audio (X32/M32 X-USB, SQ,
          Yamaha TF…) plugged into this Mac; the ones with no audio all service are removed at the end. Click a name or a source to change
          it. "No audio" is digital silence — nothing is subscribed in Dante or the console isn't sending that output.
        </p>
        <div className="rec-table-wrap">
          <table className="rec-table">
            <thead>
              <tr>
                <th>In</th>
                <th>Track</th>
                <th>Comes from</th>
                <th className="rec-meter-h">Level</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.i} className={`rec-row ${r.state}`}>
                  <td className="mono rec-in">{r.i}</td>
                  <td>
                    <input
                      className={`rec-edit ${r.named ? "" : "unnamed"}`}
                      id={`rec-name-${r.i}`}
                      aria-label={`Input ${r.i} track name`}
                      defaultValue={r.named ? r.name : ""}
                      placeholder={r.name}
                      onBlur={(e) => e.target.value !== (names[String(r.i)] ?? "") && save("multitrack_names", String(r.i), e.target.value)}
                    />
                  </td>
                  <td>
                    {me && (
                      <div className={`rec-dante small mono ${r.sub?.txDevice ? (r.sub.ok ? "ok" : "bad") : "none"}`} title="Read live from Dante">
                        {r.sub?.txDevice ? `Dante: ${r.sub.txDevice} · ${r.sub.txChannel}${r.sub.ok ? "" : ` (${r.sub.status})`}` : "Dante: not subscribed"}
                      </div>
                    )}
                    <input
                      className="rec-edit src"
                      id={`rec-src-${r.i}`}
                      aria-label={`Input ${r.i} source`}
                      defaultValue={r.source}
                      placeholder="—"
                      onBlur={(e) => e.target.value !== (sources[String(r.i)] ?? "") && save("multitrack_sources", String(r.i), e.target.value)}
                    />
                  </td>
                  <td className="rec-meter-cell">
                    <span className="rec-meter" aria-hidden="true">
                      <span style={{ width: `${Math.max(0, Math.min(100, (((r.db ?? -120) + 70) / 70) * 100))}%` }} />
                    </span>
                    <span className="mono small rec-db">{r.db == null || r.db <= -118 ? "—" : r.db.toFixed(0)}</span>
                  </td>
                  <td>
                    <span className={`rec-state ${r.state}`}>{STATE_TEXT[r.state]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Recorded services</h3>
          <span className="count">{sessions.length}</span>
        </div>
        {sessions.length === 0 ? (
          <p className="muted small">Nothing recorded yet.</p>
        ) : (
          <ul className="rec-sessions">
            {sessions.map((s) => (
              <li key={s.dir}>
                <span className="rec-s-name">{s.folder}</span>
                <span className="muted small mono">{fmtClock(s.seconds)}</span>
                <span className="muted small">
                  {s.tracks} tracks · {s.markers} markers
                </span>
                <button className="btn small ghost" onClick={() => multitrackOpen(s.dir).catch(() => {})}>
                  Open
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
