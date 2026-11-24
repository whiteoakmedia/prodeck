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
        `Tap the Share button (the square with an arrow, ${ipad ? "at the top right" : "at the bottom of Safari"})`,
        "Scroll down, choose “Add to Home Screen”, then tap Add",
        "Open ProDeck from your Home Screen. You'll sign in there, once",
      ]
    : [
        // Only promise an Install button when the browser actually gave us
        // one (beforeinstallprompt) — otherwise point at the menu.
        prompt ? "Tap Install below" : "Open the Chrome menu (⋮), then Add to Home screen",
        "Open ProDeck from your home screen",
        "Sign in, then turn on notifications when ProDeck asks",
      ];

  if (ios && added) {
    return (
      <div className="crew-onboard">
        <img className="crew-mark" src={markColor} alt="" aria-hidden />
        <h1 className="crew-onboard-title">Now open ProDeck from your Home Screen</h1>
        <p className="crew-onboard-sub">
          Find the ProDeck icon and tap it. You can close Safari: you'll sign in and get pages in that copy.
        </p>
        <button className="crew-link" onClick={dismiss}>
          I don't see it, keep going in Safari
        </button>
      </div>
    );
  }

  return (
    <div className="crew-onboard">
      <img className="crew-mark" src={markColor} alt="" aria-hidden />
      <h1 className="crew-onboard-title">
        {ios ? "Add ProDeck to your Home Screen" : "Install ProDeck on this phone"}
      </h1>
      <p className="crew-onboard-sub">
        {ios
          ? "Three taps, once. Safari can't send you pages until ProDeck lives on your Home Screen."
          : "Installing lets ProDeck reach you when the app is closed."}
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
            ? "Notifications are how pages reach you when your phone is in your pocket. Without them ProDeck is silent."
            : "If pages seem to arrive late, allow ProDeck to run in the background in your battery settings."}
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
          Install
        </button>
      )}
      {/* Exactly one way past this screen (plus Install when Android offers
          it) — two stacked skip actions read as a trick question. */}
      {!ios && prompt ? (
        <button className="crew-link" onClick={dismiss}>
          Skip for now
        </button>
      ) : (
        <button className="crew-btn primary" onClick={ios ? () => setAdded(true) : dismiss}>
          {ios ? "I've added it" : "Continue in the browser"}
        </button>
      )}
    </div>
  );
}
