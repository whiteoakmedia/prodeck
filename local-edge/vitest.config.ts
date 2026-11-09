import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// A stand-in for Cloudflare's DNS API, so record writes can be checked. It
// starts with one record nobody here made (taken-crew.prodeck.live).
type Rec = { id: string; type: string; name: string; content: string; proxied?: boolean; comment?: string };
const records: Rec[] = [{ id: "theirs", type: "CNAME", name: "taken-crew.prodeck.live", content: "elsewhere.example", comment: "" }];
let next = 1;

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { CF_API_TOKEN: "test-token", ZONE_ID: "zone1", CREW_READY: "1", CREW_DNS: "per-name" },
        outboundService: async (req: Request) => {
          const u = new URL(req.url);
          if (u.hostname === "dns.test") return Response.json(records);
          const m = u.pathname.match(/^\/client\/v4\/zones\/zone1\/dns_records(?:\/(.+))?$/);
          if (!m) return new Response("not mocked", { status: 599 });
          if (req.method === "GET") return Response.json({ success: true, result: records.filter((r) => r.name === u.searchParams.get("name")) });
          if (req.method === "POST") {
            const r = { id: `r${next++}`, ...((await req.json()) as Omit<Rec, "id">) };
            records.push(r);
            return Response.json({ success: true, result: r });
          }
          if (req.method === "DELETE") {
            const i = records.findIndex((r) => r.id === m[1]);
            if (i >= 0) records.splice(i, 1);
            return Response.json({ success: true, result: { id: m[1] } });
          }
          return Response.json({ success: true, result: {} });
        },
      },
    }),
  ],
});
