import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string][] = [
  [
    "That password didn't work.",
    "Esa contraseña no funcionó."
  ],
  [
    "Too many tries. Wait a few minutes.",
    "Demasiados intentos. Esperá unos minutos."
  ],
  [
    "The crew address didn't answer.",
    "La dirección del equipo no respondió."
  ],
  [
    "          Sign in\n",
    "          Ingresar\n"
  ],
  [
    "Enter the crew password to see the week while the booth is off.",
    "Ingresá la contraseña del equipo para ver la semana mientras Control está apagado."
  ],
  [
    "placeholder=\"Crew password\"",
    "placeholder=\"Contraseña del equipo\""
  ],
  [
    "\"Checking\" : \"Sign in\"",
    "\"Comprobando\" : \"Ingresar\""
  ],
  [
    "          Team chat",
    "          Chat del equipo"
  ],
  [
    ">via cloud</span>",
    ">mediante la nube</span>"
  ],
  [
    "Nothing yet. Messages sent here reach the whole team and land in the\n          booth feed when it's back.",
    "Todavía no hay mensajes. Los que envíes acá llegan a todo el equipo y aparecen\n          en Control cuando vuelva a conectarse."
  ],
  [
    "placeholder=\"Message the team…\"",
    "placeholder=\"Mensaje para el equipo…\""
  ],
  [
    "            Send\n",
    "            Enviar\n"
  ],
  [
    "Set up your crew profile (when the booth is back) to send messages.",
    "Configurá tu perfil de equipo cuando vuelva Control para poder enviar mensajes."
  ],
  [
    "Enter your name (tap it above if it's listed).",
    "Ingresá tu nombre o tocalo arriba si aparece en la lista."
  ],
  [
    "PIN must be exactly 4 digits.",
    "El PIN debe tener exactamente 4 dígitos."
  ],
  [
    "PINs don't match.",
    "Los PIN no coinciden."
  ],
  [
    "          Join the crew",
    "          Sumate al equipo"
  ],
  [
    ">works booth-off</span>",
    ">funciona con Control apagado</span>"
  ],
  [
    "            Tap your name on this week's plan",
    "            Tocá tu nombre en el plan de esta semana"
  ],
  [
    "            or type it",
    "            o escribilo"
  ],
  [
    "placeholder=\"Your name\"",
    "placeholder=\"Tu nombre\""
  ],
  [
    "placeholder=\"4-digit PIN\"",
    "placeholder=\"PIN de 4 dígitos\""
  ],
  [
    "placeholder=\"Confirm PIN\"",
    "placeholder=\"Confirmar PIN\""
  ],
  [
    "\"Joining…\" : \"Join\"",
    "\"Ingresando…\" : \"Solicitar ingreso\""
  ],
  [
    "You can chat right away. The booth finishes your account (and an admin\n        approves it) the next time it's on.",
    "Podés chatear de inmediato. La próxima vez que se encienda Control se completa tu cuenta\n        y un administrador la aprueba."
  ],
  [
    " /> The booth is off",
    " /> Control está apagado"
  ],
  [
    "\"This week, live from Planning Center.\"",
    "\"Esta semana, directamente desde Planning Center.\""
  ],
  [
    "\"Waiting for it to come back.\"",
    "\"Esperando que vuelva a conectarse.\""
  ],
  [
    ">Your Sunday</div>",
    ">Tu semana</div>"
  ],
  [
    "\"Scheduled\"",
    "\"Programado\""
  ],
  [
    "`Call time, ${new Date(callTs).toLocaleDateString([], { weekday: \"long\" })}` : \"No call time set\"",
    "`Horario de convocatoria, ${new Date(callTs).toLocaleDateString([], { weekday: \"long\" })}` : \"Sin horario de convocatoria\""
  ],
  [
    "          Checklist\n",
    "          Lista de tareas\n"
  ],
  [
    "          Play Next Slide",
    "          Jugar a Next Slide"
  ],
  [
    ">This week</span>",
    ">Esta semana</span>"
  ],
  [
    "nextTime.name || nextTime.type || \"Service\"",
    "nextTime.name || nextTime.type || \"Evento\""
  ],
  [
    "chartable ? \"Chart\" : \"\"",
    "chartable ? \"Partitura\" : \"\""
  ],
  [
    "Who's on this week ({onTeam.length})",
    "Equipo de esta semana ({onTeam.length})"
  ],
  [
    "\"As the booth last sent it.\" : \"Tap a song for its chart. Pages and check in come back with the booth.\"",
    "\"Como lo envió Control por última vez.\" : \"Tocá una canción para ver su partitura. Los avisos y el registro de asistencia vuelven cuando se conecte Control.\""
  ],
  [
    "The week's plan wasn't reachable either. Check your connection.",
    "Tampoco se pudo acceder al plan de la semana. Revisá tu conexión."
  ],
  [
    "cloudCopyLine(edge?.sentMs ?? 0).replace(/^The booth is off\\. /, \"\")",
    "cloudCopyLine(edge?.sentMs ?? 0).replace(/^Control está apagado\\. /, \"\")"
  ]
];
it("preserves offline flows and user data outside reviewed copy", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/crewOfflineBaseline.txt", "utf8");
 for (const [from, to] of copy) { expect(expected.split(from)).toHaveLength(2); expected = expected.replace(from, to); }
 expect(readFileSync("src/mobile/CrewOffline.tsx", "utf8")).toBe(expected);
});
