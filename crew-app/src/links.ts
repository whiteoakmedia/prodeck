// Links that open ProDeck Crew: prodeckcrew://connect?to=<booth link or
// address>, prodeckcrew://demo, prodeckcrew://home. A church's poster or
// invite can later carry one, so a phone with the app installed goes straight
// in. Pure, so it's tested without a phone.

export type LinkAction = { kind: "connect"; to: string } | { kind: "demo" } | { kind: "home" } | null;

export function readLink(url: string): LinkAction {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "prodeckcrew:") return null;
  // prodeckcrew://connect?to=… parses with "connect" as the host.
  const what = (u.hostname || u.pathname.replace(/^\/+/, "")).toLowerCase();
  if (what === "demo") return { kind: "demo" };
  if (what === "home") return { kind: "home" };
  if (what === "connect") {
    const to = u.searchParams.get("to")?.trim();
    return to ? { kind: "connect", to } : null;
  }
  return null;
}
