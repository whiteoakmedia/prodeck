import { useEffect, useRef, useState } from "react";
import markWhite from "../assets/prodeck-mark-white.svg";
import { edgeFetch, getWebToken } from "../lib/tauri";
import { CREW_SESSION_KEY } from "../chatStore";
import {
  arrivalForIn,
  isDeclined,
  manualArrival,
  productionRoster,
  type TeamMember,
} from "../pcoStore";
import { ChartSheet } from "./ChartSheet";

// S11 — booth offline. The nav is deliberately hidden: the LIVE features all
// need the booth. But the week's plan doesn't — the crew-edge worker serves
// it straight from Planning Center: the full order of service, keys, leaders,
// per-person call times, position guide, and the team roster all render here,
// and song rows open the chart sheet (chord text comes from the edge too).
// TEAM CHAT works via the cloud ring, JOINING works via the edge (a pending
// account the booth adopts at its next heartbeat), and the checklist still
// opens from cache.

interface EdgePlan {
  generatedMs: number;
  plan: { id: string; date: string; title: string };
  items: {
    id: string;
    title: string;
    sequence: number;
    length: number;
    type: string;
    key: string;
    leader: string;
    songId?: string;
    arrangementId?: string;
  }[];
  serviceTimes: { id: string; name: string; type: string; ts: number | null }[];
  team: { name: string; position: string; status: string; timeIds: string[] }[];
  extras?: {
    checkinTimes?: Record<string, string>;
    positionGuides?: Record<string, string>;
  };
}

interface EdgeMsg {
  seq: number;
  origin: string;
  from: string;
  text: string;
  channel: string;
  ts: number;
}

// Team chat against the cloud ring. Poll-based (10 s) — hibernating
// WebSockets are stage 3; a booth-off Saturday night doesn't need realtime.
function EdgeChat() {
  const [msgs, setMsgs] = useState<EdgeMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const seqRef = useRef(0);
  const name = localStorage.getItem("prodeck.crewName") ?? "";
  const token = getWebToken();

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const poll = () =>
      edgeFetch(`/chat?token=${encodeURIComponent(token)}&since=${seqRef.current}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j: { msgs: EdgeMsg[]; seq: number }) => {
          if (!alive || j.msgs.length === 0) return;
          seqRef.current = j.seq;
          // Dedupe by seq: a poll already in flight when we SEND returns our
          // own message again, which doubled it in the list (audit finding).
          setMsgs((m) => {
            const seen = new Set(m.map((x) => x.seq));
            return [...m, ...j.msgs.filter((x) => !seen.has(x.seq))].slice(-100);
          });
        })
        .catch(() => {});
    poll();
    const t = setInterval(poll, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [token]);

  if (!token) return null;

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await edgeFetch(`/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          from: name,
          text: body,
          // Lets the edge skip buzzing the sender's own devices.
          sender: localStorage.getItem("prodeck.crewId") ?? "",
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
      const j = (await r.json()) as { msg: EdgeMsg };
      seqRef.current = Math.max(seqRef.current, j.msg.seq);
      setMsgs((m) =>
        m.some((x) => x.seq === j.msg.seq) ? m : [...m, j.msg].slice(-100),
      );
      setText("");
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="crew-card edge crew-offline-plan">
      <div className="crew-row-head">
        <span className="mono" style={{ color: "var(--accent-hi)" }}>
          Team chat
        </span>
        <span className="mono-data crew-count-of">via cloud</span>
      </div>
      {msgs.length === 0 && (
        <p className="crew-hint muted" style={{ margin: "4px 0" }}>
          Nothing yet. Messages sent here reach the whole team and land in the
          booth feed when it's back.
        </p>
      )}
      {msgs.map((m) => (
        <div key={m.seq} style={{ padding: "3px 0", textAlign: "left" }}>
          <span className="mono-data" style={{ color: "var(--accent-hi)" }}>
            {m.from}
          </span>
          <span className="crew-hint muted" style={{ marginLeft: 6 }}>
            {new Date(m.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
          <div>{m.text}</div>
        </div>
      ))}
      {name ? (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            className="crew-input"
            style={{ flex: 1, minWidth: 0 }}
            placeholder="Message the team…"
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button className="crew-btn primary" style={{ width: "auto" }} disabled={busy} onClick={send}>
            Send
          </button>
        </div>
      ) : (
        <p className="crew-hint muted" style={{ marginTop: 8 }}>
          Set up your crew profile (when the booth is back) to send messages.
        </p>
      )}
      {err && <p className="crew-join-err">{err}</p>}
    </div>
  );
}

// Booth-off signup: name (tapped off the plan or typed) + 4-digit PIN. The
// edge stores it pending; the booth creates the real account and adopts the
// session at its next heartbeat, so this device never signs in twice.
function EdgeJoin({
  roster,
  onJoined,
}: {
  roster: { name: string; position: string }[];
  onJoined: () => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const token = getWebToken();
  if (!token) return null;

  const submit = async () => {
    const n = name.trim();
    setErr("");
    if (n.length < 2) return setErr("Enter your name (tap it above if it's listed).");
    if (!/^\d{4}$/.test(pin)) return setErr("PIN must be exactly 4 digits.");
    if (pin !== pin2) return setErr("PINs don't match.");
    setBusy(true);
    try {
      const r = await edgeFetch(`/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, name: n, pin, role }),
      });
      const j = (await r.json().catch(() => null)) as any;
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      localStorage.setItem(CREW_SESSION_KEY, j.session);
      localStorage.setItem("prodeck.crewName", j.name);
      onJoined();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="crew-card edge crew-offline-plan">
      <div className="crew-row-head">
        <span className="mono" style={{ color: "var(--accent-hi)" }}>
          Join the crew
        </span>
        <span className="mono-data crew-count-of">works booth-off</span>
      </div>
      {roster.length > 0 && (
        <>
          <p className="crew-hint muted" style={{ margin: "4px 0" }}>
            Tap your name on this week's plan
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "4px 0 8px" }}>
            {roster.slice(0, 24).map((m) => (
              <button
                key={m.name + m.position}
                className={`crew-btn${name === m.name ? " primary" : ""}`}
                style={{ width: "auto", padding: "6px 10px" }}
                onClick={() => {
                  setName(m.name);
                  setRole(m.position);
                }}
              >
                {m.name}
              </button>
            ))}
          </div>
          <p className="crew-hint muted" style={{ margin: "0 0 4px" }}>
            or type it
          </p>
        </>
      )}
      <input
        className="crew-input"
        placeholder="Your name"
        value={name}
        maxLength={32}
        onChange={(e) => {
          setName(e.target.value);
          setRole("");
        }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          className="crew-input"
          style={{ flex: 1, minWidth: 0 }}
          placeholder="4-digit PIN"
          inputMode="numeric"
          type="password"
          value={pin}
          maxLength={4}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        />
        <input
          className="crew-input"
          style={{ flex: 1, minWidth: 0 }}
          placeholder="Confirm PIN"
          inputMode="numeric"
          type="password"
          value={pin2}
          maxLength={4}
          onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))}
        />
      </div>
      <button
        className="crew-btn primary"
        style={{ marginTop: 8 }}
        disabled={busy}
        onClick={submit}
      >
        {busy ? "Joining…" : "Join"}
      </button>
      <p className="crew-hint muted" style={{ marginTop: 6 }}>
        You can chat right away. The booth finishes your account (and an admin
        approves it) the next time it's on.
      </p>
      {err && <p className="crew-join-err">{err}</p>}
    </div>
  );
}

export function CrewOffline({ onCached }: { onCached: () => void }) {
  const [edge, setEdge] = useState<EdgePlan | null>(null);
  const [tried, setTried] = useState(false);
  const [chart, setChart] = useState<{
    songId: string;
    arrangementId: string;
    title: string;
    itemKey: string;
  } | null>(null);
  // Bumped after an edge join so EdgeChat re-reads the stored name.
  const [, bump] = useState(0);

  useEffect(() => {
    const t = getWebToken();
    if (!t) {
      setTried(true);
      return;
    }
    edgeFetch(`/plan?token=${encodeURIComponent(t)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => setEdge(j as EdgePlan))
      .catch(() => {})
      .finally(() => setTried(true));
  }, []);

  const items = edge?.items ?? [];
  const nextTime = edge?.serviceTimes
    .filter((t) => t.ts && t.ts > Date.now() - 2 * 3600_000)
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))[0];

  // Per-person call time + position, same matcher the online app uses. The
  // edge team rows lack the fields arrivalForIn ignores — defaulted below.
  const crewName = localStorage.getItem("prodeck.crewName") ?? "";
  const crewRole = localStorage.getItem("prodeck.crewRole") ?? "";
  const team: TeamMember[] = (edge?.team ?? []).map((m) => ({
    id: m.name,
    name: m.name,
    position: m.position,
    team: "",
    status: m.status,
    photo: "",
    timeIds: m.timeIds ?? [],
  }));
  const timesById: Record<string, number> = {};
  for (const t of edge?.serviceTimes ?? []) if (t.ts) timesById[t.id] = t.ts;
  const serviceStart =
    edge?.serviceTimes.filter((t) => t.type === "service" && t.ts).sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))[0]?.ts ?? nextTime?.ts ?? 0;
  const arrival = arrivalForIn(team, timesById, crewName, crewRole, serviceStart || 0);
  const manualTs = manualArrival(
    edge?.extras?.checkinTimes ?? {},
    arrival.position || crewRole,
    serviceStart || 0,
  );
  const callTs = manualTs ?? arrival.ts;

  // Position guide, loose key match like checklists ("camera" covers "Camera 1").
  const myPos = (arrival.position || crewRole).trim().toLowerCase();
  let guide = "";
  if (myPos) {
    for (const [k, v] of Object.entries(edge?.extras?.positionGuides ?? {})) {
      const key = k.trim().toLowerCase();
      if (key && (key === myPos || myPos.startsWith(key) || key.startsWith(myPos))) {
        guide = v;
        break;
      }
    }
  }

  const joined = !!localStorage.getItem(CREW_SESSION_KEY);
  const fmtDay = (ts: number) =>
    new Date(ts).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

  if (chart) {
    return (
      <ChartSheet
        songId={chart.songId}
        arrangementId={chart.arrangementId}
        title={chart.title}
        itemKey={chart.itemKey}
        onClose={() => setChart(null)}
      />
    );
  }

  return (
    <div className="crew-onboard">
      <img className="crew-mark dim" src={markWhite} alt="" aria-hidden />
      <h1 className="crew-onboard-title">Command Center offline</h1>
      <p className="crew-onboard-sub">
        The plan, charts, chat, and your checklist still work — pages and
        check-in return with the booth.
      </p>
      <div className="crew-caution">
        <span className="pulse-dot" style={{ background: "var(--warn)" }} />
        <span className="mono">Waiting for the booth</span>
      </div>
      <button className="crew-btn primary" onClick={onCached}>
        Open checklist
      </button>

      {/* Your Sunday, from the cloud — current even with the booth Mac off. */}
      {edge && (
        <div className="crew-card edge crew-offline-plan">
          <div className="crew-row-head">
            <span className="mono" style={{ color: "var(--accent-hi)" }}>
              This week
            </span>
            <span className="mono-data crew-count-of">{edge.plan.date}</span>
          </div>
          {nextTime?.ts && (
            <p className="crew-hint muted" style={{ margin: "4px 0 0" }}>
              {nextTime.name || nextTime.type || "Service"} · {fmtDay(nextTime.ts)}
            </p>
          )}
          {arrival.scheduled && (
            <p className="crew-hint" style={{ margin: "4px 0 0", color: "var(--accent-hi)" }}>
              Your call{callTs ? ` · ${fmtDay(callTs)}` : ""}
              {arrival.position ? ` · ${arrival.position}` : ""}
            </p>
          )}
          {guide && (
            <p className="crew-hint muted" style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
              {guide}
            </p>
          )}
          <div style={{ marginTop: 8 }}>
            {items.map((s) =>
              s.type === "song" ? (
                <div
                  key={s.id}
                  className="crew-setlist-row"
                  style={{ padding: "4px 0", cursor: s.songId && s.arrangementId ? "pointer" : undefined }}
                  onClick={() =>
                    s.songId &&
                    s.arrangementId &&
                    setChart({
                      songId: s.songId,
                      arrangementId: s.arrangementId,
                      title: s.title,
                      itemKey: s.key,
                    })
                  }
                >
                  <span className="crew-setlist-title">
                    {s.title}
                    {s.songId && s.arrangementId && (
                      <span className="crew-hint muted" style={{ marginLeft: 6 }}>
                        ♪ chart
                      </span>
                    )}
                  </span>
                  {s.leader && (
                    <span className="crew-hint muted" style={{ whiteSpace: "nowrap" }}>
                      {s.leader}
                    </span>
                  )}
                  {s.key && <span className="crew-setlist-key">{s.key}</span>}
                </div>
              ) : s.type === "header" ? (
                <div key={s.id} className="mono-data crew-count-of" style={{ padding: "8px 0 2px" }}>
                  {s.title}
                </div>
              ) : (
                <div key={s.id} className="crew-setlist-row" style={{ padding: "2px 0", opacity: 0.75 }}>
                  <span className="crew-hint">{s.title}</span>
                  {s.length > 0 && (
                    <span className="crew-hint muted" style={{ whiteSpace: "nowrap" }}>
                      {Math.round(s.length / 60)} min
                    </span>
                  )}
                </div>
              ),
            )}
          </div>
          {team.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary className="crew-hint" style={{ cursor: "pointer" }}>
                Who's on this week ({team.filter((m) => !isDeclined(m.status)).length})
              </summary>
              {team
                .filter((m) => !isDeclined(m.status))
                .map((m) => (
                  <div key={m.id + m.position} className="crew-setlist-row" style={{ padding: "2px 0" }}>
                    <span className="crew-hint">{m.name}</span>
                    <span className="crew-hint muted" style={{ whiteSpace: "nowrap" }}>
                      {m.position}
                    </span>
                  </div>
                ))}
            </details>
          )}
          <p className="crew-hint muted" style={{ marginTop: 8 }}>
            Live from Planning Center — tap a song for its chart.
          </p>
        </div>
      )}
      {!joined && edge && (
        <EdgeJoin
          roster={productionRoster(
            (edge.team ?? []).map((m) => ({ ...m, team: "" })),
          ).map((m) => ({ name: m.name, position: m.position }))}
          onJoined={() => bump((n) => n + 1)}
        />
      )}
      <EdgeChat />
      {tried && !edge && (
        <p className="crew-hint muted">
          The week's plan wasn't reachable either — check your connection.
        </p>
      )}
    </div>
  );
}
