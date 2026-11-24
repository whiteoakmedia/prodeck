import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const copy: [string, string][] = [
  [
    "Thanks, {ticket.name.split(\" \")[0]}",
    "Gracias, {ticket.name.split(\" \")[0]}"
  ],
  [
    "Ask whoever is at the production computer to approve you. They'll see your name under\n              Crew Members. Keep this page open and you'll be let in as soon as they do.",
    "Pedile a quien esté en Control que apruebe tu solicitud. Verá tu nombre en\n              Integrantes del equipo. Dejá esta página abierta para ingresar apenas te aprueben."
  ],
  [
    "Waiting for the booth…",
    "Esperando la aprobación de Control…"
  ],
  [
    "Start over",
    "Empezar de nuevo"
  ],
  [
    "Join the crew",
    "Sumate al equipo"
  ],
  [
    "The booth didn't approve that request. Check with whoever is at the production computer, then try again.",
    "No se aprobó la solicitud. Consultá con quien esté en Control y volvé a intentarlo."
  ],
  [
    "Your name and a PIN you'll remember. The booth approves you, then you're in.",
    "Ingresá tu nombre y un PIN que recuerdes. Podrás entrar cuando aprueben tu solicitud desde Control."
  ],
  [
    "placeholder=\"Your name\"",
    "placeholder=\"Tu nombre\""
  ],
  [
    "placeholder=\"4 digit PIN\"",
    "placeholder=\"PIN de 4 dígitos\""
  ],
  [
    "\"Sending…\" : \"Ask to join\"",
    "\"Enviando…\" : \"Solicitar ingreso\""
  ]
];

describe("poster join localization", () => {
  it("changes only reviewed presentation text", () => {
    let expected = readFileSync("src/__tests__/fixtures/localization/posterJoinBaseline.txt", "utf8");
    for (const [from, to] of copy) {
      expect(expected.split(from)).toHaveLength(2);
      expected = expected.replace(from, to);
    }
    expect(readFileSync("src/components/PosterJoin.tsx", "utf8")).toBe(expected);
  });
});
