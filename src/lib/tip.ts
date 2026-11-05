// Support for White Oak Media, who give ProDeck away. Their public support
// page (it takes the donation itself), so the app holds no keys: it only
// opens a page in the browser.
//
// Booth computer only. Phone app stores require their own in-app payments for
// tips to a developer, so the crew app and phones never show it.

import { IS_DEMO } from "./demo";
import { IS_WEB } from "./tauri";

/** White Oak Media's support page. Empty = support links are hidden. */
export const TIP_URL = "https://www.whiteoakmedia.io/tools/support";

export function tipUrl(): string {
  if (TIP_URL) return TIP_URL;
  // The demo shows the button so it can be seen before the link exists.
  return IS_DEMO ? "https://buy.stripe.com/" : "";
}

export const showTips = (): boolean => !IS_WEB && !!tipUrl();
