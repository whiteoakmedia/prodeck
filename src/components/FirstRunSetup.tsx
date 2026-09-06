import { useEffect, useState } from "react";
import { useProDeck } from "../store";
import { usePco } from "../pcoStore";
import {
  getSettings,
  updateSettings,
  pcoTest,
  webStart,
  webStop,
  IS_WEB,
  type Settings,
} from "../lib/tauri";
import { requestSettingsJump } from "../lib/settingsJump";
import { isFreshInstall, readSetupDone, writeSetupDone, ONBOARDING_EVENT } from "../lib/onboarding";
import { ConnectCard } from "./ConnectCard";
import { Icon } from "./Icon";

/**
 * First-run onboarding — a full-screen, staged walkthrough for a fresh install.
 *
 * It does four things a downloader needs before anything else makes sense:
 *   1. explains what ProDeck is and how it works,
 *   2. shows every tool it can connect (so expectations are set),
 *   3. connects the two essentials live (ProPresenter + Planning Center),
 *   4. hands off the optional pieces to their Settings cards.
 *
 * Self-gating: desktop only, only when nothing is configured yet. Dismissed
 * once and never returns (prodeck.setupDone). Re-openable from Setup via
 * requestOnboarding(), which fires ONBOARDING_EVENT.
 */

type Stage = "welcome" | "tools" | "propresenter" | "pco" | "web" | "more" | "done";
const STAGES: { id: Stage; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "tools", label: "What it connects" },
  { id: "propresenter", label: "ProPresenter" },
  { id: "pco", label: "Planning Center" },
  { id: "web", label: "Browser access" },
  { id: "more", label: "Add-ons" },
  { id: "done", label: "Done" },
];

// Everything ProDeck currently connects to, for the "what it supports" map.
const TOOLS: {
  group: string;
  items: { name: string; need: "core" | "opt"; what: string }[];
}[] = [
  {
    group: "The essentials",
    items: [
      { name: "ProPresenter", need: "core", what: "Live slides, the rundown, triggers, and slide-note automation." },
      { name: "Planning Center", need: "core", what: "Service plans, teams, call times, mic assignments." },
      { name: "Browser access", need: "opt", what: "These dashboards on any phone, tablet, or kiosk on your network." },
    ],
  },
  {
    group: "Audio & console",
    items: [
      { name: "Audio input", need: "opt", what: "Calibrated SPL + RTA metering from any input, including Dante." },
      { name: "Allen & Heath console", need: "opt", what: "Avantis, dLive, or SQ — mutes, faders, scenes, names mirrored live; control is admin-only." },
      { name: "Song-key MIDI send", need: "opt", what: "Push the live song's key to Waves / plugin scenes over MIDI." },
    ],
  },
  {
    group: "Stream & lobby",
    items: [
      { name: "NDI stage feed", need: "opt", what: "Any NDI source as a confidence tile on a dashboard." },
      { name: "Live viewers (GA4)", need: "opt", what: "Realtime watch-page count from your stream's analytics." },
      { name: "TapLink NFC discs", need: "opt", what: "Lobby discs whose link follows the service automatically." },
      { name: "Stream Deck", need: "opt", what: "Physical keys for tap, clears, and live readouts via Companion." },
    ],
  },
  {
    group: "Crew & cloud",
    items: [
      { name: "Crew phones", need: "opt", what: "Installable app: pages, chat, check-in, checklists." },
      { name: "Your own domain", need: "opt", what: "Reach it anywhere, with a read-only fallback when the Mac is off." },
    ],
  },
];

// Optional connections the onboarding hands off to Settings, with the exact
// card each one lives in.
const ADDONS: { name: string; what: string; page: string; anchor: string }[] = [
  { name: "Audio & SPL", what: "Pick the input ProDeck listens to; calibrate the meter.", page: "settings", anchor: "set-audio" },
  { name: "Allen & Heath console", what: "Avantis, dLive, or SQ — mirror the desk live.", page: "settings", anchor: "set-avantis" },
  { name: "Song-key MIDI", what: "Send the live key to Waves / plugin scenes.", page: "settings", anchor: "set-songkey" },
  { name: "Live viewers", what: "Connect Google Analytics for a realtime count.", page: "settings", anchor: "set-ga4" },
  { name: "TapLink discs", what: "Point NFC discs at links that follow the service.", page: "settings", anchor: "set-taplink" },
  { name: "Crew & remote", what: "Your public URL, invites, and crew approvals.", page: "settings", anchor: "set-web" },
];

export function FirstRunSetup({ onNavigate }: { onNavigate?: (p: string) => void }) {
  const { settings, connected, refreshSettings } = useProDeck();
  const pco = usePco();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("welcome");

  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [pcoBusy, setPcoBusy] = useState(false);
  const [pcoMsg, setPcoMsg] = useState("");
  const [pcoDone, setPcoDone] = useState(false);

  const [webOn, setWebOn] = useState(true);
  const [adminPw, setAdminPw] = useState("");
  const [memberPw, setMemberPw] = useState("");
  const [webMsg, setWebMsg] = useState("");
  const [webBusy, setWebBusy] = useState(false);

  useEffect(() => {
    if (IS_WEB || settings === null) return;
    if (readSetupDone()) return;
    if (isFreshInstall(settings)) setOpen(true);
  }, [settings === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Re-run the walkthrough" from the Setup page.
  useEffect(() => {
    if (IS_WEB) return;
    const reopen = () => {
      setStage("welcome");
      setOpen(true);
    };
    window.addEventListener(ONBOARDING_EVENT, reopen);
    return () => window.removeEventListener(ONBOARDING_EVENT, reopen);
  }, []);

  if (!open) return null;

  const idx = STAGES.findIndex((s) => s.id === stage);
  const go = (s: Stage) => setStage(s);
  // Functional updates: the delayed `next` after a successful save must step
  // from wherever the user IS, not from the render that scheduled it (a quick
  // Back inside that window used to get yanked forward again).
  const step = (delta: number) =>
    setStage((cur) => {
      const i = STAGES.findIndex((x) => x.id === cur);
      return STAGES[Math.max(0, Math.min(i + delta, STAGES.length - 1))].id;
    });
  const next = () => step(1);
  const back = () => step(-1);
  const finish = () => {
    writeSetupDone(true);
    setOpen(false);
  };

  // A stage counts as "done" (checkmark in the rail) once its thing is set.
  const doneState = (s: Stage): boolean => {
    if (s === "propresenter") return connected;
    if (s === "pco") return pcoDone || !!settings?.pco_app_id;
    if (s === "web") return !!webMsg.startsWith("✓") || !!settings?.web_enabled;
    return idx > STAGES.findIndex((x) => x.id === s);
  };

  async function savePco() {
    setPcoBusy(true);
    setPcoMsg("");
    try {
      // saveCredentials persists and then self-tests, but it swallows the
      // test failure into pco.status — so a wrong secret used to print the
      // checkmark and advance. Test explicitly and only advance on success.
      await pco.saveCredentials(appId.trim(), secret.trim());
      await pcoTest();
      setPcoMsg("✓ Connected to Planning Center");
      setPcoDone(true);
      setTimeout(next, 800);
    } catch (e) {
      setPcoMsg(`Planning Center rejected those credentials — check the Application ID and Secret. (${String(e)})`);
    } finally {
      setPcoBusy(false);
    }
  }

  async function saveWeb() {
    setWebBusy(true);
    setWebMsg("");
    try {
      const s = (await getSettings()) as Settings;
      const nextS = {
        ...s,
        web_enabled: webOn,
        web_password: adminPw || s.web_password,
        web_member_password: memberPw || s.web_member_password,
      } as unknown as Settings;
      await updateSettings(nextS);
      // Saving only persists the setting; the gateway itself is started by
      // web_start. Without this, "Open it to phones" saved a checkbox and the
      // phone got connection refused until the next relaunch.
      if (webOn && (nextS as any).web_password) {
        await webStart((nextS as any).web_port ?? 8088);
      } else {
        await webStop().catch(() => {});
      }
      await refreshSettings();
      setWebMsg(webOn ? "✓ Browser access is live" : "✓ Saved");
      setTimeout(next, 600);
    } catch (e) {
      setWebMsg(String(e));
    } finally {
      setWebBusy(false);
    }
  }

  const openAddon = (a: (typeof ADDONS)[number]) => {
    requestSettingsJump(a.anchor);
    finish();
    onNavigate?.(a.page);
  };

  return (
    <div className="ob-root">
      {/* progress rail */}
      <aside className="ob-rail">
        <div className="ob-brand">
          <span className="ob-mark" />
          <span>ProDeck</span>
        </div>
        <ol className="ob-steps">
          {STAGES.map((s, i) => {
            const state = s.id === stage ? "on" : doneState(s.id) ? "done" : i < idx ? "done" : "";
            return (
              <li
                key={s.id}
                className={`ob-step ${state}`}
                onClick={() => (i <= idx || doneState(s.id) ? go(s.id) : null)}
              >
                <span className="ob-step-dot">{state === "done" ? "✓" : i + 1}</span>
                {s.label}
              </li>
            );
          })}
        </ol>
        <button className="ob-skip" onClick={finish}>
          Skip &amp; explore on my own
        </button>
      </aside>

      {/* content */}
      <main className="ob-main">
        {stage === "welcome" && (
          <div className="ob-stage ob-welcome">
            <span className="ob-eyebrow">Welcome</span>
            <h1>Your production booth, in one app.</h1>
            <p className="ob-lead">
              ProDeck runs on a Mac in your booth and ties the room together —
              ProPresenter, Planning Center, your consoles, crew phones, and the
              livestream — then shows it all as live dashboards anyone on your
              team can open.
            </p>
            <div className="ob-how">
              <div className="ob-how-item">
                <Icon name="dashboard" size={20} />
                <strong>One hub</strong>
                <span>This Mac connects to your tools and reads their live state.</span>
              </div>
              <div className="ob-how-item">
                <Icon name="grid" size={20} />
                <strong>Dashboards everywhere</strong>
                <span>The same view on the booth screen, phones, and kiosks.</span>
              </div>
              <div className="ob-how-item">
                <Icon name="checklist" size={20} />
                <strong>Pick what you use</strong>
                <span>Every connection is optional — ignore what you don't need.</span>
              </div>
            </div>
            <div className="ob-actions">
              <span />
              <button className="btn primary lg" onClick={next}>
                Take the tour →
              </button>
            </div>
          </div>
        )}

        {stage === "tools" && (
          <div className="ob-stage">
            <span className="ob-eyebrow">What ProDeck connects</span>
            <h1>Everything it can talk to.</h1>
            <p className="ob-lead">
              Two connections make it useful; the rest you add whenever you're
              ready. Nothing here is required to start.
            </p>
            <div className="ob-tools">
              {TOOLS.map((grp) => (
                <div key={grp.group} className="ob-tool-group">
                  <h3>{grp.group}</h3>
                  {grp.items.map((it) => (
                    <div key={it.name} className="ob-tool">
                      <span className={`ob-tag ${it.need}`}>{it.need === "core" ? "Core" : "Optional"}</span>
                      <div>
                        <strong>{it.name}</strong>
                        <span>{it.what}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="ob-actions">
              <button className="btn ghost" onClick={back}>← Back</button>
              <button className="btn primary lg" onClick={next}>Let's connect →</button>
            </div>
          </div>
        )}

        {stage === "propresenter" && (
          <div className="ob-stage">
            <span className="ob-eyebrow">Step 1 · Essential</span>
            <h1>Connect ProPresenter.</h1>
            <p className="ob-lead">
              On the ProPresenter computer, open <strong>Preferences → Network</strong>{" "}
              and turn on <strong>Enable Network</strong>. Then press{" "}
              <strong>Find</strong> — ProDeck discovers the address and port for
              you. Typing them by hand is the fallback; ProPresenter's Network
              screen shows the exact port.
            </p>
            <div className="ob-embed">
              <ConnectCard />
            </div>
            {connected && (
              <p className="ob-ok"><span className="ob-check">✓</span> Connected — slides and the rundown are live.</p>
            )}
            <div className="ob-actions">
              <button className="btn ghost" onClick={back}>← Back</button>
              <div className="ob-actions-r">
                <button className="btn ghost" onClick={next}>Skip for now</button>
                <button className="btn primary lg" disabled={!connected} onClick={next}>
                  {connected ? "Next →" : "Waiting for connection…"}
                </button>
              </div>
            </div>
          </div>
        )}

        {stage === "pco" && (
          <div className="ob-stage">
            <span className="ob-eyebrow">Step 2 · Essential</span>
            <h1>Connect Planning Center.</h1>
            <p className="ob-lead">
              Sign in at <code>api.planningcenteronline.com</code> as any
              Planning Center admin, open <strong>Personal Access Tokens</strong>,
              create one, and paste it here. It stays on this machine and is never
              sent anywhere else.
            </p>
            <div className="ob-form">
              <label className="field">
                <span>Application ID</span>
                <input className="input" autoComplete="off" value={appId} onChange={(e) => setAppId(e.target.value)} />
              </label>
              <label className="field">
                <span>Secret</span>
                <input className="input" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
              </label>
              {pcoMsg && <p className={pcoMsg.startsWith("✓") ? "ob-ok" : "error small"}>{pcoMsg}</p>}
            </div>
            <div className="ob-actions">
              <button className="btn ghost" onClick={back}>← Back</button>
              <div className="ob-actions-r">
                <button className="btn ghost" onClick={next}>Skip for now</button>
                <button className="btn primary lg" disabled={pcoBusy || !appId.trim() || !secret.trim()} onClick={savePco}>
                  {pcoBusy ? "Checking…" : "Connect →"}
                </button>
              </div>
            </div>
          </div>
        )}

        {stage === "web" && (
          <div className="ob-stage">
            <span className="ob-eyebrow">Step 3 · Recommended</span>
            <h1>Open it to phones &amp; kiosks.</h1>
            <p className="ob-lead">
              Browser access serves these dashboards to any device on your
              network. The <strong>admin</strong> password unlocks everything;
              the <strong>member</strong> password is view + chat only, for the
              team. Leave a password blank and that tier stays closed.
            </p>
            <div className="ob-form">
              <label className="field check">
                <input type="checkbox" checked={webOn} onChange={(e) => setWebOn(e.target.checked)} />
                <span>Enable browser access (port 8088)</span>
              </label>
              <label className="field">
                <span>Admin password</span>
                <input className="input" type="password" autoComplete="new-password" value={adminPw} onChange={(e) => setAdminPw(e.target.value)} />
              </label>
              <label className="field">
                <span>Member password <span className="muted">(crew phones)</span></span>
                <input className="input" type="password" autoComplete="new-password" value={memberPw} onChange={(e) => setMemberPw(e.target.value)} />
              </label>
              {webMsg && <p className={webMsg.startsWith("✓") ? "ob-ok" : "error small"}>{webMsg}</p>}
            </div>
            <div className="ob-actions">
              <button className="btn ghost" onClick={back}>← Back</button>
              <div className="ob-actions-r">
                <button className="btn ghost" onClick={next}>Skip for now</button>
                <button className="btn primary lg" disabled={webBusy || (webOn && !adminPw)} onClick={saveWeb}>
                  {webBusy ? "Saving…" : "Save →"}
                </button>
              </div>
            </div>
          </div>
        )}

        {stage === "more" && (
          <div className="ob-stage">
            <span className="ob-eyebrow">Optional</span>
            <h1>Add what fits your room.</h1>
            <p className="ob-lead">
              Each of these opens its own Settings card — set up any that apply,
              or come back to them from the <strong>Setup</strong> page anytime.
            </p>
            <div className="ob-addons">
              {ADDONS.map((a) => (
                <button key={a.name} className="ob-addon" onClick={() => openAddon(a)}>
                  <div>
                    <strong>{a.name}</strong>
                    <span>{a.what}</span>
                  </div>
                  <span className="ob-addon-go">Open →</span>
                </button>
              ))}
            </div>
            <div className="ob-actions">
              <button className="btn ghost" onClick={back}>← Back</button>
              <button className="btn primary lg" onClick={next}>I'm set for now →</button>
            </div>
          </div>
        )}

        {stage === "done" && (
          <div className="ob-stage ob-done">
            <div className="ob-done-badge"><span>✓</span></div>
            <h1>You're ready.</h1>
            <p className="ob-lead">
              Here's where everything lives once you're in.
            </p>
            <ul className="ob-recap">
              <li><Icon name="dashboard" size={16} /> <strong>Dashboard → Edit</strong> — drag widgets to build the layouts your team sees.</li>
              <li><Icon name="checklist" size={16} /> <strong>Setup</strong> — every connection's live status, with fix-it steps when something's off.</li>
              <li><Icon name="settings" size={16} /> <strong>Settings</strong> — audio, console, MIDI, viewers, crew, and the rest.</li>
            </ul>
            <div className="ob-actions">
              <span />
              <button className="btn primary lg" onClick={finish}>Open ProDeck →</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
