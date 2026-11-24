import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string, number][] = [
  [
    "`${x.name} on ${x.line}${x.me || c.listen.includes(x.line) ? \"\" : \" (not listening)\"}`",
    "`${x.name} en ${x.line}${x.me || c.listen.includes(x.line) ? \"\" : \" (sin escuchar)\"}`",
    1
  ],
  [
    "\" (can't reach: are you both on the church Wi-Fi, not cellular?)\"",
    "\" (sin conexión: ¿ambos usan el Wi-Fi de la iglesia y no datos móviles?)\"",
    1
  ],
  [
    "\" (can't connect, retrying)\"",
    "\" (no conecta, reintentando)\"",
    1
  ],
  [
    "\" (dropped, reconnecting)\"",
    "\" (conexión interrumpida, reconectando)\"",
    1
  ],
  [
    "\" (connecting)\"",
    "\" (conectando)\"",
    1
  ],
  [
    "\"Joining comms…\" : c.needsTap ? \"Tap to rejoin comms\" : \"Join comms\"",
    "\"Conectando comunicaciones…\" : c.needsTap ? \"Tocá para volver a comunicaciones\" : \"Conectar comunicaciones\"",
    1
  ],
  [
    "\"Open mic: on\" : \"Open mic: off\"",
    "\"Micrófono abierto: sí\" : \"Micrófono abierto: no\"",
    1
  ],
  [
    "Leave comms",
    "Salir de comunicaciones",
    2
  ],
  [
    "aria-label=\"Back\"",
    "aria-label=\"Volver\"",
    1
  ],
  [
    "          Comms\n",
    "          Comunicaciones\n",
    1
  ],
  [
    "Talk to the crew on a line while you hold the button. Phones talk to each other over the\n            church Wi-Fi.",
    "Hablá con el equipo en una línea mientras mantenés presionado el botón. Los celulares se comunican\n            entre sí por el Wi-Fi de la iglesia.",
    1
  ],
  [
    "Wear earbuds, and keep ProDeck open with the screen on: a locked phone can't hear or talk.",
    "Usá auriculares y mantené ProDeck abierto con la pantalla encendida: un celular bloqueado no puede escuchar ni hablar.",
    1
  ],
  [
    "\"Joining…\" : \"Join comms\"",
    "\"Conectando…\" : \"Conectar comunicaciones\"",
    1
  ],
  [
    ">Talk on</div>",
    ">Hablar en</div>",
    1
  ],
  [
    "                Open mic\n",
    "                Micrófono abierto\n",
    1
  ],
  [
    "Talk without holding, until you turn it off. Starts muted: tap the button to talk.",
    "Hablá sin mantener presionado hasta que lo desactives. Empieza muteado: tocá el botón para hablar.",
    1
  ],
  [
    "aria-label=\"Open mic\"",
    "aria-label=\"Micrófono abierto\"",
    1
  ],
  [
    ">Listen to</div>",
    ">Escuchar</div>",
    1
  ],
  [
    "aria-label={`Listen to ${l}`}",
    "aria-label={`Escuchar ${l}`}",
    1
  ],
  [
    ">On comms ({others.length + 1})</div>",
    ">En comunicaciones ({others.length + 1})</div>",
    1
  ],
  [
    ">You</span>",
    ">Vos</span>",
    1
  ],
  [
    "        Tap to rejoin comms",
    "        Tocá para volver a comunicaciones",
    1
  ],
  [
    "`${t[0].name} on ${t[0].line}` : `Comms · ${c.talkOn}`",
    "`${t[0].name} en ${t[0].line}` : `Comunicaciones · ${c.talkOn}`",
    1
  ]
];
it("protects CrewComms behavior and user data outside reviewed translations", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/CrewCommsRoundBaseline.txt", "utf8");
 for (const [from, to, count] of copy) { expect(expected.split(from)).toHaveLength(count + 1); expected = expected.split(from).join(to); }
 expect(readFileSync("src/mobile/CrewComms.tsx", "utf8")).toBe(expected);
});
