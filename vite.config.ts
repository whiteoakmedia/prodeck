import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { readFileSync } from "node:fs";

// The app version, for surfaces that can't ask Tauri (demo/screenshot mode).
const APP_VERSION: string = JSON.parse(readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8")).version;

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Readable stack traces in Sentry. Only when a release build has the token
// (scripts/release-public.sh reads ~/.prodeck/sentry-auth.token): the source
// maps are uploaded to White Oak's Sentry project, then deleted, so they never
// ship inside the app. Every other build is untouched.
// @ts-expect-error process is a nodejs global
const sentryToken: string | undefined = process.env.SENTRY_AUTH_TOKEN || undefined;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    ...(sentryToken
      ? [
          sentryVitePlugin({
            org: "white-oak-media",
            project: "prodeck",
            authToken: sentryToken,
            telemetry: false,
            // Must match the release the app reports (src/lib/crashReports.ts).
            release: { name: `prodeck@${APP_VERSION}` },
            sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
          }),
        ]
      : []),
  ],
  build: { sourcemap: sentryToken ? "hidden" : false },
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // Dev-only: forward web-gateway calls to a running ProDeck so browser-mode
    // features (web viewer, kiosk) can be exercised without a reinstall.
    proxy: {
      "/api": { target: "http://localhost:8088", changeOrigin: true },
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
