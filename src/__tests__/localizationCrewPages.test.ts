import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const copy: [string, string][] = [
  [
    "Page from {incoming.from.split(/\\s+/)[0] || \"the booth\"}",
    "Aviso de {incoming.from.split(/\\s+/)[0] || \"Control\"}"
  ],
  [
    "{acking ? \"Sending…\" : fatal ? \"Dismiss\" : \"Got it\"}",
    "{acking ? \"Enviando…\" : fatal ? \"Cerrar\" : \"Entendido\"}"
  ],
  [
    "          Page · {hhmm(incoming.sent_ms)}",
    "          Aviso · {hhmm(incoming.sent_ms)}"
  ],
  [
    "\"Booth · buzzing until you confirm\" : \"Booth\"",
    "\"Control · notificación repetida hasta confirmar\" : \"Control\""
  ],
  [
    "{acking ? \"Sending…\" : \"Got it\"}",
    "{acking ? \"Enviando…\" : \"Entendido\"}"
  ],
  [
    "\" Try again.\"",
    "\" Intentá de nuevo.\""
  ],
  [
    "              Dismiss this page",
    "              Cerrar este aviso"
  ],
  [
    "Tap anywhere in the green to confirm",
    "Tocá la zona verde para confirmar"
  ],
  [
    "const PRESETS = [\"Standby\", \"Go to black\", \"Mic check\", \"Cam 2 hot\"];",
    "const PRESETS = [\"Preparados\", \"Pasar a negro\", \"Prueba de micrófono\", \"Cámara 2 al aire\"];"
  ],
  [
    "          Cancel\n",
    "          Cancelar\n"
  ],
  [
    ">Send a page</span>",
    ">Enviar aviso</span>"
  ],
  [
    "placeholder=\"What do they need to do?\"",
    "placeholder=\"¿Qué necesitan hacer?\""
  ],
  [
    ">Recipients</span>",
    ">Destinatarios</span>"
  ],
  [
    "t === \"person\" ? \"Person\" : t === \"role\" ? \"Role\" : includeAll ? \"Everyone\" : \"This Sunday\"",
    "t === \"person\" ? \"Persona\" : t === \"role\" ? \"Rol\" : includeAll ? \"Todos\" : \"Esta semana\""
  ],
  [
    "Include people not here or on this week&apos;s plan",
    "Incluir a quienes no están presentes ni en el plan de esta semana"
  ],
  [
    "` (${othersCount} more)`",
    "` (${othersCount} más)`"
  ],
  [
    "No roles set yet. Give people a role under Settings, Crew Members.",
    "Todavía no hay roles. Asignalos en Configuración, Integrantes del equipo."
  ],
  [
    "\"with accounts\" : \"here or scheduled\"",
    "\"con cuenta\" : \"presentes o programados\""
  ],
  [
    "No approved crew yet. Approve someone under Settings, Crew Members.",
    "Todavía no hay integrantes aprobados. Aprobá a alguien en Configuración, Integrantes del equipo."
  ],
  [
    ">notifications off</span>",
    ">notificaciones desactivadas</span>"
  ],
  [
    "                      seen {hhmm(u.last_seen_ms)}",
    "                      visto a las {hhmm(u.last_seen_ms)}"
  ],
  [
    ">Buzz until read</div>",
    ">Notificar hasta confirmar</div>"
  ],
  [
    "Re-fires to whoever hasn't confirmed",
    "Vuelve a notificar a quienes no confirmaron"
  ],
  [
    "{busy ? \"Sending…\" : here === null ? \"Loading who's here…\" : `Send page to ${count}`}",
    "{busy ? \"Enviando…\" : here === null ? \"Cargando integrantes presentes…\" : `Enviar aviso a ${count}`}"
  ],
  [
    ">Page · {hhmm(page.sent_ms)}</span>",
    ">Aviso · {hhmm(page.sent_ms)}</span>"
  ],
  [
    "          Done\n",
    "          Listo\n"
  ],
  [
    "{read.length} of {page.recipients.length} read",
    "{read.length} de {page.recipients.length} confirmaron"
  ],
  [
    "{elapsed(secsSince(page.sent_ms))} elapsed",
    "{elapsed(secsSince(page.sent_ms))} transcurridos"
  ],
  [
    ">Waiting</span>",
    ">Pendientes</span>"
  ],
  [
    "                    last seen {hhmm(lastSeen(r.id))}",
    "                    última conexión {hhmm(lastSeen(r.id))}"
  ],
  [
    ">Read</span>",
    ">Confirmados</span>"
  ],
  [
    "setMsg(`Re-buzzed ${n}.`)",
    "setMsg(`Se volvió a notificar a ${n}.`)"
  ],
  [
    "          Re-buzz {waiting.length}",
    "          Volver a notificar a {waiting.length}"
  ]
];

it("translates page flows while protecting recipients, acknowledgement and caller data", () => {
  let expected = readFileSync("src/__tests__/fixtures/localization/crewPagesBaseline.txt", "utf8");
  for (const [from, to] of copy) {
    expect(expected.split(from)).toHaveLength(2);
    expected = expected.replace(from, to);
  }
  expect(readFileSync("src/mobile/CrewPages.tsx", "utf8")).toBe(expected);
});
