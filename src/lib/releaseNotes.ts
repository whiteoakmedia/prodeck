// Release notes by email: one optional ask, remembered for good.
//
// Shown at the end of first-run setup and in Settings → Software Update. A
// booth operator answers once: "Send me updates" or "No thanks", and ProDeck
// never asks again on that computer. The address goes to White Oak Media's
// ProDeck list (monthly release notes, unsubscribe in every email) and nowhere
// else: the endpoint can only add someone to that list.

export const SIGNUP_URL =
  "https://us-central1-white-oak-media-client-portal.cloudfunctions.net/prodeckSignup";
const KEY = "prodeck.releaseNotes";

export type OptInChoice = "subscribed" | "declined";

export function getChoice(store: Pick<Storage, "getItem"> = localStorage): OptInChoice | null {
  try {
    const v = store.getItem(KEY);
    return v === "subscribed" || v === "declined" ? v : null;
  } catch {
    return null;
  }
}

export function setChoice(choice: OptInChoice, store: Pick<Storage, "setItem"> = localStorage): void {
  try {
    store.setItem(KEY, choice);
  } catch {
    /* private mode or a locked profile: they may be asked again, nothing breaks */
  }
}

export const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

/** Post the address. Resolves to the message to show, or throws with one to show. */
export async function subscribe(email: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const addr = email.trim();
  if (!looksLikeEmail(addr)) throw new Error("That doesn't look like an email address.");
  let res: Response;
  try {
    res = await fetchImpl(SIGNUP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: addr, source: "prodeck-app" }),
    });
  } catch {
    throw new Error("Couldn't reach the signup just now. Check the internet connection and try again.");
  }
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
  if (!res.ok || !j.ok) throw new Error(j.error || "The signup didn't go through. Try again in a minute.");
  return j.message || "You're on the list.";
}
