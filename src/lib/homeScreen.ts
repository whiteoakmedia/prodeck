// The crew app's Home Screen copy (Share, Add to Home Screen) starts at the
// address in the page's manifest. On an iPhone that copy keeps its own
// storage, separate from Safari's, so a volunteer who joined from the poster
// in Safari used to open it to a password prompt they were never given. While
// signed in, the page points at the booth's /app.webmanifest instead, whose
// start carries this browser's sign-in (web.rs app_manifest; applied on the
// copy's first launch only, lib/tauri.ts).

import { CREW_SESSION_KEY, INVITE_KEY, IS_WEB, getWebToken } from "./tauri";

/** The manifest address for this browser's current sign-in. */
export function homeScreenManifestHref(token: string, invite: string, signedIn: boolean): string {
  if (!token) return "/manifest.json";
  let href = `/app.webmanifest?hs=${encodeURIComponent(token)}`;
  // A personal invite not yet claimed travels too, so the copy can finish it.
  if (invite && !signedIn) href += `&hsi=${encodeURIComponent(invite)}`;
  return href;
}

export function syncHomeScreenManifest() {
  if (!IS_WEB || typeof document === "undefined") return;
  let invite = "";
  let signedIn = false;
  try {
    invite = localStorage.getItem(INVITE_KEY) ?? "";
    signedIn = !!localStorage.getItem(CREW_SESSION_KEY);
  } catch {
    /* private window */
  }
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "manifest";
    document.head.appendChild(link);
  }
  const href = homeScreenManifestHref(getWebToken(), invite, signedIn);
  if (link.getAttribute("href") !== href) link.href = href;
}
