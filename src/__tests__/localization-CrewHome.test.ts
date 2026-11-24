import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string, number][] = [
  [
    "{ big: \"No time\", caption: \"set for service\" }",
    "{ big: \"Sin horario\", caption: \"del evento\" }",
    1
  ],
  [
    ">Sunday</h1>",
    ">Inicio</h1>",
    1
  ],
  [
    "              Hi {myName.split(\" \")[0]}",
    "              Hola {myName.split(\" \")[0]}",
    1
  ],
  [
    "aria-label=\"Status\"",
    "aria-label=\"Estado\"",
    1
  ],
  [
    "{boothUp ? \"Booth\" : \"Offline\"}",
    "{boothUp ? \"Control\" : \"Sin conexión\"}",
    1
  ],
  [
    "`Service starts ${dateClock(start)}` : \"No service time set\"",
    "`El evento comienza ${dateClock(start)}` : \"Sin horario para el evento\"",
    1
  ],
  [
    "`${pco.items.length} items in the plan` : \"No plan loaded\"",
    "`${pco.items.length} elementos en el plan` : \"No hay un plan cargado\"",
    1
  ],
  [
    "Checked in {clock(checked)}",
    "Asistencia registrada a las {clock(checked)}",
    1
  ],
  [
    "\"Not checked in\" : \"Not on this week's plan\"",
    "\"Asistencia sin registrar\" : \"No estás en el plan de esta semana\"",
    1
  ],
  [
    "                  expected {dayClock(expectedTs)}",
    "                  hora prevista {dayClock(expectedTs)}",
    1
  ],
  [
    "\" · service start\"",
    "\" · inicio del evento\"",
    1
  ],
  [
    "                  filling in? check in anyway",
    "                  ¿Estás reemplazando a alguien? Registrá tu asistencia igual",
    1
  ],
  [
    "{busy ? \"…\" : \"I'm here\"}",
    "{busy ? \"…\" : \"Registrar asistencia\"}",
    1
  ],
  [
    ">Files</span>",
    ">Archivos</span>",
    1
  ],
  [
    "aria-label=\"Back to position\"",
    "aria-label=\"Volver al puesto\"",
    1
  ],
  [
    "              Open\n",
    "              Abrir\n",
    1
  ],
  [
    "This file type can't be shown inside the app. Tap Open to view it; you'll\n                come back with your phone's Back gesture.",
    "Este tipo de archivo no se puede mostrar dentro de la aplicación. Tocá Abrir para verlo;\n                podés volver con el gesto de retroceso de tu celular.",
    1
  ],
  [
    "              My next duty",
    "              Mi próxima tarea",
    1
  ],
  [
    "`in ${dutyMins} min`",
    "`en ${dutyMins} min`",
    1
  ],
  [
    "`${Math.abs(dutyMins)} min over`",
    "`${Math.abs(dutyMins)} min de atraso`",
    1
  ],
  [
    "`${dutyPool.length} to go`",
    "`${dutyPool.length} pendientes`",
    1
  ],
  [
    "` · due ${dayClock(dutyDue)}`",
    "` · vence ${dayClock(dutyDue)}`",
    1
  ],
  [
    "` · then ${dutyPool.length - 1} more` : \" · last one\"",
    "` · después ${dutyPool.length - 1} más` : \" · última tarea\"",
    1
  ],
  [
    "              ✓ Done",
    "              ✓ Completada",
    1
  ],
  [
    "                All steps",
    "                Todas las tareas",
    1
  ],
  [
    "value={`${songCount} song${songCount === 1 ? \"\" : \"s\"}`}",
    "value={`${songCount} ${songCount === 1 ? \"canción\" : \"canciones\"}`}",
    1
  ],
  [
    "title=\"Checklist\"",
    "title=\"Lista de tareas\"",
    1
  ],
  [
    "`${overdue} overdue`",
    "`${overdue} ${overdue === 1 ? \"vencida\" : \"vencidas\"}`",
    1
  ],
  [
    "`${chat.unread} unread` : \"All read\"",
    "`${chat.unread} sin leer` : \"Todo leído\"",
    1
  ],
  [
    "title=\"No sound?\" value=\"Find the fault\"",
    "title=\"¿Sin sonido?\" value=\"Buscar el problema\"",
    1
  ],
  [
    "title=\"My role\" value={myArrival.position || \"Guide\"}",
    "title=\"Mi rol\" value={myArrival.position || \"Guía\"}",
    1
  ],
  [
    " : \"Not reachable\"} dot=",
    " : \"Sin conexión\"} dot=",
    1
  ]
];
it("protects src/mobile/CrewHome.tsx outside reviewed presentation", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/CrewHome-20261123-baseline.txt", "utf8");
 for (const [from, to, count] of copy) { expect(expected.split(from)).toHaveLength(count + 1); expected = expected.split(from).join(to); }
 expect(readFileSync("src/mobile/CrewHome.tsx", "utf8")).toBe(expected);
});
