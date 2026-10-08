import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { joinPosterHtml } from "../lib/joinPoster";

describe("join poster", () => {
  it("carries the QR and prints itself in the browser", () => {
    const html = joinPosterHtml("data:image/png;base64,AAAA");
    expect(html).toContain('<img src="data:image/png;base64,AAAA"');
    expect(html).toContain("window.print()");
  });

  it("can't be broken out of the img tag", () => {
    expect(joinPosterHtml('x" onerror="alert(1)')).not.toContain('" onerror');
  });

  // PRODECK-3: window.print() inside the app is refused by Tauri's ACL, so a
  // print button that calls it does nothing. Printing goes through
  // openPrintHtml (the system browser) instead.
  it("no screen calls window.print() in the app's own window", () => {
    for (const f of ["src/components/FirstRunSetup.tsx", "src/pages/Settings.tsx", "src/pages/Report.tsx"]) {
      const src = readFileSync(f, "utf8")
        .replace(/`<script>[^`]*`/g, "") // inside the page printed by the browser: fine
        .replace(/^\s*\/\/.*$/gm, ""); // comments
      expect(src, f).not.toMatch(/window\.print\(\)/);
    }
  });
});
