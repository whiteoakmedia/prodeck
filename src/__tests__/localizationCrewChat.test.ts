import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const copy: [string, string][] = [
  [
    "`Message ${channel?.label ?? \"Sunday Team\"}`",
    "`Mensaje para ${channel?.label ?? \"el equipo\"}`"
  ],
  [
    "\"Send to Stage\"",
    "\"Mensaje a escenario\""
  ],
  [
    "\"Send to Confidence\"",
    "\"Aviso en Pantalla Retorno\""
  ],
  [
    "aria-label=\"Back\"",
    "aria-label=\"Volver\""
  ],
  [
    ">Admin</span>",
    ">Administrador</span>"
  ],
  [
    "No messages yet. Say something.",
    "Todavía no hay mensajes. Escribí el primero."
  ],
  [
    ">New</span>",
    ">Nuevo</span>"
  ],
  [
    "→ {m.target} · {hhmm(m.ts)}",
    "→ {m.target === \"stage\" ? \"Escenario\" : m.target === \"confidence\" ? \"Pantalla Retorno\" : m.target === \"screen\" ? \"Pantalla\" : m.target} · {hhmm(m.ts)}"
  ],
  [
    "                Page → {p.recipients.length}",
    "                Aviso → {p.recipients.length}"
  ],
  [
    "{p.receipts.length}/{p.recipients.length} read",
    "{p.receipts.length}/{p.recipients.length} confirmaron"
  ],
  [
    "t === \"team\" ? \"Team\" : t === \"stage\" ? \"Stage\" : \"Confidence\"",
    "t === \"team\" ? \"Equipo\" : t === \"stage\" ? \"Escenario\" : \"Pantalla Retorno\""
  ],
  [
    "aria-label=\"Send\"",
    "aria-label=\"Enviar\""
  ],
  [
    "              Page\n",
    "              Enviar aviso\n"
  ],
  [
    "            Clear confidence banner",
    "            Quitar aviso de Pantalla Retorno"
  ]
];

it("preserves behavior and caller data outside reviewed CrewChat copy", () => {
  let expected = readFileSync("src/__tests__/fixtures/localization/CrewChatBaseline.txt", "utf8");
  for (const [from, to] of copy) {
    expect(expected.split(from)).toHaveLength(2);
    expected = expected.replace(from, to);
  }
  expect(readFileSync("src/mobile/CrewChat.tsx", "utf8")).toBe(expected);
});
