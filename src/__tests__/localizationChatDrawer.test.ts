import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string][] = [
  [
    "<h3>Messages</h3>",
    "<h3>Mensajes</h3>"
  ],
  [
    "Sending as <strong>",
    "Enviando como <strong>"
  ],
  [
    "title=\"Sign out\"",
    "title=\"Salir\""
  ],
  [
    "                    Sign out",
    "                    Salir"
  ],
  [
    "New messages play a chime. Click to silence it.",
    "Los mensajes nuevos suenan. Tocá para silenciarlos."
  ],
  [
    "New messages are silent. Click to hear a chime.",
    "Los mensajes nuevos están en silencio. Tocá para activar el sonido."
  ],
  [
    "\"🔔 Sound on\" : \"🔕 Muted\"",
    "\"🔔 Sonido activado\" : \"🔕 Silenciado\""
  ],
  [
    "aria-label=\"Close messages\"",
    "aria-label=\"Cerrar mensajes\""
  ]
];
it("translates message drawer while preserving actions and data", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/chatDrawerBaseline.txt", "utf8");
 for (const [from, to] of copy) { expect(expected.split(from)).toHaveLength(2); expected = expected.replace(from, to); }
 expect(readFileSync("src/components/ChatDrawer.tsx", "utf8")).toBe(expected);
});
