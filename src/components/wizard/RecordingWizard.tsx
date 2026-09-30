import { useEffect, useMemo, useState } from "react";
import {
  audioInputChannels,
  danteSnapshot,
  getSettings,
  listAudioInputs,
  multitrackProbe,
  multitrackVolumes,
  updateSettings,
  type DanteSnapshot,
  type RecVolume,
} from "../../lib/tauri";
import { namesFromSettings } from "../../lib/recorderAuto";
import { requestNavigate } from "../../lib/navigate";
import { useProDeck } from "../../store";
import { LevelBar, WizardShell } from "./WizardShell";
import { usePeakHold, useLevels } from "./useLevels";

// Multitrack recording, set up in five steps: where the audio comes from,
// a level check, what each track is called, which drive, and a last look.
// Every Next saves its step, so closing halfway keeps what was done.

const STEPS = [
  { id: "source", label: "Audio source" },
  { id: "levels", label: "Check levels" },
  { id: "names", label: "Name tracks" },
  { id: "drive", label: "Where to save" },
  { id: "done", label: "Finish" },
];

const SIGNAL_DB = -60;
/** Bytes a second per track: 24 bit at the device's rate. */
const gbPerHour = (channels: number, rate: number) => (channels * rate * 3 * 3600) / 1e9;

export function RecordingWizard({ onClose }: { onClose: () => void }) {
  const { settings, refreshSettings } = useProDeck();
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [devices, setDevices] = useState<string[]>([]);
  const [device, setDevice] = useState<string>(settings?.multitrack_device ?? "");
  const [channels, setChannels] = useState(0);
  const [rate, setRate] = useState(48000);
  const [probe, setProbe] = useState<number[] | null>(null);
  const [probing, setProbing] = useState(false);
  const [names, setNames] = useState<Record<string, string>>(settings?.multitrack_names ?? {});
  const [sources, setSources] = useState<Record<string, string>>(settings?.multitrack_sources ?? {});
  const [onlySignal, setOnlySignal] = useState(false);
  const [vols, setVols] = useState<RecVolume[]>([]);
  const [volume, setVolume] = useState(settings?.multitrack_volume ?? "");
  const [dropSilent, setDropSilent] = useState(settings?.multitrack_drop_silent ?? true);
  const [dante, setDante] = useState<DanteSnapshot | null>(null);

  const own = device === "";
  const live = useLevels(own);
  const held = usePeakHold(own ? live : []);
  const levels = own ? held : (probe ?? []);

  useEffect(() => {
    listAudioInputs().then(setDevices).catch(() => {});
    multitrackVolumes().then(setVols).catch(() => {});
    danteSnapshot().then(setDante).catch(() => {});
  }, []);

  // How many channels the chosen source has.
  useEffect(() => {
    const dev = own ? (settings?.audio_input ?? null) : device;
    audioInputChannels(dev)
      .then((n) => setChannels(n || 0))
      .catch(() => setChannels(0));
    setProbe(null);
  }, [device, own, settings?.audio_input]);

  async function listen() {
    if (own) return;
    setProbing(true);
    setMsg("");
    try {
      const r = await multitrackProbe(device, 1500);
      setProbe((prev) => r.peaks.map((v, i) => Math.max(v, prev?.[i] ?? -120)));
      setChannels(r.channels);
      setRate(r.sampleRate);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setProbing(false);
    }
  }
  useEffect(() => {
    if (at === 1 && !own && !probe) listen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, own]);

  const n = Math.max(channels, levels.length);
  const withSignal = levels.slice(0, n).filter((v) => v > SIGNAL_DB).length;

  // Dante: what the Mac's own receive channels are subscribed to (only
  // meaningful when recording from ProDeck's input, the Virtual Soundcard).
  const me = dante?.devices.find((d) => d.name === dante.localName);
  const danteRx = useMemo(() => new Map((me?.rx ?? []).filter((r) => r.txDevice).map((r) => [r.ch, r])), [me]);

  async function save(patch: Record<string, unknown>) {
    const cur = await getSettings();
    await updateSettings({ ...cur, ...patch } as typeof cur);
    await refreshSettings();
  }

  async function next() {
    setBusy(true);
    setMsg("");
    try {
      if (at === 0) await save({ multitrack_device: device || null });
      if (at === 2) {
        const clean = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
        await save({ multitrack_names: clean(names), multitrack_sources: clean(sources) });
      }
      if (at === 3) await save({ multitrack_volume: volume });
      setAt((a) => Math.min(STEPS.length - 1, a + 1));
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish(open: boolean) {
    setBusy(true);
    try {
      await save({ multitrack_drop_silent: dropSilent });
      onClose();
      if (open) requestNavigate("recording");
    } catch (e) {
      setMsg(String(e));
      setBusy(false);
    }
  }

  function fillKnown() {
    const known = settings ? namesFromSettings(settings) : {};
    setNames((prev) => {
      const out = { ...prev };
      for (const [k, v] of Object.entries(known)) if (!out[k]?.trim() && Number(k) <= n) out[k] = v;
      return out;
    });
  }
  function fillDante() {
    setNames((prev) => {
      const out = { ...prev };
      for (const [ch, r] of danteRx) if (!out[String(ch)]?.trim() && r.txChannel) out[String(ch)] = r.txChannel;
      return out;
    });
    setSources((prev) => {
      const out = { ...prev };
      for (const [ch, r] of danteRx) if (!out[String(ch)]?.trim()) out[String(ch)] = `${r.txDevice} · ${r.txChannel}`;
      return out;
    });
  }

  const chosenVol = vols.find((v) => v.path === volume);
  const perHour = gbPerHour(Math.max(1, withSignal || n), rate);
  const hours = chosenVol?.freeGb != null ? chosenVol.freeGb / Math.max(0.1, perHour) : null;
  const sourceName = own ? `ProDeck's audio input${settings?.audio_input ? ` (${settings.audio_input})` : ""}` : device;
  const namedCount = Object.values(names).filter((v) => v.trim()).length;

  const steps = STEPS.map((s, i) => ({ ...s, done: i < at }));
  const rows = Array.from({ length: n }, (_, i) => i + 1).filter((ch) => !onlySignal || (levels[ch - 1] ?? -120) > SIGNAL_DB);

  return (
    <WizardShell
      title="Set up recording"
      steps={steps}
      at={at}
      onGo={setAt}
      onClose={onClose}
      busy={busy}
      actions={
        at < STEPS.length - 1 ? (
          <button className="btn primary" disabled={busy || (at === 0 && channels === 0 && !own)} onClick={next}>
            {busy ? "Saving…" : "Next"}
          </button>
        ) : (
          <>
            <button className="btn" disabled={busy} onClick={() => finish(false)}>
              Save
            </button>
            <button className="btn primary" disabled={busy} onClick={() => finish(true)}>
              Save and open Recording
            </button>
          </>
        )
      }
    >
      {at === 0 && (
        <>
          <h2>Where does the audio come from?</h2>
          <p className="wz-lead">
            ProDeck records every channel of one audio device, each to its own track. That can be ProDeck's own input
            (usually Dante Virtual Soundcard), or a console plugged in over USB.
          </p>
          <div className="wz-choices" role="radiogroup" aria-label="Audio source">
            <label className={`wz-choice ${own ? "on" : ""}`}>
              <input type="radio" name="wz-rec-src" id="wz-rec-src-own" checked={own} onChange={() => setDevice("")} />
              <span>
                <strong>ProDeck's audio input</strong>
                <span className="muted small">{settings?.audio_input || "The Mac's default input"} · the same channels the meters and Automix hear</span>
              </span>
            </label>
            {devices
              .filter((d) => d !== settings?.audio_input)
              .map((d) => (
                <label key={d} className={`wz-choice ${device === d ? "on" : ""}`}>
                  <input type="radio" name="wz-rec-src" id={`wz-rec-src-${d}`} checked={device === d} onChange={() => setDevice(d)} />
                  <span>
                    <strong>{d}</strong>
                    <span className="muted small">{/usb|avantis|sq|dlive|x32|m32|qu|mixer|console/i.test(d) ? "Looks like a console over USB" : "Another audio device"}</span>
                  </span>
                </label>
              ))}
          </div>
          <p className="wz-note">
            {channels > 0 ? (
              <>
                <strong>{channels} channels</strong> on this source.
              </>
            ) : (
              "Checking how many channels this source has…"
            )}{" "}
            Recording from a console over USB? Plug in the cable first, then on the console choose which channels go out over USB.
          </p>
        </>
      )}

      {at === 1 && (
        <>
          <h2>Check the levels</h2>
          <p className="wz-lead">
            {own
              ? "These are live. Ask the band to play or talk into a few mics: each channel that hears something lights up and stays lit."
              : "ProDeck listens to the device for a moment. Ask the band to play, then listen again to catch more channels."}
          </p>
          <div className="wz-summary">
            <strong>
              {withSignal} of {n || "?"}
            </strong>{" "}
            channels have signal
            {!own && (
              <button className="btn small" disabled={probing} onClick={listen}>
                {probing ? "Listening…" : "Listen again"}
              </button>
            )}
          </div>
          <div className="wz-grid">
            {Array.from({ length: n }, (_, i) => (
              <div key={i} className={`wz-cell ${(levels[i] ?? -120) > SIGNAL_DB ? "on" : ""}`}>
                <span className="mono">{i + 1}</span>
                <LevelBar db={levels[i]} />
              </div>
            ))}
          </div>
          {n > 0 && withSignal === 0 && !probing && (
            <p className="wz-warn">
              Nothing yet. {own ? "Is ProDeck's audio input running (Settings, Audio)?" : "Is the console sending audio over USB?"} You can still go on and check again at soundcheck.
            </p>
          )}
        </>
      )}

      {at === 2 && (
        <>
          <h2>Name the tracks</h2>
          <p className="wz-lead">Each track's file is named after its channel. Leave a name empty and it's saved as "In 07".</p>
          <div className="wz-row-actions">
            <button className="btn small" onClick={fillKnown}>
              Fill in what ProDeck knows
            </button>
            {own && danteRx.size > 0 && (
              <button className="btn small" onClick={fillDante}>
                Use Dante channel names
              </button>
            )}
            <label className="field check small">
              <input type="checkbox" id="wz-rec-only" checked={onlySignal} onChange={(e) => setOnlySignal(e.target.checked)} />
              <span>Only channels with signal</span>
            </label>
          </div>
          <div className="rec-table-wrap">
            <table className="rec-table wz-table">
              <thead>
                <tr>
                  <th>In</th>
                  <th>Level</th>
                  <th>Name</th>
                  <th>Comes from</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((ch) => {
                  const k = String(ch);
                  const sub = own ? danteRx.get(ch) : undefined;
                  return (
                    <tr key={ch}>
                      <td className="mono rec-in">{ch}</td>
                      <td>
                        <LevelBar db={levels[ch - 1]} />
                      </td>
                      <td>
                        <input className="input" id={`wz-rec-name-${ch}`} value={names[k] ?? ""} placeholder={`In ${k.padStart(2, "0")}`} onChange={(e) => setNames({ ...names, [k]: e.target.value })} />
                      </td>
                      <td>
                        <input
                          className="input"
                          id={`wz-rec-from-${ch}`}
                          value={sources[k] ?? ""}
                          placeholder={sub ? `${sub.txDevice} · ${sub.txChannel}` : "Stage box 3, wireless 2…"}
                          onChange={(e) => setSources({ ...sources, [k]: e.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <p className="muted small">No channels with signal. Turn off the filter to name them all.</p>}
          </div>
        </>
      )}

      {at === 3 && (
        <>
          <h2>Where should recordings go?</h2>
          <p className="wz-lead">
            Every recording gets its own folder, named for the Planning Center service and the date. An external SSD keeps the Mac's own disk free.
          </p>
          <div className="wz-choices" role="radiogroup" aria-label="Recording drive">
            {vols.map((v) => (
              <label key={v.path || "internal"} className={`wz-choice ${volume === v.path ? "on" : ""}`}>
                <input type="radio" name="wz-rec-vol" id={`wz-rec-vol-${v.path || "internal"}`} checked={volume === v.path} onChange={() => setVolume(v.path)} />
                <span>
                  <strong>{v.name}</strong>
                  <span className="muted small">
                    {v.freeGb != null ? `${v.freeGb.toFixed(0)} GB free` : "Free space unknown"}
                    {v.freeGb != null && ` · about ${Math.floor(v.freeGb / Math.max(0.1, perHour))} hours of recording`}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="wz-row-actions">
            <button className="btn small ghost" onClick={() => multitrackVolumes().then(setVols).catch(() => {})}>
              Look for drives again
            </button>
            <span className="muted small">Just plugged one in? Look again.</span>
          </div>
          {chosenVol?.internal && <p className="wz-note">Fine for a test. For services, record to an external drive.</p>}
          {chosenVol?.freeGb != null && chosenVol.freeGb < 20 && <p className="wz-warn">Recording needs at least 20 GB free on this drive.</p>}
          <p className="muted small">
            {Math.max(1, withSignal || n)} tracks at {rate / 1000} kHz use about {perHour.toFixed(1)} GB an hour.
          </p>
        </>
      )}

      {at === 4 && (
        <>
          <h2>Ready to record</h2>
          <dl className="wz-review">
            <dt>Source</dt>
            <dd>
              {sourceName} · {n} channels, {withSignal} with signal when checked
            </dd>
            <dt>Names</dt>
            <dd>{namedCount ? `${namedCount} tracks named` : "None yet (tracks are saved as In 01, In 02…)"}</dd>
            <dt>Saving to</dt>
            <dd>
              {chosenVol?.name ?? (volume || "This Mac")}
              {hours != null && ` · about ${Math.floor(hours)} hours free`}
            </dd>
          </dl>
          <label className="field check">
            <input type="checkbox" id="wz-rec-drop" checked={dropSilent} onChange={(e) => setDropSilent(e.target.checked)} />
            <span>Remove tracks that stayed silent for the whole recording</span>
          </label>
          <p className="wz-note">
            Recording only starts when someone presses Record, on the Recording page or the Stream Deck. Nothing records on its own.
          </p>
        </>
      )}
      {msg && <p className="error small">{msg}</p>}
    </WizardShell>
  );
}
