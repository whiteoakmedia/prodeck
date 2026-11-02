// Running inside the ProDeck Crew phone app (crew-app/, design/CREW_APP.md)?
// The app adds "ProDeckCrew/<version>" to the web view's user agent. Inside
// it there's no Home Screen to add to and no browser to switch, and the
// churches list is one tap away.

export const IN_CREW_APP: boolean = typeof navigator !== "undefined" && /\bProDeckCrew\//.test(navigator.userAgent);

/** The app's own churches screen: its local page, which is a different address on iOS and Android. */
export function crewAppHome(ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): string {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /\bProDeckCrew\//.test(ua));
  return `${ios ? "capacitor://localhost" : "https://localhost"}/?home=1`;
}
