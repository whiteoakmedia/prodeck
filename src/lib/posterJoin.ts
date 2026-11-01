// The green-room poster while joining is closed: a volunteer asks to join with
// a name and PIN, and waits for the booth to approve them (identity.rs
// ticket). Pure pieces live here so they can be tested.

/** Where a phone that asked to join keeps its place while it waits, so
 *  closing Safari and scanning again carries on rather than asking twice. */
export const JOIN_TICKET_KEY = "prodeck.joinTicket";

/** What's wrong with the form, or "" when it can be sent. */
export function joinFormProblem(name: string, pin: string): string {
  if (name.trim().replace(/\s+/g, " ").length < 2) return "Type your name.";
  if (!/^\d{4}$/.test(pin)) return "Choose a 4 digit PIN. You'll use it to sign in.";
  return "";
}

export type JoinStatus = "waiting" | "ok" | "gone";

/** How long to wait before asking the booth again: quick at first, while the
 *  person is likely standing next to whoever approves them, then easing off. */
export function joinPollMs(askedFor: number): number {
  if (askedFor < 120_000) return 3_000;
  if (askedFor < 15 * 60_000) return 10_000;
  return 30_000;
}
