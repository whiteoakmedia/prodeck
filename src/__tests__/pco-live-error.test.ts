import { describe, expect, it } from "vitest";
import { PcoError } from "../lib/tauri";
import {
  isPcoLiveForbidden,
  pcoLiveErrorMessage,
  PCO_LIVE_FORBIDDEN_BUTTON,
  PCO_LIVE_FORBIDDEN_FOLLOW,
} from "../lib/pcoLiveError";

/**
 * Planning Center LIVE failures, in words the operator can act on.
 *
 * A login without permission to control Services Live gets a 403 on
 * toggle_control. Follow ProPresenter let it escape as an unhandled rejection
 * on every slide change, with raw JSON as the only text.
 */
const RAW_403 =
  'PCO 403 Forbidden: {"errors":[{"status":"403","title":"Forbidden","detail":"User with id 19308659 cannot read AppGraph::V2018_11_01::Actions::LiveToggleControlAction"}]}';

describe("pcoLiveErrorMessage", () => {
  it("recognises the raw 403 string pcoLiveAction rejects with", () => {
    expect(isPcoLiveForbidden(RAW_403)).toBe(true);
    expect(isPcoLiveForbidden(new Error(RAW_403))).toBe(true);
  });

  it("recognises a PcoError carrying status 403", () => {
    expect(isPcoLiveForbidden(new PcoError("PCO/403 Not allowed."))).toBe(true);
  });

  it("does not treat other failures as a permission problem", () => {
    expect(isPcoLiveForbidden("PCO 500 Internal Server Error")).toBe(false);
    expect(isPcoLiveForbidden(new PcoError("PCO/404 Planning Center couldn't find that."))).toBe(false);
    expect(isPcoLiveForbidden(undefined)).toBe(false);
  });

  it("gives Follow the permission message for a 403, without the raw JSON", () => {
    const msg = pcoLiveErrorMessage(RAW_403, "follow");
    expect(msg).toBe(PCO_LIVE_FORBIDDEN_FOLLOW);
    expect(msg).not.toContain("AppGraph");
  });

  it("gives the buttons the permission message for a 403", () => {
    expect(pcoLiveErrorMessage(RAW_403, "button")).toBe(PCO_LIVE_FORBIDDEN_BUTTON);
  });

  it("explains other Follow failures and keeps the error text", () => {
    expect(pcoLiveErrorMessage("PCO 500 Internal Server Error", "follow")).toBe(
      "Couldn't take control of Planning Center Live, so Follow didn't move it. PCO 500 Internal Server Error",
    );
  });

  it("leaves other button failures as they were", () => {
    expect(pcoLiveErrorMessage("timed out", "button")).toBe("timed out");
  });

  it("keeps user facing text free of dashes", () => {
    for (const m of [PCO_LIVE_FORBIDDEN_FOLLOW, PCO_LIVE_FORBIDDEN_BUTTON]) {
      expect(m).not.toMatch(/[—–]| - /);
    }
  });
});
