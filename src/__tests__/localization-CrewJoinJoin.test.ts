import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string, number][] = [
  [
    "`Someone here already uses the name ${name.trim()}. If that's you, type your PIN to sign in. If not, tap I'm new and add your last initial.`",
    "`Ya existe una cuenta con el nombre ${name.trim()}. Si es tuya, ingresá tu PIN. Si no, tocá Soy nuevo y agregá la inicial de tu apellido.`",
    1
  ],
  [
    "`No account called ${name.trim()} at this booth. Check the spelling, or join instead.`",
    "`No hay una cuenta llamada ${name.trim()} en Control. Revisá cómo escribiste tu nombre o solicitá el ingreso.`",
    1
  ],
  [
    "\"That account no longer exists at the booth. Join again below.\"",
    "\"Esa cuenta ya no existe en Control. Solicitá el ingreso nuevamente abajo.\"",
    1
  ],
  [
    "              Waiting for booth",
    "              Esperando a Control",
    1
  ],
  [
    ">You're all set. Waiting for the booth</p>",
    ">Listo. Esperando la aprobación de Control</p>",
    1
  ],
  [
    "`Requested ${pendingAt}. `",
    "`Solicitud enviada a las ${pendingAt}. `",
    1
  ],
  [
    "\"This screen checks every few seconds and signs you in the moment you're approved. Keep it open.\"",
    "\"Esta pantalla comprueba la aprobación cada pocos segundos y te permite ingresar apenas te aprueben. Dejala abierta.\"",
    1
  ],
  [
    "\"Enter your PIN below to check whether you've been approved.\"",
    "\"Ingresá tu PIN abajo para comprobar si te aprobaron.\"",
    1
  ],
  [
    "At the booth it's one tap: <strong>Settings → Crew Members → Approve</strong>.",
    "Desde Control se puede aprobar en <strong>Configuración → Integrantes del equipo → Aprobar</strong>.",
    1
  ],
  [
    "\"Checking…\" : \"Check now\"",
    "\"Comprobando…\" : \"Comprobar ahora\"",
    1
  ],
  [
    "`Welcome back, ${chat.name}`",
    "`Te damos la bienvenida, ${chat.name}`",
    1
  ],
  [
    "? \"Sign in\"",
    "? \"Ingresar\"",
    1
  ],
  [
    "`Almost there, ${name.split(\" \")[0]}!`",
    "`Ya falta poco, ${name.split(\" \")[0]}`",
    1
  ],
  [
    ": \"Join the crew\"",
    ": \"Sumate al equipo\"",
    1
  ],
  [
    "aria-label=\"New or returning\"",
    "aria-label=\"Cuenta nueva o existente\"",
    1
  ],
  [
    "[\"register\", \"I'm new\"]",
    "[\"register\", \"Soy nuevo\"]",
    1
  ],
  [
    "[\"signin\", \"I have an account\"]",
    "[\"signin\", \"Ya tengo cuenta\"]",
    1
  ],
  [
    "You're invited{role ? ` as ${role}` : \"\"} and already approved. Just\n          pick a 4-digit PIN below and you're in.",
    "Tenés una invitación{role ? ` como ${role}` : \"\"} y tu acceso ya está aprobado.\n          Elegí un PIN de 4 dígitos abajo para ingresar.",
    1
  ],
  [
    "Checking your invite…",
    "Comprobando tu invitación…",
    1
  ],
  [
    "\"Tap your name, or type it below\" : \"Tap your name on this week's plan\"",
    "\"Tocá tu nombre o escribilo abajo\" : \"Tocá tu nombre en el plan de esta semana\"",
    1
  ],
  [
    "m.position || \"No position\"",
    "m.position || \"Sin puesto\"",
    1
  ],
  [
    ">or type it</p>",
    ">o escribilo</p>",
    1
  ],
  [
    "placeholder=\"Your name\"",
    "placeholder=\"Tu nombre\"",
    1
  ],
  [
    "              Role: <strong>{role}</strong>",
    "              Rol: <strong>{role}</strong>",
    1
  ],
  [
    "\"Enter your 4-digit PIN\"",
    "\"Ingresá tu PIN de 4 dígitos\"",
    1
  ],
  [
    "\"Pick a 4 digit PIN. You'll use it to unlock on this phone\"",
    "\"Elegí un PIN de 4 dígitos. Lo vas a usar para ingresar desde este celular\"",
    1
  ],
  [
    "              Forgot\n",
    "              Olvidé mi PIN\n",
    1
  ],
  [
    "Ask the booth to reset you under <strong>Settings → Crew</strong>, then join again.",
    "Pedí en Control que restablezcan tu acceso en <strong>Configuración → Equipo</strong> y solicitá el ingreso nuevamente.",
    1
  ],
  [
    "            Use a different name",
    "            Usar otro nombre",
    1
  ],
  [
    "\"Sending…\" : \"Confirm PIN\"",
    "\"Enviando…\" : \"Confirmar PIN\"",
    1
  ],
  [
    "          Sign in\n",
    "          Ingresar\n",
    1
  ],
  [
    "aria-label=\"Delete\"",
    "aria-label=\"Borrar\"",
    1
  ]
];
it("protects src/mobile/CrewJoin.tsx behavior and values outside reviewed copy", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/CrewJoinJoinBaseline.txt", "utf8");
 for (const [from, to, count] of copy) { expect(expected.split(from)).toHaveLength(count + 1); expected = expected.split(from).join(to); }
 expect(readFileSync("src/mobile/CrewJoin.tsx", "utf8")).toBe(expected);
});
