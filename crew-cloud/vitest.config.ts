import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The name service stand-in: a booth's secret is "secret-<name>". The real
// one is prodeck-local's Names entrypoint (local-edge/src/index.ts).
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: {
        bindings: { BOARD_ADMIN_TOKEN: "board-admin" },
        serviceBindings: {
          NAMES: async (req: Request) => {
            const b = (await req.json()) as { name: string; secret: string };
            // "secret2-<name>" stands for a new owner after the name was released.
            return Response.json({ ok: b.secret === `secret-${b.name}` || b.secret === `secret2-${b.name}` });
          },
        },
      },
    }),
  ],
});
