import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Separate from vite.config.ts on purpose: that file carries the Tauri dev
// server settings (fixed port, strictPort, the gateway proxy), none of which
// should be loaded to run tests.
export default defineConfig({
  plugins: [react()],
  test: {
    // Most of what's worth testing here reads `window` or `localStorage` at
    // module load — IS_WEB is decided that way — so a plain node environment
    // can't even import the modules under test.
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
