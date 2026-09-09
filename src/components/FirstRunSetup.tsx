import { useEffect, useRef, useState } from "react";
import { useProDeck } from "../store";
import { usePco } from "../pcoStore";
import {
  getSettings,
  updateSettings,
  pcoTest,
  webStart,
  webStop,
  avantisState,
  on,
  IS_WEB,
  PUBLIC_URL,
  type Settings,
} from "../lib/tauri";
import {
  DASHBOARD_TEMPLATES,
  loadDashboards,
  saveDashboards,
  newId,
  type Dashboard as Dash,
} from "../lib/dashboards";
import { requestSettingsJump } from "../lib/settingsJump";
import { STARTER_CHECKLISTS, addStarterChecklists } from "../lib/checklistTemplates";
import { keepaliveStatus, keepaliveInstall, setDemo, type KeepaliveStatus } from "../lib/tauri";
import { isFreshInstall, readSetupDone, writeSetupDone, ONBOARDING_EVENT } from "../lib/onboarding";
import { ConnectCard } from "./ConnectCard";
import { Icon } from "./Icon";

/**
 * First-run onboarding — a full-screen, staged setup for a fresh install.
 *
 * Every stage does the real work (not a tour of where to click later) and
 * shows live proof it worked: ProPresenter found, Planning Center verified,
 * the gateway actually serving, the console actually connected, a join QR
 * the team can scan right now, starter dashboards created. Progress persists
 * across relaunches; every step is skippable; nothing is a one-shot decision.
 *
 * Self-gating: desktop only, only when nothing is configured yet. Dismissed
 * once and never returns (prodeck.setupDone). Re-openable from Setup via
 * requestOnboarding(), which fires ONBOARDING_EVENT.
 */

type Stage =
  | "welcome"
  | "tools"
  | "propresenter"
  | "pco"
  | "web"
  | "console"
  | "team"
  | "dashboards"
  | "done";

const STAGES: { id: Stage; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "tools", label: "What it connects" },
  { id: "propresenter", label: "ProPresenter" },
  { id: "pco", label: "Planning Center" },
  { id: "web", label: "Phones & kiosks" },
  { id: "console", label: "Sound console" },
  { id: "team", label: "Your team" },
  { id: "dashboards", label: "Dashboards" },
  { id: "done", label: "Done" },
];
const STAGE_KEY = "prodeck.setupStage";

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
      { name: "Phones & kiosks", need: "opt", what: "These dashboards on any phone, tablet, or kiosk on your network." },
    ],
  },
  {
    group: "Audio & console",
    items: [
      { name: "Audio input", need: "opt", what: "Calibrated SPL + RTA metering from any input, including Dante." },
      { name: "Sound console", need: "opt", what: "Allen & Heath Avantis, dLive or SQ, and Behringer X32 / Midas M32 — mutes, faders, scenes and names mirrored live; a watchdog that pages one person about setup changes." },
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

// Optional connections the Done screen hands off to Settings, with the exact
// card each one lives in.
const ADDONS: { name: string; what: string; page: string; anchor: string }[] = [
  { name: "Audio & SPL", what: "Pick the input ProDeck listens to; calibrate the meter.", page: "settings", anchor: "set-audio" },
  { name: "Song-key MIDI", what: "Send the live key to Waves / plugin scenes.", page: "settings", anchor: "set-songkey" },
  { name: "Live viewers", what: "Connect Google Analytics for a realtime count.", page: "settings", anchor: "set-ga4" },
  { name: "TapLink discs", what: "Point NFC discs at links that follow the service.", page: "settings", anchor: "set-taplink" },
  { name: "Your own domain", what: "Public URL, crew phones anywhere, booth-off fallback.", page: "settings", anchor: "set-web" },
  { name: "Desk watchdog", what: "Page one person when the console's setup changes.", page: "settings", anchor: "set-avantis" },
];

const CONSOLES = [
  { id: "avantis", name: "Avantis", hint: "Base MIDI channel 1–12 · Utility → Control → MIDI", port: 51325, maxBase: 12 },
  { id: "dlive", name: "dLive", hint: "MixRack port 51325, Surface 51328 · base channel 1–12", port: 51325, maxBase: 12 },
  { id: "sq", name: "SQ-5 / SQ-6 / SQ-7", hint: "MIDI channel 1–16 · Utility → General → MIDI · names not available", port: 51325, maxBase: 16 },
  { id: "x32", name: "X32 / M32", hint: "Behringer X32 or Midas M32 · OSC on port 10023 · nothing to set on the desk", port: 10023, maxBase: 1 },
];

function readStage(): Stage {
  try {
    const v = localStorage.getItem(STAGE_KEY) as Stage | null;
    if (v && STAGES.some((s) => s.id === v) && v !== "done") return v;
  } catch {
    /* storage unavailable */
  }
  return "welcome";
}
function writeStage(s: Stage) {
  try {
    localStorage.setItem(STAGE_KEY, s);
  } catch {
    /* storage unavailable */
  }
}
function randomToken(bytes = 12): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
/** Where phones on the church network reach this Mac. */
function lanBase(s: Settings): string {
  const pub = (s as any).public_url?.trim?.() as string | undefined;
  if (pub) return pub.replace(/\/+$/, "");
  if (PUBLIC_URL) return PUBLIC_URL.replace(/\/+$/, "");
  const host = ((s as any).device_name || "this-mac").replace(/\.local$/i, "");
  return `http://${host}.local:${(s as any).web_port || 8088}`;
}

export function FirstRunSetup({ onNavigate }: { onNavigate?: (p: string) => void }) {
  const { settings, connected, refreshSettings } = useProDeck();
  const pco = usePco();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("welcome");

  // PCO
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [pcoBusy, setPcoBusy] = useState(false);
  const [pcoMsg, setPcoMsg] = useState("");
  const [pcoDone, setPcoDone] = useState(false);

  // Web
  const [webOn, setWebOn] = useState(true);
  const [adminPw, setAdminPw] = useState("");
  const [memberPw, setMemberPw] = useState("");
  const [webMsg, setWebMsg] = useState("");
  const [webBusy, setWebBusy] = useState(false);

  // Console
  const [deskModel, setDeskModel] = useState("avantis");
  const [deskHost, setDeskHost] = useState("");
  const [deskPort, setDeskPort] = useState(51325);
  const [deskBase, setDeskBase] = useState(1);
  const [deskBusy, setDeskBusy] = useState(false);
  const [deskMsg, setDeskMsg] = useState("");
  const [deskSaved, setDeskSaved] = useState(false);
  const [deskUp, setDeskUp] = useState(false);

  // Team
  const [joinUrl, setJoinUrl] = useState("");
  const [joinQr, setJoinQr] = useState("");
  const [joinMsg, setJoinMsg] = useState("");
  const [copied, setCopied] = useState(false);

  // Dashboards
  const [existing, setExisting] = useState<Dash[] | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [dashMsg, setDashMsg] = useState("");
  const [dashBusy, setDashBusy] = useState(false);
  const createdRef = useRef(0);
  const [withChecklists, setWithChecklists] = useState(true);
  const [checklistsAdded, setChecklistsAdded] = useState(0);

  // Reliability nudge on the Done screen
  const [keep, setKeep] = useState<KeepaliveStatus | null>(null);
  const [keepBusy, setKeepBusy] = useState(false);
  const [keepMsg, setKeepMsg] = useState("");

  // ---- gating -----------------------------------------------------------
  useEffect(() => {
    if (IS_WEB || settings === null) return;
    if (readSetupDone()) return;
    if (isFreshInstall(settings)) {
      setStage(readStage()); // resume where they left off
      setOpen(true);
    }
  }, [settings === null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (IS_WEB) return;
    const reopen = () => {
      setStage("welcome");
      setOpen(true);
    };
    window.addEventListener(ONBOARDING_EVENT, reopen);
    return () => window.removeEventListener(ONBOARDING_EVENT, reopen);
  }, []);

  useEffect(() => {
    if (open) writeStage(stage);
  }, [stage, open]);

  // Console stage: seed the form from settings, then watch the mirror.
  useEffect(() => {
    if (!open || stage !== "console") return;
    if (settings) {
      const s = settings as any;
      if (s.avantis_host) setDeskHost(s.avantis_host);
      if (s.avantis_model) setDeskModel(s.avantis_model);
      if (s.avantis_port) setDeskPort(s.avantis_port);
      if (s.avantis_midi_base) setDeskBase(s.avantis_midi_base);
      if (s.avantis_enabled && s.avantis_host) setDeskSaved(true);
    }
    let alive = true;
    const poll = () =>
      avantisState()
        .then((snap) => alive && setDeskUp(!!(snap as any).connected))
        .catch(() => {});
    poll();
    const iv = setInterval(poll, 1500);
    const un = on<{ connected: boolean }>("avantis:status", (s) => alive && setDeskUp(!!s.connected));
    return () => {
      alive = false;
      clearInterval(iv);
      un.then((f) => f());
    };
  }, [open, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Team stage: make sure a join token exists, then render the QR.
  useEffect(() => {
    if (!open || stage !== "team") return;
    let alive = true;
    (async () => {
      try {
        const s = (await getSettings()) as Settings;
        if (!(s as any).web_enabled) {
          setJoinMsg("Phones & kiosks is off — turn it on in the previous step and this QR appears.");
          setJoinUrl("");
          return;
        }
        let token = (s as any).web_invite_token as string;
        if (!token) {
          token = randomToken();
          await updateSettings({ ...s, web_invite_token: token } as unknown as Settings);
          await refreshSettings();
        }
        const url = `${lanBase(s)}/join`;
        if (!alive) return;
        setJoinUrl(url);
        setJoinMsg("");
        const Q = await import("qrcode");
        const png = await Q.toDataURL(url, { margin: 1, width: 260 });
        if (alive) setJoinQr(png);
      } catch (e) {
        if (alive) setJoinMsg(`Couldn't prepare the join code (${String(e)}). You can always get it later from Settings → Browser Access.`);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || stage !== "done") return;
    keepaliveStatus().then(setKeep).catch(() => {});
  }, [open, stage]);

  // Dashboards stage: load what exists and pre-pick sensible starters.
  useEffect(() => {
    if (!open || stage !== "dashboards") return;
    let alive = true;
    // Recommend by what they connected: the console/audio-flavoured layout
    // only when there is a desk; the worship layout when PCO is there to fill
    // it. Runs whether or not the existing list could be read.
    const recommend = (list: Dash[]) => {
      const have = new Set(list.map((d) => d.name));
      const s = settings as any;
      const want: Record<string, boolean> = {};
      for (const t of DASHBOARD_TEMPLATES) {
        if (have.has(t.name)) continue;
        want[t.key] =
          t.key === "foh" ? !!s?.avantis_enabled || !!s?.audio_input :
          t.key === "worship" ? !!s?.pco_app_id :
          true;
      }
      setPicked(want);
    };
    loadDashboards()
      .then((ds) => {
        if (!alive) return;
        const list = (ds ?? []) as Dash[];
        setExisting(list);
        recommend(list);
      })
      .catch(() => {
        if (!alive) return;
        setExisting([]);
        recommend([]);
      });
    return () => {
      alive = false;
    };
  }, [open, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const idx = STAGES.findIndex((s) => s.id === stage);
  const go = (s: Stage) => setStage(s);
  // Functional updates: a delayed `next` must step from wherever the user IS.
  const step = (delta: number) =>
    setStage((cur) => {
      const i = STAGES.findIndex((x) => x.id === cur);
      return STAGES[Math.max(0, Math.min(i + delta, STAGES.length - 1))].id;
    });
  const next = () => step(1);
  const back = () => step(-1);
  const finish = () => {
    writeSetupDone(true);
    try {
      localStorage.removeItem(STAGE_KEY);
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  const s = (settings ?? {}) as any;
  const state = {
    pro: connected,
    pco: pcoDone || !!s.pco_app_id,
    web: webMsg.startsWith("✓") || !!s.web_enabled,
    console: deskUp,
    team: !!s.web_invite_token && !!s.web_enabled,
    dashboards: createdRef.current > 0 || (existing?.length ?? 0) > 0,
  };
  // A stage counts as "done" (checkmark in the rail) once its thing is set.
  const doneState = (st: Stage): boolean => {
    switch (st) {
      case "propresenter": return state.pro;
      case "pco": return state.pco;
      case "web": return state.web;
      case "console": return state.console;
      case "team": return state.team;
      case "dashboards": return createdRef.current > 0;
      default: return idx > STAGES.findIndex((x) => x.id === st);
    }
  };

  async function savePco() {
    setPcoBusy(true);
    setPcoMsg("");
    try {
      // saveCredentials persists and then self-tests, but swallows the test
      // failure into pco.status — test explicitly and only advance on success.
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
      const cur = (await getSettings()) as Settings;
      const nextS = {
        ...cur,
        web_enabled: webOn,
        web_password: adminPw || (cur as any).web_password,
        web_member_password: memberPw || (cur as any).web_member_password,
      } as unknown as Settings;
      await updateSettings(nextS);
      // Saving only persists the setting; the gateway itself is started by
      // web_start — without it phones get "connection refused" until relaunch.
      if (webOn && (nextS as any).web_password) {
        await webStart((nextS as any).web_port ?? 8088);
      } else {
        await webStop().catch(() => {});
      }
      await refreshSettings();
      setWebMsg(webOn ? "✓ Phones and kiosks can connect now" : "✓ Saved");
      setTimeout(next, 600);
    } catch (e) {
      setWebMsg(String(e));
    } finally {
      setWebBusy(false);
    }
  }

  async function saveConsole() {
    setDeskBusy(true);
    setDeskMsg("");
    try {
      const cur = (await getSettings()) as Settings;
      const model = CONSOLES.find((c) => c.id === deskModel) ?? CONSOLES[0];
      await updateSettings({
        ...cur,
        avantis_enabled: true,
        avantis_model: deskModel,
        avantis_host: deskHost.trim(),
        avantis_port: deskPort || model.port,
        avantis_midi_base: Math.min(model.maxBase, Math.max(1, deskBase)),
      } as unknown as Settings);
      await refreshSettings();
      setDeskSaved(true);
      setDeskMsg("Saved — ProDeck is connecting to the desk…");
    } catch (e) {
      setDeskMsg(String(e));
    } finally {
      setDeskBusy(false);
    }
  }

  async function createDashboards() {
    setDashBusy(true);
    setDashMsg("");
    try {
      const list = ((await loadDashboards()) ?? []) as Dash[];
      const have = new Set(list.map((d) => d.name));
      const add: Dash[] = [];
      for (const t of DASHBOARD_TEMPLATES) {
        if (!picked[t.key] || have.has(t.name)) continue;
        add.push({ id: newId(), name: t.name, widgets: t.build() } as Dash);
      }
      if (add.length === 0) {
        if (withChecklists) {
          const n = await addStarterChecklists().catch(() => 0);
          setChecklistsAdded(n);
          setDashMsg(n > 0 ? `✓ Added ${n} starter checklist${n === 1 ? "" : "s"}.` : "Nothing selected that you don't already have.");
          if (n > 0) createdRef.current += 1;
        } else {
          setDashMsg("Nothing selected that you don't already have.");
        }
        return;
      }
      await saveDashboards([...list, ...add]);
      createdRef.current += add.length;
      setExisting([...list, ...add]);
      setPicked({});
      let extra = "";
      if (withChecklists) {
        try {
          const n = await addStarterChecklists();
          setChecklistsAdded(n);
          if (n > 0) extra = ` and ${n} starter checklist${n === 1 ? "" : "s"}`;
        } catch {
          /* checklists are a bonus — never fail the step over them */
        }
      }
      setDashMsg(`✓ Created ${add.length} dashboard${add.length === 1 ? "" : "s"}${extra} — Dashboard → Edit to make them yours.`);
    } catch (e) {
      setDashMsg(String(e));
    } finally {
      setDashBusy(false);
    }
  }

  const openAddon = (a: (typeof ADDONS)[number]) => {
    requestSettingsJump(a.anchor);
    finish();
    onNavigate?.(a.page);
  };
  const copyJoin = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the link is visible to copy by hand */
    }
  };

  const consoleMeta = CONSOLES.find((c) => c.id === deskModel) ?? CONSOLES[0];
  const templatesToShow = DASHBOARD_TEMPLATES;

  return (
    <div className="ob-root">
      {/* progress rail */}
      <aside className="ob-rail">
        <div className="ob-brand">
          <span className="ob-mark" />
          <span>ProDeck</span>
        </div>
        <ol className="ob-steps">
          {STAGES.map((st, i) => {
            const cls = st.id === stage ? "on" : doneState(st.id) ? "done" : i < idx ? "seen" : "";
            return (
              <li
                key={st.id}
                className={`ob-step ${cls}`}
                onClick={() => (i <= idx || doneState(st.id) ? go(st.id) : null)}
              >
                <span className="ob-step-dot">{cls === "done" ? "✓" : i + 1}</span>
                {st.label}
              </li>
            );
          })}
        </ol>
        <div className="ob-rail-foot">
          <span className="muted small">Progress is saved — close and come back anytime.</span>
          <button className="ob-skip" onClick={finish}>
            Skip &amp; explore on my own
          </button>
        </div>
      </aside>

      {/* content */}
      <main className="ob-main">
        {stage === "welcome" && (
          <div className="ob-stage ob-welcome">
            <span className="ob-eyebrow">Welcome</span>
            <h1>Your production booth, in one app.</h1>
            <p className="ob-lead">
              ProDeck runs on a Mac in your booth and ties the room together —
              ProPresenter, Planning Center, your sound console, crew phones, and
              the livestream — then shows it all as live dashboards anyone on your
              team can open. Free, open source, no account.
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
            <p className="muted small ob-note">About 10 minutes with everything in the room turned on. Each step shows you it worked before you move on.</p>
            <div className="ob-actions">
              <button className="btn ghost" onClick={() => setDemo(true)}>
                Explore with sample data
              </button>
              <button className="btn primary lg" onClick={next}>
                Let's set it up →
              </button>
            </div>
            <p className="muted small ob-note">
              Not ready to connect anything? <strong>Explore with sample data</strong> fills every
              dashboard with a pretend Sunday so you can see what ProDeck does. It writes nothing
              and you can leave it at any time.
            </p>
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
            <StatusLine ok={connected} okText="Connected — slides and the rundown are live." waitText="Waiting for ProPresenter…" />
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
              {!pcoMsg && state.pco && <StatusLine ok okText="Planning Center is connected." waitText="" />}
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
              Serves these dashboards to any device on your network — and it's
              what your team's phones connect to. The <strong>admin</strong>{" "}
              password unlocks everything; the <strong>member</strong> password is
              view + chat only, for the team.
            </p>
            <div className="ob-form">
              <label className="field check">
                <input type="checkbox" checked={webOn} onChange={(e) => setWebOn(e.target.checked)} />
                <span>Enable phones &amp; kiosks (port 8088)</span>
              </label>
              <label className="field">
                <span>Admin password</span>
                <input className="input" type="password" autoComplete="new-password" value={adminPw} onChange={(e) => setAdminPw(e.target.value)} />
              </label>
              <label className="field">
                <span>Member password <span className="muted">(the team)</span></span>
                <input className="input" type="password" autoComplete="new-password" value={memberPw} onChange={(e) => setMemberPw(e.target.value)} />
              </label>
              {webMsg && <p className={webMsg.startsWith("✓") ? "ob-ok" : "error small"}>{webMsg}</p>}
              {!webMsg && state.web && <StatusLine ok okText="Phones and kiosks can connect." waitText="" />}
            </div>
            <div className="ob-actions">
              <button className="btn ghost" onClick={back}>← Back</button>
              <div className="ob-actions-r">
                <button className="btn ghost" onClick={next}>Skip for now</button>
                <button className="btn primary lg" disabled={webBusy || (webOn && !adminPw && !s.web_password)} onClick={saveWeb}>
                  {webBusy ? "Starting…" : "Save & start →"}
                </button>
              </div>
            </div>
          </div>
        )}

        {stage === "console" && (
          <div className="ob-stage">
            <span className="ob-eyebrow">Step 4 · Optional</span>
            <h1>Mirror your sound console.</h1>
            <p className="ob-lead">
              Digital desks talk over the network. Pick yours, give ProDeck its IP,
              and mutes, faders, scenes and channel names show up live on every
              dashboard. Control stays admin-only.
            </p>
            <div className="ob-consoles">
              {CONSOLES.map((c) => (
                <button
                  key={c.id}
                  className={`ob-console ${deskModel === c.id ? "on" : ""}`}
                  onClick={() => {
                    setDeskModel(c.id);
                    setDeskPort(c.port);
                    setDeskBase((b) => Math.min(b, c.maxBase));
                  }}
                >
                  <strong>{c.name}</strong>
                  <span>{c.hint}</span>
                </button>
              ))}
            </div>
            <div className="ob-form ob-form-row">
              <label className="field">
                <span>Console IP address</span>
                <input className="input" placeholder="192.168.1.20" value={deskHost} onChange={(e) => setDeskHost(e.target.value)} />
              </label>
              <label className="field narrow">
                <span>Port</span>
                <input className="input" type="number" value={deskPort} onChange={(e) => setDeskPort(parseInt(e.target.value) || consoleMeta.port)} />
              </label>
              {deskModel !== "x32" && (
              <label className="field narrow">
                <span>{deskModel === "sq" ? "MIDI channel" : "Base MIDI ch."}</span>
                <input className="input" type="number" min={1} max={consoleMeta.maxBase} value={deskBase}
                  onChange={(e) => { const n = parseInt(e.target.value); if (Number.isFinite(n)) setDeskBase(Math.min(consoleMeta.maxBase, Math.max(1, n))); }} />
              </label>
              )}
            </div>
            <p className="muted small ob-note">
              {deskModel === "x32"
                ? "Nothing to set on the console itself — ProDeck subscribes over OSC. "
                : `Set the desk's MIDI channel under ${deskModel === "sq" ? "Utility → General → MIDI" : "Utility → Control → MIDI"} and enter the same number here. `}
              Give the desk a fixed IP (or a DHCP reservation) so this keeps working after a router restart.
            </p>
            {deskMsg && <p className={deskMsg.startsWith("Saved") ? "ob-ok" : "error small"}>{deskMsg}</p>}
            {deskSaved && (
              <StatusLine
                ok={deskUp}
                okText={`Connected to the ${consoleMeta.name} — the mirror is live.`}
                waitText="Reaching the desk… (a few seconds). Not connecting? Check the IP, that the desk is on the same network, and that MIDI over TCP is enabled on it."
              />
            )}
            <div className="ob-actions">
              <button className="btn ghost" onClick={back}>← Back</button>
              <div className="ob-actions-r">
                <button className="btn ghost" onClick={next}>{deskSaved ? "Next →" : "No console / later"}</button>
                <button className="btn primary lg" disabled={deskBusy || !deskHost.trim()} onClick={saveConsole}>
                  {deskBusy ? "Saving…" : deskSaved ? "Save again" : "Connect the desk"}
                </button>
              </div>
            </div>
          </div>
        )}

        {stage === "team" && (
          <div className="ob-stage">
            <span className="ob-eyebrow">Step 5 · Your team</span>
            <h1>Get your crew on their phones.</h1>
            <p className="ob-lead">
              Anyone who scans this joins with their name and a PIN; you approve
              them once (a badge appears on Settings). Installed to the home
              screen, their phone gets pages and chat even when the app is closed.
              Print it and hang it in the booth — the code never changes.
            </p>
            {joinMsg && <p className="error small">{joinMsg}</p>}
            {joinUrl && (
              <div className="ob-join">
                {joinQr ? <img src={joinQr} alt="Join ProDeck Crew" className="ob-join-qr" /> : <div className="ob-join-qr ob-join-ph" />}
                <div className="ob-join-side">
                  <span className="ob-join-h">Join link</span>
                  <code className="ob-join-url">{joinUrl}</code>
                  <div className="ob-join-actions">
                    <button className="btn small" onClick={copyJoin}>{copied ? "Copied ✓" : "Copy link"}</button>
                    <button className="btn small ghost" onClick={() => window.print()}>Print this page</button>
                  </div>
                  <p className="muted small">
                    Works on the church Wi-Fi now. Add your own domain later (Settings → Browser Access → Public URL) and the same code works from anywhere.
                  </p>
                </div>
              </div>
            )}
            <div className="ob-actions">
              <button className="btn ghost" onClick={back}>← Back</button>
              <button className="btn primary lg" onClick={next}>Next →</button>
            </div>
          </div>
        )}

        {stage === "dashboards" && (
          <div className="ob-stage">
            <span className="ob-eyebrow">Step 6 · Dashboards</span>
            <h1>Start with layouts that already work.</h1>
            <p className="ob-lead">
              Each one is a real dashboard built from what you connected — open it,
              press <strong>Edit</strong>, and drag things around. We pre-selected
              the ones that fit your setup.
            </p>
            <div className="ob-tpls">
              {templatesToShow.map((t) => {
                const have = existing?.some((d) => d.name === t.name);
                return (
                  <label key={t.key} className={`ob-tpl ${have ? "have" : picked[t.key] ? "on" : ""}`}>
                    <input
                      type="checkbox"
                      disabled={!!have}
                      checked={!!have || !!picked[t.key]}
                      onChange={(e) => setPicked((p) => ({ ...p, [t.key]: e.target.checked }))}
                    />
                    <div>
                      <strong>{t.name}</strong>
                      <span>{t.blurb}</span>
                      {have && <em>Already in your dashboards</em>}
                    </div>
                  </label>
                );
              })}
            </div>
            <label className={`ob-tpl ob-tpl-wide ${withChecklists ? "on" : ""}`}>
              <input type="checkbox" checked={withChecklists} onChange={(e) => setWithChecklists(e.target.checked)} disabled={checklistsAdded > 0} />
              <div>
                <strong>Also add starter volunteer checklists</strong>
                <span>
                  {STARTER_CHECKLISTS.map((c) => c.name).join(" · ")} — written by someone who has run a booth; edit anything.
                </span>
                {checklistsAdded > 0 && <em>Added — see the Checklists page</em>}
              </div>
            </label>
            {dashMsg && <p className={dashMsg.startsWith("✓") ? "ob-ok" : "muted small"}>{dashMsg}</p>}
            <div className="ob-actions">
              <button className="btn ghost" onClick={back}>← Back</button>
              <div className="ob-actions-r">
                <button className="btn ghost" onClick={next}>Skip</button>
                <button className="btn primary lg" disabled={dashBusy || (!Object.values(picked).some(Boolean) && !(withChecklists && checklistsAdded === 0))} onClick={createDashboards}>
                  {dashBusy ? "Creating…" : `Create ${Object.values(picked).filter(Boolean).length || ""} dashboard${Object.values(picked).filter(Boolean).length === 1 ? "" : "s"}`}
                </button>
                {createdRef.current > 0 && <button className="btn primary lg" onClick={next}>Next →</button>}
              </div>
            </div>
          </div>
        )}

        {stage === "done" && (
          <div className="ob-stage ob-done">
            <div className="ob-done-badge"><span>✓</span></div>
            <h1>You're set up.</h1>
            <p className="ob-lead">Here's where you landed — anything grey is one click away later.</p>
            {keep && !(keep.installed && keep.matchesCurrent) && (
              <div className="ob-keep">
                <div>
                  {/* Both strings come from the backend's own answer. Hardcoding
                      the macOS wording here promised Windows users a
                      crash-relaunch that a Run key cannot deliver, and told
                      them to use an Applications folder they don't have. */}
                  <strong>
                    {keep.supervises === false ? "Start ProDeck at login" : "Keep ProDeck running"}
                  </strong>
                  <span>
                    {!keep.inApplications
                      ? (keep.installHint ??
                        "Move ProDeck to your Applications folder, then turn this on from Settings → Reliability.")
                      : keep.supervises === false
                        ? "Open ProDeck automatically whenever you sign in, so a restart doesn't leave the booth dark. Recommended for a booth computer."
                        : "Start at login and relaunch within seconds of any crash — so a Sunday-morning hiccup never leaves the booth dark. Recommended for a booth computer."}
                  </span>
                  {keepMsg && <em>{keepMsg}</em>}
                </div>
                <button
                  className="btn primary"
                  disabled={keepBusy || !keep.inApplications}
                  onClick={async () => {
                    setKeepBusy(true);
                    setKeepMsg("");
                    try {
                      setKeep(await keepaliveInstall());
                      setKeepMsg("✓ On — ProDeck will come back on its own.");
                    } catch (e) {
                      setKeepMsg(String(e));
                    } finally {
                      setKeepBusy(false);
                    }
                  }}
                >
                  {keepBusy ? "Turning on…" : "Turn on"}
                </button>
              </div>
            )}
            {keep && keep.installed && keep.matchesCurrent && (
              <p className="ob-ok"><span className="ob-check">✓</span> Keep ProDeck running is on — it starts at login and relaunches after a crash.</p>
            )}
            <ul className="ob-summary">
              <SummaryRow ok={state.pro} label="ProPresenter" okText="connected" offText="not connected — ProPresenter page" />
              <SummaryRow ok={state.pco} label="Planning Center" okText="connected" offText="not connected — open the Planning Center page" />
              <SummaryRow ok={state.web} label="Phones & kiosks" okText="serving" offText="off — Settings → Browser Access" />
              <SummaryRow ok={state.console} label="Sound console" okText={`${consoleMeta.name} mirrored`} offText={s.avantis_enabled ? "configured, not reachable yet" : "none — Settings → Allen & Heath Console"} />
              <SummaryRow ok={state.team} label="Team join code" okText="ready to scan" offText="needs Phones & kiosks on" />
              <SummaryRow ok={state.dashboards} label="Dashboards" okText={`${existing?.length ?? "your"} ready — Dashboard → Edit`} offText="use Dashboard → New" />
            </ul>
            <h3 className="ob-h3">Also available — set up anytime</h3>
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
            <p className="muted small ob-note">
              The <strong>Setup</strong> page keeps this checklist alive with plain-English fixes whenever something goes red. You can re-run this guide from there.
            </p>
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

function StatusLine({ ok, okText, waitText }: { ok: boolean; okText: string; waitText: string }) {
  if (ok) {
    return (
      <p className="ob-ok">
        <span className="ob-check">✓</span> {okText}
      </p>
    );
  }
  if (!waitText) return null;
  return (
    <p className="ob-wait">
      <span className="ob-spin" /> {waitText}
    </p>
  );
}

function SummaryRow({ ok, label, okText, offText }: { ok: boolean; label: string; okText: string; offText: string }) {
  return (
    <li className={`ob-sum ${ok ? "ok" : ""}`}>
      <span className={`hl-dot ${ok ? "ok" : "idle"}`} />
      <strong>{label}</strong>
      <span>{ok ? okText : offText}</span>
    </li>
  );
}
