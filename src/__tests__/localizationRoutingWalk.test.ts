import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string][] = [
  [
    "`Channel ${n.ref?.index ?? \"\"}`",
    "`Canal ${n.ref?.index ?? \"\"}`"
  ],
  [
    "            People\n",
    "            Personas\n"
  ],
  [
    "          Channels\n",
    "          Canales\n"
  ],
  [
    "            Places\n",
    "            Lugares\n"
  ],
  [
    "            Stage\n",
    "            Escenario\n"
  ],
  [
    "placeholder=\"Channel number, name, or what's on the desk…\"",
    "placeholder=\"Número de canal, nombre o texto en la consola…\""
  ],
  [
    "Nothing on the map matches “{q}”.",
    "No hay coincidencias en el mapa para “{q}”."
  ],
  [
    "n.kind === \"source\" ? \"src\" : \"out\"",
    "n.kind === \"source\" ? \"ent\" : \"sal\""
  ],
  [
    "This mic isn't mapped to a desk channel yet (Planning Center → Mics)",
    "Este micrófono todavía no está asignado a un canal de la consola (Planning Center → Micrófonos)"
  ],
  [
    "{p.position} · mic {p.mic}",
    "{p.position} · micrófono {p.mic}"
  ],
  [
    "\" · not mapped to a channel\"",
    "\" · sin asignar a un canal\""
  ],
  [
    "No channels on the map yet.",
    "Todavía no hay canales en el mapa."
  ],
  [
    "” on the desk</span>",
    "” en la consola</span>"
  ],
  [
    ">muted</span>",
    ">muteado</span>"
  ],
  [
    "className=\"rw-num mono\">out</span>",
    "className=\"rw-num mono\">sal</span>"
  ],
  [
    "            ‹ Back",
    "            ‹ Volver"
  ],
  [
    "That isn't on the map any more.",
    "Eso ya no está en el mapa."
  ],
  [
    "aria-label=\"Back\"",
    "aria-label=\"Volver\""
  ],
  [
    "\"Known issue\" : \"Deliberate — know about it\"",
    "\"Problema conocido\" : \"Cambio intencional: tenelo en cuenta\""
  ],
  [
    ">Already checked for you</div>",
    ">Ya revisado por ProDeck</div>"
  ],
  [
    "\"Between the source and the desk, in order\" : \"What to look at, in order\"",
    "\"Entre la fuente y la consola, en orden\" : \"Qué revisar, en orden\""
  ],
  [
    "Everything on this path that ProDeck can see looks right. If there is still no sound, it is at the source itself.",
    "Todo lo que ProDeck puede revisar en esta ruta parece estar bien. Si todavía no hay sonido, revisá la fuente."
  ],
  [
    "ProDeck can't see anything on this path live — it is all walking.",
    "ProDeck no puede revisar esta ruta en vivo: hay que comprobarla en persona."
  ],
  [
    "                  Everything on {n.label} →",
    "                  Todo lo conectado a {n.label} →"
  ],
  [
    "walk(map, targetId, live)",
    "walk(map, targetId, live, \"es\")"
  ]
];
it("translates the routing guide without changing routing actions or user data", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/routingWalkBaseline.txt", "utf8");
 for (const [from, to] of copy) { expect(expected.split(from)).toHaveLength(2); expected = expected.replace(from, to); }
 expect(readFileSync("src/components/RoutingWalk.tsx", "utf8")).toBe(expected);
});
