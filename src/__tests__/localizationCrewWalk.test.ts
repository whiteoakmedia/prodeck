import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string][] = [
  [
    "aria-label=\"Back\"",
    "aria-label=\"Volver\""
  ],
  [
    "              No sound?",
    "              ¿Sin sonido?"
  ],
  [
    "Pick the person, channel or place. ProDeck checks what it can see from the booth first, then tells you where to walk.",
    "Elegí la persona, el canal o el lugar. ProDeck revisa primero lo que puede ver desde Control y después te indica dónde ir."
  ],
  [
    "The booth's routing map couldn't be read: {loadErr}",
    "No se pudo leer el mapa de ruteo de Control: {loadErr}"
  ],
  [
    "Loading the map…",
    "Cargando el mapa…"
  ],
  [
    "This is the example map that ships with ProDeck, not this building's. Someone at the booth needs to fill in Routing first.",
    "Este es el mapa de ejemplo de ProDeck. Alguien en Control debe configurar primero el ruteo de este lugar."
  ]
];
it("keeps routing data and actions while translating mobile guidance", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/crewWalkBaseline.txt", "utf8");
 for (const [from, to] of copy) { expect(expected.split(from)).toHaveLength(2); expected = expected.replace(from, to); }
 expect(readFileSync("src/mobile/CrewWalk.tsx", "utf8")).toBe(expected);
});
