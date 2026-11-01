// Who a page will actually reach. A page buzzes a locked phone only when that
// person turned notifications on; everyone else sees it the next time they
// open ProDeck. The composer says so before you send, rather than leaving the
// sender wondering why nobody came.

export interface ReachUser {
  id: string;
  name: string;
  nickname?: string;
  /** Undefined = an older booth that doesn't say. */
  notify?: boolean;
}

export interface Reach {
  /** Will feel it on a locked phone. */
  buzzed: number;
  /** Only see it with ProDeck open, by display name. */
  quiet: string[];
  /** The booth didn't say (older ProDeck): no line is shown. */
  unknown: boolean;
}

export function pageReach(users: ReachUser[], ids: string[]): Reach {
  const picked = users.filter((u) => ids.includes(u.id));
  if (picked.some((u) => u.notify === undefined)) return { buzzed: 0, quiet: [], unknown: true };
  const quiet = picked.filter((u) => !u.notify).map((u) => u.nickname || u.name);
  return { buzzed: picked.length - quiet.length, quiet, unknown: false };
}

/** One plain line for under the Send button, or "" for nothing to say. */
export function reachLine(r: Reach): string {
  if (r.unknown || r.quiet.length === 0) return "";
  const names = r.quiet.length <= 3 ? r.quiet.join(", ") : `${r.quiet.slice(0, 3).join(", ")} and ${r.quiet.length - 3} more`;
  const verb = r.quiet.length === 1 ? "hasn't" : "haven't";
  return `${names} ${verb} turned on notifications, so they'll only see this with ProDeck open.`;
}
