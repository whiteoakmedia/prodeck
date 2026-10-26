import { useEffect, useMemo, useState } from "react";
import {
  avantisPatchGet,
  avantisState,
  danteSnapshot,
  loadSoundcheckLayout,
  on,
  playbackOutputs,
  playbackSession,
  playbackStart,
  playbackStatus,
  playbackStop,
  saveSoundcheckLayout,
  type AvantisPatch,
  type DanteSnapshot,
  type PlaybackSession,
  type PlaybackStatus,
  type RecSession,
} from "../lib/tauri";
import { buildLayout, isLayout, listensToSoundcheck, routesOf, sheetFromLayout, sheetText, type Sheet, type SoundcheckLayout } from "../lib/soundcheckSheet";
import { fmtClock } from "../recorder";

// Recording → Soundcheck: play a recorded service back into the console's
// Virtual SoundCheck, with the patch sheet that makes the console hear it.
// ProDeck changes nothing on the desk or the Dante network; the sheet says
// what to change, when no service is on, and how to put Sunday back.

/** Where the sheet's outputs are remembered, for the "still patched" banner. */
export const SOUNDCHECK_TX_KEY = "prodeck.soundcheckTx";

const CONSOLE_NAME = /allen|avantis|dlive|dante64|^ah[-\s]/i;

export function SoundcheckPanel({ sessions, dir, onDir }: { sessions: RecSession[]; dir: string; onDir: (d: string) => void }) {
  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [outputs, setOutputs] = useState<{ name: string; channels: number }[]>([]);
  const [device, setDevice] = useState("");
  const [dante, setDante] = useState<DanteSnapshot | null>(null);
  const [patch, setPatch] = useState<AvantisPatch | null>(null);
  const [deskNames, setDeskNames] = useState<Record<number, string>>({});
  const [status, setStatus] = useState<PlaybackStatus>({ playing: false });
  const [pos, setPos] = useState(0);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  // undefined while loading; null when none has been worked out yet.
  const [layout, setLayout] = useState<SoundcheckLayout | null | undefined>(undefined);

  useEffect(() => {
    playbackOutputs()
      .then((o) => {
        setOutputs(o);
        setDevice((d) => d || o.find((x) => /dante/i.test(x.name))?.name || "");
      })
      .catch(() => {});
    danteSnapshot().then(setDante).catch(() => {});
    avantisPatchGet().then(setPatch).catch(() => {});
    avantisState()
      .then((s) => {
        const out: Record<number, string> = {};
        for (const [id, nm] of Object.entries(s?.names ?? {})) if (id.startsWith("input:") && nm) out[Number(id.slice(6))] = String(nm);
        setDeskNames(out);
      })
      .catch(() => {});
    playbackStatus().then(setStatus).catch(() => {});
    loadSoundcheckLayout()
      .then((v) => setLayout(isLayout(v) ? v : null))
      .catch(() => setLayout(null));
    const a = on<DanteSnapshot>("routing:dante", (d) => d && setDante(d));
    const b = on<PlaybackStatus>("playback:status", (s) => {
      if (!s) return;
      setStatus(s);
      if (s.secs != null) setPos(s.secs);
    });
    return () => {
      a.then((f) => f());
      b.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (!dir) return;
    setSession(null);
    setLoadErr("");
    setPos(0);
    playbackSession(dir).then(setSession).catch((e) => setLoadErr(String(e)));
  }, [dir]);

  const localName = session?.routing?.localName || dante?.localName || "";
  const local = dante?.devices.find((d) => d.name === localName);
  const consoleDev = dante?.devices.find((d) => CONSOLE_NAME.test(d.name) || CONSOLE_NAME.test(d.model ?? ""));
  const recordedRx = session?.routing?.danteRx ?? local?.rx ?? [];
  const fromUsb = !!session?.routing?.device;

  const canSheet = !!consoleDev && !!patch && !patch.live && !fromUsb;
  const sundayGone = !!consoleDev && listensToSoundcheck(consoleDev, localName, local);

  // Work the layout out once from the Sunday routing, then only ever add to
  // it (a new source this Mac records). Never from a network that's already
  // patched for soundcheck: the Sunday sources aren't visible then.
  useEffect(() => {
    if (layout === undefined || !canSheet || !consoleDev || !patch || !local || sundayGone) return;
    const keep = layout && layout.console === consoleDev.name ? layout : null;
    const next = buildLayout({ localRx: local.rx, localName, local, console: consoleDev, devices: dante?.devices ?? [], patch, deskNames, keep });
    if (keep && next.rows.length === keep.rows.length) return;
    if (!next.rows.length) return;
    setLayout(next);
    saveSoundcheckLayout(next).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, canSheet, consoleDev, patch, local, sundayGone, localName, deskNames]);

  const sheet: Sheet | null = useMemo(() => {
    if (!session || !canSheet || !patch || !layout || layout.console !== consoleDev?.name) return null;
    return sheetFromLayout(layout, { tracks: session.tracks, recordedRx, routingIsToday: !session.routing?.danteRx, patch, deskNames });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, canSheet, patch, layout, consoleDev?.name, deskNames, recordedRx]);

  useEffect(() => {
    if (!sheet) return;
    try {
      localStorage.setItem(SOUNDCHECK_TX_KEY, JSON.stringify(sheet.txUsed));
    } catch {
      /* the banner just won't know */
    }
  }, [sheet]);

  const routes = sheet ? routesOf(sheet) : {};
  const routed = Object.keys(routes).length;
  // Which of the sheet's inputs the console is actually listening to now.
  const hearing = sheet ? sheet.rows.filter((r) => consoleDev?.rx.find((x) => x.ch === r.rx && x.txDevice === localName && Number(x.txChannel) === r.tx)).length : 0;
  const uniqueRx = sheet ? new Set(sheet.rows.map((r) => r.rx)).size : 0;
  const playing = status.playing && status.dir === dir;

  async function play(from = pos) {
    setErr("");
    try {
      await playbackStart(dir, device, routes, from);
    } catch (e) {
      setErr(String(e));
    }
  }
  async function stop() {
    const s = await playbackStop().catch(() => null);
    if (s?.secs != null) setPos(s.secs);
  }
  async function seek(t: number) {
    setPos(t);
    if (playing) await play(t);
  }
  async function copy() {
    if (!sheet || !consoleDev) return;
    try {
      await navigator.clipboard.writeText(sheetText(sheet, localName, consoleDev.name));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setErr(String(e));
    }
  }
  const levelOf = (tx: number) => status.levels?.[tx - 1];

  return (
    <section className="card sc">
      <div className="card-head">
        <h3>Soundcheck playback</h3>
        <select className="input sc-pick" id="sc-session" value={dir} onChange={(e) => onDir(e.target.value)} aria-label="Recording to play">
          {sessions.map((s) => (
            <option key={s.dir} value={s.dir}>
              {s.folder}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small">
        Play a recorded service back into the console and mix it with your own faders, as if the band were playing. The console needs its Virtual SoundCheck
        switched on and a few Dante inputs pointed at this Mac: the patch sheet below says exactly which. Do that when no service is on.
      </p>
      {loadErr && <p className="error small">{loadErr}</p>}

      {session && (
        <>
          <div className="sc-transport">
            {playing ? (
              <button className="btn primary" onClick={stop}>
                Stop
              </button>
            ) : (
              <button className="btn primary" disabled={!device || routed === 0} onClick={() => play()}>
                Play
              </button>
            )}
            <button className="btn ghost small" onClick={() => seek(0)}>
              Back to start
            </button>
            <span className="mono sc-clock">
              {fmtClock(pos)} / {fmtClock(session.seconds)}
            </span>
            <input
              type="range"
              className="sc-scrub"
              id="sc-scrub"
              aria-label="Position"
              min={0}
              max={Math.max(1, Math.floor(session.seconds))}
              value={Math.floor(pos)}
              onChange={(e) => setPos(Number(e.target.value))}
              onMouseUp={(e) => seek(Number((e.target as HTMLInputElement).value))}
              onKeyUp={(e) => seek(Number((e.target as HTMLInputElement).value))}
            />
            <label className="field sc-out">
              <span>Play out of</span>
              <select className="input" id="sc-device" value={device} onChange={(e) => setDevice(e.target.value)}>
                <option value="">Choose an output</option>
                {outputs.map((o) => (
                  <option key={o.name} value={o.name}>
                    {o.name} ({o.channels} outputs)
                  </option>
                ))}
              </select>
            </label>
          </div>
          {session.markers.length > 0 && (
            <div className="sc-markers" aria-label="Markers">
              {session.markers.map((m, i) => (
                <button key={i} className={`btn small ${pos >= m.t && pos < (session.markers[i + 1]?.t ?? Infinity) ? "primary" : "ghost"}`} onClick={() => seek(m.t)}>
                  <span className="mono muted">{fmtClock(m.t)}</span> {m.text}
                </button>
              ))}
            </div>
          )}
          {sheet && (
            <p className={hearing === sheet.rows.length && hearing > 0 ? "wz-ok" : "wz-note"}>
              {hearing === 0
                ? `Nothing on the console is listening to these outputs yet, so playing is safe and silent. To hear it, make the ${uniqueRx} Dante subscriptions below.`
                : `The console hears ${hearing} of ${sheet.rows.length} soundcheck channels.`}
            </p>
          )}
          {status.error && <p className="error small">{status.error}</p>}
          {err && <p className="error small">{err}</p>}
        </>
      )}

      {session && !sheet && (
        <p className="wz-note">
          {fromUsb
            ? "This was recorded from a console over USB, so there's no Dante patch to work out. Play it back over USB with the console's own USB playback routing."
            : patch?.live
              ? "The patch sheet reads an Avantis show file. For this console, play each track out on the output of the same number."
              : !consoleDev
                ? "ProDeck hasn't found the console on the Dante network yet (Routing, Live)."
                : !patch
                  ? "The patch sheet needs a show file from the console: save the show to a USB stick or from Avantis Director and put it in Downloads."
                  : sundayGone && layout !== undefined
                    ? "The console is already listening to this Mac for soundcheck, so ProDeck can't see your Sunday routing to work the layout out from. Load your Sunday preset in Dante Controller and come back: ProDeck works the layout out once and keeps it, so one soundcheck preset fits every recording."
                    : "Working out the soundcheck layout."}
        </p>
      )}

      {sheet && consoleDev && (
        <>
          <div className="sc-sheet-head">
            <h4>Patch sheet</h4>
            <button className="btn small" onClick={copy}>
              {copied ? "Copied" : "Copy as text"}
            </button>
          </div>
          <ol className="sc-steps">
            <li>
              <strong>Save your Sunday first.</strong> In Dante Controller, File, Save Preset, and call it Sunday. That's your way back.
            </li>
            <li>
              In Dante Controller, make the subscriptions in the Dante column below ({uniqueRx} of them). Save that as a preset too, called Soundcheck, for next time.
            </li>
            <li>
              On the Avantis: I/O, Virtual SoundCheck. Pick I/O Port 1, set each channel below to its I/O Port 1 channel, set every other channel to off, and
              switch it on. Channel names turn orange.
            </li>
            <li>Press Play here and mix.</li>
            <li>
              <strong>Put Sunday back after:</strong> Virtual SoundCheck to Inactive on the desk, then apply the Sunday preset in Dante Controller. ProDeck shows a
              reminder until the console stops listening to these outputs.
            </li>
          </ol>
          {sheet.notes.map((n) => (
            <p key={n} className="wz-warn">
              {n}
            </p>
          ))}
          <div className="rec-table-wrap">
            <table className="rec-table sc-table">
              <thead>
                <tr>
                  <th>Console channel</th>
                  <th>Track</th>
                  <th>Virtual SoundCheck</th>
                  <th>Dante subscription</th>
                  <th>Level</th>
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((r) => (
                  <tr key={r.ch}>
                    <td>
                      <span className="mono rec-in">{r.ch}</span> {r.chName}
                    </td>
                    <td>
                      <span className="mono muted">{r.track}</span> {r.trackName}
                    </td>
                    <td>I/O Port 1 channel {r.rx}</td>
                    <td>
                      {consoleDev.name} {r.rx} ← {localName} {String(r.tx).padStart(2, "0")}
                      {r.rxWas && <span className="muted small"> (Sunday: {r.rxWas})</span>}
                    </td>
                    <td>
                      <span className={`sc-lamp ${(levelOf(r.tx) ?? -120) > -60 ? "on" : ""}`} aria-hidden="true" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(sheet.silent.length > 0 || sheet.skipped.length > 0) && (
            <details className="sc-more">
              <summary>
                {sheet.silent.length > 0 && `${sheet.silent.length} channels go quiet during soundcheck`}
                {sheet.silent.length > 0 && sheet.skipped.length > 0 && " · "}
                {sheet.skipped.length > 0 && `${sheet.skipped.length} tracks aren't played back`}
              </summary>
              {sheet.silent.length > 0 && (
                <>
                  <p className="muted small">Their Dante input is borrowed for a track, so they hear nothing until Sunday is back.</p>
                  <ul className="small">
                    {sheet.silent.map((x) => (
                      <li key={x.ch}>
                        Ch {x.ch} {x.name}
                        {x.was && <span className="muted"> (Sunday: {x.was})</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {sheet.skipped.length > 0 && (
                <ul className="small">
                  {sheet.skipped.map((x) => (
                    <li key={x.track}>
                      Track {x.track} {x.name}: <span className="muted">{x.why}</span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}
        </>
      )}
    </section>
  );
}
