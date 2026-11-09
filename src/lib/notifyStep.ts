// The last onboarding step, on Home until it's done: page notifications. Only
// 4 of 13 Cornerstone crew had them (2026-11-01) because the switch lived in
// More and nothing ever asked. Each state says exactly what to do next.

import type { PushStatus } from "./pushClient";

export type NotifyAction = "enable" | "install" | "secure" | "none";

export interface NotifyStep {
  title: string;
  body: string;
  action: NotifyAction;
  /** The button, when there is one. */
  button?: string;
  /** A one-time tip once everything is set up, dismissed with Got it rather
   *  than snoozed. */
  tip?: boolean;
}

/** Shown once on an iPhone after page notifications are on. On silent, iOS
 *  plays no sound for any app, and whether a page buzzes is the phone's own
 *  Haptics setting, which nothing in the app can change (first real page
 *  test, 2026-11-09: a page on silent was completely still). */
export const HAPTICS_TIP: NotifyStep = {
  title: "Feel pages on silent",
  body: "On silent, an iPhone only buzzes for a page if Haptics is set to Always Play. Open Settings, tap Sounds & Haptics, then Haptics, and choose Always Play.",
  action: "none",
  tip: true,
};

/** "Not now" hides the step for this long, then it asks again. */
export const SNOOZE_MS = 12 * 60 * 60 * 1000;

export function notifyStep(
  status: PushStatus,
  o: {
    ios: boolean;
    secureUrl: string;
    snoozedUntil: number;
    now: number;
    app?: boolean;
    choseOff?: boolean;
    /** The haptics tip was already dismissed on this phone. */
    hapticsTipSeen?: boolean;
  },
): NotifyStep | null {
  if (status === "on") return o.ios && !o.hapticsTipSeen ? HAPTICS_TIP : null;
  if (status === "unsupported") return null;
  // They turned pages off in More: that's an answer, not a step left to do.
  if (status === "off" && o.choseOff) return null;
  if (o.now < o.snoozedUntil) return null;
  switch (status) {
    case "off":
      return {
        title: "Last step: turn on page notifications",
        body: "Then a page from the booth buzzes your phone even when ProDeck is closed.",
        action: "enable",
        button: "Turn on notifications",
      };
    case "needs-install":
      return {
        title: "Add ProDeck to your Home Screen",
        body: "iPhones only deliver pages to ProDeck on the Home Screen: tap Share, then Add to Home Screen, then open ProDeck from there.",
        action: "install",
        button: "Show me how",
      };
    case "denied":
      // In the ProDeck Crew app the app checks again: the page can't.
      if (o.app)
        return {
          title: "Notifications are blocked",
          body: o.ios
            ? "Open the iPhone's Settings, tap Notifications, then ProDeck Crew, and turn on Allow Notifications. Then come back and tap Check again."
            : "Open your phone's Settings, find ProDeck Crew under Notifications, and allow them. Then come back and tap Check again.",
          action: "enable",
          button: "Check again",
        };
      return {
        title: "Notifications are blocked",
        body: o.ios
          ? "Open the iPhone's Settings, tap Notifications, then ProDeck, and turn on Allow Notifications. Then come back here."
          : "Open your phone's Settings, find ProDeck (or Chrome) under Notifications, and allow them. Then come back here.",
        action: "none",
      };
    case "insecure":
      return o.secureUrl
        ? {
            title: "Pages can't reach this phone from this address",
            body: "Notifications only work on the booth's secure address. Open it there, sign in with the same name and PIN, and add that one to your Home Screen.",
            action: "secure",
            button: "Open the secure address",
          }
        : {
            title: "Pages can't reach this phone from this address",
            body: "Notifications only work on a secure (https) address. Ask at the booth for it.",
            action: "none",
          };
  }
  return null;
}

/** The secure address, carrying this browser's sign-in so it isn't asked for again. */
export function secureLink(publicUrl: string, token: string): string {
  const base = publicUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base)) return "";
  return token ? `${base}/?join=${encodeURIComponent(token)}` : `${base}/`;
}
