import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string, number][] = [
  [
    "title = \"Dashboards\"",
    "title = \"Paneles de control\"",
    1
  ],
  [
    "aria-label=\"Back\"",
    "aria-label=\"Volver\"",
    1
  ],
  [
    "aria-label=\"Dashboard\"",
    "aria-label=\"Panel de control\"",
    1
  ],
  [
    "{ id: \"service\", name: \"Service\" }",
    "{ id: \"service\", name: \"Evento\" }",
    1
  ],
  [
    "{left === 1 ? \"One part of this dashboard is\" : `${left} parts of this dashboard are`} only on the booth screen.",
    "{left === 1 ? \"Una parte de este panel solo aparece\" : `${left} partes de este panel solo aparecen`} en la pantalla de Control.",
    1
  ],
  [
    ">Sound level</span>",
    ">Nivel de sonido</span>",
    1
  ],
  [
    "\"not measuring\" : quiet ? \"quiet\" : \"measuring\"",
    "\"sin medir\" : quiet ? \"sin señal\" : \"midiendo\"",
    1
  ],
  [
    ">No reading</small>",
    ">Sin medición</small>",
    1
  ],
  [
    "`peak ${Math.round(splPeak)} dB SPL`",
    "`pico ${Math.round(splPeak)} dB SPL`",
    1
  ],
  [
    "\"Room is quiet. The meter wakes with the console.\"",
    "\"No se detecta señal. El medidor se activa con la consola.\"",
    1
  ],
  [
    "\"The booth isn't measuring right now.\"",
    "\"Control no está midiendo en este momento.\"",
    1
  ],
  [
    ">Overflow listen</span>",
    ">Escuchar audio</span>",
    1
  ],
  [
    ">Order of service</span>",
    ">Crono</span>",
    1
  ],
  [
    "{pco.items.length} items",
    "{pco.items.length} elementos",
    1
  ],
  [
    "No plan loaded at the booth.",
    "No hay un plan cargado en Control.",
    1
  ],
  [
    "`key ${it.key}`",
    "`tonalidad ${it.key}`",
    1
  ],
  [
    "`mic ${pco.micForLeader(it.leader)}`",
    "`micrófono ${pco.micForLeader(it.leader)}`",
    1
  ],
  [
    ">Now</span>",
    ">En curso</span>",
    1
  ],
  [
    "Camera feeds stay on the booth network. They aren't sent outside the building.",
    "Las señales de cámara permanecen en la red de Control. No se envían fuera del edificio.",
    1
  ]
];
it("protects CrewDash behavior and user data outside reviewed translations", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/CrewDashRoundBaseline.txt", "utf8");
 for (const [from, to, count] of copy) { expect(expected.split(from)).toHaveLength(count + 1); expected = expected.split(from).join(to); }
 expect(readFileSync("src/mobile/CrewDash.tsx", "utf8")).toBe(expected);
});
