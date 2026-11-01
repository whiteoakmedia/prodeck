// The TVs that have checked in with this booth (tv.rs), as Settings lists them.

export interface TvScreen {
  id: string;
  name: string;
  ip: string;
  /** ProDeck Display version (Android versionCode). */
  app: number;
  /** The dashboard it shows, "Camera tally board", or "". */
  showing: string;
  online: boolean;
  seenSecs: number;
  outdated: boolean;
  canInstall: boolean;
  updateAsked: boolean;
  /** What the TV says about an update in progress. */
  note: string;
}

/** One short status for a TV's row: what it is doing, and whether it needs you. */
export function tvStatus(s: TvScreen): { text: string; tone: "ok" | "warn" | "off" } {
  if (!s.online) return { text: `Off, last seen ${ago(s.seenSecs)}`, tone: "off" };
  if (s.note) return { text: s.note, tone: "warn" };
  if (s.updateAsked) return { text: "Update asked for. The TV starts it within a minute", tone: "warn" };
  if (s.outdated) return { text: `Update ready (it has version ${s.app})`, tone: "warn" };
  return { text: `Up to date, version ${s.app}`, tone: "ok" };
}

function ago(secs: number): string {
  if (secs < 120) return "a minute ago";
  if (secs < 3600) return `${Math.round(secs / 60)} minutes ago`;
  const h = Math.round(secs / 3600);
  return h === 1 ? "an hour ago" : `${h} hours ago`;
}
