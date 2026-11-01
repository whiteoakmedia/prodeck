import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every Tauri plugin the app registers must have a permission in the main
 * window's capability.
 *
 * tauri-plugin-shell was registered in lib.rs but never granted (and never
 * used). Its injected script caught clicks on external target="_blank" links
 * and invoked plugin:shell|open, which the ACL refused, so each click left an
 * unhandled rejection in Sentry ("Command plugin:shell|open not allowed by
 * ACL"). The opener plugin already opens those links.
 */

const root = join(__dirname, "..", "..");
const lib = readFileSync(join(root, "src-tauri", "src", "lib.rs"), "utf8");
const capability = JSON.parse(
  readFileSync(join(root, "src-tauri", "capabilities", "default.json"), "utf8"),
) as { permissions: (string | { identifier: string })[] };

// Plugins that expose no commands to the webview, so need no permission.
const NO_COMMANDS = new Set(["single_instance"]);

const registered = [...lib.matchAll(/\.plugin\(\s*tauri_plugin_(\w+)::/g)].map((m) => m[1]);
const granted = new Set(
  capability.permissions.map((p) => (typeof p === "string" ? p : p.identifier).split(":")[0]),
);

describe("registered Tauri plugins are allowed by the capability", () => {
  it("finds the plugin registrations", () => {
    expect(registered).toContain("opener");
  });

  it("does not register the shell plugin", () => {
    expect(registered).not.toContain("shell");
    expect(lib).not.toMatch(/tauri_plugin_shell/);
  });

  it("grants a permission for each plugin that has commands", () => {
    const missing = registered
      .filter((name) => !NO_COMMANDS.has(name))
      .filter((name) => !granted.has(name.replace(/_/g, "-")));
    expect(missing).toEqual([]);
  });
});
