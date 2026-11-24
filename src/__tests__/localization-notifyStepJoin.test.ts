import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string, number][] = [
  [
    "\"Feel pages on silent\"",
    "\"Recibí avisos con el celular en silencio\"",
    1
  ],
  [
    "\"On silent, an iPhone only buzzes for a page if Haptics is set to Always Play. Open Settings, tap Sounds & Haptics, then Haptics, and choose Always Play.\"",
    "\"Con el iPhone en silencio, los avisos vibran solo si la respuesta háptica está configurada en Reproducir siempre. Abrí Configuración, elegí Sonidos y vibración, luego Respuesta háptica y Reproducir siempre.\"",
    1
  ],
  [
    "\"Last step: turn on page notifications\"",
    "\"Último paso: activá las notificaciones de avisos\"",
    1
  ],
  [
    "\"Then a page from the booth buzzes your phone even when ProDeck is closed.\"",
    "\"Así, un aviso de Control puede hacer vibrar tu celular incluso con ProDeck cerrado.\"",
    1
  ],
  [
    "\"Turn on notifications\"",
    "\"Activar notificaciones\"",
    1
  ],
  [
    "\"Add ProDeck to your Home Screen\"",
    "\"Agregá ProDeck a la pantalla de inicio\"",
    1
  ],
  [
    "\"iPhones only deliver pages to ProDeck on the Home Screen: tap Share, then Add to Home Screen, then open ProDeck from there.\"",
    "\"En iPhone, los avisos llegan cuando ProDeck está en la pantalla de inicio. Tocá Compartir, elegí Agregar a inicio y abrí ProDeck desde allí.\"",
    1
  ],
  [
    "\"Show me how\"",
    "\"Ver cómo hacerlo\"",
    1
  ],
  [
    "\"Notifications are blocked\"",
    "\"Las notificaciones están bloqueadas\"",
    2
  ],
  [
    "\"Open the iPhone's Settings, tap Notifications, then ProDeck Crew, and turn on Allow Notifications. Then come back and tap Check again.\"",
    "\"Abrí Configuración del iPhone, elegí Notificaciones y ProDeck Crew, y activá Permitir notificaciones. Volvé acá y tocá Comprobar de nuevo.\"",
    1
  ],
  [
    "\"Open your phone's Settings, find ProDeck Crew under Notifications, and allow them. Then come back and tap Check again.\"",
    "\"Abrí la configuración del celular, buscá ProDeck Crew en Notificaciones y permitilas. Volvé acá y tocá Comprobar de nuevo.\"",
    1
  ],
  [
    "\"Check again\"",
    "\"Comprobar de nuevo\"",
    1
  ],
  [
    "\"Open the iPhone's Settings, tap Notifications, then ProDeck, and turn on Allow Notifications. Then come back here.\"",
    "\"Abrí Configuración del iPhone, elegí Notificaciones y ProDeck, y activá Permitir notificaciones. Después volvé acá.\"",
    1
  ],
  [
    "\"Open your phone's Settings, find ProDeck (or Chrome) under Notifications, and allow them. Then come back here.\"",
    "\"Abrí la configuración del celular, buscá ProDeck o Chrome en Notificaciones y permitilas. Después volvé acá.\"",
    1
  ],
  [
    "\"Pages can't reach this phone from this address\"",
    "\"Los avisos no pueden llegar a este celular desde esta dirección\"",
    2
  ],
  [
    "\"Notifications only work on the booth's secure address. Open it there, sign in with the same name and PIN, and add that one to your Home Screen.\"",
    "\"Las notificaciones solo funcionan desde la dirección segura de Control. Abrila, ingresá con el mismo nombre y PIN, y agregala a la pantalla de inicio.\"",
    1
  ],
  [
    "\"Open the secure address\"",
    "\"Abrir la dirección segura\"",
    1
  ],
  [
    "\"Notifications only work on a secure (https) address. Ask at the booth for it.\"",
    "\"Las notificaciones solo funcionan con una dirección segura (https). Pedila en Control.\"",
    1
  ]
];
it("protects src/lib/notifyStep.ts behavior and values outside reviewed copy", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/notifyStepJoinBaseline.txt", "utf8");
 for (const [from, to, count] of copy) { expect(expected.split(from)).toHaveLength(count + 1); expected = expected.split(from).join(to); }
 expect(readFileSync("src/lib/notifyStep.ts", "utf8")).toBe(expected);
});
