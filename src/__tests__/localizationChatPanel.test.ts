import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const copy: [string, string, number][] = [
  [
    " — waiting for booth approval.",
    " — esperando la aprobación de Control.",
    1
  ],
  [
    "Ask at the booth (or an admin phone) to approve you under Settings →\n          Crew, then tap below.",
    "Pedí que te aprueben desde Control o desde el celular de un administrador, en Configuración →\n          Equipo. Después, tocá el botón de abajo.",
    1
  ],
  [
    "I'm approved — sign in",
    "Ya me aprobaron: ingresar",
    1
  ],
  [
    "placeholder=\"Your 4-digit PIN\"",
    "placeholder=\"Tu PIN de 4 dígitos\"",
    1
  ],
  [
    "<strong>Join the crew</strong> — pick a name and a 4-digit PIN.",
    "<strong>Sumate al equipo</strong>: elegí un nombre y un PIN de 4 dígitos.",
    1
  ],
  [
    "placeholder=\"Your name\"",
    "placeholder=\"Tu nombre\"",
    1
  ],
  [
    "placeholder=\"4-digit PIN\"",
    "placeholder=\"PIN de 4 dígitos\"",
    1
  ],
  [
    "          Join\n",
    "          Solicitar ingreso\n",
    1
  ],
  [
    "          Sign in\n",
    "          Ingresar\n",
    1
  ],
  [
    "<strong>No messages yet</strong>",
    "<strong>Todavía no hay mensajes</strong>",
    1
  ],
  [
    "Messages to the whole crew show up here.",
    "Los mensajes para todo el equipo aparecen acá.",
    1
  ],
  [
    "Messages reach the crew on their phones. Use To for the stage displays or a TV screen, and Page when someone has to answer.",
    "Los mensajes llegan a los celulares del equipo. Elegí el destino para enviarlos al escenario o a una pantalla, y usá Enviar aviso cuando necesites una respuesta.",
    1
  ],
  [
    "{m.target}</span>",
    "{m.target === \"stage\" ? \"Escenario\" : m.target === \"confidence\" ? \"Pantalla Retorno\" : m.target === \"screen\" ? \"Pantalla\" : m.target}</span>",
    1
  ],
  [
    "              Page → {p.recipients.length}",
    "              Aviso → {p.recipients.length}",
    1
  ],
  [
    "{p.receipts.length}/{p.recipients.length} read",
    "{p.receipts.length}/{p.recipients.length} leídos",
    1
  ],
  [
    "<span className=\"muted small\">To</span>",
    "<span className=\"muted small\">Para</span>",
    1
  ],
  [
    "title=\"Destination\"",
    "title=\"Destino\"",
    1
  ],
  [
    "<option value=\"team\">Team</option>",
    "<option value=\"team\">Equipo</option>",
    1
  ],
  [
    "<option value=\"stage\">Stage</option>",
    "<option value=\"stage\">Escenario</option>",
    1
  ],
  [
    "<option value=\"confidence\">Confidence</option>",
    "<option value=\"confidence\">Pantalla Retorno</option>",
    1
  ],
  [
    "<optgroup label=\"Kiosks and TV screens\">",
    "<optgroup label=\"Pantallas públicas y televisores\">",
    1
  ],
  [
    "<option value=\"screen:all\">All screens</option>",
    "<option value=\"screen:all\">Todas las pantallas</option>",
    1
  ],
  [
    "                  {n} screen",
    "                  Pantalla {n}",
    1
  ],
  [
    "title=\"Send a page. It buzzes the chosen crew until each one confirms.\"",
    "title=\"Enviar un aviso. Se notifica a los integrantes elegidos hasta que cada uno confirme.\"",
    1
  ],
  [
    "            Page someone",
    "            Enviar aviso",
    1
  ],
  [
    "\"Message the crew…\"",
    "\"Mensaje para el equipo…\"",
    1
  ],
  [
    "\"Text for the stage displays…\"",
    "\"Mensaje a escenario…\"",
    1
  ],
  [
    "`Message for ${screen ? `the ${screen} screen` : \"every screen\"}…`",
    "`Mensaje para ${screen ? `la pantalla ${screen}` : \"todas las pantallas\"}…`",
    1
  ],
  [
    "\"Banner for confidence screens…\"",
    "\"Aviso en Pantalla Retorno…\"",
    1
  ],
  [
    "          Send\n",
    "          Enviar\n",
    1
  ],
  [
    "title=\"Take the message off the screen\"",
    "title=\"Quitar el mensaje de la pantalla\"",
    1
  ],
  [
    "title=\"Clear the confidence banner\"",
    "title=\"Quitar el aviso de Pantalla Retorno\"",
    1
  ],
  [
    "            Clear\n",
    "            Quitar\n",
    2
  ]
];

it("translates chat presentation while preserving behavior and values", () => {
  let expected = readFileSync("src/__tests__/fixtures/localization/chatPanelBaseline.txt", "utf8");
  for (const [from, to, count] of copy) {
    expect(expected.split(from)).toHaveLength(count + 1);
    expected = expected.split(from).join(to);
  }
  expect(readFileSync("src/components/ChatPanel.tsx", "utf8")).toBe(expected);
});
