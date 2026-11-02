import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The shell's own screens (connect, saved churches). The crew app itself is
// served by each church's booth and opened inside the app.
export default defineConfig({
  plugins: [react()],
  server: { host: true },
  build: { outDir: "dist", emptyOutDir: true },
});
