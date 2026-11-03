import { IS_SHOTS, SHOT_TAB } from "../lib/tauri";
import { useEffect, useState } from "react";
import { usePerms } from "../lib/perms";
import { CrewNav, type CrewTab } from "./CrewNav";
import { CrewWalk } from "./CrewWalk";
import { CrewChat } from "./CrewChat";
import { CrewJoin } from "./CrewJoin";
import {
  IconBell,
  IconChevron,
  IconChime,
  IconComms,
  IconLock,
  IconNoSound,
  IconPeople,
  IconScreen,
  IconSignOut,
  IconSwitch,
  IconTally,
  IconTrash,
} from "./icons";
import { CrewHome } from "./CrewHome";
import { CrewChecklist } from "./CrewChecklist";
import { CrewOnboard, shouldOnboard } from "./CrewOnboard";
import { CrewOffline } from "./CrewOffline";
import { CrewLeader } from "./CrewLeader";
import { CrewDash } from "./CrewDash";
import { CREW_ID_KEY, CREW_SESSION_KEY, useChat } from "../chatStore";
import { listVisibleFor, useChecklists } from "../checklistStore";
import { usePco } from "../pcoStore";
import { IS_WEB, atemState, clearWebToken, identityDeleteSelf, identityWhoami, onGatewayState } from "../lib/tauri";
import { offersTally, readTallyMode, writeTallyMode } from "../lib/tallyMode";
import { switchLayout, wideScreen } from "../lib/layout";
import { IN_CREW_APP, crewAppHome } from "../lib/crewApp";
import { TallyPage } from "../pages/Tally";
import { CommsChip, CrewComms } from "./CrewComms";
import { setCommsAllowed } from "../lib/intercom";
import { syncHomeScreenManifest } from "../lib/homeScreen";
import { CrewNotifyStep } from "./CrewNotifyStep";
import { useProDeck } from "../store";
import { disablePush, enablePush, pushState, type PushStatus } from "../lib/pushClient";
import { listenSnapshot, onListen, stopListen } from "../lib/listen";
import { onTrack, seekTrack, skipTrack, stopTrack, toggleTrack, trackSnapshot } from "../lib/trackPlayer";

// ProDeck Crew — the phone shell (design/mobile). Renders instead of the
// desktop Shell on phone-width web clients. v1 ships the frame + working
// Chat and Dashboards; Home/Checklist arrive with their screens (S03/S08).

export function MobileShell() {
  const shotTab = IS_SHOTS && SHOT_TAB && ["home", "chat", "checklist", "dashboards", "more"].includes(SHOT_TAB) ? (SHOT_TAB as CrewTab) : null;
  const [tab, setTab] = useState<CrewTab>(shotTab ?? "home");
  // Bumped when Home is tapped while already on Home: remounts it, closing
  // whatever sheet it had open (My role), like a native tab bar.
  const [homeKey, setHomeKey] = useState(0);
  // "No sound?" is reached from Home (and More), not a sixth tab: the nav is
  // five tabs by design and this is an occasional screen, not a daily one.
  const [walk, setWalk] = useState(IS_SHOTS && SHOT_TAB === "walk");
  // Comms is a More screen too; the chip above every tab brings it back.
  const [comms, setComms] = useState(false);
  // Comms is the booth's switch (Settings, Comms): off, it's nowhere on the
  // phone, and a phone that was on it hangs up. Known = settings arrived;
  // until then nothing rejoins by itself.
  const { settings } = useProDeck();
  const commsOn = !!settings?.comms_enabled;
  useEffect(() => {
    if (settings) setCommsAllowed(commsOn);
  }, [settings, commsOn]);
  const [onboarding, setOnboarding] = useState(() => IS_WEB && shouldOnboard());
  const chat = useChat();
  // Keep Add to Home Screen carrying this phone's sign-in (lib/homeScreen.ts).
  useEffect(() => syncHomeScreenManifest(), [chat.auth]);
  // The overdue dot only counts lists this phone can actually see — an alert
  // for another position's hidden list is just an unanswerable mystery.
  const cl = useChecklists();
  const crewRole = (IS_WEB && localStorage.getItem("prodeck.crewRole")) || "";
  // Booth reachability, not ProPresenter state.
  const [boothUp, setBoothUp] = useState(true);
  useEffect(() => onGatewayState(setBoothUp), []);
  // Leader board is admin-only; the gateway enforces the underlying calls too.
  const { isAdmin, can } = usePerms();
  const [leader, setLeader] = useState(false);
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

  // "Use as tally light": the whole phone becomes the camera's tally until
  // Back to ProDeck. Remembered, so a reload on a mounted phone stays a tally.
  const [tally, setTally] = useState(() => IS_WEB && readTallyMode());
  const tallyOn = (on: boolean) => {
    writeTallyMode(on);
    setTally(on);
  };

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
  // Ahead of the offline screen: a tally that loses the booth must say so
  // itself ("Can't reach ProDeck"), in place, and come back on its own.
  if (tally) return <TallyPage param="" onExit={() => tallyOn(false)} />;

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
  if ((IS_WEB && chat.auth !== "in") || (IS_SHOTS && SHOT_TAB === "join")) {
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
        <CommsChip
          hidden={!commsOn || (tab === "more" && comms && !walk && !leader)}
          onOpen={() => {
            setTab("more");
            setLeader(false);
            setWalk(false);
            setComms(true);
          }}
        />
        <ListenChip />
      </div>
      <main className="crew-main">
        {tab === "home" && walk && <CrewWalk onBack={() => setWalk(false)} />}
        {/* Onboarding's last step, until page notifications are on. */}
        {IS_WEB && tab === "home" && !walk && <CrewNotifyStep onShowInstall={() => setOnboarding(true)} />}
        {tab === "home" && !walk && <CrewHome key={homeKey} onGoChecklist={() => setTab("checklist")} onGoWalk={() => setWalk(true)} onGoChat={() => setTab("chat")} />}
        {tab === "chat" && (
          <div className="crew-page crew-page-chat">
            <CrewChat />
          </div>
        )}
        {tab === "checklist" && <CrewChecklist />}
        {tab === "dashboards" && <CrewDash />}
        {tab === "more" && leader && <CrewLeader />}
        {tab === "more" && !leader && walk && <CrewWalk onBack={() => setWalk(false)} />}
        {tab === "more" && !leader && !walk && comms && commsOn && <CrewComms onBack={() => setComms(false)} />}
        {tab === "more" && !leader && !walk && !(comms && commsOn) && (
          <div className="crew-page crew-more">
            <h1 className="crew-title">More</h1>

            <div className="more-profile">
              <span className="more-avatar" aria-hidden>
                {initials(chat.name)}
              </span>
              <div className="more-profile-text">
                <div className="more-profile-name">{chat.name || "This phone"}</div>
                {IS_WEB && <div className="mono more-profile-tier">{isAdmin ? "Admin" : "Crew member"}</div>}
              </div>
            </div>

            <MoreGroup label="Tools">
              {commsOn && <MoreRow icon={<IconComms />} title="Comms" sub="Talk to the crew" onClick={() => setComms(true)} />}
              <TallyRow onStart={() => tallyOn(true)} />
              <MoreRow icon={<IconNoSound />} title="No sound?" sub="Find the fault, step by step" onClick={() => setWalk(true)} />
              {(isAdmin || can("manage")) && (
                <MoreRow icon={<IconPeople />} title="Leader board" sub="Who's here, who needs help" onClick={() => setLeader(true)} />
              )}
            </MoreGroup>

            <MoreGroup label="Notifications">
              <PushRow />
              <MoreRow
                icon={<IconChime />}
                title="Message sounds"
                sub="While the app is open. Pages always ring."
                trailing={
                  <button
                    className={`crew-toggle ${chat.sound ? "on" : ""}`}
                    role="switch"
                    aria-checked={chat.sound}
                    aria-label="Message sounds"
                    onClick={() => chat.setSound(!chat.sound)}
                  >
                    <span className="crew-toggle-knob" />
                  </button>
                }
              />
            </MoreGroup>

            <MoreGroup label="Account">
              {IN_CREW_APP && <MoreRow icon={<IconSwitch />} title="Switch church" onClick={() => (location.href = crewAppHome())} />}
              {IS_WEB && wideScreen() && (
                <MoreRow icon={<IconScreen />} title="Full view" sub="Every page and dashboard" onClick={() => switchLayout("full")} />
              )}
              {chat.auth === "in" && <MoreRow icon={<IconLock />} title="Lock" sub="Ask for my PIN again" onClick={chat.signOut} />}
              {IS_WEB && (
                // Without this a phone is stuck on whichever tier it first
                // signed in as: "Lock" only clears the crew session, so you'd
                // get the PIN screen back and never the access-password screen.
                <MoreRow
                  icon={<IconSignOut />}
                  title="Sign out"
                  sub="Forget this phone"
                  onClick={() => {
                    chat.forgetDevice();
                    clearWebToken();
                    location.reload();
                  }}
                />
              )}
              {IS_WEB && chat.auth === "in" && (
                <DeleteAccount
                  onDone={() => {
                    chat.forgetDevice();
                    clearWebToken();
                    if (IN_CREW_APP) location.href = crewAppHome();
                    else location.reload();
                  }}
                />
              )}
            </MoreGroup>

            {IS_WEB && (
              <p className="more-foot">
                {isAdmin
                  ? "You can send pages from Chat."
                  : "Members can chat, check in and confirm pages. Booth controls need an admin sign in."}
              </p>
            )}
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
          setWalk(false); // and any tab tap leaves the troubleshooter
          setComms(false); // and the comms screen (comms itself keeps running)
          // Tapping the tab you're on takes you to its top, as on iOS. Before,
          // it did nothing and read as a dead button.
          if (t === tab) {
            document.querySelector(".crew-main")?.scrollTo({ top: 0, behavior: "smooth" });
            if (t === "home") setHomeKey((k) => k + 1);
          }
          setTab(t);
        }}
      />
    </div>
  );
}

// Notifications. States the actual reason push isn't available rather than a
// bare "off" — on iOS the browser reports "denied" when the real problem is
// that the app isn't on the Home Screen yet, which is unguessable.
/**
 * Delete my account: removes this volunteer's crew account at the booth, with
 * its notifications. Two taps, the second spelling out what goes.
 */
function DeleteAccount({ onDone }: { onDone: () => void }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!sure) {
    return <MoreRow icon={<IconTrash />} title="Delete my account" danger onClick={() => setSure(true)} />;
  }
  return (
    <div className="crew-card danger" style={{ marginTop: 10 }}>
      <p style={{ margin: 0 }}>
        This removes your ProDeck crew account from the booth: your sign-in, PIN and notifications. Planning
        Center isn't changed, so you stay on the schedule, and your name is still there to tap if you join again.
        Chat messages you sent stay.
      </p>
      {err && <p className="crew-join-err">{err}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          className="btn crew-delete-yes"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            try {
              await identityDeleteSelf(localStorage.getItem(CREW_SESSION_KEY) ?? "");
              onDone();
            } catch (e) {
              setErr((e as Error)?.message ?? String(e));
              setBusy(false);
            }
          }}
        >
          {busy ? "Deleting…" : "Delete my account"}
        </button>
        <button className="btn ghost" disabled={busy} onClick={() => setSure(false)}>
          Keep it
        </button>
      </div>
    </div>
  );
}

/** Offered only when the booth has a switcher to read cameras from. */
function TallyRow({ onStart }: { onStart: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let alive = true;
    atemState()
      .then((s) => alive && setShow(offersTally(s)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!show) return null;
  return <MoreRow icon={<IconTally />} title="Tally light" sub="Use this phone at a camera" onClick={onStart} />;
}

function PushRow() {
  const [state, setState] = useState<PushStatus>("off");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    pushState().then(setState).catch(() => {});
  }, []);

  const copy: Record<PushStatus, string> = {
    on: "Pages reach you even when it's closed",
    off: "Off: pages only show while it's open",
    denied:
      "This browser is refusing notifications for ProDeck. That also happens if the permission pop-up was dismissed. Allow notifications for this site in your browser settings, then come back.",
    insecure:
      "Not available on this plain (http) address. Open ProDeck from the booth's secure address to turn them on.",
    "needs-install":
      "Add ProDeck to your Home Screen first. iPhones send no notifications to a browser tab.",
    unsupported: "This browser can't do push notifications.",
  };
  // The ProDeck Crew app: no browser, and the phone's own Settings.
  if (IN_CREW_APP) {
    copy.on = "Pages will buzz this phone even when ProDeck Crew is closed.";
    copy.denied = "Notifications are off for ProDeck Crew. Turn them on in the phone's Settings, under Notifications, then tap the switch.";
    copy.unsupported = "Pages can't buzz this phone yet. Keep ProDeck Crew open during the service and pages still show.";
  }

  const toggle =
    state === "on" || state === "off" || (IN_CREW_APP && state === "denied") ? (
      <button
        className={`crew-toggle ${state === "on" ? "on" : ""}`}
        role="switch"
        aria-checked={state === "on"}
        aria-label="Page notifications"
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
    ) : null;
  return <MoreRow icon={<IconBell />} title="Page notifications" sub={err || copy[state]} trailing={toggle} />;
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

/** "Devon Clark" → "DC" for the More screen's avatar. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "·";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** A titled group of rows, iOS Settings style. */
function MoreGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="more-group" aria-label={label}>
      <div className="mono more-group-label">{label}</div>
      <div className="more-group-rows">{children}</div>
    </section>
  );
}

/** One row: icon, title, an optional line under it, then a switch or a chevron. */
function MoreRow({
  icon,
  title,
  sub,
  onClick,
  trailing,
  danger,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  onClick?: () => void;
  trailing?: React.ReactNode;
  danger?: boolean;
}) {
  const body = (
    <>
      <span className="more-icon" aria-hidden>
        {icon}
      </span>
      <span className="more-text">
        <span className="more-title">{title}</span>
        {sub && <span className="more-sub">{sub}</span>}
      </span>
      {trailing ?? (onClick ? <span className="more-chev"><IconChevron /></span> : null)}
    </>
  );
  return onClick && !trailing ? (
    <button className={`more-row${danger ? " danger" : ""}`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={`more-row${danger ? " danger" : ""}`}>{body}</div>
  );
}
