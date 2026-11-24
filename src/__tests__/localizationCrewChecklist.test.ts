import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const copy: [string, string][] = [
  [
    ">Checklist</h1>",
    ">Lista de tareas</h1>"
  ],
  [
    "`Mine ${myDone} of ${mine.length} · team ${totals.done} of ${totals.total}`",
    "`Mis tareas: ${myDone} de ${mine.length} · equipo: ${totals.done} de ${totals.total}`"
  ],
  [
    "`Team checklist · ${totals.done} of ${totals.total} done`",
    "`Lista del equipo · ${totals.done} de ${totals.total} completadas`"
  ],
  [
    "{queued} change{queued === 1 ? \"\" : \"s\"} waiting to reach the booth · tap to retry",
    "{queued} {queued === 1 ? \"cambio pendiente\" : \"cambios pendientes\"} de envío a Control · tocá para reintentar"
  ],
  [
    "Checked in {clock(checked)}",
    "Asistencia registrada a las {clock(checked)}"
  ],
  [
    ">I'm here</div>",
    ">Estoy presente</div>"
  ],
  [
    "return \"tells the booth\"",
    "return \"avisa a Control\""
  ],
  [
    "`Expected ${dayClock(t)} · tells the booth`",
    "`Hora prevista: ${dayClock(t)} · avisa a Control`"
  ],
  [
    "`Expected ${dayClock(t)} (service start, since you're not on this week's plan) · tells the booth`",
    "`Hora prevista: ${dayClock(t)} (inicio del evento, porque no estás en el plan de esta semana) · avisa a Control`"
  ],
  [
    "\"Check in\"",
    "\"Registrar asistencia\""
  ],
  [
    ">My checklist</span>",
    ">Mis tareas</span>"
  ],
  [
    "\"No checklists set up at the booth yet.\"",
    "\"Todavía no hay listas de tareas configuradas en Control.\""
  ],
  [
    "`Nothing for \"${myRole}\" this week.`",
    "`No hay tareas para \"${myRole}\" esta semana.`"
  ],
  [
    "\"You're not on this week's plan in Planning Center, so there's no position checklist for you.\"",
    "\"No estás en el plan de esta semana en Planning Center, por eso no tenés una lista de tareas para tu puesto.\""
  ],
  [
    "{hiddenCount} other-position checklist{hiddenCount === 1 ? \"\" : \"s\"} hidden",
    "{hiddenCount} {hiddenCount === 1 ? \"lista de otro puesto oculta\" : \"listas de otros puestos ocultas\"}"
  ],
  [
    ">assigned to the team individually</div>",
    ">asignadas individualmente al equipo</div>"
  ],
  [
    "${open ? \"Collapse\" : \"Expand\"} ${list.name}",
    "${open ? \"Contraer\" : \"Expandir\"} ${list.name}"
  ],
  [
    "`due ${dayClock(due)}`",
    "`vence ${dayClock(due)}`"
  ],
  [
    "\" · overdue\"",
    "\" · vencida\""
  ],
  [
    "` · ${others} assigned`",
    "` · ${others} asignadas`"
  ],
  [
    "` · ${p.total - p.done} left`",
    "` · ${p.total - p.done} pendientes`"
  ]
];

it("preserves behavior and caller data outside reviewed CrewChecklist copy", () => {
  let expected = readFileSync("src/__tests__/fixtures/localization/CrewChecklistBaseline.txt", "utf8");
  for (const [from, to] of copy) {
    expect(expected.split(from)).toHaveLength(2);
    expected = expected.replace(from, to);
  }
  expect(readFileSync("src/mobile/CrewChecklist.tsx", "utf8")).toBe(expected);
});
