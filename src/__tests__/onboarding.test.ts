import { describe, expect, it } from "vitest";
import { isFreshInstall } from "../lib/onboarding";
import type { Settings } from "../lib/tauri";

/**
 * "Has this booth been set up yet?"
 *
 * Two places decide this and they must agree. The trap is `pp_host`, which
 * DEFAULTS to "localhost" and is therefore never empty — testing it for
 * emptiness never detects a fresh install. That exact mistake shipped twice:
 * once here, and once in the widget gate, where it made every ProPresenter
 * widget on a new install say "offline — reconnecting…" with no way to reach
 * the setup it had never been through.
 */
const base = { pp_host: "localhost", pp_auto_connect: false, pco_app_id: "", web_enabled: false };
const settings = (over: Partial<Settings> = {}) => ({ ...base, ...over }) as Settings;

describe("isFreshInstall", () => {
  it("is true for a genuinely new install", () => {
    expect(isFreshInstall(settings())).toBe(true);
  });

  it("is not fooled by the default pp_host", () => {
    // The whole point: "localhost" is the default, not evidence of setup.
    expect(isFreshInstall(settings({ pp_host: "localhost" }))).toBe(true);
    expect(isFreshInstall(settings({ pp_host: "" }))).toBe(true);
  });

  it("is false once ProPresenter has actually connected", () => {
    expect(isFreshInstall(settings({ pp_auto_connect: true }))).toBe(false);
  });

  it("is false once Planning Center or the gateway is configured", () => {
    expect(isFreshInstall(settings({ pco_app_id: "abc" }))).toBe(false);
    expect(isFreshInstall(settings({ web_enabled: true }))).toBe(false);
  });

  it("treats a host typed without connecting as still-fresh", () => {
    // Typing an address is not the same as having reached it, and the setup
    // flow should still offer itself.
    expect(isFreshInstall(settings({ pp_host: "172.16.0.68" }))).toBe(true);
  });
});
