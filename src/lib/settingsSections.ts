// How the Settings page is organised: a few sections down the side, each
// holding the cards that belong together, so it's one screen at a time
// instead of twenty-eight cards in one scroll. Every card keeps its old
// anchor id (set-…), which is how the rest of the app links straight to one.

export interface SettingsSection {
  id: string;
  label: string;
  /** One line under the heading: what lives here. */
  blurb: string;
  /** Card anchor ids, in the order they appear. */
  cards: string[];
}

export const SECTIONS: SettingsSection[] = [
  {
    id: "connections",
    label: "Connections",
    blurb: "ProPresenter, your sound console, OBS and camera feeds.",
    cards: ["set-connections", "set-pp", "set-avantis", "set-obs", "set-atem", "set-ndi", "set-relay"],
  },
  {
    id: "sound",
    label: "Sound",
    blurb: "What ProDeck listens to, recording, song keys and walk-in music.",
    cards: ["set-audio", "set-recorder", "set-songkey", "set-music", "set-alerts"],
  },
  {
    id: "automation",
    label: "Automation",
    blurb: "Things ProDeck can do for you: follow the lyrics, mix the band, ride the speech mics, react to buttons.",
    cards: ["set-gemini", "set-automix", "set-autopilot", "set-inputs"],
  },
  {
    id: "online",
    label: "Online",
    blurb: "Church Online, live viewer counts and TapLink giving discs.",
    cards: ["set-chop", "set-ga4", "set-taplink"],
  },
  {
    id: "crew",
    label: "Crew & screens",
    blurb: "Crew accounts, scheduled pages, phones and kiosks.",
    cards: ["set-crew", "set-schedule", "set-web", "set-kiosk"],
  },
  {
    id: "app",
    label: "App & help",
    blurb: "Updates, help, the troubleshooter, backups and how ProDeck looks.",
    cards: ["set-update", "set-help", "set-assist", "set-reliability", "set-backup", "set-appearance"],
  },
];

const OF: Record<string, string> = Object.fromEntries(SECTIONS.flatMap((s) => s.cards.map((c) => [c, s.id])));

/** The section a card belongs to (anything unlisted goes under App & help). */
export const sectionOf = (cardId: string): string => OF[cardId] ?? "app";

/**
 * Does a card match what was typed? Every word has to appear somewhere in the
 * card (its title, labels, hints, options), in any order, ignoring case.
 */
export function cardMatches(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = text.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Unsaved edits: the form differs from what's saved. */
export function isDirty(form: unknown, saved: unknown): boolean {
  if (!form || !saved) return false;
  return JSON.stringify(form) !== JSON.stringify(saved);
}
