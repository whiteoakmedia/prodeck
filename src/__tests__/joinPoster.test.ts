import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { joinPosterHtml } from "../lib/joinPoster";

describe("join poster", () => {
  it("carries the QR and prints itself in the browser", () => {
    const html = joinPosterHtml("data:image/png;base64,AAAA");
    expect(html).toContain('<img src="data:image/png;base64,AAAA"');
    expect(html).toContain("window.print()");
  });

  // Both print buttons (first-run Step 5 and Settings → Crew Members) share
  // this one document, so its content is pinned here.
  it("renders the title, the three steps and a print-on-load script", () => {
    const html = joinPosterHtml("data:image/png;base64,abc");
    expect(html).toContain('src="data:image/png;base64,abc"');
    expect(html).toContain("<h1>Join the ProDeck Crew</h1>");
    expect(html).toContain("<li>Open your phone's camera and point it at the code</li>");
    // iPhones get the ProDeck Crew app from the code (crew-cloud applinks.ts).
    expect(html).toContain(
      "<li>iPhone: get the free ProDeck Crew app when asked, then scan again. Other phones open in the browser</li>",
    );
    expect(html).toContain("<li>Tap your name, pick a 4 digit PIN, and you're in</li>");
    expect(html).toContain(
      "<script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>",
    );
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
