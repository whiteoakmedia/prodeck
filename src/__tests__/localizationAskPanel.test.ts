import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string][] = [
  [
    ">Ask ProDeck</span>",
    ">Consultá a ProDeck</span>"
  ],
  [
    "Describe what's wrong in your own words. It answers only from this building's map and notes.",
    "Describí el problema con tus palabras. ProDeck responde usando únicamente el mapa y las notas de este lugar."
  ],
  [
    ">Looking at the map…</div>",
    ">Revisando el mapa…</div>"
  ],
  [
    "\"Say what happened next…\" : \"e.g. Ruth's mic is crackling · nothing from the keys · stream is quiet\"",
    "\"Contá qué pasó después…\" : \"Ej.: el micrófono de Ruth hace ruido · no se escuchan los teclados · la transmisión suena baja\""
  ],
  [
    "          Ask\n",
    "          Consultar\n"
  ],
  [
    "          Start over\n",
    "          Empezar de nuevo\n"
  ]
];
it("preserves actions and user content in AskPanel", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/AskPanelBaseline.txt", "utf8");
 for (const [from, to] of copy) { expect(expected.split(from)).toHaveLength(2); expected = expected.replace(from, to); }
 expect(readFileSync("src/components/AskPanel.tsx", "utf8")).toBe(expected);
});
