// Messages to kiosks and TV screens ("Five minutes to stage" on the green
// room TV). Sent from Messages with the destination set to a screen; chat.rs
// files them under "screen:all" or "screen:<dashboard name>".

/** How long a message stays up on a screen unless it's cleared sooner. */
export const SCREEN_HOLD_MS = 3 * 60_000;

/** Is this channel meant for a screen showing `dashboard`? */
export function forThisScreen(channel: string, dashboard: string): boolean {
  const which = channel.startsWith("screen:") ? channel.slice(7).trim() : "";
  if (!which) return false;
  return which.toLowerCase() === "all" || which.toLowerCase() === dashboard.trim().toLowerCase();
}

/** The destination picker's value for a screen, and back. */
export const screenChannel = (dashboard: string | null) => `screen:${dashboard ?? "all"}`;
