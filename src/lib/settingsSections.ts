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
    label: "Conexiones",
    blurb: "ProPresenter, consola de sonido, OBS y señales de cámara.",
    cards: ["set-connections", "set-pp", "set-avantis", "set-obs", "set-atem", "set-ndi", "set-relay"],
  },
  {
    id: "sound",
    label: "Sonido",
    blurb: "Audio que recibe ProDeck, grabación, tonalidades y música de entrada.",
    cards: ["set-audio", "set-recorder", "set-songkey", "set-music", "set-alerts"],
  },
  {
    id: "automation",
    label: "Automatización",
    blurb: "Seguimiento de la letra, mezcla de la banda, micrófonos de voz y acciones de botones.",
    cards: ["set-gemini", "set-automix", "set-autopilot", "set-inputs"],
  },
  {
    id: "online",
    label: "En línea",
    blurb: "Church Online, audiencia en vivo y discos de donaciones TapLink.",
    cards: ["set-chop", "set-ga4", "set-taplink"],
  },
  {
    id: "crew",
    label: "Equipo y pantallas",
    blurb: "Cuentas del equipo, avisos programados, celulares, pantallas públicas, Tally y comunicaciones.",
    cards: ["set-crew", "set-schedule", "set-web", "set-local", "set-crewaddr", "set-kiosk", "set-tv", "set-tally", "set-comms"],
  },
  {
    id: "app",
    label: "Aplicación y ayuda",
    blurb: "Actualizaciones, ayuda, resolución de problemas, copias de seguridad y apariencia de ProDeck.",
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
