import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string, number][] = [
  [
    "o.talking ? \"Mute\" : \"Unmute\"",
    "o.talking ? \"Mutear\" : \"Desmutear\"",
    1
  ],
  [
    "`Live on ${o.line}. Tap to mute` : `Muted. Tap to talk on ${o.line}`",
    "`Al aire en ${o.line}. Tocá para mutear` : `Muteado. Tocá para hablar en ${o.line}`",
    1
  ],
  [
    "`Talking on ${o.line}` : `Hold to talk on ${o.line}`",
    "`Hablando en ${o.line}` : `Mantené presionado para hablar en ${o.line}`",
    1
  ],
  [
    "\"Comms runs on phones and tablets, never on the booth computer.\"",
    "\"Las comunicaciones funcionan en celulares y tablets, no en la computadora de Control.\"",
    1
  ],
  [
    "\"Sign in first: comms uses your crew name.\"",
    "\"Ingresá primero: comunicaciones usa tu nombre de equipo.\"",
    1
  ],
  [
    "\"Comms needs the microphone, and phones only allow that on the secure (https) address. Open ProDeck from that address to use comms.\"",
    "\"Las comunicaciones necesitan el micrófono y los celulares solo lo permiten en una dirección segura (https). Abrí ProDeck desde esa dirección para usarlas.\"",
    1
  ]
];
it("preserves behavior and data outside reviewed copy", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/intercomCommsBaseline.txt", "utf8");
 for (const [from, to, count] of copy) { expect(expected.split(from)).toHaveLength(count + 1); expected = expected.split(from).join(to); }
 expect(readFileSync("src/lib/intercom.ts", "utf8")).toBe(expected);
});
