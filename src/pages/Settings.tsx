import { useCallback, useEffect, useRef, useState } from "react";
import { useProDeck } from "../store";
import { useAlerts } from "../alertsStore";
import { useRelay } from "../relayStore";
import { useUpdater } from "../updaterStore";
import {
  audioInputChannels,
  connectMidi,
  disconnectMidi,
  geminiTest,
  invoke,
  IS_WEB,
  listAudioInputs,
  on,
  listMidiInputs,
  listMidiOutputs,
  connectMidiOut,
  midiSendKey,
  oscSendKey,
  tapTest,
  identityList,
  identityApprove,
  identityRemove,
  type CrewUser,
  tapMappings,
  tapSaveMappings,
  tapCheckLinks,
  startOsc,
  stopOsc,
  updateSettings,
  webStart,
  webStatus,
  webStop,
  type Settings,
  type AvantisSoftkey,
  type Invite,
  inviteCreate,
  inviteList,
  inviteRevoke,
  openPrintHtml,
  PUBLIC_URL,
  type TapMappings,
  type TapLinkCheck,
} from "../lib/tauri";
import lockupHorizontal from "../assets/prodeck-lockup-horizontal-color.svg";
import { askConfirm } from "../lib/dialogs";
import QRCode from "qrcode";
import { useSchedules } from "../scheduleStore";
import { usePco , isDeclined } from "../pcoStore";

export function SettingsPage() {
  const { settings, refreshSettings, midiLog, oscLog } = useProDeck();
  const { config: alertCfg, setConfig: setAlertCfg } = useAlerts();
  const relay = useRelay();
  const upd = useUpdater();
  const [form, setForm] = useState<Settings | null>(null);
  // Raw text of the scene-labels box while it's being edited (parsed map
  // lives in form.avantis_scene_labels).
  const [sceneLabelsText, setSceneLabelsText] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [midiPorts, setMidiPorts] = useState<string[]>([]);
  const [midiOutPorts, setMidiOutPorts] = useState<string[]>([]);
  const [keysendMsg, setKeysendMsg] = useState("");
  const [tapMsg, setTapMsg] = useState("");
  const [crew, setCrew] = useState<CrewUser[] | null>(null);

  // Crew roster (PIN identities). Available on the booth and admin web
  // clients; member clients get an error and the card simply hides.
  useEffect(() => {
    let alive = true;
    const load = () =>
      identityList()
        .then((u) => alive && setCrew(u))
        .catch(() => alive && setCrew(null));
    load();
    const un = on("identity:changed", load);
    return () => {
      alive = false;
      un.then((f) => f());
    };
  }, []);
  const [audioInputs, setAudioInputs] = useState<string[]>([]);
  const [oscOn, setOscOn] = useState(false);
  const [status, setStatus] = useState("");
  const [webInfo, setWebInfo] = useState<{ running: boolean; port: number }>({
    running: false,
    port: 0,
  });
  const [geminiMsg, setGeminiMsg] = useState("");
  // Browser clients receive ga4_key_path redacted, so including it here made
  // a working setup read as "off" everywhere except the booth.
  const ga4Ok = !!form?.ga4_property_id;
  const [geminiBusy, setGeminiBusy] = useState(false);
  const [chCount, setChCount] = useState(0);
  const [chanLevels, setChanLevels] = useState<number[]>([]);

  // Channel count of the selected input device, for the routing chips.
  useEffect(() => {
    audioInputChannels(form?.audio_input ?? null)
      .then(setChCount)
      .catch(() => setChCount(0));
  }, [form?.audio_input]);

  // Live per-channel input levels so you can see which channels carry signal.
  useEffect(() => {
    const un = on<number[]>("audio:channels", (lv) =>
      setChanLevels(Array.isArray(lv) ? lv : []),
    );
    return () => {
      un.then((f) => f());
    };
  }, []);

  function toggleChan(
    key: "audio_measure_channels" | "audio_overflow_channels",
    ch: number,
  ) {
    setForm((f) => {
      if (!f) return f;
      const cur = f[key] ?? [];
      const next = cur.includes(ch)
        ? cur.filter((c) => c !== ch)
        : [...cur, ch].sort((a, b) => a - b);
      return { ...f, [key]: next };
    });
  }

  useEffect(() => {
    refreshSettings();
    listMidiInputs().then(setMidiPorts).catch(() => {});
    listMidiOutputs().then(setMidiOutPorts).catch(() => {});
    listAudioInputs().then(setAudioInputs).catch(() => {});
    if (!IS_WEB) webStatus().then(setWebInfo).catch(() => {});
  }, []);

  useEffect(() => {
    if (settings && !form) setForm(settings);
  }, [settings, form]);

  if (!form) return <div className="page"><header className="page-head"><h1>Settings</h1></header></div>;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm({ ...form, [key]: value });

  async function save() {
    if (!form) return;
    await updateSettings(form);
    await refreshSettings();
    // Let the key-send hook re-read its config + (re)connect the MIDI output.
    window.dispatchEvent(new Event("prodeck:keysend"));
    document.documentElement.dataset.theme = form.theme;
    // Apply the web gateway (host only): start when enabled + password set.
    if (!IS_WEB) {
      try {
        if (form.web_enabled && form.web_password) await webStart(form.web_port);
        else await webStop();
        setWebInfo(await webStatus());
      } catch {
        /* ignore */
      }
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function toggleOsc() {
    if (oscOn) {
      await stopOsc();
      setOscOn(false);
      setStatus("OSC listener stopped");
    } else {
      try {
        await startOsc(form!.osc_port);
        setOscOn(true);
        setStatus(`OSC listening on :${form!.osc_port}`);
      } catch (e) {
        setStatus(String(e));
      }
    }
  }

  async function testGemini() {
    if (!form) return;
    setGeminiBusy(true);
    setGeminiMsg("");
    try {
      await updateSettings(form); // persist the key so the backend can read it
      await refreshSettings();
      const r = await geminiTest();
      setGeminiMsg(`✓ ${r}`);
    } catch (e) {
      setGeminiMsg(String(e));
    } finally {
      setGeminiBusy(false);
    }
  }

  // Save config, then push a sample key (G = pitch class 7) out both paths so the
  // operator can confirm the rig receives it.
  async function testKeySend() {
    if (!form) return;
    setKeysendMsg("");
    try {
      await updateSettings(form);
      await refreshSettings();
      window.dispatchEvent(new Event("prodeck:keysend"));
      const sent: string[] = [];
      if (form.keysend_osc_host) {
        await oscSendKey(form.keysend_osc_host, form.keysend_osc_port, "G", 7);
        sent.push(`OSC /key "G" 7 → ${form.keysend_osc_host}:${form.keysend_osc_port}`);
      }
      if (form.keysend_midi_port) {
        await connectMidiOut(form.keysend_midi_port);
        await midiSendKey(form.keysend_midi_channel, 7, form.keysend_cc);
        sent.push(
          `MIDI PC 7${form.keysend_cc >= 0 ? ` + CC${form.keysend_cc}=7` : ""} ch${form.keysend_midi_channel} → ${form.keysend_midi_port}`,
        );
      }
      setKeysendMsg(sent.length ? `✓ Sent test key G — ${sent.join("  ·  ")}` : "Set an OSC host and/or a MIDI output first.");
    } catch (e) {
      setKeysendMsg(`✗ ${e}`);
    }
  }

  // Save config, then verify the edge is reachable and the token works.
  async function testTapLink() {
    if (!form) return;
    setTapMsg("");
    try {
      await updateSettings(form);
      await refreshSettings();
      const r = await tapTest(form.tap_edge_url, form.tap_token);
      setTapMsg(`✓ ${r}`);
    } catch (e) {
      setTapMsg(`✗ ${e}`);
    }
  }

  async function toggleMidi() {
    if (form!.midi_port) {
      try {
        await connectMidi(form!.midi_port);
        setStatus(`MIDI connected: ${form!.midi_port}`);
      } catch (e) {
        setStatus(String(e));
      }
    } else {
      await disconnectMidi();
      setStatus("MIDI disconnected");
    }
  }


  return (
    <div className="page">
      <header className="page-head">
        <h1>Settings</h1>
        <button className="btn primary small" onClick={save}>
          {saved ? "Saved ✓" : "Save"}
        </button>
      </header>

      {status && <div className="banner">{status}</div>}

      {/* Eleven sections is a lot of scrolling — a grouped jump bar keeps
          "where do I approve someone" one click, not a hunt. */}
      <nav className="set-jump">
        {[
          { g: "Connections", items: [["ProPresenter", "set-pp"], ["Avantis", "set-avantis"], ["LAN Relay", "set-relay"], ...(!IS_WEB ? [["Browser Access", "set-web"]] : [])] },
          { g: "Audio", items: [["Audio & Captions", "set-audio"], ["Alerts", "set-alerts"]] },
          { g: "Crew", items: [["Crew Members", "set-crew"]] },
          { g: "Advanced", items: [["Gemini", "set-gemini"], ["Control Inputs", "set-inputs"], ["Song Key", "set-songkey"], ["TapLink", "set-taplink"]] },
          { g: "App", items: [["Updates", "set-update"], ["Appearance", "set-appearance"]] },
        ].map(({ g, items }) => (
          <span key={g} className="set-jump-group">
            <span className="set-jump-label">{g}</span>
            {items.map(([label, id]) => (
              <button
                key={id}
                className="btn small ghost"
                onClick={() =>
                  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                {label}
              </button>
            ))}
          </span>
        ))}
      </nav>

      <section className="card">
        <div className="card-head">
          <h3 id="set-update">Software Update</h3>
          <span className="chip">v{upd.version || "…"}</span>
        </div>
        <div className="settings-grid">
          <label className="field wide">
            <span>Status</span>
            <input
              className="input"
              readOnly
              value={
                upd.status === "checking"
                  ? "Checking for updates…"
                  : upd.status === "available"
                    ? `Update v${upd.newVersion} available`
                    : upd.status === "downloading"
                      ? `Downloading… ${upd.progress}%`
                      : upd.status === "ready"
                        ? "Installed — restarting"
                        : upd.status === "uptodate"
                          ? "Up to date"
                          : upd.status === "error"
                            ? "Update server unreachable"
                            : "—"
              }
            />
          </label>
          <div className="field btn-field">
            <span>&nbsp;</span>
            {upd.status === "available" ? (
              <button className="btn primary" onClick={() => upd.install()}>
                Install &amp; Restart
              </button>
            ) : (
              <button
                className="btn"
                onClick={() => upd.check()}
                disabled={upd.status === "checking" || upd.status === "downloading"}
              >
                Check for updates
              </button>
            )}
          </div>
        </div>
        <p className="hint">
          Updates download from the booth machine over your network and install on restart.
          The update server address is set in the build's updater endpoint.
        </p>
      </section>

      <section className="card">
        <div className="card-head"><h3 id="set-pp">ProPresenter</h3></div>
        <div className="settings-grid">
          <label className="field">
            <span>Host / IP</span>
            <input className="input" value={form.pp_host}
              onChange={(e) => set("pp_host", e.target.value)} />
          </label>
          <label className="field">
            <span>Port</span>
            <input className="input" type="number" value={form.pp_port}
              onChange={(e) => { const n = parseInt(e.target.value); if (Number.isFinite(n)) set("pp_port", n); }} />
          </label>
          <label className="field check">
            <input type="checkbox" checked={form.pp_auto_connect}
              onChange={(e) => set("pp_auto_connect", e.target.checked)} />
            <span>Auto-connect on launch</span>
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 id="set-avantis">Avantis Console</h3>
          <span className="chip">read-only mirror</span>
        </div>
        <p className="muted small">
          Watches the sound desk over the network (MIDI TCP): mutes, faders,
          scenes, and channel names show up live in ProDeck. ProDeck never
          sends control to the desk — it only listens.
        </p>
        <div className="settings-grid">
          <label className="field check">
            <input type="checkbox" checked={form.avantis_enabled}
              onChange={(e) => set("avantis_enabled", e.target.checked)} />
            <span>Mirror the Avantis</span>
          </label>
          <label className="field">
            <span>Console IP</span>
            <input className="input" placeholder="172.16.0.16" value={form.avantis_host}
              onChange={(e) => set("avantis_host", e.target.value.trim())} />
          </label>
          <label className="field">
            <span>Base MIDI channel (desk: Utility → Control → MIDI)</span>
            <input className="input" type="number" min={1} max={12} value={form.avantis_midi_base}
              onChange={(e) => { const n = parseInt(e.target.value); if (Number.isFinite(n)) set("avantis_midi_base", Math.min(12, Math.max(1, n))); }} />
          </label>
          <label className="field">
            <span>Desk watchdog — page this person when the desk changes</span>
            <select
              className="input"
              value={form.avantis_watch_user ?? ""}
              onChange={(e) => set("avantis_watch_user", e.target.value)}
            >
              <option value="">Off — nobody watches</option>
              {(crew ?? [])
                .filter((u) => u.approved)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field check">
            <input
              type="checkbox"
              checked={form.avantis_watch_armed}
              disabled={!form.avantis_watch_user}
              onChange={(e) => set("avantis_watch_armed", e.target.checked)}
            />
            <span>
              Armed — <strong>setup</strong> changes are paged, batched every 45s: FX
              send/return levels &amp; mutes, channel renames (an FX swap renames its
              return), and scene recalls. Normal mixing — input/DCA faders and mutes —
              never alerts. Names are re-checked every 5 minutes while armed.
            </span>
          </label>
          <SoftkeyEditor
            list={form.avantis_softkeys ?? []}
            crew={crew}
            onChange={(next) => set("avantis_softkeys", next)}
          />
          <label className="field wide">
            <span>Scene names — one per line, e.g. "1 = Pre-service" (the desk only sends numbers)</span>
            <textarea
              className="input"
              rows={4}
              value={
                sceneLabelsText ??
                Object.entries(form.avantis_scene_labels ?? {})
                  .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                  .map(([n, l]) => `${n} = ${l}`)
                  .join("\n")
              }
              onChange={(e) => {
                setSceneLabelsText(e.target.value);
                const map: Record<string, string> = {};
                for (const line of e.target.value.split("\n")) {
                  const m = line.match(/^\s*(\d+)\s*[=:—-]\s*(.+)$/);
                  if (m) map[m[1]] = m[2].trim();
                }
                set("avantis_scene_labels", map);
              }}
            />
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h3 id="set-audio">Audio &amp; Captions</h3></div>
        <div className="settings-grid">
          <label className="field wide">
            <span>Default audio input</span>
            <select className="input" value={form.audio_input ?? ""}
              onChange={(e) => set("audio_input", e.target.value || null)}>
              <option value="">System default</option>
              {audioInputs.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </label>
          {chCount > 1 && (
            <>
              <div className="field wide">
                <span>Measurement channels ({chCount} available)</span>
                <div className="chan-row">
                  {Array.from({ length: chCount }, (_, i) => i + 1).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      className={`chan-chip ${(form.audio_measure_channels ?? []).includes(ch) ? "on" : ""}`}
                      onClick={() => toggleChan("audio_measure_channels", ch)}
                    >
                      <span
                        className="chan-lvl"
                        style={{ height: `${Math.min(100, (chanLevels[ch - 1] ?? 0) * 160)}%` }}
                      />
                      <span className="chan-n">{ch}</span>
                    </button>
                  ))}
                </div>
                <span className="hint">
                  Channels the SPL/RTA/LUFS meter mixes. Empty = all. (e.g. pick 1, 2 for your
                  measurement mic.)
                </span>
              </div>
              <div className="field wide">
                <span>Overflow / Listen channels</span>
                <div className="chan-row">
                  {Array.from({ length: chCount }, (_, i) => i + 1).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      className={`chan-chip ${(form.audio_overflow_channels ?? []).includes(ch) ? "on" : ""}`}
                      onClick={() => toggleChan("audio_overflow_channels", ch)}
                    >
                      <span
                        className="chan-lvl"
                        style={{ height: `${Math.min(100, (chanLevels[ch - 1] ?? 0) * 160)}%` }}
                      />
                      <span className="chan-n">{ch}</span>
                    </button>
                  ))}
                </div>
                <span className="hint">
                  Streamed to the “Overflow Listen” widget for phones in other rooms. Empty = off.
                  Restart audio capture after changing channels.
                </span>
              </div>
            </>
          )}
          <label className="field wide">
            <span>Whisper binary (whisper.cpp CLI)</span>
            <input className="input" placeholder="/opt/homebrew/bin/whisper-cli"
              value={form.whisper_bin ?? ""}
              onChange={(e) => set("whisper_bin", e.target.value || null)} />
          </label>
          <label className="field wide">
            <span>Whisper model (.bin)</span>
            <input className="input" placeholder="…/ggml-base.en.bin"
              value={form.whisper_model ?? ""}
              onChange={(e) => set("whisper_model", e.target.value || null)} />
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 id="set-ga4">Live Viewers (Google Analytics)</h3>
          <span className={`chip ${ga4Ok ? "online" : ""}`}>{ga4Ok ? "on" : "off"}</span>
        </div>
        <p className="muted small">
          Live count of people watching on the Church Online web player, from GA4's realtime
          report. Church Online has no viewer API of its own, so this reads the analytics tag
          already running on the watch page. <strong>The Facebook simulcast is not counted</strong> —
          only the web player.
        </p>
        <div className="settings-grid">
          <label className="field">
            <span>GA4 property ID</span>
            <input
              className="input"
              placeholder="e.g. 520479442"
              value={form.ga4_property_id ?? ""}
              onChange={(e) => set("ga4_property_id", e.target.value.trim())}
            />
          </label>
          <label className="field wide">
            <span>Service-account key file</span>
            <input
              className="input"
              placeholder={
                form.ga4_property_id && !form.ga4_key_path
                  ? "set on the booth Mac — hidden from browsers"
                  : "/Users/…/ProDeck/ga4-key.json"
              }
              value={form.ga4_key_path ?? ""}
              onChange={(e) => set("ga4_key_path", e.target.value.trim())}
            />
          </label>
          <label className="field">
            <span>Page filter (optional)</span>
            <input
              className="input"
              placeholder="blank = whole property"
              value={form.ga4_page_filter ?? ""}
              onChange={(e) => set("ga4_page_filter", e.target.value.trim())}
            />
          </label>
        </div>
        <p className="hint">
          The property ID is the number in GA4 Admin → Property Settings, <em>not</em> the
          <code>G-</code> measurement ID. Add the service account as a <strong>Viewer</strong> on
          that property, and enable the Google Analytics Data API in its Cloud project. Leave the
          page filter blank when the property only covers the watch subdomain.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 id="set-gemini">Gemini Smart Matching</h3>
          <span
            className={`chip ${
              form.gemini_match_enabled && form.gemini_api_key ? "online" : ""
            }`}
          >
            {form.gemini_match_enabled && form.gemini_api_key ? "on" : "off"}
          </span>
        </div>
        <p className="muted small">
          Makes <strong>Auto‑Follow</strong> (Captions page) far more accurate: Gemini matches the
          live transcript to your ProPresenter slide lyrics, even when words are misheard. Text
          only — no audio leaves this machine. If Gemini is unreachable it falls back to local
          matching automatically, so Auto‑Follow keeps working offline.
        </p>
        <div className="settings-grid">
          <label className="field wide">
            <span>Gemini API key (Google AI Studio)</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              placeholder="Paste your key — stored only on this machine"
              value={form.gemini_api_key ?? ""}
              onChange={(e) => set("gemini_api_key", e.target.value || null)}
            />
          </label>
          <label className="field check">
            <input
              type="checkbox"
              checked={form.gemini_match_enabled}
              onChange={(e) => set("gemini_match_enabled", e.target.checked)}
            />
            <span>Use Gemini for Auto‑Follow matching</span>
          </label>
          <div className="field btn-field">
            <span>&nbsp;</span>
            <button
              className="btn"
              onClick={testGemini}
              disabled={geminiBusy || !form.gemini_api_key}
            >
              {geminiBusy ? "Testing…" : "Save & Test key"}
            </button>
          </div>
        </div>
        {geminiMsg && (
          <p className={geminiMsg.startsWith("✓") ? "hint" : "error"}>{geminiMsg}</p>
        )}
        <p className="hint">
          Get a free key at <code>aistudio.google.com/apikey</code>. Your key is stored only on
          this machine; the live audio is never sent to Google — only the text transcript and your
          slide lyrics.
        </p>
      </section>

      <section className="card">
        <div className="card-head"><h3 id="set-inputs">Control Inputs</h3></div>
        <div className="settings-grid">
          <label className="field">
            <span>OSC port</span>
            <input className="input" type="number" value={form.osc_port}
              onChange={(e) => { const n = parseInt(e.target.value); if (Number.isFinite(n)) set("osc_port", n); }} />
          </label>
          <div className="field btn-field">
            <span>&nbsp;</span>
            <button className={`btn ${oscOn ? "danger" : ""}`} onClick={toggleOsc}>
              {oscOn ? "Stop OSC" : "Start OSC"}
            </button>
          </div>
          <label className="field wide">
            <span>MIDI input</span>
            <div className="inline">
              <select className="input" value={form.midi_port ?? ""}
                onChange={(e) => set("midi_port", e.target.value || null)}>
                <option value="">None</option>
                {midiPorts.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button className="btn" onClick={toggleMidi}>
                {form.midi_port ? "Connect" : "Disconnect"}
              </button>
            </div>
          </label>
        </div>
        <p className="hint">
          MIDI: notes D3/C3/E3 → next / previous / clear. OSC: <code>/prodeck/next</code>,{" "}
          <code>/prodeck/previous</code>, <code>/prodeck/clear/&lt;layer&gt;</code>.
        </p>
        {(midiLog.length > 0 || oscLog.length > 0) && (
          <div className="log-strip">
            {[...oscLog, ...midiLog].slice(-3).map((l, i) => (
              <span key={i} className="log-line">{l.text}</span>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h3 id="set-songkey">Song Key → Backing Track / Vocal Tune</h3>
          <span className={`chip ${form.keysend_enabled ? "online" : ""}`}>
            {form.keysend_enabled ? "on" : "off"}
          </span>
        </div>
        <p className="muted small">
          Sends the live song's key (from Planning Center, or your in-app override) to your Waves /
          MultiTracks PC as a <strong>pitch class 0–11</strong>, so the rig switches to a per-key
          state automatically. Sent both as OSC and as a MIDI Program Change (+ optional CC) — wire
          up whichever your rig uses.
        </p>
        <div className="settings-grid">
          <label className="field check">
            <input
              type="checkbox"
              checked={form.keysend_enabled}
              onChange={(e) => set("keysend_enabled", e.target.checked)}
            />
            <span>Auto-send the live song's key</span>
          </label>
          <label className="field">
            <span>OSC host — rig PC's IP (blank = off)</span>
            <input
              className="input"
              placeholder="e.g. 172.16.0.50"
              value={form.keysend_osc_host}
              onChange={(e) => set("keysend_osc_host", e.target.value)}
            />
          </label>
          <label className="field">
            <span>OSC port</span>
            <input
              className="input"
              type="number"
              value={form.keysend_osc_port}
              onChange={(e) => { const n = parseInt(e.target.value); if (Number.isFinite(n)) set("keysend_osc_port", n); }}
            />
          </label>
          <label className="field wide">
            <span>MIDI output — e.g. a Network/rtpMIDI session (None = off)</span>
            <select
              className="input"
              value={form.keysend_midi_port ?? ""}
              onChange={(e) => set("keysend_midi_port", e.target.value || null)}
            >
              <option value="">None</option>
              {midiOutPorts.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>MIDI channel</span>
            <input
              className="input"
              type="number"
              min={1}
              max={16}
              value={form.keysend_midi_channel}
              onChange={(e) =>
                set("keysend_midi_channel", Math.min(16, Math.max(1, parseInt(e.target.value) || 1)))
              }
            />
          </label>
          <label className="field">
            <span>Also send CC# (−1 = Program Change only)</span>
            <input
              className="input"
              type="number"
              min={-1}
              max={127}
              value={form.keysend_cc}
              onChange={(e) => {
                const n = parseInt(e.target.value);
                set("keysend_cc", Number.isNaN(n) ? -1 : Math.min(127, Math.max(-1, n)));
              }}
            />
          </label>
          <div className="field btn-field">
            <span>&nbsp;</span>
            <button className="btn" onClick={testKeySend}>
              Save &amp; send test (G)
            </button>
          </div>
        </div>
        {keysendMsg && (
          <p className={keysendMsg.startsWith("✓") ? "hint" : "error"}>{keysendMsg}</p>
        )}
        <details className="hint">
          <summary>How to receive it on the Waves / MultiTracks PC</summary>
          <p>
            The key is sent as a number 0–11 (C=0, C#=1, … B=11; minor keys use the root — Am→9).
            It selects a <em>pre-built per-key state</em>; it is not a live transpose.
          </p>
          <ul>
            <li>
              <strong>Waves Tune Real-Time in SuperRack (recommended):</strong> build 12 snapshots,
              one per key, ordered so snapshot 1 = C … snapshot 12 = B. Program Change <em>N</em>{" "}
              recalls snapshot <em>N+1</em>. On Windows install <code>rtpMIDI</code>, connect to this
              Mac's Network MIDI session, then choose that session as the MIDI output above.
            </li>
            <li>
              <strong>Waves Tune in a DAW (Ableton/Logic/Cubase):</strong> right-click Scale Root →
              Learn, then send a CC once to bind it (set a CC# above).
            </li>
            <li>
              <strong>Prefer OSC?</strong> Run Bitfocus Companion on the rig PC, enable its OSC
              listener (port 12321), and map <code>/key/pc &lt;n&gt;</code> → send Program Change{" "}
              <em>n</em> to the rig.
            </li>
            <li>
              <strong>MultiTracks Playback</strong> has no remote key control — keep setting its key
              per song in advance (it cloud-syncs). This drives Waves, not Playback.
            </li>
          </ul>
        </details>
      </section>

      <section className="card">
        <div className="card-head">
          <h3 id="set-taplink">TapLink (NFC giving link)</h3>
          <span className={`chip ${form.tap_enabled ? "online" : ""}`}>
            {form.tap_enabled ? "armed" : "off"}
          </span>
        </div>
        <p className="muted small">
          Keeps the Overflow Tap discs' destination in sync with the service. Put{" "}
          <code>tap:go</code> in a slide's notes and every tap lands on giving the moment that
          slide goes live; <code>tap:default</code> reverts. Keywords and links are editable
          below. Only this booth instance follows slides; phones on the web gateway can watch
          and override, but not change the setup here.
        </p>
        <div className="settings-grid">
          <label className="field check">
            <input
              type="checkbox"
              checked={form.tap_enabled}
              onChange={(e) => set("tap_enabled", e.target.checked)}
              disabled={IS_WEB}
            />
            <span>Follow slides (arm the watcher)</span>
          </label>
          <label className="field wide">
            <span>Edge URL</span>
            <input
              className="input"
              value={form.tap_edge_url}
              onChange={(e) => set("tap_edge_url", e.target.value)}
              disabled={IS_WEB}
            />
          </label>
          <label className="field wide">
            <span>API token (from taplink-edge deploy)</span>
            <input
              className="input"
              type="password"
              value={form.tap_token}
              onChange={(e) => set("tap_token", e.target.value)}
              disabled={IS_WEB}
              placeholder={IS_WEB ? "hidden on web clients" : ""}
            />
          </label>
          {!IS_WEB && (
            <div className="field btn-field">
              <span>&nbsp;</span>
              <button className="btn" onClick={testTapLink}>
                Save &amp; test connection
              </button>
            </div>
          )}
        </div>
        {tapMsg && <p className={tapMsg.startsWith("✓") ? "hint" : "error"}>{tapMsg}</p>}
        {/* Configured, not armed: disarming only stops slide-following, so the
            links must stay editable. */}
        {!IS_WEB && !!form.tap_edge_url && !!form.tap_token && <TapMappingEditor />}
      </section>

      {crew !== null && (
        <section className="card">
          <div className="card-head">
            <h3 id="set-crew">Crew Members</h3>
            {crew.some((u) => !u.approved) && (
              <span className="chip">{crew.filter((u) => !u.approved).length} pending</span>
            )}
          </div>
          <p className="muted small">
            PIN identities for phones — messages carry these verified names. New joins
            wait here until you approve them — or skip the wait entirely by
            sending a personal invite link below.
          </p>
          <PersonalInvites />
          {crew.length === 0 && <p className="muted small">Nobody has joined yet.</p>}
          {crew.map((u) => (
            <div key={u.id} className="field-row crew-row">
              <span className={`chip ${u.approved ? "online" : ""}`}>
                {u.approved ? "approved" : "pending"}
              </span>
              <span className="crew-name">{u.name}</span>
              {/* Read-only: the position comes from THIS WEEK'S Planning
                  Center plan, matched by name. There is nothing to type here —
                  scheduling someone in PCO is what gives them a position, and
                  taking them off it is what removes one. */}
              <span
                className={`crew-role-view ${u.role ? "" : "muted"}`}
                title="From this week's Planning Center plan — change it in PCO"
              >
                {u.role || "not on this week's plan"}
              </span>
              <span className="muted small">
                {u.last_seen_ms
                  ? `seen ${new Date(u.last_seen_ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                  : "never signed in"}
              </span>
              <button
                className={`btn small ${u.approved ? "ghost" : "primary"}`}
                onClick={() => identityApprove(u.id, !u.approved).catch(() => {})}
              >
                {u.approved ? "Revoke" : "Approve"}
              </button>
              <button className="btn small ghost" onClick={() => identityRemove(u.id).catch(() => {})}>
                Remove
              </button>
            </div>
          ))}
        </section>
      )}

      {!IS_WEB && <ScheduledAlerts crew={crew ?? []} />}

      <section className="card">
        <div className="card-head">
          <h3 id="set-relay">LAN Relay (multi-instance sync)</h3>
          <span className={`chip ${relay.mode !== "off" ? "online" : "offline"}`}>
            {relay.mode === "host"
              ? `Hosting · ${relay.clients} client${relay.clients === 1 ? "" : "s"}`
              : relay.mode === "client"
                ? relay.connected
                  ? "Client · connected"
                  : "Client · connecting…"
                : "Off"}
          </span>
        </div>
        <div className="settings-grid">
          <label className="field">
            <span>Mode</span>
            <select
              className="input"
              value={relay.mode}
              onChange={(e) => {
                const m = e.target.value;
                if (m === "host") relay.startHost();
                else if (m === "client") relay.connectClient();
                else relay.stop();
              }}
            >
              <option value="off">Off</option>
              <option value="host">Host (this machine shares its state)</option>
              <option value="client">Client (mirror another machine)</option>
            </select>
          </label>
          {relay.mode !== "client" && (
            <label className="field">
              <span>Host port</span>
              <input
                className="input"
                type="number"
                value={relay.hostPort}
                onChange={(e) => relay.setHostPort(parseInt(e.target.value) || 51421)}
              />
            </label>
          )}
          {relay.mode !== "host" && (
            <label className="field wide">
              <span>Host address (ws://IP:port)</span>
              <input
                className="input"
                placeholder="ws://172.16.0.50:51421"
                value={relay.clientUrl}
                onChange={(e) => relay.setClientUrl(e.target.value)}
              />
            </label>
          )}
        </div>
        <p className="hint">
          Make the booth machine (the one connected to ProPresenter / NDI / audio) the{" "}
          <strong>Host</strong>. On each other machine, choose <strong>Client</strong> and enter{" "}
          <code>ws://HOST-IP:{relay.hostPort}</code>. Clients mirror ProPresenter state, audio
          levels, dashboards, and pull camera/NDI video from the host. Control stays on the host.
        </p>
      </section>

      <section className="card">
        <div className="card-head"><h3 id="set-alerts">Alerts &amp; Monitoring</h3></div>
        <div className="settings-grid">
          <label className="field check">
            <input type="checkbox" checked={alertCfg.enabled}
              onChange={(e) => setAlertCfg({ enabled: e.target.checked })} />
            <span>Enable smart alerts (visual only)</span>
          </label>
          <label className="field check">
            <input type="checkbox" checked={alertCfg.ppDisconnect}
              onChange={(e) => setAlertCfg({ ppDisconnect: e.target.checked })} />
            <span>ProPresenter disconnect</span>
          </label>
          <label className="field check">
            <input type="checkbox" checked={alertCfg.ndiLoss}
              onChange={(e) => setAlertCfg({ ndiLoss: e.target.checked })} />
            <span>Stage feed (NDI) loss</span>
          </label>
          <label className="field check">
            <input type="checkbox" checked={alertCfg.tapPushFail}
              onChange={(e) => setAlertCfg({ tapPushFail: e.target.checked })} />
            <span>TapLink push failed (NFC discs)</span>
          </label>
          <label className="field check">
            <input type="checkbox" checked={alertCfg.micMuted}
              onChange={(e) => setAlertCfg({ micMuted: e.target.checked })} />
            <span>Scheduled mic muted during service (Avantis)</span>
          </label>
          <label className="field check">
            <input type="checkbox" checked={alertCfg.audioSilence}
              onChange={(e) => setAlertCfg({ audioSilence: e.target.checked })} />
            <span>Dead-feed alert</span>
          </label>
          <label className="field">
            <span>Silence below (dBFS)</span>
            <input className="input" type="number" value={alertCfg.silenceDb}
              onChange={(e) => setAlertCfg({ silenceDb: parseInt(e.target.value) || -80 })} />
          </label>
          <label className="field">
            <span>Silence after (sec)</span>
            <input className="input" type="number" min={1} value={alertCfg.silenceSecs}
              onChange={(e) => setAlertCfg({ silenceSecs: parseInt(e.target.value) || 1 })} />
          </label>
          <label className="field check">
            <input type="checkbox" checked={alertCfg.overSpl}
              onChange={(e) => setAlertCfg({ overSpl: e.target.checked })} />
            <span>Sustained over-SPL</span>
          </label>
          <label className="field">
            <span>Over-SPL threshold (dB)</span>
            <input className="input" type="number" value={alertCfg.overSplValue}
              onChange={(e) => setAlertCfg({ overSplValue: parseInt(e.target.value) || 0 })} />
          </label>
          <label className="field">
            <span>Over-SPL after (sec)</span>
            <input className="input" type="number" min={1} value={alertCfg.overSecs}
              onChange={(e) => setAlertCfg({ overSecs: parseInt(e.target.value) || 1 })} />
          </label>
        </div>
        <p className="hint">
          Alerts pop as banners on any screen (with optional sound). Add the{" "}
          <strong>System Health</strong> widget to a dashboard for an at-a-glance status row.
        </p>
      </section>

      {!IS_WEB && (
        <section className="card">
          <div className="card-head">
            <h3 id="set-web">Browser Access (LAN)</h3>
            {webInfo.running ? (
              <span className="chip online">serving · :{webInfo.port}</span>
            ) : (
              <span className="chip">off</span>
            )}
          </div>
          <p className="muted small">
            Serve the dashboards to phones, tablets, and laptops on the church network.
            They open this Mac's address in a browser and sign in with the password below.
          </p>
          <CrewInviteLink form={form} set={set} />
          <AutoCheckin form={form} set={set} />
          <div className="settings-grid">
          <label className="field wide">
            <span>Public URL — the domain volunteers reach from anywhere (your tunnel), e.g. https://booth.yourchurch.org. Blank = LAN only.</span>
            <input className="input" placeholder="https://…"
              value={form.public_url ?? ""}
              onChange={(e) => set("public_url", e.target.value.trim())} />
          </label>
            <label className="field switch">
              <input
                type="checkbox"
                checked={form.web_enabled}
                onChange={(e) => set("web_enabled", e.target.checked)}
              />
              <span>Enable browser access</span>
            </label>
            <label className="field">
              <span>Port</span>
              <input
                className="input"
                type="number"
                value={form.web_port}
                onChange={(e) => set("web_port", parseInt(e.target.value) || 8088)}
              />
            </label>
            <label className="field wide">
              <span>Admin password — full view &amp; control</span>
              <input
                className="input"
                type="text"
                value={form.web_password}
                onChange={(e) => set("web_password", e.target.value)}
                placeholder="Required — admins sign in with this"
              />
            </label>
            <label className="field wide">
              <span>Member password — dashboards + team chat only (blank = off)</span>
              <input
                className="input"
                type="text"
                value={form.web_member_password}
                onChange={(e) => set("web_member_password", e.target.value)}
                placeholder="Members can't message stage/confidence or control anything"
              />
            </label>
            {form.web_enabled && form.web_password && (
              <div className="field wide">
                <span>Open in a browser</span>
                <code className="web-url">
                  http://{(form.device_name || "this-mac").replace(/\.local$/i, "")}.local:
                  {form.web_port}/
                </code>
              </div>
            )}
          </div>
          {form.web_enabled && !form.web_password && (
            <p className="error">Set a password — browser access stays off until you do.</p>
          )}
          <p className="hint">
            Press Save to apply. Admin password = view and control everything. Member
            password = see dashboards, hear Listen, and send <strong>team</strong> chat —
            no stage or confidence messages, no controls (enforced by the host, not the
            browser). Give volunteers the member password only.
          </p>
        </section>
      )}

      <section className="card">
        <div className="card-head"><h3 id="set-appearance">Appearance</h3></div>
        <div className="settings-grid">
          <label className="field">
            <span>Theme</span>
            <select className="input" value={form.theme}
              onChange={(e) => set("theme", e.target.value)}>
              <option value="dark">Dark (Slate / Indigo)</option>
              <option value="midnight">Midnight</option>
              <option value="light">Light</option>
            </select>
          </label>
        </div>
      </section>
      <img
        className="settings-credit-lockup"
        src={lockupHorizontal}
        alt="ProDeck — by Zach Green"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TapLink mapping editor — keyword → destination, edited in-app and PUT to the
// edge (which re-validates everything). Booth-only, like the token and the arm
// switch: the gateway lets a phone PICK a keyword, not redefine one.
//
// Renaming/removing a keyword is the sharp edge: the trigger lives in the
// ProPresenter slide's notes, which this app can't rewrite. So the editor
// always says so, and a save that drops a keyword asks for confirmation and
// names the slides' old keywords explicitly.
// ---------------------------------------------------------------------------

interface KwRow {
  id: number;
  key: string;
  url: string;
  ttl: string; // blank = inherit the global TTL
}

const KEY_RE = /^[a-z0-9_-]{1,32}$/;
const RESERVED = ["default", "__default"];

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Verdict for one checked link. 401/403/405/429 are deliberately NOT failures:
// giving providers bot-block non-browser clients, so a red "dead link" there
// would be a lie that trains the operator to ignore this column.
function LinkVerdict({ check }: { check?: TapLinkCheck }) {
  if (!check) return null;
  const { status, error } = check;
  if (status && status >= 200 && status < 300)
    return <span className="chip online" title={`HTTP ${status}`}>ok</span>;
  if (status && [401, 403, 405, 429].includes(status))
    return (
      <span className="chip warn" title={`HTTP ${status} — the host blocks automated checks. Open it in a browser to be sure.`}>
        {status}?
      </span>
    );
  return (
    <span className="chip bad" title={error ?? `HTTP ${status}`}>
      {status ?? "dead"}
    </span>
  );
}

function TapMappingEditor() {
  const [rows, setRows] = useState<KwRow[]>([]);
  const [def, setDef] = useState("");
  const [ttl, setTtl] = useState("180");
  // Keywords as the edge currently knows them — the baseline a save is diffed
  // against to spot renames/removals.
  const [known, setKnown] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // Verdicts keyed by URL, so an edited row loses its stale badge for free.
  const [checks, setChecks] = useState<Record<string, TapLinkCheck>>({});
  const [checking, setChecking] = useState(false);
  const nextId = useRef(1);

  const load = useCallback(() => {
    tapMappings()
      .then((m) => {
        setRows(
          Object.entries(m.keywords).map(([key, v]) => ({
            id: nextId.current++,
            key,
            url: typeof v === "string" ? v : v.url,
            ttl: typeof v === "string" || v.ttl_minutes == null ? "" : String(v.ttl_minutes),
          })),
        );
        setDef(m.default);
        setTtl(String(m.ttl_minutes));
        setKnown(Object.keys(m.keywords));
        setErr("");
      })
      .catch((e) => setErr(String(e)));
  }, []);

  // Wrapped: load() returns a promise, and React would take that for a cleanup.
  useEffect(() => {
    load();
  }, [load]);

  const patch = (id: number, f: Partial<KwRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...f } : r)));

  // Fetch every destination and report what answered. Checks what's in the
  // boxes, not what's saved, so a bad paste is caught before it goes live.
  async function checkLinks() {
    setErr("");
    setMsg("");
    const urls = Array.from(
      new Set([def.trim(), ...rows.map((r) => r.url.trim())].filter(isHttpUrl)),
    );
    if (!urls.length) return setErr("No valid links to check yet.");
    setChecking(true);
    try {
      const results = await tapCheckLinks(urls);
      const byUrl: Record<string, TapLinkCheck> = {};
      for (const c of results) byUrl[c.url] = c;
      setChecks(byUrl);
      const dead = results.filter((c) => !c.status || c.status >= 400).length;
      const blocked = results.filter(
        (c) => c.status && [401, 403, 405, 429].includes(c.status),
      ).length;
      setMsg(
        dead - blocked > 0
          ? `${dead - blocked} link${dead - blocked === 1 ? "" : "s"} did not answer — see the badges.`
          : blocked > 0
            ? `All links reachable (${blocked} host${blocked === 1 ? "" : "s"} blocks automated checks — open those by hand).`
            : "✓ Every link answered.",
      );
    } catch (e) {
      setErr(String(e));
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    setMsg("");
    setErr("");
    const keywords: TapMappings["keywords"] = {};
    if (!isHttpUrl(def)) return setErr("Default URL must be a http(s) link.");
    const ttlNum = Number(ttl);
    if (!Number.isFinite(ttlNum) || ttlNum <= 0 || ttlNum > 10080)
      return setErr("Default timer must be 1–10080 minutes.");

    for (const r of rows) {
      const key = r.key.trim().toLowerCase();
      const url = r.url.trim();
      if (!key && !url) continue; // untouched blank row
      if (!KEY_RE.test(key))
        return setErr(`Keyword "${r.key}" must be lower-case letters, numbers, - or _ (max 32).`);
      if (RESERVED.includes(key)) return setErr(`"${key}" is reserved — pick another keyword.`);
      if (keywords[key]) return setErr(`"${key}" is listed twice.`);
      if (!isHttpUrl(url)) return setErr(`The link for "${key}" must be a http(s) URL.`);
      if (r.ttl.trim()) {
        const t = Number(r.ttl);
        if (!Number.isFinite(t) || t <= 0 || t > 10080)
          return setErr(`Timer for "${key}" must be 1–10080 minutes.`);
        keywords[key] = { url, ttl_minutes: t };
      } else {
        keywords[key] = url;
      }
    }
    if (!Object.keys(keywords).length) return setErr("Keep at least one keyword.");

    // A rename reads as remove-then-add, so both land in `gone`.
    const gone = known.filter((k) => !(k in keywords));
    if (gone.length) {
      const list = gone.map((k) => `tap:${k}`).join(", ");
      const ok = await askConfirm(
        `Heads up: ${list} will no longer exist. Any ProPresenter slide with ${
          gone.length === 1 ? "that keyword" : "those keywords"
        } in its notes will stop switching the discs — open those slides and change the notes to the new keyword. Save anyway?`,
        "Save mappings",
      );
      if (!ok) return;
    }

    setBusy(true);
    try {
      await tapSaveMappings({ default: def.trim(), ttl_minutes: ttlNum, keywords });
      setKnown(Object.keys(keywords));
      setMsg(
        gone.length
          ? `✓ Saved. Remember to update slides that still say ${gone
              .map((k) => `tap:${k}`)
              .join(", ")}.`
          : "✓ Saved — live on the discs now.",
      );
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tap-map">
      <div className="card-head">
        <h4>Keywords &amp; links</h4>
        <button className="btn small ghost" onClick={load} disabled={busy}>
          Reload
        </button>
      </div>
      <p className="hint">
        A slide's notes say <code>tap:&lt;keyword&gt;</code>. Renaming a keyword here does{" "}
        <strong>not</strong> update ProPresenter — any slide already tagged with the old keyword
        must be re-tagged by hand, or it will silently stop switching the discs.
      </p>

      {rows.map((r) => (
        <div className="field-row" key={r.id}>
          <input
            className="input kw"
            value={r.key}
            placeholder="keyword"
            onChange={(e) => patch(r.id, { key: e.target.value })}
          />
          <input
            className="input"
            value={r.url}
            placeholder="https://…"
            onChange={(e) => patch(r.id, { url: e.target.value })}
          />
          <input
            className="input port"
            value={r.ttl}
            placeholder="min"
            title="Minutes before this keyword reverts to the default link. Blank = use the default timer."
            onChange={(e) => patch(r.id, { ttl: e.target.value })}
          />
          <LinkVerdict check={checks[r.url.trim()]} />
          <button
            className="btn small ghost"
            title="Remove this keyword"
            onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
          >
            ✕
          </button>
        </div>
      ))}

      <div className="field-row">
        <button
          className="btn small ghost"
          onClick={() =>
            setRows((rs) => [...rs, { id: nextId.current++, key: "", url: "", ttl: "" }])
          }
        >
          + Add keyword
        </button>
      </div>

      <div className="settings-grid">
        <label className="field wide">
          <span>
            Default link (every tap outside a tagged moment){" "}
            <LinkVerdict check={checks[def.trim()]} />
          </span>
          <input className="input" value={def} onChange={(e) => setDef(e.target.value)} />
        </label>
        <label className="field">
          <span>Default timer (minutes)</span>
          <input className="input port" value={ttl} onChange={(e) => setTtl(e.target.value)} />
        </label>
        <div className="field btn-field">
          <span>&nbsp;</span>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save mappings"}
          </button>
        </div>
        <div className="field btn-field">
          <span>&nbsp;</span>
          <button
            className="btn"
            onClick={checkLinks}
            disabled={checking}
            title="Fetch every link and report what answers — catches an archived form or a rotated giving URL before Sunday."
          >
            {checking ? "Checking…" : "Check links"}
          </button>
        </div>
      </div>

      {err && <p className="error">{err}</p>}
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}

// Scheduled alerts — fire a page at a clock time or T-minus the service.
//
// Booth-only card: the schedule is evaluated on the booth (every phone running
// the same timer would fire the same alert once per phone), so this is where it
// is configured too. "Fires ..." is computed live so a mis-set time is obvious
// before Sunday rather than after it.
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ScheduledAlerts({ crew }: { crew: CrewUser[] }) {
  const sch = useSchedules();
  const pco = usePco();
  const approved = crew.filter((u) => u.approved);
  // Teams come from whoever is on the plan, so the list follows PCO rather than
  // needing its own configuration.
  const teams = [...new Set(pco.team.map((m) => m.team.trim()).filter(Boolean))].sort();
  return (
    <section className="card">
      <div className="card-head">
        <h3>Scheduled alerts</h3>
        <button className="btn small" onClick={sch.add}>
          Add alert
        </button>
      </div>
      <p className="muted small">
        Sends a real page at the scheduled time — it takes over recipients' screens, pushes to
        locked phones, and reports who acknowledged. Each alert fires once per service.
      </p>
      <p className="muted small">
        Scope an alert to a service type and the days it runs, and it stays out of the way of
        every other service. Address a PCO team instead of named people and it follows whoever
        is rostered that week.
      </p>

      {sch.alerts.length === 0 && (
        <p className="hint">No scheduled alerts yet.</p>
      )}

      {sch.alerts.map((a) => (
        <div key={a.id} className="sched-alert">
          <div className="field-row">
            <label className="field check" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={a.enabled}
                onChange={(e) => sch.update(a.id, { enabled: e.target.checked })}
              />
              <span>On</span>
            </label>
            <input
              className="input"
              value={a.label}
              placeholder="Name (for you)"
              onChange={(e) => sch.update(a.id, { label: e.target.value })}
            />
            <select
              className="input"
              value={a.kind}
              onChange={(e) => sch.update(a.id, { kind: e.target.value as "clock" | "relative" })}
            >
              <option value="relative">Before service</option>
              <option value="clock">At a time</option>
            </select>
            {a.kind === "relative" ? (
              <input
                className="input port"
                type="number"
                value={a.beforeMin}
                title="Minutes before the service start. Negative = after (T+10)."
                onChange={(e) => sch.update(a.id, { beforeMin: Number(e.target.value) })}
              />
            ) : (
              <input
                className="input port"
                type="time"
                value={a.at}
                onChange={(e) => sch.update(a.id, { at: e.target.value })}
              />
            )}
            <button className="btn small ghost" onClick={() => sch.remove(a.id)}>
              Remove
            </button>
          </div>

          <div className="field-row">
            <input
              className="input"
              value={a.body}
              placeholder="What the page says — e.g. Mic check, all positions"
              onChange={(e) => sch.update(a.id, { body: e.target.value })}
            />
            <label className="field check" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={a.buzz}
                onChange={(e) => sch.update(a.id, { buzz: e.target.checked })}
              />
              <span>Buzz until read</span>
            </label>
          </div>

          <div className="field-row">
            <select
              className="input"
              value={a.serviceTypeId}
              title="Only fire for this service type"
              onChange={(e) => sch.update(a.id, { serviceTypeId: e.target.value })}
            >
              <option value="">Any service</option>
              {pco.serviceTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={a.team}
              title="Page a PCO team instead of named people"
              onChange={(e) => sch.update(a.id, { team: e.target.value })}
            >
              <option value="">Pick people below</option>
              {teams.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="sched-days">
            <span className="muted small">Days</span>
            {DAY_LABELS.map((d, i) => {
              const on = a.days.includes(i);
              return (
                <button
                  key={d}
                  className={`chip ${on ? "online" : ""}`}
                  title={a.days.length === 0 ? "Any day" : ""}
                  onClick={() =>
                    sch.update(a.id, {
                      days: on ? a.days.filter((x) => x !== i) : [...a.days, i].sort(),
                    })
                  }
                >
                  {d}
                </button>
              );
            })}
            <span className="muted small">{a.days.length === 0 ? "any day" : ""}</span>
          </div>

          {/* Hidden when a team is addressed — the roster decides, and showing
              a stale hand-picked list next to it invites the wrong assumption
              about who is actually getting paged. */}
          <div className="sched-recips" hidden={!!a.team}>
            <span className="muted small">
              {a.recipients.length === 0 ? "Everyone" : `${a.recipients.length} selected`}
            </span>
            {approved.map((u) => {
              const on = a.recipients.includes(u.id);
              return (
                <button
                  key={u.id}
                  className={`chip ${on ? "online" : ""}`}
                  onClick={() =>
                    sch.update(a.id, {
                      recipients: on
                        ? a.recipients.filter((x) => x !== u.id)
                        : [...a.recipients, u.id],
                    })
                  }
                >
                  {u.name}
                  {u.role ? ` · ${u.role}` : ""}
                </button>
              );
            })}
          </div>

          <p className="hint small">{sch.nextFire(a)}</p>
        </div>
      ))}
    </section>
  );
}

// Desk softkeys → crew pages. "Learn" listens to the mirror's MIDI stream for
// the next unrecognised note (press the softkey on the Avantis), then the row
// just needs a message and who gets it. Softkeys must transmit on a MIDI
// channel OUTSIDE the desk's base range (use channel 1) so they can never be
// read as mutes.
function SoftkeyEditor({
  list,
  crew,
  onChange,
}: {
  list: AvantisSoftkey[];
  crew: CrewUser[] | null;
  onChange: (next: AvantisSoftkey[]) => void;
}) {
  const [learning, setLearning] = useState(false);
  const [captured, setCaptured] = useState<{ channel: number; note: number } | null>(null);
  const [body, setBody] = useState("");
  const [recips, setRecips] = useState<string[]>([]);

  useEffect(() => {
    if (!learning) return;
    const un = on<{ channel: number; note: number; velocity: number }>(
      "avantis:midi",
      (m) => {
        setCaptured({ channel: m.channel, note: m.note });
        setLearning(false);
      },
    );
    const t = setTimeout(() => setLearning(false), 15_000);
    return () => {
      clearTimeout(t);
      un.then((f) => f());
    };
  }, [learning]);

  const approved = (crew ?? []).filter((u) => u.approved);

  return (
    <div className="field wide">
      <span>Desk softkeys → crew pages</span>
      {list.map((k, i) => (
        <div key={i} className="field-row" style={{ alignItems: "center", padding: "3px 0" }}>
          <span className="chip">ch {k.midi_channel} · note {k.note}</span>
          <span style={{ flex: 1, fontWeight: 600 }}>"{k.body}"</span>
          <span className="muted small">
            → {k.recipients.length === 0 ? "everyone" : `${k.recipients.length} people`}
          </span>
          <button
            className="btn small ghost"
            title="Remove this softkey mapping"
            onClick={() => onChange(list.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}

      <div className="field-row" style={{ marginTop: 6, alignItems: "center" }}>
        <button
          className={`btn small ${learning ? "primary" : ""}`}
          onClick={() => {
            setCaptured(null);
            setLearning(true);
          }}
        >
          {learning ? "Press the softkey on the desk…" : captured ? `Captured ch ${captured.channel} · note ${captured.note}` : "Learn key…"}
        </button>
        <input
          className="input"
          placeholder="Page message (e.g. FOH needs the producer)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button
          className="btn small primary"
          disabled={!captured || !body.trim()}
          onClick={() => {
            if (!captured) return;
            onChange([
              ...list,
              { midi_channel: captured.channel, note: captured.note, body: body.trim(), recipients: recips },
            ]);
            setCaptured(null);
            setBody("");
            setRecips([]);
          }}
        >
          Add
        </button>
      </div>
      {approved.length > 0 && (
        <div className="field-row" style={{ flexWrap: "wrap", gap: 6, marginTop: 4 }}>
          <span className="muted small" style={{ width: "100%" }}>
            Who gets paged (none checked = everyone):
          </span>
          {approved.map((u) => (
            <label key={u.id} className="chip" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={recips.includes(u.id)}
                onChange={(e) =>
                  setRecips((p) =>
                    e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id),
                  )
                }
              />{" "}
              {u.name}
            </label>
          ))}
        </div>
      )}
      <span className="hint">
        On the Avantis, assign a SoftKey to send a custom MIDI note on channel
        1 (Utility → Control → MIDI / SoftKeys). Pages fire once per press.
      </span>
    </div>
  );
}

// Auto check-in: phones prove presence when the app opens — on the church
// wifi via the request's own addresses (nothing to configure; the detected
// WAN IPs are shown so it's inspectable), or within a geo fence for people
// still on cellular in the lot. Coordinates blank = geo path off, no
// location prompts ever.
function AutoCheckin({
  form,
  set,
}: {
  form: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const [wan, setWan] = useState<string[]>([]);
  useEffect(() => {
    if (IS_WEB) return;
    invoke<string[]>("checkin_wan_ip").then(setWan).catch(() => setWan([]));
  }, []);
  return (
    <div className="field wide">
      <span>
        Auto check-in — phones on the church wifi check in the moment they open
        ProDeck{wan.length > 0 ? ` (this building: ${wan.join(", ")})` : ""}
      </span>
      <div className="field-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ width: 140 }}
          placeholder="Latitude"
          value={form.church_lat}
          onChange={(e) => set("church_lat", e.target.value.trim())}
        />
        <input
          className="input"
          style={{ width: 140 }}
          placeholder="Longitude"
          value={form.church_lng}
          onChange={(e) => set("church_lng", e.target.value.trim())}
        />
        <input
          className="input"
          style={{ width: 90 }}
          type="number"
          min={25}
          placeholder="Radius m"
          value={form.checkin_radius_m || 150}
          onChange={(e) => set("checkin_radius_m", Math.max(25, Number(e.target.value) || 150))}
        />
      </div>
      {(() => {
        // Non-numeric coordinates silently disable the whole geo path while
        // the fields LOOK configured (audit finding) — say which state it's in.
        const lat = parseFloat(form.church_lat);
        const lng = parseFloat(form.church_lng);
        const blank = !form.church_lat.trim() && !form.church_lng.trim();
        const valid =
          Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
        return (
          <span className="hint" style={!blank && !valid ? { color: "var(--warn, #e0a030)" } : undefined}>
            {blank
              ? "Geo fence off — phones never ask for location. Wifi detection needs no setup."
              : valid
                ? `Geo fence ACTIVE: within ${form.checkin_radius_m || 150} m of ${lat.toFixed(5)}, ${lng.toFixed(5)} counts as on-site.`
                : "These coordinates don't parse — the geo fence is OFF until both are plain numbers (e.g. 41.51234, -72.98765)."}
          </span>
        );
      })()}
      <label className="field switch" style={{ marginTop: 6 }}>
        <input
          type="checkbox"
          checked={form.checkin_nudge}
          onChange={(e) => set("checkin_nudge", e.target.checked)}
        />
        <span>
          Page crew at their call time if they haven't checked in (uses the
          per-position times in PCO Setup → Check-in times)
        </span>
      </label>
    </div>
  );
}

// The rotatable crew link: anyone with it lands signed-in at member tier —
// no password typing. Rotate to kill every previously shared copy. The QR +
// printable poster make it self-serve in the green room.
function CrewInviteLink({
  form,
  set,
}: {
  form: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const link = form.web_invite_token
    ? `${PUBLIC_URL}/?join=${form.web_invite_token}`
    : "";
  // The QR/poster encode the tokenless /join redirect, so a printed code
  // survives every rotation; the copyable text link stays on the raw token
  // (rotate to kill texted copies).
  const posterLink = form.web_invite_token ? `${PUBLIC_URL}/join` : "";

  useEffect(() => {
    if (!posterLink) return setQr("");
    QRCode.toDataURL(posterLink, { margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(""));
  }, [posterLink]);

  function rotate() {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    set(
      "web_invite_token",
      Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
    );
  }

  async function printPoster() {
    if (!qr) return;
    const html =
      `<!doctype html><html><head><meta charset="utf-8"><title>Join ProDeck Crew</title>` +
      `<style>body{font-family:-apple-system,Helvetica,sans-serif;text-align:center;padding:48px;color:#111}` +
      `h1{font-size:40px;margin:0 0 6px}p{font-size:20px;color:#444;margin:6px 0}` +
      `img{width:340px;height:340px;margin:28px 0}ol{display:inline-block;text-align:left;font-size:22px;line-height:1.7}</style></head><body>` +
      `<h1>Join the ProDeck Crew</h1><p>Cornerstone production &amp; worship team app</p>` +
      `<img src="${qr}" alt="QR">` +
      `<ol><li>Scan the code with your phone camera</li>` +
      `<li>Add ProDeck to your Home Screen when asked</li>` +
      `<li>Tap your name, pick a 4-digit PIN — done</li></ol>` +
      `<script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>` +
      `</body></html>`;
    openPrintHtml(html).catch(() => {});
  }

  return (
    <div className="field wide">
      <span>Crew invite link — no password needed, member access</span>
      {link ? (
        <>
          <div className="field-row" style={{ alignItems: "center" }}>
            <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
            <button
              className="btn small"
              onClick={() => {
                navigator.clipboard?.writeText(link).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
            <button className="btn small ghost" title="Kill every shared copy of this link and mint a new one" onClick={rotate}>
              Rotate
            </button>
            {!IS_WEB && (
              <button className="btn small ghost" onClick={printPoster} disabled={!qr}>
                Print poster…
              </button>
            )}
          </div>
          {qr && <img src={qr} alt="Invite QR" style={{ width: 160, height: 160, borderRadius: 8, marginTop: 6 }} />}
          <span className="hint">
            Remember to Save after generating or rotating. Text this link (dies on
            rotate), or hang the poster — its QR points at /join, which always
            follows the current link, so printed posters never expire.
          </span>
        </>
      ) : (
        <div className="field-row">
          <button className="btn small primary" onClick={rotate}>
            Generate invite link
          </button>
        </div>
      )}
    </div>
  );
}

// Personal one-time invites: pre-approved, name+role locked to the link, gone
// once claimed. The fastest onboarding there is — send it, they pick a PIN.
function PersonalInvites() {
  const pco = usePco();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [who, setWho] = useState("");
  const [copiedTok, setCopiedTok] = useState("");

  const load = () => inviteList().then(setInvites).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const roster = pco.team.filter((m) => !isDeclined(m.status));
  const linkFor = (t: string) => `${PUBLIC_URL}/?invite=${t}`;

  async function create() {
    const name = who.trim();
    if (!name) return;
    const role = roster.find((m) => m.name.toLowerCase() === name.toLowerCase())?.position ?? "";
    await inviteCreate(name, role).catch(() => {});
    setWho("");
    load();
  }

  return (
    <div className="field wide">
      <span>Personal invites — pre-approved, one-time links</span>
      {invites
        .filter((i) => !i.used)
        .map((i) => (
          <div key={i.token} className="field-row" style={{ alignItems: "center", padding: "3px 0" }}>
            <span style={{ flex: 1, fontWeight: 600 }}>
              {i.name}
              {i.role ? <span className="muted small"> · {i.role}</span> : null}
              {i.expired ? <span className="muted small"> · expired</span> : null}
            </span>
            <button
              className="btn small"
              disabled={!!i.expired}
              onClick={() => {
                navigator.clipboard?.writeText(linkFor(i.token)).catch(() => {});
                setCopiedTok(i.token);
                setTimeout(() => setCopiedTok(""), 1500);
              }}
            >
              {copiedTok === i.token ? "Copied ✓" : "Copy link"}
            </button>
            <button
              className="btn small ghost"
              title="Revoke this invite"
              onClick={() => inviteRevoke(i.token).then(load)}
            >
              ×
            </button>
          </div>
        ))}
      <div className="field-row" style={{ marginTop: 6 }}>
        <input
          className="input"
          list="invite-roster"
          placeholder="Name (pick from this week's plan or type)"
          value={who}
          onChange={(e) => setWho(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <datalist id="invite-roster">
          {roster.map((m) => (
            <option key={m.id} value={m.name} />
          ))}
        </datalist>
        <button className="btn small primary" disabled={!who.trim()} onClick={create}>
          Invite
        </button>
      </div>
      <span className="hint">
        The link signs them in, fills their name and role, and skips approval —
        they only pick a PIN. Links die after one use or 7 days.
      </span>
    </div>
  );
}
