// The line under a song in the crew setlists.

/**
 * "Maria leads" under a song. The leader often comes from the item's PCO
 * description, which may already say it ("Maria lead", "led by Josh"), and
 * then it's shown as written rather than as "Maria lead leads".
 */
export function leaderLine(leader: string): string {
  const l = leader.trim();
  if (!l) return "";
  return /\b(lead|leads|leading|led)\b/i.test(l) ? l : `${l} leads`;
}
