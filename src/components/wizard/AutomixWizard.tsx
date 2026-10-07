import { useEffect, useMemo, useState } from "react";
import { deskControlSupported } from "../../lib/consoles";
import {
  avantisReconnect,
  avantisState,
  getSettings,
  listMidiInputs,
  on,
  updateSettings,
  type AvantisSnapshot,
  type Settings,
} from "../../lib/tauri";
import { DEFAULT_RULES, parseFeeds, parseRules } from "../../lib/automix";
import { formatFeeds, guessRoles, retargetRules, ROLES } from "../../lib/automixSetup";
import { requestNavigate } from "../../lib/navigate";
import { usePco } from "../../pcoStore";
import { useProDeck } from "../../store";
import { LevelBar, WizardShell } from "./WizardShell";
import { useLevels, usePeakHold } from "./useLevels";

// Automix, set up in order: the console, which of its faders plays each part,
// the instruments' own feeds, backing vocals, where the timing comes from,
// speech mics, and a last look at the rules it will follow. Nothing but the
// console is saved until the last step, because the rules are rewritten from
// the fader answers and the two have to change together.

const STEPS = [
  { id: "console", label: "Console" },
  { id: "faders", label: "Faders" },
  { id: "feeds", label: "Instrument feeds" },
  { id: "bgv", label: "Backing vocals" },
  { id: "timing", label: "Song timing" },
  { id: "speech", label: "Speech mics" },
  { id: "review", label: "Review" },
];

const CONSOLES = [
  { id: "avantis", name: "Allen & Heath Avantis", port: 51325, maxBase: 12 },
  { id: "dlive", name: "Allen & Heath dLive", port: 51325, maxBase: 12 },
  { id: "sq", name: "Allen & Heath SQ", port: 51325, maxBase: 16 },
  { id: "x32", name: "Behringer X32 or Midas M32", port: 10023, maxBase: 1 },
];

/** Faders the automix may ride: DCAs, groups and auxes (never mains). */
const RIDEABLE = /^(dca|grp|sgrp|aux):/;
const CH = /^ch\s*(\d+)$/i;
const SIGNAL_DB = -60;

const inputNo = (id: string) => {
  const m = id.match(/^input:(\d+)$/);
  return m ? m[1] : "";
};

export function AutomixWizard({ onClose, onAway }: { onClose: () => void; onAway: () => void }) {
  const { settings, refreshSettings } = useProDeck();
  const pco = usePco();
  const s = settings as Settings | null;
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Console
  const [desk, setDesk] = useState<AvantisSnapshot | null>(null);
  const [model, setModel] = useState(s?.avantis_model || "avantis");
  const [host, setHost] = useState(s?.avantis_host ?? "");
  const [port, setPort] = useState(s?.avantis_port || 51325);
  const [base, setBase] = useState(s?.avantis_midi_base || 12);
  useEffect(() => {
    let alive = true;
    const pull = () => avantisState().then((d) => alive && setDesk(d)).catch(() => {});
    pull();
    const iv = setInterval(pull, 1500);
    const u = on<AvantisSnapshot>("avantis:state", (d) => alive && d && setDesk(d));
    return () => {
      alive = false;
      clearInterval(iv);
      u.then((f) => f());
    };
  }, []);
  const connected = !!desk?.connected;
  const [changing, setChanging] = useState(false);

  // The desk's faders, by name.
  const deskFaders = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const [id, nm] of Object.entries(desk?.names ?? {})) {
      const n = String(nm ?? "").trim();
      if (!n || !RIDEABLE.test(id) || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out;
  }, [desk?.names]);
  const deskInputs = useMemo(
    () =>
      Object.entries(desk?.names ?? {})
        .filter(([id]) => id.startsWith("input:"))
        .map(([id, nm]) => ({ no: inputNo(id), name: String(nm ?? "") }))
        .sort((a, b) => Number(a.no) - Number(b.no)),
    [desk?.names],
  );

  // Faders: part → this desk's name ("" = not on this desk).
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [rolesSeeded, setRolesSeeded] = useState(false);
  useEffect(() => {
    if (rolesSeeded) return;
    const saved = s?.automix_roles ?? {};
    if (Object.keys(saved).length) {
      setRoles(Object.fromEntries(ROLES.map((r) => [r.id, saved[r.id] === "-" ? "" : (saved[r.id] ?? "")])));
      setRolesSeeded(true);
    } else if (deskFaders.length) {
      setRoles(guessRoles(deskFaders, deskInputs));
      setRolesSeeded(true);
    }
  }, [deskFaders, deskInputs, rolesSeeded, s?.automix_roles]);
  const [fxMute, setFxMute] = useState(!!s?.automix_fx_mute);
  const known = (v: string) => !v || CH.test(v) || deskFaders.includes(v) || desk?.namesSupported === false;

  // Feeds: part → audio input channels.
  const [feeds, setFeeds] = useState<Record<string, number[]>>(() => {
    const parsed = parseFeeds(s?.automix_feeds ?? "");
    const saved = s?.automix_roles ?? {};
    const out: Record<string, number[]> = {};
    for (const r of ROLES) {
      const name = saved[r.id] || r.base;
      if (parsed[name]) out[r.id] = parsed[name];
    }
    return out;
  });
  const [assigning, setAssigning] = useState("eg");
  const live = useLevels(true);
  const held = usePeakHold(live);
  const trackNames = s?.multitrack_names ?? {};

  // Backing vocals, timing, speech
  const [bgvOn, setBgvOn] = useState(s?.automix_bgv_ride ?? true);
  const [tuck, setTuck] = useState(s?.automix_bgv_tuck ?? -6);
  const [guide, setGuide] = useState(s?.follow_guide_channel ?? 0);
  const [click, setClick] = useState(s?.follow_click_channel ?? 0);
  const [midi, setMidi] = useState(s?.follow_midi_port ?? "");
  const [midiPorts, setMidiPorts] = useState<string[]>([]);
  useEffect(() => {
    listMidiInputs().then(setMidiPorts).catch(() => {});
  }, []);
  const [lapel, setLapel] = useState(inputNo(s?.autopilot_lapel ?? ""));
  const [lapelAudio, setLapelAudio] = useState(s?.autopilot_lapel_audio ?? 0);
  const [mc, setMc] = useState(inputNo(s?.autopilot_mc ?? ""));
  const [mcAudio, setMcAudio] = useState(s?.autopilot_mc_audio ?? 0);

  // Review: the rules, rewritten for this desk's names.
  const answer = useMemo(() => Object.fromEntries(ROLES.map((r) => [r.id, roles[r.id]?.trim() || "-"])), [roles]);
  const generated = useMemo(() => retargetRules(s?.automix_rules ?? "", s?.automix_roles ?? {}, answer), [s?.automix_rules, s?.automix_roles, answer]);
  const [rulesText, setRulesText] = useState<string | null>(null);
  const rules = rulesText ?? generated;
  const moments = Object.keys(parseRules(rules)).length;

  async function connect() {
    setBusy(true);
    setMsg("");
    try {
      const cur = (await getSettings()) as Settings;
      const m = CONSOLES.find((c) => c.id === model) ?? CONSOLES[0];
      await updateSettings({
        ...cur,
        avantis_enabled: true,
        avantis_model: model,
        avantis_host: host.trim(),
        avantis_port: port || m.port,
        avantis_midi_base: Math.min(m.maxBase, Math.max(1, base)),
      });
      await refreshSettings();
      await avantisReconnect().catch(() => {});
      setMsg("Saved. ProDeck is connecting to the console…");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      const cur = (await getSettings()) as Settings;
      const name = (id: string) => answer[id];
      const feedText = formatFeeds(Object.fromEntries(Object.entries(feeds).filter(([id]) => name(id) !== "-").map(([id, chs]) => [name(id), chs])));
      await updateSettings({
        ...cur,
        automix_roles: answer,
        automix_rules: rules.trim() === DEFAULT_RULES.trim() ? "" : rules,
        automix_fx_mute: fxMute && name("fx") !== "-" ? name("fx") : "",
        automix_bgv_name: name("bgv") === "-" ? cur.automix_bgv_name : name("bgv"),
        automix_bgv_ride: name("bgv") !== "-" && bgvOn,
        automix_bgv_tuck: tuck,
        automix_feeds: feedText,
        automix_feeds_on: feedText.length > 0,
        follow_guide_channel: guide,
        follow_click_channel: click,
        follow_midi_port: midi || null,
        autopilot_lapel: lapel ? `input:${lapel}` : "",
        autopilot_lapel_audio: lapelAudio,
        autopilot_mc: mc ? `input:${mc}` : "",
        autopilot_mc_audio: mcAudio,
      });
      await refreshSettings();
      onClose();
    } catch (e) {
      setMsg(String(e));
      setBusy(false);
    }
  }

  const micChans = Object.keys(s?.audio_mic_channels ?? {}).length;
  const leadScenes = Object.keys(pco.micSceneMap ?? {}).length;
  const timingSources = [guide > 0, click > 0, !!midi].filter(Boolean).length;
  const assigned = ROLES.filter((r) => roles[r.id]?.trim()).length;
  const feedRoles = ROLES.filter((r) => r.nudge && roles[r.id]?.trim());

  const steps = STEPS.map((st, i) => ({
    ...st,
    done: i < at || (st.id === "console" && connected),
  }));

  function toggleFeed(ch: number) {
    setFeeds((prev) => {
      const cur = prev[assigning] ?? [];
      const nextChs = cur.includes(ch) ? cur.filter((c) => c !== ch) : [...cur, ch].sort((a, b) => a - b);
      return { ...prev, [assigning]: nextChs };
    });
  }
  const feedOwner = (ch: number) => feedRoles.find((r) => (feeds[r.id] ?? []).includes(ch));

  const chanRow = (label: string, id: string, value: number, set: (n: number) => void, hint: string) => (
    <div className="wz-chan">
      <label className="field" htmlFor={id}>
        <span>{label}</span>
        <input className="input" type="number" id={id} min={0} max={256} value={value} onChange={(e) => set(Math.max(0, parseInt(e.target.value, 10) || 0))} />
      </label>
      <LevelBar db={value > 0 ? held[value - 1] : undefined} />
      <span className="muted small">{value > 0 ? trackNames[String(value)] || hint : "Not used"}</span>
    </div>
  );

  return (
    <WizardShell
      title="Set up Automix"
      steps={steps}
      at={at}
      onGo={(i) => {
        setMsg("");
        setAt(i);
      }}
      onClose={onClose}
      busy={busy}
      actions={
        at < STEPS.length - 1 ? (
          <button className="btn primary" disabled={busy || (at === 0 && !connected)} onClick={() => setAt(at + 1)}>
            Next
          </button>
        ) : (
          <button className="btn primary" disabled={busy || moments === 0} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
        )
      }
    >
      {at === 0 && (
        <>
          <h2>Connect the console</h2>
          <p className="wz-lead">Automix moves your faders at the right moments in each song, so ProDeck needs to reach the console on the network.</p>
          {!deskControlSupported(desk?.model || s?.avantis_model) && (
            <p className="wz-warn">ProDeck can only watch a Yamaha desk for now, so Automix can't move its faders yet. Everything else still mirrors live.</p>
          )}
          {connected ? (
            <p className="wz-ok">
              Connected to the {CONSOLES.find((c) => c.id === (desk?.model || model))?.name ?? "console"} at {s?.avantis_host}. {deskFaders.length} faders found.
            </p>
          ) : (
            <p className="wz-warn">Not connected yet.</p>
          )}
          {connected && !changing ? (
            <div className="wz-row-actions">
              <button className="btn small ghost" onClick={() => setChanging(true)}>
                Change connection
              </button>
            </div>
          ) : (
            <>
              <div className="wz-form">
                <label className="field">
                  <span>Console</span>
                  <select
                    className="input"
                    id="wz-am-model"
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value);
                      setPort(CONSOLES.find((c) => c.id === e.target.value)?.port ?? 51325);
                    }}
                  >
                    {CONSOLES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Console IP address</span>
                  <input className="input" id="wz-am-host" value={host} placeholder="192.168.1.20" onChange={(e) => setHost(e.target.value)} />
                </label>
                <label className="field">
                  <span>Port</span>
                  <input className="input" type="number" id="wz-am-port" value={port} onChange={(e) => setPort(parseInt(e.target.value, 10) || 0)} />
                </label>
                {model !== "x32" && (
                  <label className="field">
                    <span>MIDI channel</span>
                    <input className="input" type="number" id="wz-am-base" min={1} max={16} value={base} onChange={(e) => setBase(parseInt(e.target.value, 10) || 1)} />
                  </label>
                )}
              </div>
              <div className="wz-row-actions">
                <button className="btn" disabled={busy || !host.trim()} onClick={connect}>
                  {connected ? "Save and reconnect" : "Connect"}
                </button>
              </div>
              <p className="muted small">
                On an Allen &amp; Heath desk the MIDI channel is set under Utility, Control, MIDI. An X32 or M32 needs nothing set on the desk.
              </p>
            </>
          )}
        </>
      )}

      {at === 1 && (
        <>
          <h2>Which fader plays each part?</h2>
          <p className="wz-lead">
            Automix works with the faders you already mix from, usually DCAs. Pick yours for each part, or leave it empty if your desk has no fader for it. For a
            single channel, type ch and its number, like ch 12.
          </p>
          <datalist id="wz-am-faders">
            {deskFaders.map((n) => (
              <option key={n} value={n} />
            ))}
            {deskInputs.slice(0, 128).map((i) => (
              <option key={i.no} value={`ch ${i.no}`}>
                {i.name}
              </option>
            ))}
          </datalist>
          <div className="wz-roles">
            {ROLES.map((r) => {
              const v = roles[r.id] ?? "";
              return (
                <div key={r.id} className="wz-role">
                  <label htmlFor={`wz-am-role-${r.id}`}>{r.label}</label>
                  <input
                    className="input"
                    id={`wz-am-role-${r.id}`}
                    list="wz-am-faders"
                    value={v}
                    placeholder="Not on this desk"
                    onChange={(e) => setRoles({ ...roles, [r.id]: e.target.value })}
                  />
                  <span className={`small ${known(v) ? "muted" : "wz-warn-text"}`}>{!v ? "" : known(v) ? "✓" : "Not a fader on this desk"}</span>
                </div>
              );
            })}
          </div>
          {roles.fx?.trim() && (
            <label className="field check">
              <input type="checkbox" id="wz-am-fxmute" checked={fxMute} onChange={(e) => setFxMute(e.target.checked)} />
              <span>Mute {roles.fx} between songs</span>
            </label>
          )}
          <p className="muted small">
            {assigned} of {ROLES.length} parts set. Nothing changes on the desk until you save on the last step, and Automix only moves faders after someone presses Arm.
          </p>
        </>
      )}

      {at === 2 && (
        <>
          <h2>Instrument feeds</h2>
          <p className="wz-lead">
            If guitars and keys also reach ProDeck's audio input on their own channels, Automix can hear them: a small lift for the one playing an instrumental,
            a small trim for one that's dug in too loud. Pick a part, then click its channels. Ask the player to play and watch which channel lights up.
          </p>
          {feedRoles.length === 0 ? (
            <p className="wz-note">No guitars, keys or acoustics set on the last step, so there's nothing to listen for. You can skip this.</p>
          ) : (
            <>
              <div className="wz-row-actions" role="radiogroup" aria-label="Part to assign">
                {feedRoles.map((r) => (
                  <label key={r.id} className={`wz-pill ${assigning === r.id ? "on" : ""}`}>
                    <input type="radio" name="wz-am-assign" id={`wz-am-assign-${r.id}`} checked={assigning === r.id} onChange={() => setAssigning(r.id)} />
                    {roles[r.id]} <span className="muted">{(feeds[r.id] ?? []).join(", ") || "none"}</span>
                  </label>
                ))}
              </div>
              <div className="wz-grid">
                {Array.from({ length: Math.max(held.length, 16) }, (_, i) => {
                  const ch = i + 1;
                  const owner = feedOwner(ch);
                  return (
                    <button
                      key={ch}
                      type="button"
                      className={`wz-cell pick ${(held[i] ?? -120) > SIGNAL_DB ? "on" : ""} ${owner ? "taken" : ""} ${owner?.id === assigning ? "mine" : ""}`}
                      onClick={() => toggleFeed(ch)}
                      title={owner ? `${roles[owner.id]}` : "Click to assign"}
                    >
                      <span className="mono">{ch}</span>
                      <span className="wz-cell-name">{owner ? roles[owner.id] : trackNames[String(ch)] || ""}</span>
                      <LevelBar db={held[i]} />
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {at === 3 && (
        <>
          <h2>Backing vocals</h2>
          {!roles.bgv?.trim() ? (
            <p className="wz-note">No backing vocal fader set, so the rider stays off. Go back to Faders to add one.</p>
          ) : (
            <>
              <p className="wz-lead">
                The rider brings {roles.bgv} up when a backing singer is singing and tucks it when none are. It hears each vocal mic, and knows which one is the
                song leader from the desk scene.
              </p>
              <label className="field check">
                <input type="checkbox" id="wz-am-bgv" checked={bgvOn} onChange={(e) => setBgvOn(e.target.checked)} />
                <span>Ride {roles.bgv}</span>
              </label>
              <div className="wz-form">
                <label className="field" htmlFor="wz-am-tuck">
                  <span>Tuck when nobody is singing (dB)</span>
                  <input className="input" type="number" id="wz-am-tuck" min={-12} max={0} step={1} value={tuck} onChange={(e) => setTuck(Math.max(-12, Math.min(0, Number(e.target.value) || 0)))} />
                </label>
              </div>
              <ul className="wz-checks">
                <li className={micChans ? "ok" : "todo"}>
                  {micChans ? `${micChans} vocal mics are mapped to audio channels.` : "Vocal mics aren't mapped to audio channels yet."}{" "}
                  <button className="btn ghost small" onClick={() => {
                      onAway();
                      requestNavigate("settings", "set-audio");
                    }}>
                    {micChans ? "Change" : "Set up"}
                  </button>
                </li>
                <li className={leadScenes ? "ok" : "todo"}>
                  {leadScenes ? `${leadScenes} lead scenes are set, one per mic.` : "No lead scenes yet, so the rider can't tell the leader from the singers."}{" "}
                  <button className="btn ghost small" onClick={() => {
                      onAway();
                      requestNavigate("planning");
                    }}>
                    {leadScenes ? "Change" : "Set up"}
                  </button>
                </li>
              </ul>
              <p className="muted small">Those open another page. Your answers here are kept: come back with Continue Automix setup at the bottom of the screen.</p>
            </>
          )}
        </>
      )}

      {at === 4 && (
        <>
          <h2>Where does the song timing come from?</h2>
          <p className="wz-lead">Automix changes the mix as the song moves from verse to chorus. It needs at least one of these.</p>
          {chanRow("Guide track channel", "wz-am-guide", guide, setGuide, "The spoken cues: Verse, Chorus, Bridge")}
          {chanRow("Click channel", "wz-am-click", click, setClick, "The beat")}
          <div className="wz-chan">
            <label className="field" htmlFor="wz-am-midi">
              <span>MIDI clock</span>
              <select className="input" id="wz-am-midi" value={midi} onChange={(e) => setMidi(e.target.value)}>
                <option value="">None</option>
                {midiPorts.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                {midi && !midiPorts.includes(midi) && <option value={midi}>{midi} (not connected)</option>}
              </select>
            </label>
            <span />
            <span className="muted small">From Playback or Ableton: the exact downbeat</span>
          </div>
          {timingSources === 0 ? (
            <p className="wz-warn">Choose at least one, or Automix won't know when to move.</p>
          ) : (
            <p className="wz-ok">
              {timingSources} timing source{timingSources > 1 ? "s" : ""} set.
            </p>
          )}
        </>
      )}

      {at === 5 && (
        <>
          <h2>Speech mics (optional)</h2>
          <p className="wz-lead">
            ProDeck can open the pastor's lapel and the MC mic when the plan gets to their part, and close them after. Only while Automix is armed. Leave empty to skip.
          </p>
          <datalist id="wz-am-inputs">
            {deskInputs.map((i) => (
              <option key={i.no} value={i.no}>
                {i.name}
              </option>
            ))}
          </datalist>
          <div className="wz-form">
            <label className="field">
              <span>Lapel: desk channel</span>
              <input className="input" id="wz-am-lapel" list="wz-am-inputs" inputMode="numeric" value={lapel} placeholder="None" onChange={(e) => setLapel(e.target.value.replace(/\D/g, ""))} />
            </label>
            <label className="field">
              <span>Lapel: audio channel</span>
              <input className="input" type="number" id="wz-am-lapel-audio" min={0} value={lapelAudio} onChange={(e) => setLapelAudio(Math.max(0, parseInt(e.target.value, 10) || 0))} />
            </label>
            <label className="field">
              <span>MC mic: desk channel</span>
              <input className="input" id="wz-am-mc" list="wz-am-inputs" inputMode="numeric" value={mc} placeholder="None" onChange={(e) => setMc(e.target.value.replace(/\D/g, ""))} />
            </label>
            <label className="field">
              <span>MC mic: audio channel</span>
              <input className="input" type="number" id="wz-am-mc-audio" min={0} value={mcAudio} onChange={(e) => setMcAudio(Math.max(0, parseInt(e.target.value, 10) || 0))} />
            </label>
          </div>
          <p className="muted small">
            {lapel && deskInputs.find((i) => i.no === lapel)?.name ? `Lapel is ${deskInputs.find((i) => i.no === lapel)?.name}. ` : ""}
            {mc && deskInputs.find((i) => i.no === mc)?.name ? `MC is ${deskInputs.find((i) => i.no === mc)?.name}. ` : ""}
            The audio channel lets ProDeck hear when they stop talking. 0 means it never closes the mic on its own.
          </p>
        </>
      )}

      {at === 6 && (
        <>
          <h2>Review</h2>
          <dl className="wz-review">
            <dt>Console</dt>
            <dd>{connected ? `Connected, ${deskFaders.length} faders` : "Not connected"}</dd>
            <dt>Faders</dt>
            <dd>
              {ROLES.filter((r) => roles[r.id]?.trim())
                .map((r) => `${r.label}: ${roles[r.id]}`)
                .join(" · ") || "None set"}
            </dd>
            <dt>Feeds</dt>
            <dd>{feedRoles.filter((r) => feeds[r.id]?.length).map((r) => `${roles[r.id]} on ${feeds[r.id].join(", ")}`).join(" · ") || "None"}</dd>
            <dt>Backing vocals</dt>
            <dd>{roles.bgv?.trim() && bgvOn ? `${roles.bgv} rides, tucks ${tuck} dB` : "Off"}</dd>
            <dt>Timing</dt>
            <dd>{[guide ? `guide on ${guide}` : "", click ? `click on ${click}` : "", midi ? `MIDI clock from ${midi}` : ""].filter(Boolean).join(" · ") || "None"}</dd>
            <dt>Speech mics</dt>
            <dd>{[lapel ? `lapel ch ${lapel}` : "", mc ? `MC ch ${mc}` : ""].filter(Boolean).join(" · ") || "Off"}</dd>
          </dl>
          <label className="field" htmlFor="wz-am-rules">
            <span>
              The moves, in dB from where you set each fader ({moments} moments). Written for your faders; change any number you like.
            </span>
            <textarea className="input mono wz-rules" id="wz-am-rules" rows={9} value={rules} onChange={(e) => setRulesText(e.target.value)} />
          </label>
          {rulesText != null && (
            <button className="btn small ghost" onClick={() => setRulesText(null)}>
              Undo my edits
            </button>
          )}
          <p className="wz-note">
            Automix never starts on its own. When the mix sounds right, press Arm on the Automix tile or the Stream Deck. Touch a fader and it lets go of that one for the rest of the song.
          </p>
        </>
      )}
      {msg && <p className={msg.startsWith("Saved") ? "wz-ok" : "error small"}>{msg}</p>}
    </WizardShell>
  );
}

