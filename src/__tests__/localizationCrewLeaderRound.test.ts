import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string, number][] = [
  [
    "`Join the ProDeck crew, ${who.split(\" \")[0]}! Tap, add to your Home Screen, pick a PIN. You're already approved: ${url}`",
    "`Sumate al equipo de ProDeck, ${who.split(\" \")[0]}. Abrí el enlace, agregá ProDeck a la pantalla de inicio y elegí un PIN. Tu acceso ya está aprobado: ${url}`",
    1
  ],
  [
    "Link copied. Text it to them.",
    "Enlace copiado. Podés enviárselo.",
    1
  ],
  [
    "aria-label=\"Back\"",
    "aria-label=\"Volver\"",
    1
  ],
  [
    "          Leader board",
    "          Panel del equipo",
    1
  ],
  [
    "{scheduled.length} scheduled · {needAttention.length} need attention",
    "{scheduled.length} programados · {needAttention.length} necesitan atención",
    1
  ],
  [
    ">On site</span>",
    ">Presentes</span>",
    1
  ],
  [
    ">Service</span>",
    ">Evento</span>",
    1
  ],
  [
    ">Issues</span>",
    ">Pendientes</span>",
    1
  ],
  [
    "No approved crew yet. Approve people under Settings, Crew Members, and give each one a role.",
    "Todavía no hay integrantes aprobados. Aprobá a cada persona en Configuración, Integrantes del equipo, y asignale un rol.",
    1
  ],
  [
    ">Needs attention</span>",
    ">Necesitan atención</span>",
    1
  ],
  [
    "{u.role || \"no role set\"} · expected {expected(u) ? clock(expected(u)) : \"—\"},\n                not arrived",
    "{u.role || \"sin rol asignado\"} · horario previsto {expected(u) ? clock(expected(u)) : \"—\"},\n                todavía no llegó",
    1
  ],
  [
    "                  Nudge",
    "                  Enviar aviso",
    1
  ],
  [
    ">Not in yet</span>",
    ">Todavía no llegaron</span>",
    1
  ],
  [
    "`due ${clock(expected(u))}` : \"no time\"",
    "`previsto ${clock(expected(u))}` : \"sin horario\"",
    1
  ],
  [
    ">On track</span>",
    ">Presentes</span>",
    1
  ],
  [
    "{u.role ? `${u.role} · ` : \"\"}in {clock(arrivals[u.id])}",
    "{u.role ? `${u.role} · ` : \"\"}llegó {clock(arrivals[u.id])}",
    1
  ],
  [
    ">Not scheduled this week</span>",
    ">Sin programar esta semana</span>",
    1
  ],
  [
    ">Invite someone</span>",
    ">Invitar a alguien</span>",
    1
  ],
  [
    "placeholder=\"Name from the plan (or type)\"",
    "placeholder=\"Nombre del plan o escrito a mano\"",
    1
  ],
  [
    "          Share link",
    "          Compartir enlace",
    1
  ],
  [
    "Pre-approved one-time link: they tap it, install, pick a PIN, no\n        password, no waiting.",
    "Enlace de un solo uso con acceso aprobado: la persona lo abre, instala la aplicación y elige un PIN.\n        No necesita contraseña ni esperar aprobación.",
    1
  ],
  [
    "`${nudge.name}, checking in: are you on your way?`",
    "`${nudge.name}, ¿ya estás en camino?`",
    1
  ]
];
it("protects CrewLeader behavior and user data outside reviewed translations", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/CrewLeaderRoundBaseline.txt", "utf8");
 for (const [from, to, count] of copy) { expect(expected.split(from)).toHaveLength(count + 1); expected = expected.split(from).join(to); }
 expect(readFileSync("src/mobile/CrewLeader.tsx", "utf8")).toBe(expected);
});
