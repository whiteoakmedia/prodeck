import { useEffect, useState } from "react";
import { useProDeck } from "../store";
import { usePco } from "../pcoStore";
import { getSettings, updateSettings, IS_WEB, type Settings } from "../lib/tauri";
import { ConnectCard } from "./ConnectCard";
import { Icon } from "./Icon";

/**
 * First-run walkthrough. A fresh install used to open on a silent empty
 * dashboard — the only onboarding was knowing which Settings cards to visit.
 * This walks the three connections that make ProDeck useful, each skippable,
 * and never returns once dismissed (prodeck.setupDone).
 *
 * Self-gating: desktop only, and only when nothing is configured yet — an
 * existing booth (Pro host or PCO creds present) never sees it.
 */

const DONE_KEY = "prodeck.setupDone";

const STEPS = ["welcome", "propresenter", "pco", "web", "done"] as const;
type Step = (typeof STEPS)[number];

export function FirstRunSetup() {
  const { settings, connected } = useProDeck();
  const pco = usePco();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("welcome");

  // PCO step state
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [pcoBusy, setPcoBusy] = useState(false);
  const [pcoMsg, setPcoMsg] = useState("");

  // Web step state
  const [webOn, setWebOn] = useState(true);
  const [adminPw, setAdminPw] = useState("");
  const [memberPw, setMemberPw] = useState("");
  const [webMsg, setWebMsg] = useState("");
  const [webBusy, setWebBusy] = useState(false);

  useEffect(() => {
    if (IS_WEB || settings === null) return;
    if (localStorage.getItem(DONE_KEY) === "1") return;
    const fresh =
      !settings.pp_host?.trim() && !settings.pco_app_id && !settings.web_enabled;
    if (fresh) setOpen(true);
  }, [settings === null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const finish = () => {
    localStorage.setItem(DONE_KEY, "1");
    setOpen(false);
  };
  const idx = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(idx + 1, STEPS.length - 1)]);
  const back = () => setStep(STEPS[Math.max(idx - 1, 0)]);

  async function savePco() {
    setPcoBusy(true);
    setPcoMsg("");
    try {
      await pco.saveCredentials(appId.trim(), secret.trim());
      setPcoMsg("✓ Connected to Planning Center");
      setTimeout(next, 700);
    } catch (e) {
      setPcoMsg(String(e));
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
      };
      await updateSettings(nextS as unknown as Settings);
      setWebMsg("✓ Saved");
      setTimeout(next, 500);
    } catch (e) {
      setWebMsg(String(e));
    } finally {
      setWebBusy(false);
    }
  }

  return (
    <div className="fr-backdrop">
      <div className="fr-card">
        <div className="fr-progress">
          {STEPS.map((s, i) => (
            <span key={s} className={`fr-dot ${i <= idx ? "on" : ""}`} />
          ))}
        </div>

        {step === "welcome" && (
          <>
            <h2>Welcome to ProDeck</h2>
            <p className="fr-lead">
              Three quick connections make this useful. Every step is skippable —
              everything lives in Settings afterward, so nothing here is a
              one-shot decision.
            </p>
            <ol className="fr-list">
              <li><strong>ProPresenter</strong> — live slides, rundown control, automation</li>
              <li><strong>Planning Center</strong> — plans, teams, and everything scheduled</li>
              <li><strong>Browser access</strong> — dashboards on phones and kiosk screens</li>
            </ol>
            <div className="fr-actions">
              <button className="btn ghost" onClick={finish}>
                Skip setup
              </button>
              <button className="btn primary" onClick={next}>
                Start
              </button>
            </div>
          </>
        )}

        {step === "propresenter" && (
          <>
            <h2>Connect ProPresenter</h2>
            <p className="fr-lead">
              On the ProPresenter machine, turn on{" "}
              <strong>Preferences → Network → Enable Network</strong>, then scan
              or enter its address here.
            </p>
            <ConnectCard />
            <div className="fr-actions">
              <button className="btn ghost" onClick={back}>
                Back
              </button>
              <button className="btn ghost" onClick={next}>
                Skip
              </button>
              <button className="btn primary" disabled={!connected} onClick={next}>
                {connected ? "Connected — next" : "Waiting for connection…"}
              </button>
            </div>
          </>
        )}

        {step === "pco" && (
          <>
            <h2>Connect Planning Center</h2>
            <p className="fr-lead">
              Create a <strong>Personal Access Token</strong> at{" "}
              <code>api.planningcenteronline.com</code> (any Services admin
              account) and paste the pair here. It stays on this machine.
            </p>
            <label className="field">
              <span>Application ID</span>
              <input
                className="input"
                autoComplete="off"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Secret</span>
              <input
                className="input"
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </label>
            {pcoMsg && (
              <p className={pcoMsg.startsWith("✓") ? "hint" : "error small"}>{pcoMsg}</p>
            )}
            <div className="fr-actions">
              <button className="btn ghost" onClick={back}>
                Back
              </button>
              <button className="btn ghost" onClick={next}>
                Skip
              </button>
              <button
                className="btn primary"
                disabled={pcoBusy || !appId.trim() || !secret.trim()}
                onClick={savePco}
              >
                {pcoBusy ? "Checking…" : "Save & verify"}
              </button>
            </div>
          </>
        )}

        {step === "web" && (
          <>
            <h2>Browser access</h2>
            <p className="fr-lead">
              Serves these dashboards to phones and kiosks on your network.
              Admin unlocks everything; the member password is dashboards + chat
              only.
            </p>
            <label className="field check">
              <input
                type="checkbox"
                checked={webOn}
                onChange={(e) => setWebOn(e.target.checked)}
              />
              <span>Enable the web gateway (port 8088)</span>
            </label>
            <label className="field">
              <span>Admin password</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={adminPw}
                onChange={(e) => setAdminPw(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Member password (crew phones)</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={memberPw}
                onChange={(e) => setMemberPw(e.target.value)}
              />
            </label>
            {webMsg && (
              <p className={webMsg.startsWith("✓") ? "hint" : "error small"}>{webMsg}</p>
            )}
            <div className="fr-actions">
              <button className="btn ghost" onClick={back}>
                Back
              </button>
              <button className="btn ghost" onClick={next}>
                Skip
              </button>
              <button
                className="btn primary"
                disabled={webBusy || (webOn && !adminPw)}
                onClick={saveWeb}
              >
                {webBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <h2>You're set</h2>
            <p className="fr-lead">Where everything else lives:</p>
            <ul className="fr-list">
              <li><Icon name="settings" size={14} /> <strong>Settings</strong> — audio input & SPL, Avantis, MIDI key-send, GA4 viewers, crew approvals</li>
              <li><Icon name="dashboard" size={14} /> <strong>Dashboard → Edit</strong> — build your widget layouts</li>
              <li><Icon name="captions" size={14} /> <code>docs/ADOPTERS_GUIDE.html</code> — the full phased guide (tap discs, kiosks, your own domain)</li>
            </ul>
            <div className="fr-actions">
              <button className="btn primary" onClick={finish}>
                Open ProDeck
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
