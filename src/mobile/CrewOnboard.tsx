import { useState } from "react";
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
  !isStandalone() && localStorage.getItem(SEEN_KEY) !== "1";

export function CrewOnboard({ onDone }: { onDone: () => void }) {
  const ios = isIos();
  const [prompt, setPrompt] = useState<Event | null>(
    (window as unknown as { __pdInstallPrompt?: Event }).__pdInstallPrompt ?? null,
  );

  function dismiss() {
    localStorage.setItem(SEEN_KEY, "1");
    onDone();
  }

  const steps = ios
    ? [
        "Tap the Share button in Safari",
        "Choose “Add to Home Screen”",
        "Open ProDeck from your Home Screen and allow Notifications",
      ]
    : [
        // Only promise an Install button when the browser actually gave us
        // one (beforeinstallprompt) — otherwise point at the menu.
        prompt ? "Tap Install below" : "Open the Chrome menu (⋮) → Add to Home screen",
        "Open ProDeck from your app drawer",
        "Allow Notifications when asked",
      ];

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
        <button className="crew-btn primary" onClick={dismiss}>
          {ios ? "I've added it — continue" : "Continue in the browser"}
        </button>
      )}
    </div>
  );
}
