import { useEffect, useState } from "react";
import { enablePush, pushState, type PushStatus } from "../lib/pushClient";
import { notifyStep, secureLink, SNOOZE_MS } from "../lib/notifyStep";
import { getWebToken } from "../lib/tauri";
import { useProDeck } from "../store";
import { IN_CREW_APP } from "../lib/crewApp";
import { secureBase } from "../lib/lanUrl";

// Onboarding's last step, on Home until page notifications are on
// (lib/notifyStep.ts says what to show for each state).

const SNOOZE_KEY = "prodeck.notifySnooze";
const isIos = () => typeof navigator !== "undefined" && /iP(hone|ad|od)/.test(navigator.userAgent);

export function CrewNotifyStep({ onShowInstall }: { onShowInstall: () => void }) {
  const { settings } = useProDeck();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [snoozedUntil, setSnoozedUntil] = useState(() => {
    try {
      return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) || 0;
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    let alive = true;
    const read = () => pushState().then((s) => alive && setStatus(s)).catch(() => {});
    read();
    // Coming back from the phone's Settings (allowed notifications there).
    const onVis = () => document.visibilityState === "visible" && read();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (!status) return null;
  const secureUrl = secureLink(secureBase(settings), getWebToken());
  const step = notifyStep(status, { ios: isIos(), secureUrl, snoozedUntil, now: Date.now(), app: IN_CREW_APP });
  if (!step) return null;

  const act = async () => {
    setErr("");
    if (step.action === "install") return onShowInstall();
    if (step.action === "secure") {
      location.href = secureUrl;
      return;
    }
    setBusy(true);
    try {
      const next = await enablePush();
      setStatus(next);
      if (next === "off") setErr("Notifications weren't allowed. Tap the button again and choose Allow.");
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="crew-card warn crew-notify-step" role="region" aria-label="Page notifications">
      <div className="crew-notify-title">{step.title}</div>
      <p className="crew-notify-body">{step.body}</p>
      {step.button && (
        <button className="crew-btn primary" disabled={busy} onClick={() => void act()}>
          {busy ? "Asking…" : step.button}
        </button>
      )}
      {err && <p className="crew-join-err">{err}</p>}
      <button
        className="crew-link"
        onClick={() => {
          const until = Date.now() + SNOOZE_MS;
          try {
            localStorage.setItem(SNOOZE_KEY, String(until));
          } catch {
            /* private window: hidden until the page reloads */
          }
          setSnoozedUntil(until);
        }}
      >
        Not now
      </button>
    </div>
  );
}
