import type { Settings } from "./tauri";

/**
 * Shared first-run logic. Two places decide "is this a fresh install?" (the
 * onboarding gate and the open-on-Setup route); they must agree, and they
 * must not key on a field that has a non-empty default.
 *
 * `pp_host` defaults to "localhost", so testing it for emptiness never
 * detected a fresh install. `pp_auto_connect` is false until ProPresenter has
 * actually connected once, which is the signal we want.
 */
export function isFreshInstall(s: Settings): boolean {
  return !s.pp_auto_connect && !s.pco_app_id && !s.web_enabled;
}

const DONE_KEY = "prodeck.setupDone";

export function readSetupDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSetupDone(done: boolean) {
  try {
    if (done) localStorage.setItem(DONE_KEY, "1");
    else localStorage.removeItem(DONE_KEY);
  } catch {
    /* storage unavailable — the onboarding just shows again next launch */
  }
}

/** Imperative re-open, so "Re-run the walkthrough" actually re-runs it. */
export const ONBOARDING_EVENT = "prodeck:onboarding";
export function requestOnboarding() {
  writeSetupDone(false);
  window.dispatchEvent(new Event(ONBOARDING_EVENT));
}
