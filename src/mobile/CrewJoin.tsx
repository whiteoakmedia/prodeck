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
          setErr(`Ya existe una cuenta con el nombre ${name.trim()}. Si es tuya, ingresá tu PIN. Si no, tocá Soy nuevo y agregá la inicial de tu apellido.`);
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
        setErr(`No hay una cuenta llamada ${name.trim()} en Control. Revisá cómo escribiste tu nombre o solicitá el ingreso.`);
        setPin("");
        return;
      }
      if (/no such name|register first/i.test(msg)) {
        chat.forgetDevice();
        setName("");
        setPin("");
        setErr("Esa cuenta ya no existe en Control. Solicitá el ingreso nuevamente abajo.");
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
              Esperando a Control
            </span>
          </div>
          <p className="crew-wait-title">Listo. Esperando la aprobación de Control</p>
          <p className="crew-wait-body">
            {pendingAt ? `Solicitud enviada a las ${pendingAt}. ` : ""}
            {canPoll
              ? "Esta pantalla comprueba la aprobación cada pocos segundos y te permite ingresar apenas te aprueben. Dejala abierta."
              : "Ingresá tu PIN abajo para comprobar si te aprobaron."}
          </p>
        </div>
        <p className="crew-join-help">
          Desde Control se puede aprobar en <strong>Configuración → Integrantes del equipo → Aprobar</strong>.
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
              {busy ? "Comprobando…" : "Comprobar ahora"}
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
          ? `Te damos la bienvenida, ${chat.name}`
          : mode === "signin"
            ? "Ingresar"
            : inviteReady
            ? `Ya falta poco, ${name.split(" ")[0]}`
            : "Sumate al equipo"}
      </h1>

      {mode !== "unlock" && !invite && (
        <div className="crew-seg crew-join-seg" role="tablist" aria-label="Cuenta nueva o existente">
          {(
            [
              ["register", "Soy nuevo"],
              ["signin", "Ya tengo cuenta"],
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
          Tenés una invitación{role ? ` como ${role}` : ""} y tu acceso ya está aprobado.
          Elegí un PIN de 4 dígitos abajo para ingresar.
        </p>
      )}
      {mode === "register" && invite && !inviteReady && (
        <p className="crew-join-help">Comprobando tu invitación…</p>
      )}

      {mode !== "unlock" && !invite && (
        <>
          {roster.length > 0 && (
            <>
              <p className="crew-join-help">
                {mode === "signin" ? "Tocá tu nombre o escribilo abajo" : "Tocá tu nombre en el plan de esta semana"}
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
                      <span className="mono-data crew-recip-seen">{m.position || "Sin puesto"}</span>
                    </button>
                  );
                })}
              </div>
              {mode === "register" && <p className="crew-join-help">o escribilo</p>}
            </>
          )}
          <input
            className="crew-input"
            placeholder="Tu nombre"
            value={name}
            autoCapitalize="words"
            onChange={(e) => {
              setName(e.target.value);
              setRole(""); // typed by hand → no position to claim
            }}
          />
          {role && mode === "register" && (
            <p className="crew-join-help">
              Rol: <strong>{role}</strong>
            </p>
          )}
        </>
      )}

      <PinDots pin={pin} />
      <p className="crew-join-help">
        {mode === "unlock" || mode === "signin"
          ? "Ingresá tu PIN de 4 dígitos"
          : "Elegí un PIN de 4 dígitos. Lo vas a usar para ingresar desde este celular"}
      </p>

      <Keypad
        onPress={press}
        onBack={() => setPin((p) => p.slice(0, -1))}
        extra={
          mode === "unlock" ? (
            <button className="crew-key ghost" onClick={() => setForgot((v) => !v)}>
              Olvidé mi PIN
            </button>
          ) : null
        }
      />

      {forgot && (
        <>
          <p className="crew-join-help">
            Pedí en Control que restablezcan tu acceso en <strong>Configuración → Equipo</strong> y solicitá el ingreso nuevamente.
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
            Usar otro nombre
          </button>
        </>
      )}

      {mode === "register" && (
        <button
          className="crew-btn primary"
          disabled={busy || pin.length !== 4 || !name.trim()}
          onClick={() => submit(pin)}
        >
          {busy ? "Enviando…" : "Confirmar PIN"}
        </button>
      )}
      {/* Sign in goes by itself on the 4th digit once there's a name. Typed
          the other way round (PIN first), this is the way to finish. */}
      {mode === "signin" && pin.length === 4 && name.trim() && !busy && (
        <button className="crew-btn primary" onClick={() => submit(pin)}>
          Ingresar
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
      <button className="crew-key ghost" onClick={onBack} aria-label="Borrar">
        ⌫
      </button>
    </div>
  );
}
