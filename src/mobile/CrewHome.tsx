import { useEffect, useState } from "react";
import { usePco } from "../pcoStore";
import { useChat, CREW_SESSION_KEY } from "../chatStore";
import { listVisibleFor, roleMatches, useChecklists, type Checklist } from "../checklistStore";
import { useProDeck } from "../store";
import { enqueue } from "../lib/outbox";
import { Markdown } from "../lib/markdown";
import {
  checkinAuto,
  checkinGeo,
  checkinList,
  checkinSet,
  IS_WEB,
  on,
  onGatewayState,
  posfileList,
  posfileUrl,
  tapEdgeState,
  webWhoami,
  type PosFile,
  type TapEdgeState,
} from "../lib/tauri";

// S03 — Home, the Sunday screen. Answers "what do I do next" in two seconds.
//
// Order is fixed by urgency (countdown → duty → checklist → tiles → live strip →
// check-in), and everything except the check-in bar is read-only: no controls
// mid-screen, so nothing can be fired by accident with a phone in one hand.
//
// "My next duty" is real now: owned/role checklist steps exist, so the card
// shows the next unfinished step and ✓ advances through them one at a time.
// The plan-position line ("6 items ahead of you") remains out — plan items
// still carry no per-person link.

import { clock, countdown as fmtCountdown, dateClock, dayClock } from "./fmt";
import { useLiveTimers } from "../lib/liveTimers";
import { CrewSetlist } from "./CrewSetlist";
import { CrewMySet } from "./CrewMySet";
import { fileRuleFor } from "../pcoStore";

export function CrewHome({ onGoChecklist }: { onGoChecklist?: () => void }) {
  const pco = usePco();
  const chat = useChat();
  const cl = useChecklists();
  const { connected, audioDb, audioRunning, splCalibration } = useProDeck();
  // "Booth online" must mean THIS PHONE CAN REACH THE BOOTH. `connected` is the
  // booth's link to ProPresenter — a different question, and one a phone often
  // can't answer at all (pp_is_connected isn't exposed to web clients, so it
  // only ever flips when a pp:status event happens to arrive). Using it here
  // told volunteers the booth was offline while it was serving them the page.
  const [boothUp, setBoothUp] = useState(true);
  useEffect(() => onGatewayState(setBoothUp), []);
  const [checked, setChecked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [tap, setTap] = useState<TapEdgeState | null>(null);
  // TapLink is a booth/admin concern — on a volunteer's Home it's just
  // unexplained jargon, so the tile only renders for admin phones.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    webWhoami()
      .then((w) => setIsAdmin(w.tier === "admin"))
      .catch(() => {});
  }, []);
  const [, tick] = useState(0);

  // The countdown is the top of the screen — it has to actually count.
  useEffect(() => {
    const iv = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const serviceKey = `${pco.selectedPlanId ?? ""}::${pco.selectedServiceTimeId ?? ""}`;

  useEffect(() => {
    let alive = true;
    // The booth keys arrivals by crew user id, which this phone doesn't know —
    // so it resolves our own arrival from the session and returns it as `mine`.
    const load = () =>
      checkinList(localStorage.getItem(CREW_SESSION_KEY) ?? "")
        .then((r) => alive && setChecked(r.mine ?? null))
        .catch(() => {});
    load();
    return () => {
      alive = false;
    };
  }, [serviceKey]);

  useEffect(() => {
    tapEdgeState()
      .then(setTap)
      .catch(() => {});
  }, []);

  const start = pco.serviceTimes.find((t) => t.id === pco.selectedServiceTimeId)?.ts ?? 0;

  // AUTO CHECK-IN. Phones can't be pinged, so presence is proven the moment
  // the app is looked at: the gateway checks whether THIS request came from
  // inside the building (LAN peer, or public IP == the church's WAN address);
  // failing that, and only when the booth has coordinates configured, one
  // geolocation reading covers "in the parking lot on LTE". Runs on open and
  // whenever the app returns to the foreground, only inside the arrival
  // window (3 h before the selected service until 2 h after), and stops for
  // good once checked in — same first-timestamp-wins record as the button.
  useEffect(() => {
    if (!IS_WEB || checked !== null) return;
    const session = localStorage.getItem(CREW_SESSION_KEY) ?? "";
    if (!session || !start || !pco.selectedPlanId) return;
    let alive = true;
    let lastTry = 0;
    const attempt = async () => {
      const now = Date.now();
      if (now < start - 3 * 3600_000 || now > start + 2 * 3600_000) return;
      if (now - lastTry < 60_000) return; // foreground flaps
      lastTry = now;
      try {
        const r = await checkinAuto(session, serviceKey);
        if (!alive) return;
        if (r.checkedIn && r.at) return setChecked(r.at);
        // Off the wifi — try location, but only when the booth can use it.
        if (r.geo && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            async (p) => {
              try {
                const g = await checkinGeo(
                  session,
                  serviceKey,
                  p.coords.latitude,
                  p.coords.longitude,
                );
                if (alive && g.checkedIn && g.at) setChecked(g.at);
              } catch {
                /* manual button remains */
              }
            },
            () => {},
            { maximumAge: 120_000, timeout: 10_000 },
          );
        }
      } catch {
        /* booth unreachable — the offline screen owns that story */
      }
    };
    attempt();
    const onVis = () => document.visibilityState === "visible" && attempt();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, serviceKey, start]);
  // Human at any distance: "T-24 min to service" on Sunday morning,
  // "2d 7h to service" midweek — a bare T-3606 helps nobody.
  const cd = start ? fmtCountdown(start) : { big: "—", caption: "to service" };
  // When ProPresenter is running a countdown (the pre-service timer on the
  // screens), the phones show THAT — it's the number the room is watching.
  const ppTimer = useLiveTimers().find((t) => t.state === "running");

  // MY call time from the PCO schedule (name → nickname → position match).
  const myRole = localStorage.getItem("prodeck.crewRole") ?? "";
  const myArrival = pco.arrivalFor(
    localStorage.getItem("prodeck.crewName") ?? "",
    myRole,
  );
  const expectedTs = myArrival.ts ?? start;

  // Same visibility rule as the Checklist tab: position lists only surface
  // when I'm SCHEDULED to that position this week — PCO decides, full stop.
  const visibleTo = (c: Checklist) => listVisibleFor(c, myArrival.position, false);
  const myLists = cl.checklists.filter(visibleTo);
  const overdue = cl.overdue().filter(visibleTo).length;

  // MY NEXT DUTY (S03) — the next unfinished checklist step, one at a time:
  // items assigned to me first, then my position's team items, ordered by the
  // list's due time. ✓ advances straight to the following step.
  const myId = localStorage.getItem("prodeck.crewId") ?? "";
  const dutyPool = [
    ...cl
      .itemsFor(myId)
      .filter((x) => !x.item.done)
      .map((x) => ({ ...x, mine: true })),
    ...myLists.flatMap((list) =>
      list.items
        .filter((it) => !it.done && !it.owner && !it.header) // owned covered above; headers aren't steps
        .map((item) => ({ list, item, mine: false })),
    ),
  ].sort((a, b) => {
    if (a.mine !== b.mine) return a.mine ? -1 : 1;
    const da = cl.dueAt(a.list) ?? Infinity;
    const db = cl.dueAt(b.list) ?? Infinity;
    return da - db;
  });
  const duty = dutyPool[0] ?? null;
  const dutyDue = duty ? cl.dueAt(duty.list) : null;
  const dutyMins = dutyDue ? Math.round((dutyDue - Date.now()) / 60000) : null;
  const totals = myLists.reduce(
    (a, c) => {
      const p = cl.progress(c);
      return { done: a.done + p.done, total: a.total + p.total };
    },
    { done: 0, total: 0 },
  );
  const pct = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;

  async function checkIn() {
    setBusy(true);
    try {
      const r = await checkinSet(localStorage.getItem(CREW_SESSION_KEY) ?? "", serviceKey);
      setChecked(r.at);
    } catch (e) {
      // Only a TRANSPORT failure means "offline — queue it". A server that
      // answered with an error (revoked session, bad request) must not turn
      // into a false green bar backed by a queued replay that will fail the
      // same way (audit finding). The booth keeping the FIRST timestamp is
      // what makes the offline replay safe.
      const msg = String((e as Error)?.message ?? e);
      const transport = !boothUp || /fetch|network|load failed|timeout/i.test(msg);
      if (transport) {
        enqueue({
          kind: "checkin",
          session: localStorage.getItem(CREW_SESSION_KEY) ?? "",
          serviceKey,
        });
        setChecked(Date.now());
      }
      /* server-rejected: bar stays un-checked, which is the honest state */
    } finally {
      setBusy(false);
    }
  }

  const myName = localStorage.getItem("prodeck.crewName") ?? "";

  // Setlist sheet — songs, keys, leaders, charts. Shown whenever the plan has
  // songs; worship lives here, and production peeks at keys too.
  const [setlistOpen, setSetlistOpen] = useState(false);
  const songCount = pco.items.filter((i) => i.type === "song").length;
  // Band members (scheduled to a position with a file rule) get the inline
  // My Set section instead of the card — their materials ON the home screen.
  const fileRule = myArrival.scheduled
    ? fileRuleFor(pco.fileFilters, myArrival.position)
    : null;
  const isBand = fileRule !== null;

  // Position guide: only exists when scheduled this week AND the booth has
  // written a guide for that position ("Camera" guide covers "Camera 1").
  const [guideOpen, setGuideOpen] = useState(false);
  // Viewed IN the shell. target="_blank" from a Home Screen PWA hands the
  // volunteer to Safari with no way back into the app — mid-service that is
  // the app disappearing, not a new tab.
  const [viewing, setViewing] = useState<PosFile | null>(null);
  // Reference files the booth attached to this position. Matched the same loose
  // way as the guide, so one "Camera" attachment covers Camera 1 and Camera 2.
  const [posFiles, setPosFiles] = useState<PosFile[]>([]);
  useEffect(() => {
    const load = () => posfileList().then(setPosFiles).catch(() => {});
    load();
    const un = on("posfiles:changed", load);
    return () => {
      un.then((f) => f());
    };
  }, []);
  const myFiles = myArrival.scheduled
    ? posFiles.filter((f) => roleMatches(f.position, myArrival.position))
    : [];
  const guideText = myArrival.scheduled
    ? Object.entries(pco.positionGuides).find(([p]) =>
        roleMatches(p, myArrival.position),
      )?.[1] ?? ""
    : "";

  return (
    <div className="crew-page">
      <h1 className="crew-title">Sunday</h1>
      {/* Who the app thinks you are — the quiet confirmation that sign-in and
          role assignment actually took. */}
      {myName && (
        <p className="crew-hint muted" style={{ marginTop: -8 }}>
          Hi {myName.split(" ")[0]}
          {myRole ? ` · ${myRole}` : ""}
        </p>
      )}

      {/* Countdown — the live ProPresenter timer when one is running (what
          the room screens show), otherwise time to the PCO service start. */}
      <div className="crew-card edge crew-count">
        <div className="crew-count-left">
          <div className="crew-count-num">{ppTimer ? ppTimer.time : cd.big}</div>
          <div className="mono crew-count-cap">
            {ppTimer ? ppTimer.name : cd.caption}
          </div>
        </div>
        <div className="crew-count-rule" />
        <div className="crew-count-right">
          <div className="crew-count-when">
            {start ? `Service starts ${dateClock(start)}` : "No service time set"}
          </div>
          <div className="crew-hint muted">
            {pco.items.length ? `${pco.items.length} items in the plan` : "No plan loaded"}
          </div>
        </div>
      </div>

      {/* Band members: My Set inline (their files, right here). Everyone
          else: the compact Setlist card opening the full sheet. */}
      {songCount > 0 && isBand && <CrewMySet rule={fileRule} />}
      {songCount > 0 && !isBand && (
        <button className="crew-card edge crew-guide" onClick={() => setSetlistOpen(true)}>
          <span className="mono" style={{ color: "var(--accent-hi)" }}>
            Setlist
          </span>
          <span className="crew-guide-line">
            {songCount} song{songCount === 1 ? "" : "s"} — keys, leaders &amp; charts
          </span>
          <span className="crew-guide-go">Open →</span>
        </button>
      )}
      {setlistOpen && <CrewSetlist onClose={() => setSetlistOpen(false)} />}

      {/* Position guide — only when scheduled this week and the booth wrote
          one for this position. Small callout; full text opens as a sheet. */}
      {(guideText || myFiles.length > 0) && (
        <button className="crew-card edge crew-guide" onClick={() => setGuideOpen(true)}>
          <span className="mono" style={{ color: "var(--accent-hi)" }}>
            Your position
          </span>
          <span className="crew-guide-line">
            {myArrival.position} —{" "}
            {guideText ? "job description & expectations" : "reference files"}
            {guideText && myFiles.length > 0
              ? ` · ${myFiles.length} file${myFiles.length === 1 ? "" : "s"}`
              : ""}
          </span>
          <span className="crew-guide-go">Read →</span>
        </button>
      )}
      {guideOpen && (
        <div className="crew-sheet crew-guide-sheet" onClick={() => setGuideOpen(false)}>
          <div className="crew-guide-body" onClick={(e) => e.stopPropagation()}>
            {/* Sticky: a full job description is thousands of pixels tall, and
                a close button that scrolls off the top is no close button. */}
            <div className="crew-row-head crew-guide-head">
              <span className="crew-buzz-title">{myArrival.position}</span>
              <button className="btn ghost" onClick={() => setGuideOpen(false)}>
                ✕
              </button>
            </div>
            {guideText && (
              <div className="crew-guide-text">
                <Markdown text={guideText} />
              </div>
            )}
            {myFiles.length > 0 && (
              <div className="crew-guide-files">
                <span className="mono crew-sheet-label">Files</span>
                {myFiles.map((f) => (
                  // Opened in a new tab rather than inlined: a PDF or an image
                  // wants the OS viewer's zoom, and the sheet stays put behind.
                  <button key={f.id} className="crew-file" onClick={() => setViewing(f)}>
                    <span className="crew-file-name">{f.name}</span>
                    <span className="mono-data crew-file-size">
                      {f.size >= 1048576
                        ? `${(f.size / 1048576).toFixed(1)} MB`
                        : `${Math.max(1, Math.round(f.size / 1024))} KB`}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {viewing && (
        <div className="crew-viewer">
          <header className="crew-viewer-head">
            <button
              className="crew-back"
              onClick={() => setViewing(null)}
              aria-label="Back to position"
            >
              ‹
            </button>
            <span className="crew-viewer-name">{viewing.name}</span>
            {/* Always offered, never automatic: some file types no phone can
                render inline, and this is the deliberate way out. */}
            <a
              className="crew-viewer-out mono"
              href={posfileUrl(viewing.id)}
              target="_blank"
              rel="noreferrer"
            >
              Open
            </a>
          </header>
          <div className="crew-viewer-body">
            {viewing.mime.startsWith("image/") ? (
              <img className="crew-viewer-img" src={posfileUrl(viewing.id)} alt={viewing.name} />
            ) : viewing.mime === "application/pdf" ? (
              <iframe
                className="crew-viewer-frame"
                src={posfileUrl(viewing.id)}
                title={viewing.name}
              />
            ) : (
              <p className="crew-hint muted crew-viewer-note">
                This file type can't be shown inside the app. Tap Open to view it — you'll
                come back with your phone's Back gesture.
              </p>
            )}
          </div>
        </div>
      )}

      {/* My next duty — the design's accent card, driven by real checklist
          steps: shows ONE step, ✓ advances to the next. */}
      {duty && (
        <div className="crew-card crew-duty">
          <div className="crew-row-head">
            <span className="mono" style={{ color: "var(--accent-hi)" }}>
              My next duty
            </span>
            <span className="mono-data crew-count-of">
              {dutyMins != null && dutyMins >= 0 && dutyMins <= 120
                ? `in ${dutyMins} min`
                : dutyMins != null && dutyMins < 0 && dutyMins >= -120
                  ? `${Math.abs(dutyMins)} min over`
                  : `${dutyPool.length} to go`}
            </span>
          </div>
          <div className="crew-duty-title">{duty.item.text}</div>
          <div className="crew-buzz-sub">
            {duty.list.name}
            {dutyDue ? ` · due ${dayClock(dutyDue)}` : ""}
            {dutyPool.length > 1 ? ` · then ${dutyPool.length - 1} more` : " · last one"}
          </div>
          <div className="field-row" style={{ marginTop: 12, marginBottom: 0 }}>
            <button
              className="crew-checkin-btn"
              onClick={() => cl.toggleItem(duty.list.id, duty.item.id)}
            >
              ✓ Done
            </button>
            {onGoChecklist && (
              <button className="btn ghost" onClick={onGoChecklist}>
                All steps
              </button>
            )}
          </div>
        </div>
      )}

      {/* Checklist progress — only when there IS a checklist for this
          position. "0 of 0" read as something being broken. */}
      {totals.total > 0 && (
        <div className="crew-card edge">
          <div className="crew-row-head">
            <span className="crew-buzz-title">Checklist</span>
            {overdue > 0 && <span className="crew-chip-warn mono">{overdue} overdue</span>}
            <span className="mono-data crew-count-of">
              {totals.done}/{totals.total}
            </span>
          </div>
          <div className="crew-progress" style={{ marginTop: 10 }}>
            <div className="crew-progress-fill accent" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Tiles */}
      <div className="crew-tiles">
        <div className="crew-card edge">
          <span className="mono" style={{ color: "var(--dim)" }}>
            Unread
          </span>
          <div className="crew-tile-big">{chat.unread}</div>
          <div className="crew-hint muted">
            {chat.unread === 1 ? "message" : "messages"} in Sunday Team
          </div>
        </div>
        {isAdmin && (
          <div className="crew-card edge">
            <span className="mono" style={{ color: "var(--dim)" }}>
              TapLink
            </span>
            <div className="crew-tile-row">
              <span
                className="crew-dot"
                style={{ background: tap ? "var(--success)" : "var(--dim)" }}
              />
              <span className="crew-tile-state">{tap?.state ?? "default"}</span>
            </div>
            <div className="crew-hint muted">
              {tap ? "discs live" : "not reachable"}
            </div>
          </div>
        )}
      </div>

      {/* Live strip */}
      <div className="crew-strip edge">
        <span className="crew-strip-item">
          <span
            className="crew-dot"
            style={{ background: boothUp ? "var(--success)" : "var(--danger)" }}
          />
          {boothUp ? "Booth online" : "Booth offline"}
        </span>
        <span className="crew-strip-rule" />
        {/* ProPresenter is its own fact, and only shown once we've actually
            heard from it — a phone that simply hasn't received a status frame
            yet must not be reported as "Pro offline". */}
        {connected && (
          <>
            <span className="crew-strip-item">
              <span className="crew-dot" style={{ background: "var(--success)" }} />
              Pro live
            </span>
            <span className="crew-strip-rule" />
          </>
        )}
        <span className="mono-data crew-strip-item">
          {audioRunning
            ? audioDb > -85
              ? `${Math.round(audioDb + splCalibration)} dB`
              : "quiet"
            : "no meter"}
        </span>
      </div>

      {/* Check-in — the only control on the screen. Only people on this
          week's plan get an expected time; everyone else can still check in
          (last-minute subs happen) but is never told they're due. */}
      <div className="crew-checkin edge">
        {checked ? (
          <span className="crew-checkin-done">
            <span className="crew-check on green">✓</span> Checked in {clock(checked)}
          </span>
        ) : (
          <>
            <div>
              <div className="crew-buzz-title">
                {myArrival.scheduled ? "Not checked in" : "Not on this week's plan"}
              </div>
              {myArrival.scheduled && expectedTs > 0 && (
                <div className="mono-data crew-buzz-sub">
                  expected {dayClock(expectedTs)}
                  {myArrival.ts == null ? " · service start" : ""}
                </div>
              )}
              {!myArrival.scheduled && (
                <div className="mono-data crew-buzz-sub">
                  filling in? check in anyway
                </div>
              )}
            </div>
            <button className="crew-checkin-btn" disabled={busy} onClick={checkIn}>
              {busy ? "…" : "I'm here"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
