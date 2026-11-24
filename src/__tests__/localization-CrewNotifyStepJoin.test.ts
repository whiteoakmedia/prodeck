import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string, number][] = [
  [
    "Notifications weren't allowed. Tap the button again and choose Allow.",
    "No se permitieron las notificaciones. Tocá el botón nuevamente y elegí Permitir.",
    1
  ],
  [
    "aria-label=\"Page notifications\"",
    "aria-label=\"Notificaciones de avisos\"",
    1
  ],
  [
    "\"Asking…\"",
    "\"Solicitando…\"",
    1
  ],
  [
    "          Got it",
    "          Entendido",
    1
  ],
  [
    "        Not now",
    "        Ahora no",
    1
  ]
];
it("protects src/mobile/CrewNotifyStep.tsx behavior and values outside reviewed copy", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/CrewNotifyStepJoinBaseline.txt", "utf8");
 for (const [from, to, count] of copy) { expect(expected.split(from)).toHaveLength(count + 1); expected = expected.split(from).join(to); }
 expect(readFileSync("src/mobile/CrewNotifyStep.tsx", "utf8")).toBe(expected);
});
