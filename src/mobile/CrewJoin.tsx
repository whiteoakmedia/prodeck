import { BackToChurches } from "../components/BackToChurches";
import { useEffect, useState } from "react";
import { useChat } from "../chatStore";
import { productionRoster, usePco } from "../pcoStore";
import { INVITE_KEY, IS_SHOTS, SHOT_TAB, inviteInfo } from "../lib/tauri";

// S02a / S02b — join, PIN, waiting for approval (design/mobile/README.md).
//
// The keypad is deliberately NOT a text input: no keyboard animation, bigger
// targets, and it works with a phone at hip height. Unlock submits on the 4th
// digit; first-run registration needs an explicit Confirm because a typo there
// creates an account nobody can sign into.
//
// The spec wants name and role pre-filled from the Planning Center roster. We
// can't know who is holding a phone, so first run offers THIS WEEK'S SCHEDULED
// TEAM as a pick-list: tap your name and your PCO position becomes your role.
// That's the spec's intent, and it also keeps roles honest — typed-by-hand roles
// drifted into things like "ADMIN" and people's nicknames, which made the
// leader board and role filters meaningless.

const PENDING_AT_KEY = "prodeck.crewPendingAt";

export function CrewJoin() {
  const chat = useChat();
  // A stored name means this device has registered before → unlock, not signup.
  // (The demo's ?tab=join shows a phone that's never joined.)
  const returning = !!chat.name && !(IS_SHOTS && SHOT_TAB === "join");
  const [name, setName] = useState(returning ? chat.name : "");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  // "Already have an account?": name + PIN for an account made on another
  // phone, in a browser, or before this phone was reset. Joining with your
  // own name and PIN also signed you in, but nothing said so.
  const [signIn, setSignIn] = useState(false);
  // Position picked off the plan, sent with registration.
  const [role, setRole] = useState("");
  const pco = usePco();
  // Production only — the plan also lists the worship band, who have no booth
  // accounts and would bury the handful of people who do.
  const roster = productionRoster(pco.team);
  const [pendingAt] = useState(() => localStorage.getItem(PENDING_AT_KEY));

  // Personal invite (?invite= link): name + role come from the invite, the
  // account arrives pre-approved, and this screen collapses to "pick a PIN".
  const [invite, setInvite] = useState(() => localStorage.getItem(INVITE_KEY) ?? "");
  const [inviteReady, setInviteReady] = useState(false);
  useEffect(() => {
    if (!invite) return;
    inviteInfo(invite)
      .then((i) => {
        setName(i.name);
        setRole(i.role);
        setInviteReady(true);
      })
      .catch(() => {
        // Used or expired — drop back to the normal join flow.
        localStorage.removeItem(INVITE_KEY);
        setInvite("");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite]);

  const mode: "unlock" | "register" | "signin" = returning && !invite ? "unlock" : signIn ? "signin" : "register";

  async function submit(p: string) {
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      if (mode === "register") {
        try {
          await chat.register(name.trim(), p, role, invite);
        } catch (e) {
          // The name is someone's already. It used to try this new PIN as a
          // sign in to that account, which counted against their lockout and,
          // if two people chose the same PIN, signed a newcomer in as someone
          // else. Now it asks: their account, or a different name.
          if (!/is taken/i.test(String(e))) throw e;
          setSignIn(true);
          setPin("");
          setErr(`Someone here already uses the name ${name.trim()}. If that's you, type your PIN to sign in. If not, tap I'm new and add your last initial.`);
          return;
        }
        if (invite) localStorage.removeItem(INVITE_KEY); // claimed
        localStorage.setItem(
          PENDING_AT_KEY,
          new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        );
      } else if (mode === "signin") {
        await chat.login(name.trim(), p);
      } else {
        await chat.login(chat.name, p);
      }
    } catch (e) {
      const msg = String(e);
      // The booth no longer has this name — the account was deleted or renamed
      // at the booth. Without this the device is stranded: it stays in unlock
      // mode forever, asking for the PIN of an account that doesn't exist.
      if (mode === "signin" && /no such name|register first/i.test(msg)) {
        setErr(`No account called ${name.trim()} at this booth. Check the spelling, or join instead.`);
        setPin("");
        return;
      }
      if (/no such name|register first/i.test(msg)) {
        chat.forgetDevice();
        setName("");
        setPin("");
        setErr("That account no longer exists at the booth. Join again below.");
        return;
      }
      setErr(msg);
      setPin(""); // wrong PIN clears the dots rather than leaving a half-entry
    } finally {
      setBusy(false);
    }
  }

  // Unlock (and sign in, once there's a name) fires the moment the 4th digit
  // lands: no confirm button.
  useEffect(() => {
    if ((mode === "unlock" || (mode === "signin" && name.trim())) && pin.length === 4) submit(pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, mode]);

  // Registration keeps the roster + name field above the keypad, which can
  // push Confirm below the fold on small phones — bring it into view the
  // moment the 4th digit lands.
  useEffect(() => {
    if (mode === "register" && pin.length === 4)
      document
        .querySelector(".crew-join .crew-btn.primary")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [pin, mode]);

  // While waiting for approval, poll with the PIN still held in memory (it is
  // never persisted): login on an unapproved account returns "pending" without
  // counting toward lockout, and flips to a real session the moment the booth
  // approves — no push, no manual re-entry. After a reload the PIN is gone and
  // the keypad below is the fallback.
  const canPoll = chat.auth === "pending" && pin.length === 4;
  useEffect(() => {
    if (!canPoll) return;
    const id = setInterval(() => {
      chat.login(chat.name || name, pin).catch(() => {});
    }, 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPoll]);

  function press(d: string) {
    setErr("");
    setPin((p) => (p.length >= 4 ? p : p + d));
  }

  if (chat.auth === "pending") {
    return (
      <div className="crew-join">
        <div className="crew-wait edge-warn">
          <div className="crew-wait-head">
            <span className="pulse-dot" style={{ background: "var(--warn)" }} />
            <span className="mono" style={{ color: "var(--warn)" }}>
              Waiting for booth
            </span>
          </div>
          <p className="crew-wait-title">You're all set. Waiting for the booth</p>
          <p className="crew-wait-body">
            {pendingAt ? `Requested ${pendingAt}. ` : ""}
            {canPoll
              ? "This screen checks every few seconds and signs you in the moment you're approved. Keep it open."
              : "Enter your PIN below to check whether you've been approved."}
          </p>
        </div>
        <p className="crew-join-help">
          At the booth it's one tap: <strong>Settings → Crew Members → Approve</strong>.
        </p>
        {!canPoll && (
          <>
            <PinDots pin={pin} />
            <Keypad
              onPress={press}
              onBack={() => setPin((p) => p.slice(0, -1))}
              extra={null}
            />
            <button
              className="crew-btn primary"
              disabled={busy || pin.length !== 4}
              onClick={() => submit(pin)}
            >
              {busy ? "Checking…" : "Check now"}
            </button>
          </>
        )}
        {err && <p className="crew-join-err">{err}</p>}
      </div>
    );
  }

  return (
    <div className="crew-join">
      <h1 className="crew-join-title">
        {mode === "unlock"
          ? `Welcome back, ${chat.name}`
          : mode === "signin"
            ? "Sign in"
            : inviteReady
            ? `Almost there, ${name.split(" ")[0]}!`
            : "Join the crew"}
      </h1>

      {mode !== "unlock" && !invite && (
        <div className="crew-seg crew-join-seg" role="tablist" aria-label="New or returning">
          {(
            [
              ["register", "I'm new"],
              ["signin", "I have an account"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={`crew-seg-btn ${mode === m ? "on" : ""}`}
              onClick={() => {
                setSignIn(m === "signin");
                setPin("");
                setErr("");
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {mode === "register" && inviteReady && (
        <p className="crew-join-help">
          You're invited{role ? ` as ${role}` : ""} and already approved. Just
          pick a 4-digit PIN below and you're in.
        </p>
      )}
      {mode === "register" && invite && !inviteReady && (
        <p className="crew-join-help">Checking your invite…</p>
      )}

      {mode !== "unlock" && !invite && (
        <>
          {roster.length > 0 && (
            <>
              <p className="crew-join-help">
                {mode === "signin" ? "Tap your name, or type it below" : "Tap your name on this week's plan"}
              </p>
              <div className="crew-roster">
                {roster.map((m) => {
                  const on = name.trim().toLowerCase() === m.name.trim().toLowerCase();
                  return (
                    <button
                      key={m.id}
                      className={`crew-roster-row ${on ? "on" : ""}`}
                      onClick={() => {
                        setName(m.name);
                        setRole(m.position || "");
                      }}
                    >
                      <span className="crew-recip-name">{m.name}</span>
                      <span className="mono-data crew-recip-seen">{m.position || "No position"}</span>
                    </button>
                  );
                })}
              </div>
              {mode === "register" && <p className="crew-join-help">or type it</p>}
            </>
          )}
          <input
            className="crew-input"
            placeholder="Your name"
            value={name}
            autoCapitalize="words"
            onChange={(e) => {
              setName(e.target.value);
              setRole(""); // typed by hand → no position to claim
            }}
          />
          {role && mode === "register" && (
            <p className="crew-join-help">
              Role: <strong>{role}</strong>
            </p>
          )}
        </>
      )}

      <PinDots pin={pin} />
      <p className="crew-join-help">
        {mode === "unlock" || mode === "signin"
          ? "Enter your 4-digit PIN"
          : "Pick a 4 digit PIN. You'll use it to unlock on this phone"}
      </p>

      <Keypad
        onPress={press}
        onBack={() => setPin((p) => p.slice(0, -1))}
        extra={
          mode === "unlock" ? (
            <button className="crew-key ghost" onClick={() => setForgot((v) => !v)}>
              Forgot
            </button>
          ) : null
        }
      />

      {forgot && (
        <>
          <p className="crew-join-help">
            Ask the booth to reset you under <strong>Settings → Crew</strong>, then join again.
          </p>
          <button
            className="crew-link"
            onClick={() => {
              chat.forgetDevice();
              setName("");
              setPin("");
              setErr("");
              setForgot(false);
            }}
          >
            Use a different name
          </button>
        </>
      )}

      {mode === "register" && (
        <button
          className="crew-btn primary"
          disabled={busy || pin.length !== 4 || !name.trim()}
          onClick={() => submit(pin)}
        >
          {busy ? "Sending…" : "Confirm PIN"}
        </button>
      )}
      {/* Sign in goes by itself on the 4th digit once there's a name. Typed
          the other way round (PIN first), this is the way to finish. */}
      {mode === "signin" && pin.length === 4 && name.trim() && !busy && (
        <button className="crew-btn primary" onClick={() => submit(pin)}>
          Sign in
        </button>
      )}

      {err && <p className="crew-join-err">{err}</p>}
      <BackToChurches />
    </div>
  );
}

function PinDots({ pin }: { pin: string }) {
  return (
    <div className="crew-pin">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={`crew-pin-dot ${i < pin.length ? "filled" : ""}`} />
      ))}
    </div>
  );
}

function Keypad({
  onPress,
  onBack,
  extra,
}: {
  onPress: (d: string) => void;
  onBack: () => void;
  extra: React.ReactNode;
}) {
  return (
    <div className="crew-keypad">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <button key={d} className="crew-key" onClick={() => onPress(d)}>
          {d}
        </button>
      ))}
      {/* Bottom-left cell: "Forgot" on unlock, empty on first run. */}
      {extra ?? <span />}
      <button className="crew-key" onClick={() => onPress("0")}>
        0
      </button>
      <button className="crew-key ghost" onClick={onBack} aria-label="Delete">
        ⌫
      </button>
    </div>
  );
}
