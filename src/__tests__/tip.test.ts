import { describe, expect, it } from "vitest";
import { TIP_URL } from "../lib/tip";

describe("tips", () => {
  // Opened in the browser from the open-source app: it must be a public
  // Stripe page, never anything carrying a key.
  it("is a Stripe Payment Link or nothing", () => {
    expect(TIP_URL === "" || /^https:\/\/(buy|donate)\.stripe\.com\/[A-Za-z0-9_-]+$/.test(TIP_URL)).toBe(true);
    expect(TIP_URL).not.toMatch(/sk_|pk_|rk_/);
  });
});
