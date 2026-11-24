/**
 * What to tell the operator when a Planning Center LIVE action fails.
 *
 * It gets its own file because of one real failure: an operator whose
 * Planning Center login can't control Services Live for the plan. PCO answers
 * toggle_control with a 403 whose body is raw JSON ("User with id ... cannot
 * read AppGraph::...::LiveToggleControlAction"), and Follow ProPresenter let
 * that escape as an unhandled rejection on every slide change. That is their
 * Planning Center setup, not a bug, so say so in words they can act on.
 *
 * `pcoLiveAction` rejects with the raw Rust string ("PCO 403 Forbidden: ...");
 * `pcoGet` wraps errors in PcoError with the status beside the message. Both
 * shapes are recognised.
 */
import { PcoError } from "./tauri";

export const PCO_LIVE_FORBIDDEN_FOLLOW =
  "Your Planning Center login isn't allowed to control Services Live for this plan, so Follow can't move it. A Planning Center admin can raise your permission for this service type.";

export const PCO_LIVE_FORBIDDEN_BUTTON =
  "Your Planning Center login isn't allowed to control Services Live for this plan. A Planning Center admin can raise your permission for this service type.";

/** True when a LIVE failure is Planning Center refusing permission (403). */
export function isPcoLiveForbidden(e: unknown): boolean {
  if (e instanceof PcoError && e.status === 403) return true;
  const text = String((e as { message?: unknown })?.message ?? e ?? "");
  return /PCO[ /]403|Forbidden/i.test(text);
}

/**
 * The message to show for a failed LIVE action. `follow` is the Follow
 * ProPresenter path (taking control before stepping); `button` is the
 * widget's Next, Previous and Take control buttons.
 */
export function pcoLiveErrorMessage(e: unknown, from: "follow" | "button"): string {
  if (isPcoLiveForbidden(e)) {
    return from === "follow" ? PCO_LIVE_FORBIDDEN_FOLLOW : PCO_LIVE_FORBIDDEN_BUTTON;
  }
  if (from === "follow") {
    return `Couldn't take control of Planning Center Live, so Follow didn't move it. ${String(e)}`;
  }
  return String(e);
}
