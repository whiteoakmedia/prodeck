import { BackToChurches } from "./BackToChurches";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CREW_SESSION_KEY, realInvoke, setWebToken } from "../lib/tauri";
import { JOIN_TICKET_KEY, joinFormProblem, joinPollMs, type JoinStatus } from "../lib/posterJoin";
import lockupStacked from "../assets/prodeck-lockup-stacked-color.svg";

interface Ticket {
  session: string;
  name: string;
  at: number;
}

function readTicket(): Ticket | null {
  try {
    const t = JSON.parse(localStorage.getItem(JOIN_TICKET_KEY) ?? "null");
    return t && typeof t.session === "string" ? t : null;
  } catch {
    return null;
  }
}

export const hasJoinTicket = () => !!readTicket();

/**
 * Scanned the green-room poster while joining is closed. It used to be a dead
 * end ("Joining is closed right now" and a Try again button that did the same
 * thing). Now the volunteer asks to join, the booth sees them under Crew
 * Members, and the moment they're approved this phone is let in.
 */
export function PosterJoin() {
  const [ticket, setTicket] = useState<Ticket | null>(readTicket);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = joinFormProblem(name, pin);
    if (problem) return setErr(problem);
    setBusy(true);
    setErr("");
    try {
      const r = await realInvoke<{ status: string; session: string }>("join_signup", { name: name.trim(), pin });
      const t = { session: r.session, name: name.trim().replace(/\s+/g, " "), at: Date.now() };
      localStorage.setItem(JOIN_TICKET_KEY, JSON.stringify(t));
      setTicket(t);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  // Waiting: ask the booth until it lets this phone in or turns it away.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!ticket) return;
    let timer: ReturnType<typeof setTimeout>;
    const ask = async () => {
      try {
        const r = await realInvoke<{ status: JoinStatus; web_token?: string; session?: string; name?: string; id?: string; role?: string }>(
          "join_status",
          { session: ticket.session },
        );
        if (!alive.current) return;
        if (r.status === "ok" && r.web_token) {
          localStorage.setItem(CREW_SESSION_KEY, ticket.session);
          localStorage.setItem("prodeck.crewName", r.name ?? ticket.name);
          if (r.id) localStorage.setItem("prodeck.crewId", r.id);
          if (r.role) localStorage.setItem("prodeck.crewRole", r.role);
          localStorage.removeItem(JOIN_TICKET_KEY);
          setWebToken(r.web_token);
          window.location.replace("/");
          return;
        }
        if (r.status === "gone") {
          localStorage.removeItem(JOIN_TICKET_KEY);
          setGone(true);
          setTicket(null);
          return;
        }
      } catch {
        /* booth unreachable for a moment: keep waiting */
      }
      timer = setTimeout(ask, joinPollMs(Date.now() - ticket.at));
    };
    ask();
    return () => {
      alive.current = false;
      clearTimeout(timer);
    };
  }, [ticket]);

  return (
    <div className="web-login">
      <div className="web-login-card">
        <img className="login-lockup" src={lockupStacked} alt="ProDeck by White Oak Media" />
        {ticket ? (
          <>
            <h2 style={{ margin: "4px 0 0" }}>Thanks, {ticket.name.split(" ")[0]}</h2>
            <p className="muted">
              Ask whoever is at the production computer to approve you. They'll see your name under
              Crew Members. Keep this page open and you'll be let in as soon as they do.
            </p>
            <p className="muted small">Waiting for the booth…</p>
            <button
              className="btn ghost"
              onClick={() => {
                localStorage.removeItem(JOIN_TICKET_KEY);
                setTicket(null);
              }}
            >
              Start over
            </button>
          </>
        ) : (
          <form onSubmit={submit} style={{ display: "contents" }}>
            <h2 style={{ margin: "4px 0 0" }}>Join the crew</h2>
            {gone ? (
              <p className="muted">The booth didn't approve that request. Check with whoever is at the production computer, then try again.</p>
            ) : (
              <p className="muted">Your name and a PIN you'll remember. The booth approves you, then you're in.</p>
            )}
            <input
              id="join-name"
              className="input"
              placeholder="Your name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
            />
            <input
              id="join-pin"
              className="input"
              placeholder="4 digit PIN"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
            {err && <p className="error">{err}</p>}
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Ask to join"}
            </button>
          </form>
        )}
      </div>
      <BackToChurches />
    </div>
  );
}
