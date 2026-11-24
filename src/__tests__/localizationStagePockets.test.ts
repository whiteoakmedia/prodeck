import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string][] = [
  [
    "No stage pockets on the map yet. On the booth, press Edit → Stage to add them: a name and a socket range each.",
    "Todavía no hay paneles de conectores del escenario en el mapa. Desde Control, elegí Editar → Escenario para agregarlos con su nombre y rango de conectores."
  ],
  [
    "{liveCount} of {sockets.length} live",
    "{liveCount} de {sockets.length} en uso"
  ],
  [
    "Marked dead — looks normal, goes nowhere",
    "Marcado como fuera de servicio: parece normal, pero no conecta"
  ],
  [
    "Nothing on the map uses this socket. Free at the desk, or a tie line nobody wrote down.",
    "Nada en el mapa usa este conector. Puede estar libre en la consola o ser una línea directa que no se registró."
  ],
  [
    "On the map as a source, but not patched to a door or channel yet.",
    "Figura como fuente en el mapa, pero todavía no está conectado a un puerto o canal."
  ],
  [
    "`Socket ${s.n} → ${first.doorLabel} ${first.at} → channel ${first.channelIndex}${s.inserts.length ? ` · insert via ${s.inserts.join(\", \")}` : \"\"}`",
    "`Conector ${s.n} → ${first.doorLabel} ${first.at} → canal ${first.channelIndex}${s.inserts.length ? ` · inserción mediante ${s.inserts.join(\", \")}` : \"\"}`"
  ],
  [
    ">dead</div>",
    ">fuera de servicio</div>"
  ],
  [
    ">free</div>",
    ">libre</div>"
  ],
  [
    ">unpatched</div>",
    ">sin conectar</div>"
  ],
  [
    "} shares gain</div>",
    "} comparte ganancia</div>"
  ],
  [
    ">muted</div>",
    ">muteado</div>"
  ],
  [
    "\"Mark live again\" : \"Mark dead\"",
    "\"Marcar como funcional\" : \"Marcar fuera de servicio\""
  ],
  [
    "\"undo\" : \"dead\"",
    "\"deshacer\" : \"fuera de servicio\""
  ],
  [
    "placeholder=\"Pocket name\"",
    "placeholder=\"Nombre del panel\""
  ],
  [
    "title=\"Numbering space of the sockets, e.g. stage\"",
    "title=\"Grupo de numeración de los conectores, por ejemplo escenario\""
  ],
  [
    "placeholder=\"Where it is, what's odd about it\"",
    "placeholder=\"Dónde está y qué particularidades tiene\""
  ],
  [
    "title=\"Remove pocket\"",
    "title=\"Quitar panel\""
  ],
  [
    "placeholder=\"New pocket — e.g. Stage right front\"",
    "placeholder=\"Nuevo panel, por ejemplo escenario adelante a la derecha\""
  ],
  [
    "placeholder=\"from\"",
    "placeholder=\"desde\""
  ],
  [
    "placeholder=\"to\"",
    "placeholder=\"hasta\""
  ],
  [
    "        Add pocket",
    "        Agregar panel"
  ]
];
it("preserves actions and user content in StagePockets", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/StagePocketsBaseline.txt", "utf8");
 for (const [from, to] of copy) { expect(expected.split(from)).toHaveLength(2); expected = expected.replace(from, to); }
 expect(readFileSync("src/components/StagePockets.tsx", "utf8")).toBe(expected);
});
