import { useEffect, useState } from "react";
import { CrewNav, type CrewTab } from "./CrewNav";
import { CrewChat } from "./CrewChat";
import { CrewJoin } from "./CrewJoin";
import { CrewHome } from "./CrewHome";
import { CrewChecklist } from "./CrewChecklist";
import { CrewOnboard, shouldOnboard } from "./CrewOnboard";
import { CrewOffline } from "./CrewOffline";
import { CrewLeader } from "./CrewLeader";
import { CrewDash } from "./CrewDash";
import { CREW_ID_KEY, CREW_SESSION_KEY, useChat } from "../chatStore";
import { listVisibleFor, useChecklists } from "../checklistStore";
import { usePco } from "../pcoStore";
import { IS_WEB, clearWebToken, identityWhoami, onGatewayState, webWhoami } from "../lib/tauri";
import { disablePush, enablePush, pushState, type PushStatus } from "../lib/pushClient";
import { listenSnapshot, onListen, stopListen } from "../lib/listen";
import { onTrack, seekTrack, skipTrack, stopTrack, toggleTrack, trackSnapshot } from "../lib/trackPlayer";

// ProDeck Crew — the phone shell (design/mobile). Renders instead of the
// desktop Shell on phone-width web clients. v1 ships the frame + working
// Chat and Dashboards; Home/Checklist arrive with their screens (S03/S08).

export function MobileShell() {
  const [tab, setTab] = useState<CrewTab>("home");
  const [onboarding, setOnboarding] = useState(() => IS_WEB && shouldOnboard());
  const chat = useChat();
  // The overdue dot only counts lists this phone can actually see — an alert
  // for another position's hidden list is just an unanswerable mystery.
  const cl = useChecklists();
  const crewRole = (IS_WEB && localStorage.getItem("prodeck.crewRole")) || "";
  // Booth reachability, not ProPresenter state.
  const [boothUp, setBoothUp] = useState(true);
  useEffect(() => onGatewayState(setBoothUp), []);
  // Leader board is admin-only; the gateway enforces the underlying calls too.
  const [isAdmin, setIsAdmin] = useState(!IS_WEB);
  const [leader, setLeader] = useState(false);
  useEffect(() => {
    if (!IS_WEB) return;
    webWhoami().then((w) => setIsAdmin(w.tier === "admin")).catch(() => {});
  }, []);
  // Identity (id + role) is fetched ONCE at the shell so every tab agrees.
  // It used to live only in the Checklist tab — Home read an empty role until
  // you visited Checklist at least once, hiding role lists and the duty card.
  const [, roleReady] = useState(0);
  useEffect(() => {
    if (!IS_WEB || chat.auth !== "in") return;
    identityWhoami(localStorage.getItem(CREW_SESSION_KEY) ?? "")
      .then((w) => {
        localStorage.setItem(CREW_ID_KEY, w.id);
        localStorage.setItem("prodeck.crewRole", w.role);
        // Healed PCO spelling wins for matching: a "zach green" signup starts
        // matching arrival/position as "Zachary Green" once the booth links it.
        if (w.pcoName) localStorage.setItem("prodeck.crewName", w.pcoName);
        roleReady((n) => n + 1); // children read localStorage per render
      })
      .catch(() => {});
  }, [chat.auth]);
  // The overdue dot only counts lists this phone can actually see — an alert
  // for another position's hidden list is just an unanswerable mystery.
  // Position-tagged lists require being scheduled to the position this week.
  const pco = usePco();
  const myArrival = pco.arrivalFor(
    (IS_WEB && localStorage.getItem("prodeck.crewName")) || "",
    crewRole,
  );
  const overdueCount = cl
    .overdue()
    .filter((c) => listVisibleFor(c, myArrival.position, isAdmin)).length;

  // Install onboarding comes first on a fresh device: on iOS, push simply does
  // not work until the app is on the Home Screen, so asking someone to sign in
  // first buys them a silent morning.
  if (IS_WEB && onboarding) {
    return (
      <div className="crew">
        <main className="crew-main">
          <CrewOnboard onDone={() => setOnboarding(false)} />
        </main>
      </div>
    );
  }

  // S11 — the booth is unreachable. This gate MUST come before the sign-in
  // gate: CrewJoin needs the booth, while CrewOffline carries the booth-off
  // surfaces INCLUDING the edge signup — with the order flipped, a new
  // volunteer scanning the poster while the booth was dark hit a sign-in
  // screen that could never work and the EdgeJoin card was dead code (audit
  // finding). Signed-in phones keep the cached-checklist escape hatch.
  if (IS_WEB && !boothUp && (chat.auth !== "in" || tab !== "checklist")) {
    return (
      <div className="crew">
        <main className="crew-main">
          <CrewOffline onCached={() => setTab("checklist")} />
        </main>
      </div>
    );
  }

  // Signing in is the whole screen, not a panel inside Chat: an unapproved
  // phone can't do anything on the other tabs either, and the nav would just
  // be four dead ends.
  if (IS_WEB && chat.auth !== "in") {
    return (
      <div className="crew">
        <main className="crew-main">
          <CrewJoin />
        </main>
      </div>
    );
  }

  return (
    <div className="crew">
      <div className="crew-chip-stack">
        <ListenChip />
      </div>
      <main className="crew-main">
        {tab === "home" && <CrewHome onGoChecklist={() => setTab("checklist")} />}
        {tab === "chat" && (
          <div className="crew-page crew-page-chat">
            <CrewChat />
          </div>
        )}
        {tab === "checklist" && <CrewChecklist />}
        {tab === "dashboards" && <CrewDash />}
        {tab === "more" && leader && <CrewLeader />}
        {tab === "more" && !leader && (
          <div className="crew-page">
            <h1 className="crew-title">More</h1>
            <PushCard />
            {/* In-app sounds: chat chime + vibration while the app is open.
                Pages always ring regardless — they're the emergency channel. */}
            <div className="crew-card edge">
              <div className="crew-buzz" style={{ background: "none", padding: 0 }}>
                <div>
                  <div className="crew-buzz-title">Message sounds</div>
                  <div className="crew-buzz-sub">
                    Chime and vibrate for new chat while the app is open. Pages always
                    ring.
                  </div>
                </div>
                <button
                  className={`crew-toggle ${chat.sound ? "on" : ""}`}
                  role="switch"
                  aria-checked={chat.sound}
                  onClick={() => chat.setSound(!chat.sound)}
                />
              </div>
            </div>
            {isAdmin && (
              <button className="crew-btn primary" onClick={() => setLeader(true)}>
                Leader board
              </button>
            )}
            <div className="crew-card edge">
              <p style={{ margin: 0 }}>
                Signed in as <strong>{chat.name || "—"}</strong>
                {IS_WEB && (
                  <span className="mono crew-tier"> · {isAdmin ? "admin" : "member"}</span>
                )}
              </p>
              {chat.auth === "in" && (
                <button className="btn ghost" style={{ marginTop: 10 }} onClick={chat.signOut}>
                  Lock (PIN again)
                </button>
              )}
              {IS_WEB && (
                <>
                  {/* Without this a phone is stuck on whichever tier it first
                      signed in as: "Sign out" only cleared the crew session, so
                      you'd get the PIN screen back and never the access-password
                      screen. Signing in as member then needing to page was a
                      dead end. */}
                  <button
                    className="btn ghost"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      chat.forgetDevice();
                      clearWebToken();
                      location.reload();
                    }}
                  >
                    Sign out completely
                  </button>
                  <p className="crew-hint muted" style={{ marginTop: 6 }}>
                    {isAdmin
                      ? "You can send pages from Chat."
                      : "As a member you can chat, check in, and confirm pages. Booth controls need an admin sign-in (ask at the booth)."}
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </main>
      <TrackBar />
      <CrewNav
        active={tab}
        unread={chat.unread}
        overdue={overdueCount > 0}
        onSelect={(t) => {
          setLeader(false); // leaving More closes the leader board
          setTab(t);
        }}
      />
    </div>
  );
}

// Notifications. States the actual reason push isn't available rather than a
// bare "off" — on iOS the browser reports "denied" when the real problem is
// that the app isn't on the Home Screen yet, which is unguessable.
function PushCard() {
  const [state, setState] = useState<PushStatus>("off");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    pushState().then(setState).catch(() => {});
  }, []);

  const copy: Record<PushStatus, string> = {
    on: "Pages will buzz this phone even when ProDeck is closed.",
    off: "Turn on so pages reach you when your phone is in your pocket.",
    denied:
      "This browser is refusing notifications for ProDeck — that also happens if the permission pop-up was dismissed. Allow notifications for this site in your browser settings, then come back.",
    insecure:
      "Not available over a plain http:// address — this lights up once the booth's secure address is live.",
    "needs-install":
      "Add ProDeck to your Home Screen first — iOS sends no notifications to a browser tab.",
    unsupported: "This browser can't do push notifications.",
  };

  return (
    <div className="crew-card edge">
      <div className="crew-buzz" style={{ background: "none", padding: 0 }}>
        <div>
          <div className="crew-buzz-title">Page notifications</div>
          <div className="crew-buzz-sub">{copy[state]}</div>
        </div>
        {(state === "on" || state === "off") && (
          <button
            className={`crew-toggle ${state === "on" ? "on" : ""}`}
            role="switch"
            aria-checked={state === "on"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                setState(state === "on" ? await disablePush() : await enablePush());
              } catch (e) {
                setErr(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <span className="crew-toggle-knob" />
          </button>
        )}
      </div>
      {err && <p className="crew-join-err">{err}</p>}
    </div>
  );
}

// Floating "still listening" chip — the stream survives tab changes now
// (lib/listen singleton), so the stop control must survive them too.
function ListenChip() {
  const [, force] = useState(0);
  useEffect(() => onListen(() => force((n) => n + 1)), []);
  const { state } = listenSnapshot();
  if (state === "idle") return null;
  return (
    <button className="crew-listen-chip" onClick={stopListen}>
      <span className="pulse-dot" style={{ background: "var(--success)" }} />
      {state === "playing" ? "Listening to booth audio" : "Connecting…"}
      <span className="crew-listen-stop">Stop</span>
    </button>
  );
}

// Track mini-player — a real bar above the nav, not a chip: scrubber, ±15 s
// skips, play/pause, times. Sits in normal flow so it never covers content,
// and the track keeps playing across every tab.
const mmss = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

function TrackBar() {
  const [, force] = useState(0);
  useEffect(() => onTrack(() => force((n) => n + 1)), []);
  const { state, title, pos, dur } = trackSnapshot();
  if (state === "idle") return null;
  return (
    <div className="crew-trackbar">
      <div className="crew-trackbar-top">
        <span className="crew-track-title">{title}</span>
        <button className="crew-track-btn crew-listen-stop" onClick={stopTrack}>
          ✕
        </button>
      </div>
      <input
        className="crew-track-seek"
        type="range"
        min={0}
        max={Math.max(1, dur)}
        step={1}
        value={Math.min(pos, dur || pos)}
        onChange={(e) => seekTrack(parseFloat(e.target.value))}
      />
      <div className="crew-trackbar-controls">
        <span className="mono-data crew-track-time">{mmss(pos)}</span>
        <button className="crew-track-btn" onClick={() => skipTrack(-15)}>
          ↺15
        </button>
        <button className="crew-track-btn crew-track-play" onClick={toggleTrack}>
          {state === "playing" ? "⏸" : state === "loading" ? "…" : "▶"}
        </button>
        <button className="crew-track-btn" onClick={() => skipTrack(15)}>
          15↻
        </button>
        <span className="mono-data crew-track-time">{dur > 0 ? mmss(dur) : "–:––"}</span>
      </div>
    </div>
  );
}
