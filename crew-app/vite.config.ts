import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// The store version (Xcode's MARKETING_VERSION), so crash reports name it.
const pbx = readFileSync(new URL("./ios/App/App.xcodeproj/project.pbxproj", import.meta.url), "utf8");
const version = pbx.match(/MARKETING_VERSION = ([\d.]+);/)?.[1] ?? "0";

// The shell's own screens (connect, saved churches). The crew app itself is
// served by each church's booth and opened inside the app.
export default defineConfig({
  plugins: [react()],
  define: { __CREW_VERSION__: JSON.stringify(version) },
  server: { host: true },
  build: { outDir: "dist", emptyOutDir: true },
});
