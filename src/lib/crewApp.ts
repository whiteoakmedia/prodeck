// Running inside the ProDeck Crew phone app (crew-app/, design/CREW_APP.md)?
// The app adds "ProDeckCrew/<version>" to the web view's user agent. Inside
// it there's no Home Screen to add to and no browser to switch, and the
// churches list is one tap away.

export const IN_CREW_APP: boolean = typeof navigator !== "undefined" && /\bProDeckCrew\//.test(navigator.userAgent);

const APP_PUSH_KEY = "prodeck.appPush";

/**
 * What the app said about page notifications as it opened this page
 * (crew-app/src/native.ts pushToken): "apns:<token>", "denied", "prompt", or
 * "" when it said nothing (Android for now, or an older app). It comes in
 * the address's #crewpush= and is kept, so a reload still knows.
 */
export function readAppPush(hash: string, saved: string): { value: string; rest: string } {
  const m = /(^#|&)crewpush=([^&]*)/.exec(hash);
  if (!m) return { value: saved, rest: hash };
  let rest = hash.slice(0, m.index) + hash.slice(m.index + m[0].length);
  if (m[1] === "#") rest = rest ? `#${rest.replace(/^&/, "")}` : "";
  let value = "";
  try {
    value = decodeURIComponent(m[2]);
  } catch {
    /* mangled: as if nothing was said */
  }
  return { value: /^(apns:[0-9a-f]{64,200}|denied|prompt)$/i.test(value) ? value : "", rest };
}

export const appPush: string = (() => {
  if (!IN_CREW_APP || typeof location === "undefined") return "";
  let saved = "";
  try {
    saved = localStorage.getItem(APP_PUSH_KEY) ?? "";
  } catch {
    /* private storage */
  }
  const { value, rest } = readAppPush(location.hash, saved);
  if (rest !== location.hash) history.replaceState(null, "", location.pathname + location.search + rest);
  try {
    localStorage.setItem(APP_PUSH_KEY, value);
  } catch {
    /* private storage */
  }
  return value;
})();

/**
 * The app's own page: its local address, which is different on iOS and
 * Android. ?home=1 is the churches screen; ?notify=1 asks the phone for
 * notifications and comes straight back to this church.
 */
export function crewAppHome(
  ua: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
  to: "home" | "notify" = "home",
): string {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /\bProDeckCrew\//.test(ua));
  return `${ios ? "capacitor://localhost" : "https://localhost"}/?${to}=1`;
}
