import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string][] = [
  [
    ">More</h1>",
    ">Más</h1>"
  ],
  [
    "chat.name || \"This phone\"",
    "chat.name || \"Este celular\""
  ],
  [
    "isAdmin ? \"Admin\" : \"Crew member\"",
    "isAdmin ? \"Administrador\" : \"Integrante del equipo\""
  ],
  [
    "<MoreGroup label=\"Tools\">",
    "<MoreGroup label=\"Herramientas\">"
  ],
  [
    "title=\"Comms\" sub=\"Talk to the crew\"",
    "title=\"Comunicaciones\" sub=\"Hablar con el equipo\""
  ],
  [
    "title=\"No sound?\" sub=\"Find the fault, step by step\"",
    "title=\"¿Sin sonido?\" sub=\"Encontrá el problema paso a paso\""
  ],
  [
    "title=\"Leader board\" sub=\"Who's here, who needs help\"",
    "title=\"Panel del equipo\" sub=\"Quiénes están presentes y quiénes necesitan ayuda\""
  ],
  [
    "<MoreGroup label=\"Notifications\">",
    "<MoreGroup label=\"Notificaciones\">"
  ],
  [
    "title=\"Message sounds\"",
    "title=\"Sonidos de mensajes\""
  ],
  [
    "aria-label=\"Message sounds\"",
    "aria-label=\"Sonidos de mensajes\""
  ],
  [
    "sub=\"While the app is open. Pages always ring.\"",
    "sub=\"Mientras la aplicación está abierta. Los avisos siempre suenan.\""
  ],
  [
    "<MoreGroup label=\"Account\">",
    "<MoreGroup label=\"Cuenta\">"
  ],
  [
    "title=\"Switch church\"",
    "title=\"Cambiar de iglesia\""
  ],
  [
    "title=\"Full view\" sub=\"Every page and dashboard\"",
    "title=\"Vista completa\" sub=\"Todas las páginas y paneles de control\""
  ],
  [
    "title=\"Lock\" sub=\"Ask for my PIN again\"",
    "title=\"Bloquear\" sub=\"Pedir mi PIN nuevamente\""
  ],
  [
    "title=\"Sign out\"",
    "title=\"Salir\""
  ],
  [
    "sub=\"Forget this phone\"",
    "sub=\"Desvincular este celular\""
  ],
  [
    "\"You can send pages from Chat.\"",
    "\"Podés enviar avisos desde Chat.\""
  ],
  [
    "\"Members can chat, check in and confirm pages. Booth controls need an admin sign in.\"",
    "\"Los integrantes pueden chatear, registrar asistencia y confirmar avisos. Para controlar ProDeck se necesita acceso de administrador.\""
  ],
  [
    "title=\"Delete my account\"",
    "title=\"Eliminar mi cuenta\""
  ],
  [
    "This removes your ProDeck crew account from the booth: your sign-in, PIN and notifications. Planning\n        Center isn't changed, so you stay on the schedule, and your name is still there to tap if you join again.\n        Chat messages you sent stay.",
    "Esto elimina tu cuenta del equipo en Control, incluidos tu acceso, PIN y notificaciones. Planning\n        Center no cambia: seguís en el cronograma y tu nombre estará disponible si volvés a ingresar.\n        Los mensajes que enviaste permanecen en el chat."
  ],
  [
    "\"Deleting…\" : \"Delete my account\"",
    "\"Eliminando…\" : \"Eliminar mi cuenta\""
  ],
  [
    "          Keep it",
    "          Conservarla"
  ],
  [
    "title=\"Tally light\" sub=\"Use this phone at a camera\"",
    "title=\"Luz Tally\" sub=\"Usar este celular en una cámara\""
  ],
  [
    "on: \"Pages reach you even when it's closed\"",
    "on: \"Los avisos llegan incluso con la aplicación cerrada\""
  ],
  [
    "off: \"Off: pages only show while it's open\"",
    "off: \"Desactivadas: los avisos solo aparecen con la aplicación abierta\""
  ],
  [
    "\"This browser is refusing notifications for ProDeck. That also happens if the permission pop-up was dismissed. Allow notifications for this site in your browser settings, then come back.\"",
    "\"El navegador no permite las notificaciones de ProDeck. También puede pasar si cerraste el pedido de permiso. Permití las notificaciones para este sitio en la configuración del navegador y volvé acá.\""
  ],
  [
    "\"Not available on this plain (http) address. Open ProDeck from the booth's secure address to turn them on.\"",
    "\"No están disponibles en esta dirección sin seguridad (http). Abrí ProDeck desde la dirección segura de Control para activarlas.\""
  ],
  [
    "\"Add ProDeck to your Home Screen first. iPhones send no notifications to a browser tab.\"",
    "\"Agregá primero ProDeck a la pantalla de inicio. El iPhone no envía notificaciones a una pestaña del navegador.\""
  ],
  [
    "unsupported: \"This browser can't do push notifications.\"",
    "unsupported: \"Este navegador no admite notificaciones push.\""
  ],
  [
    "copy.on = \"Pages will buzz this phone even when ProDeck Crew is closed.\"",
    "copy.on = \"Los avisos pueden hacer vibrar este celular aunque ProDeck Crew esté cerrado.\""
  ],
  [
    "copy.denied = \"Notifications are off for ProDeck Crew. Turn them on in the phone's Settings, under Notifications, then tap the switch.\"",
    "copy.denied = \"Las notificaciones de ProDeck Crew están desactivadas. Activalas en la configuración del celular, en Notificaciones, y después tocá el interruptor.\""
  ],
  [
    "copy.unsupported = \"Pages can't buzz this phone yet. Keep ProDeck Crew open during the service and pages still show.\"",
    "copy.unsupported = \"Los avisos todavía no pueden hacer vibrar este celular. Mantené ProDeck Crew abierto durante el evento para verlos.\""
  ],
  [
    "aria-label=\"Page notifications\"",
    "aria-label=\"Notificaciones de avisos\""
  ],
  [
    "title=\"Page notifications\"",
    "title=\"Notificaciones de avisos\""
  ],
  [
    "\"Listening to booth audio\" : \"Connecting…\"",
    "\"Escuchando el audio de Control\" : \"Conectando…\""
  ],
  [
    ">Stop</span>",
    ">Detener</span>"
  ],
  ['Pick something on the left.', 'Elegí una opción de la izquierda.']
];
it("preserves mobile navigation and actions outside reviewed copy", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/MobileShellNavBaseline.txt", "utf8");
 for (const [from, to] of copy) { expect(expected.split(from)).toHaveLength(2); expected = expected.replace(from, to); }
 expect(readFileSync("src/mobile/MobileShell.tsx", "utf8")).toBe(expected);
});
