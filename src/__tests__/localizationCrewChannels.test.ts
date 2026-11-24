import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const copy: [string, string][] = [
  [
    "label: \"Sunday Team\"",
    "label: \"Equipo\""
  ],
  [
    "\"No messages yet\"",
    "\"Todavía no hay mensajes\""
  ],
  [
    ">Team</span>",
    ">Equipo</span>"
  ],
  [
    ">My roles</span>",
    ">Mis roles</span>"
  ],
  [
    ">Other roles</span>",
    ">Otros roles</span>"
  ],
  [
    "Role channels appear as crew are given roles at the booth, or when\n            they pick their name off the plan when joining.",
    "Los canales por rol aparecen cuando se asignan roles desde Control o cuando\n            alguien elige su nombre del plan al ingresar."
  ],
  [
    "Channels aren't private: every crew device can read all of them.",
    "Los canales no son privados: todos los dispositivos del equipo pueden leerlos."
  ]
];

it("preserves behavior and caller data outside reviewed CrewChannels copy", () => {
  let expected = readFileSync("src/__tests__/fixtures/localization/CrewChannelsBaseline.txt", "utf8");
  for (const [from, to] of copy) {
    expect(expected.split(from)).toHaveLength(2);
    expected = expected.replace(from, to);
  }
  expect(readFileSync("src/mobile/CrewChannels.tsx", "utf8")).toBe(expected);
});
