// Links that open ProDeck Crew: a church's crew code
// (https://<name>-crew.prodeck.live/join, a universal link), or
// prodeckcrew://connect?to=<booth link or address>, prodeckcrew://demo,
// prodeckcrew://home. Pure, so it's tested without a phone.

export type LinkAction = { kind: "connect"; to: string } | { kind: "demo" } | { kind: "home" } | null;

export function readLink(url: string): LinkAction {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  // A crew code or crew link iOS handed the app (universal links): the
  // church's crew address /join, or a ?join= / ?invite= link. Only these are
  // claimed (crew-cloud/src/applinks.ts), and only on per church names.
  if (u.protocol === "https:") {
    const churchHost = /^[a-z0-9-]+-crew\.prodeck\.live$/.test(u.hostname) || /^[a-z0-9-]+\.local\.prodeck\.live$/.test(u.hostname);
    const claimed = u.pathname === "/join" || (u.pathname === "/" && (u.searchParams.has("join") || u.searchParams.has("invite")));
    return churchHost && claimed && !u.searchParams.has("web") ? { kind: "connect", to: u.toString() } : null;
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
