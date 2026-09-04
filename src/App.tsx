import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  IS_WEB,
  KIOSK_DASH,
  getWebToken,
  setWebToken,
  getSettings,
  identityList,
  identitySetRole,
  on,
} from "./lib/tauri";
import { KioskPage } from "./pages/Kiosk";
import { ChatProvider, useChat } from "./chatStore";
import { PagesProvider } from "./pagesStore";
import { ScheduleProvider } from "./scheduleStore";
import { startOutbox } from "./lib/outbox";
import { CrewPageTakeover } from "./mobile/CrewPages";
import { ServiceWizard } from "./components/ServiceWizard";
import { FirstRunSetup } from "./components/FirstRunSetup";
import { Setup } from "./pages/Setup";
import { ChatDrawer } from "./components/ChatDrawer";
import { usePco } from "./pcoStore";
import lockupStacked from "./assets/prodeck-lockup-stacked-color.svg";
import { MobileShell } from "./mobile/MobileShell";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./mobile/tokens.css";
import "./mobile/mobile.css";

// Phone-width web clients get the ProDeck Crew shell (design/mobile); the
// desktop app and full-size browsers keep the sidebar UI. Evaluated once —
// a phone doesn't become a desktop mid-session.
const IS_PHONE =
  IS_WEB && typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
import { ProDeckProvider, useProDeck } from "./store";
import { PcoProvider } from "./pcoStore";
import { TrackingProvider } from "./trackingStore";
import { AlertsProvider, useAlerts } from "./alertsStore";
import { RelayProvider } from "./relayStore";
import { UpdaterProvider, useUpdater } from "./updaterStore";
import { ChecklistProvider, useChecklists } from "./checklistStore";
import { LyricFollowProvider } from "./lyricFollow";
import { DialogHost } from "./lib/dialogs";
import { ChecklistsPage } from "./pages/Checklists";
import { ClearDock } from "./components/ClearDock";
import { Icon } from "./components/Icon";
import { useProFollow } from "./lib/proFollow";
import { HealthStrip } from "./components/HealthStrip";
import { useKeySend } from "./lib/keySend";
import { Dashboard } from "./pages/Dashboard";
import { ProPresenterPage } from "./pages/ProPresenter";
import { Multiview } from "./pages/Multiview";
import { Captions } from "./pages/Captions";
import { PlanningCenter } from "./pages/PlanningCenter";
import { Report } from "./pages/Report";
import { SettingsPage } from "./pages/Settings";
import { RoutingPage } from "./pages/Routing";
import "./App.css";

type Page =
  | "dashboard"
  | "setup"
  | "propresenter"
  | "multiview"
  | "captions"
  | "planning"
  | "checklists"
  | "routing"
  | "report"
  | "settings";

// Multiview and Captions are hidden (Aug 2026): the only NDI source here is
// ProPresenter's stage output — there are no NDI cameras — and captions never
// entered service. The pages and routes still exist; add an entry back here
// to resurface one.
const NAV: { id: Page; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "setup", label: "Setup", icon: "checklist" },
  { id: "propresenter", label: "ProPresenter", icon: "slides" },
  { id: "planning", label: "Planning Center", icon: "calendar" },
  { id: "checklists", label: "Checklists", icon: "checklist" },
  { id: "routing", label: "Routing", icon: "grid" },
  { id: "report", label: "Analytics", icon: "report" },
  { id: "settings", label: "Settings", icon: "settings" },
];

// Startup wizard: the booth walks through service setup (service, setlist
// swap, mics, desk names) on the day's FIRST app launch. Once per calendar
// day, so watchdog crash-restarts and update installs never pop it over a
// live service; ✕ or Done snoozes it until tomorrow.
const WIZARD_DAY_KEY = "prodeck.wizardDay";

function Shell() {
  const [page, setPage] = useState<Page>("dashboard");
  const [startupWizard, setStartupWizard] = useState(false);
  const [navHidden, setNavHidden] = useState(
    () => localStorage.getItem("prodeck.navHidden") === "1",
  );
  const { settings } = useProDeck();
  const checklists = useChecklists();
  const chat = useChat();
  const overdueCount = checklists.overdue().length;
  useProFollow();
  useKeySend();

  // New crew signups used to wait invisibly until someone happened to open
  // Settings → Crew Members. Surface them: badge on Settings + a banner that
  // deep-links straight there.
  const [pendingCrew, setPendingCrew] = useState<string[]>([]);
  useEffect(() => {
    if (IS_WEB) return; // booth-only; web admins manage crew from Settings
    const load = () =>
      identityList()
        .then((l) => setPendingCrew(l.filter((u) => !u.approved).map((u) => u.name)))
        .catch(() => {});
    load();
    const un = on("identity:changed", load);
    return () => {
      un.then((f) => f());
    };
  }, []);

  // Position is Planning Center's, full stop. The booth mirrors each week's
  // plan onto the crew accounts so the backend, the pager and role channels
  // keep a position to work with — but nobody types one into ProDeck. An
  // account that drops off the plan has its position cleared, which is what
  // makes "not scheduled = no position checklist" true.
  const pcoSync = usePco();

  // Open the startup wizard once PCO has loaded enough to be useful (service
  // types present). Never on web clients — the booth runs the service.
  useEffect(() => {
    if (IS_WEB || pcoSync.serviceTypes.length === 0) return;
    const today = new Date().toDateString();
    if (localStorage.getItem(WIZARD_DAY_KEY) !== today) {
      localStorage.setItem(WIZARD_DAY_KEY, today);
      setStartupWizard(true);
    }
  }, [pcoSync.serviceTypes.length]);

  // The owner's chord works both ways: SHIFT + ↑ ↑ ↓ ↓ on the normal UI
  // SUMMONS the fullscreen wizard (inside it, the same chord dismisses —
  // the ref guard stops this listener from instantly re-summoning it).
  const wizardOpenRef = useRef(false);
  useEffect(() => {
    wizardOpenRef.current = startupWizard;
  }, [startupWizard]);
  useEffect(() => {
    if (IS_WEB) return;
    const SEQ = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown"];
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.key !== SEQ[i]) {
        i = 0;
        return;
      }
      i += 1;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        i = 0;
      }, 3000);
      if (i === SEQ.length) {
        i = 0;
        if (!wizardOpenRef.current) setStartupWizard(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (IS_WEB) return; // the booth owns the roster; phones only read it
    if (pcoSync.team.length === 0) return; // no plan loaded — never wipe on empty
    let alive = true;
    const sync = () =>
      identityList()
        .then((list) => {
          if (!alive) return;
          for (const u of list) {
            if (!u.approved) continue;
            const want = pcoSync.arrivalFor(u.name, "").position.trim();
            if ((u.role ?? "").trim() === want) continue; // no write, no event loop
            identitySetRole(u.id, want).catch(() => {});
          }
        })
        .catch(() => {});
    sync();
    const un = on("identity:changed", sync);
    return () => {
      alive = false;
      un.then((f) => f());
    };
  }, [pcoSync.team]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme ?? "dark";
  }, [settings?.theme]);

  function toggleNav() {
    setNavHidden((v) => {
      const next = !v;
      localStorage.setItem("prodeck.navHidden", next ? "1" : "0");
      return next;
    });
  }

  return (
    <div className={`app ${navHidden ? "nav-hidden" : ""}`}>
      {startupWizard && <ServiceWizard locked onClose={() => setStartupWizard(false)} />}
      <FirstRunSetup />
      {/* Always rendered so the mobile bottom-nav (CSS) shows even when the
          desktop sidebar is collapsed; desktop collapse hides it via CSS. */}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-name">ProDeck</span>
          <button className="nav-collapse" title="Hide sidebar" onClick={toggleNav}>
            «
          </button>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${page === n.id ? "active" : ""}`}
              onClick={() => setPage(n.id)}
            >
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.id === "checklists" && overdueCount > 0 && (
                <span className="nav-badge">{overdueCount}</span>
              )}
              {n.id === "settings" && pendingCrew.length > 0 && (
                <span className="nav-badge">{pendingCrew.length}</span>
              )}
            </button>
          ))}
          <button
            className={`nav-item ${chat.open ? "active" : ""}`}
            onClick={() => chat.setOpen(!chat.open)}
          >
            <Icon name="captions" />
            <span>Messages</span>
            {chat.unread > 0 && <span className="nav-badge">{chat.unread}</span>}
          </button>
        </nav>
        <div className="sidebar-footer">
          {/* Traffic lights + click-for-what-to-do; replaces the old
              PP-only pill (PP is the first light). */}
          <HealthStrip />
        </div>
      </aside>

      <main className="main">
        {navHidden && (
          <button className="nav-show" title="Show sidebar" onClick={toggleNav}>
            »
          </button>
        )}
        <UpdateBanner />
        {pendingCrew.length > 0 && page !== "settings" && (
          <div className="banner">
            {pendingCrew.length === 1
              ? `${pendingCrew[0]} is waiting to join the crew.`
              : `${pendingCrew.length} people are waiting to join the crew: ${pendingCrew.join(", ")}.`}
            <button className="btn small primary" onClick={() => setPage("settings")}>
              Review &amp; approve
            </button>
          </div>
        )}
        <AlertStack />
        <ControlToast />
        <ClearDock />
        <DialogHost />
        <ChatDrawer />
        {page === "dashboard" && <Dashboard onNavigate={setPage} />}
        {page === "setup" && <Setup onNavigate={(p) => setPage(p as Page)} />}
        {page === "propresenter" && <ProPresenterPage />}
        {page === "multiview" && <Multiview />}
        {page === "captions" && <Captions />}
        {page === "planning" && <PlanningCenter />}
        {page === "checklists" && <ChecklistsPage />}
        {page === "routing" && <RoutingPage />}
        {page === "report" && <Report />}
        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

// Floating stack of active alerts, visible on every page. Mic/desk alerts
// live in a fixed right-hand column: the top banner shares width with page
// content and cut their text off; the side stack floats over everything and
// wraps.
function AlertStack() {
  const { alerts, dismiss } = useAlerts();
  if (alerts.length === 0) return null;
  const mic = alerts.filter((a) => a.id.startsWith("mic:"));
  const rest = alerts.filter((a) => !a.id.startsWith("mic:"));
  const toast = (a: (typeof alerts)[number]) => (
    <div key={a.id} className={`alert-toast ${a.severity}`}>
      <span className="alert-dot" />
      <span className="alert-msg">{a.message}</span>
      <button className="alert-x" title="Dismiss" onClick={() => dismiss(a.id)}>
        ×
      </button>
    </div>
  );
  return (
    <>
      {rest.length > 0 && <div className="alert-stack">{rest.map(toast)}</div>}
      {mic.length > 0 && <div className="alert-side">{mic.map(toast)}</div>}
    </>
  );
}

// Transient toast when a ProPresenter control action fails (dead link, 404,
// etc.) — control calls used to fail silently.
function ControlToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onErr = (e: Event) => {
      setMsg(((e as CustomEvent).detail as string) || "Control action failed");
      if (t) clearTimeout(t);
      t = setTimeout(() => setMsg(null), 4000);
    };
    window.addEventListener("prodeck-control-error", onErr);
    return () => {
      window.removeEventListener("prodeck-control-error", onErr);
      if (t) clearTimeout(t);
    };
  }, []);
  if (!msg) return null;
  return (
    <div className="control-toast" onClick={() => setMsg(null)}>
      <span className="alert-dot" />
      <span>Couldn’t reach ProPresenter — {msg}</span>
    </div>
  );
}

// Floating banner when a software update is available / installing.
function UpdateBanner() {
  const u = useUpdater();
  if (u.status === "available") {
    return (
      <div className="update-banner">
        <span className="dot online" />
        <span>
          Update <strong>v{u.newVersion}</strong> available
        </span>
        <button className="btn small primary" onClick={() => u.install()}>
          Install &amp; Restart
        </button>
        <button className="btn small ghost" onClick={() => u.dismiss()}>
          Later
        </button>
      </div>
    );
  }
  if (u.status === "downloading" || u.status === "ready") {
    return (
      <div className="update-banner">
        <span>{u.status === "ready" ? "Restarting…" : `Downloading update… ${u.progress}%`}</span>
        <div className="update-bar">
          <div className="update-fill" style={{ width: `${u.progress}%` }} />
        </div>
      </div>
    );
  }
  return null;
}

// In browser (web-gateway) mode, gate the app behind the access password before
// any provider mounts (so we don't fire unauthorized requests at the host).
function WebGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(() => !IS_WEB || !!getWebToken());
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!IS_WEB) return;
    const onUnauth = () => {
      setAuthed(false);
      setErr("Session expired — sign in again.");
    };
    window.addEventListener("prodeck-web-unauthorized", onUnauth);
    return () => window.removeEventListener("prodeck-web-unauthorized", onUnauth);
  }, []);

  if (authed) return <>{children}</>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pw) return;
    setBusy(true);
    setErr("");
    setWebToken(pw);
    try {
      await getSettings(); // round-trips the token against the host
      setAuthed(true);
    } catch {
      setErr("Wrong password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="web-login">
      <form className="web-login-card" onSubmit={submit}>
        <img className="login-lockup" src={lockupStacked} alt="ProDeck — by Zach Green" />
        {/* "view & control" oversold the member tier — most phones sign in
            with the crew password and get a viewer + chat + check-in. */}
        <p className="muted">
          Enter the password from the booth. The crew password gets you in; the
          admin password also unlocks booth controls.
        </p>
        <input
          className="input"
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Access password"
        />
        <button className="btn primary" disabled={busy || !pw}>
          {busy ? "Connecting…" : "Connect"}
        </button>
        {err && <p className="error">{err}</p>}
      </form>
    </div>
  );
}

// Replay anything queued while the booth was unreachable, as soon as it's back.
startOutbox();

export default function App() {
  return (
    <WebGate>
      <UpdaterProvider>
        <RelayProvider>
          <ProDeckProvider>
            <PcoProvider>
              <TrackingProvider>
                <LyricFollowProvider>
                  <ChecklistProvider>
                    <AlertsProvider>
                      <ChatProvider>
                        <PagesProvider>
                         <ScheduleProvider>
                          {KIOSK_DASH ? (
                            <KioskPage name={KIOSK_DASH} />
                          ) : IS_PHONE ? (
                            <MobileShell />
                          ) : (
                            <Shell />
                          )}
                          {/* Above every shell so a page can't be navigated out
                              from under. Not on the kiosk: a wall display has
                              nobody standing at it to confirm. */}
                          {!KIOSK_DASH && <CrewPageTakeover />}
                         </ScheduleProvider>
                        </PagesProvider>
                      </ChatProvider>
                    </AlertsProvider>
                  </ChecklistProvider>
                </LyricFollowProvider>
              </TrackingProvider>
            </PcoProvider>
          </ProDeckProvider>
        </RelayProvider>
      </UpdaterProvider>
    </WebGate>
  );
}
