import { useState } from "react";
import { IN_CREW_APP } from "../lib/crewApp";
import markColor from "../assets/prodeck-mark-color.svg";

// S01a / S01b — install onboarding.
//
// This screen exists for one reason: **iOS delivers no web push at all until
// the app is on the Home Screen.** Without it, a volunteer signs in, gets no
// pages all morning, and concludes the app is broken. Detect the platform and
// render ONE variant — never both, because showing an iPhone user Android
// instructions is how you lose them.

const isIos = () =>
  typeof navigator !== "undefined" &&
  /iP(hone|ad|od)/.test(navigator.userAgent) &&
  !("MSStream" in window);

export const isStandalone = () =>
  (typeof window !== "undefined" &&
    window.matchMedia?.("(display-mode: standalone)").matches) ||
  (typeof navigator !== "undefined" &&
    (navigator as unknown as { standalone?: boolean }).standalone === true);

const SEEN_KEY = "prodeck.installSeen";
/** Shown once per device; re-entry is via the link in More. */
export const shouldOnboard = () =>
  // The ProDeck Crew app is already installed: nothing to add to a Home Screen.
  !IN_CREW_APP && !isStandalone() && localStorage.getItem(SEEN_KEY) !== "1";

export function CrewOnboard({ onDone }: { onDone: () => void }) {
  const ios = isIos();
  // iOS: after "I've added it" the next move is to leave Safari for the Home
  // Screen copy (which now arrives signed in, lib/homeScreen.ts), not to carry
  // on here and sign in twice. Carrying on in Safari stays possible from there.
  const [added, setAdded] = useState(false);
  const ipad =
    /iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const [prompt, setPrompt] = useState<Event | null>(
    (window as unknown as { __pdInstallPrompt?: Event }).__pdInstallPrompt ?? null,
  );

  function dismiss() {
    localStorage.setItem(SEEN_KEY, "1");
    onDone();
  }

  const steps = ios
    ? [
        `Tocá Compartir (el cuadrado con una flecha, ${ipad ? "arriba a la derecha" : "abajo en Safari"})`,
        "Deslizá hacia abajo, elegí “Agregar a inicio” y tocá Agregar",
        "Abrí ProDeck desde la pantalla de inicio. Vas a ingresar allí una sola vez",
      ]
    : [
        // Only promise an Install button when the browser actually gave us
        // one (beforeinstallprompt) — otherwise point at the menu.
        prompt ? "Tocá Instalar abajo" : "Abrí el menú de Chrome (⋮) y elegí Agregar a pantalla principal",
        "Abrí ProDeck desde la pantalla de inicio",
        "Ingresá y activá las notificaciones cuando ProDeck lo solicite",
      ];

  if (ios && added) {
    return (
      <div className="crew-onboard">
        <img className="crew-mark" src={markColor} alt="" aria-hidden />
        <h1 className="crew-onboard-title">Ahora abrí ProDeck desde la pantalla de inicio</h1>
        <p className="crew-onboard-sub">
          Buscá el ícono de ProDeck y tocalo. Podés cerrar Safari: vas a ingresar y recibir avisos desde esa aplicación.
        </p>
        <button className="crew-link" onClick={dismiss}>
          No lo encuentro, continuar en Safari
        </button>
      </div>
    );
  }

  return (
    <div className="crew-onboard">
      <img className="crew-mark" src={markColor} alt="" aria-hidden />
      <h1 className="crew-onboard-title">
        {ios ? "Agregá ProDeck a la pantalla de inicio" : "Instalá ProDeck en este celular"}
      </h1>
      <p className="crew-onboard-sub">
        {ios
          ? "Solo tenés que hacerlo una vez. Safari no puede enviar avisos hasta que agregues ProDeck a la pantalla de inicio."
          : "Al instalar ProDeck, podés recibir avisos aunque la aplicación esté cerrada."}
      </p>

      <ol className="crew-steps">
        {steps.map((s, i) => (
          <li key={i} className="crew-step">
            <span className="crew-step-num">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>

      <div className="crew-caution">
        <span className="crew-dot" style={{ background: "var(--warn)" }} />
        <span>
          {ios
            ? "Las notificaciones permiten recibir avisos cuando guardás el celular. Sin ellas, ProDeck no te avisa."
            : "Si los avisos llegan tarde, permití que ProDeck funcione en segundo plano desde la configuración de batería."}
        </span>
      </div>

      {!ios && prompt && (
        <button
          className="crew-btn primary"
          onClick={async () => {
            // Android fires beforeinstallprompt; we stashed it on window.
            const p = prompt as unknown as { prompt: () => Promise<void> };
            await p.prompt().catch(() => {});
            setPrompt(null);
          }}
        >
          Instalar
        </button>
      )}
      {/* Exactly one way past this screen (plus Install when Android offers
          it) — two stacked skip actions read as a trick question. */}
      {!ios && prompt ? (
        <button className="crew-link" onClick={dismiss}>
          Omitir por ahora
        </button>
      ) : (
        <button className="crew-btn primary" onClick={ios ? () => setAdded(true) : dismiss}>
          {ios ? "Ya lo agregué" : "Continuar en el navegador"}
        </button>
      )}
    </div>
  );
}
