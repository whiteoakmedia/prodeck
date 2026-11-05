import { describe, expect, it } from "vitest";
import { TIP_URL as URL_CONST } from "../lib/tip";

const TIP_URL: string = URL_CONST;

describe("tips", () => {
  // Opened in the browser from the open-source app: it must be White Oak
  // Media's public support page or a Stripe page, never anything carrying a key.
  it("is White Oak Media's support page, a Stripe Payment Link, or nothing", () => {
    expect(
      TIP_URL === "" ||
        TIP_URL === "https://www.whiteoakmedia.io/tools/support" ||
        /^https:\/\/(buy|donate)\.stripe\.com\/[A-Za-z0-9_-]+$/.test(TIP_URL),
    ).toBe(true);
    expect(TIP_URL).not.toMatch(/sk_|pk_|rk_/);
  });
});
