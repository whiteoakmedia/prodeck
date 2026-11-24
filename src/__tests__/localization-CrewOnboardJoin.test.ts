import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string, number][] = [
  [
    "`Tap the Share button (the square with an arrow, ${ipad ? \"at the top right\" : \"at the bottom of Safari\"})`",
    "`Tocá Compartir (el cuadrado con una flecha, ${ipad ? \"arriba a la derecha\" : \"abajo en Safari\"})`",
    1
  ],
  [
    "\"Scroll down, choose “Add to Home Screen”, then tap Add\"",
    "\"Deslizá hacia abajo, elegí “Agregar a inicio” y tocá Agregar\"",
    1
  ],
  [
    "\"Open ProDeck from your Home Screen. You'll sign in there, once\"",
    "\"Abrí ProDeck desde la pantalla de inicio. Vas a ingresar allí una sola vez\"",
    1
  ],
  [
    "\"Tap Install below\" : \"Open the Chrome menu (⋮), then Add to Home screen\"",
    "\"Tocá Instalar abajo\" : \"Abrí el menú de Chrome (⋮) y elegí Agregar a pantalla principal\"",
    1
  ],
  [
    "\"Open ProDeck from your home screen\"",
    "\"Abrí ProDeck desde la pantalla de inicio\"",
    1
  ],
  [
    "\"Sign in, then turn on notifications when ProDeck asks\"",
    "\"Ingresá y activá las notificaciones cuando ProDeck lo solicite\"",
    1
  ],
  [
    ">Now open ProDeck from your Home Screen</h1>",
    ">Ahora abrí ProDeck desde la pantalla de inicio</h1>",
    1
  ],
  [
    "Find the ProDeck icon and tap it. You can close Safari: you'll sign in and get pages in that copy.",
    "Buscá el ícono de ProDeck y tocalo. Podés cerrar Safari: vas a ingresar y recibir avisos desde esa aplicación.",
    1
  ],
  [
    "I don't see it, keep going in Safari",
    "No lo encuentro, continuar en Safari",
    1
  ],
  [
    "\"Add ProDeck to your Home Screen\" : \"Install ProDeck on this phone\"",
    "\"Agregá ProDeck a la pantalla de inicio\" : \"Instalá ProDeck en este celular\"",
    1
  ],
  [
    "\"Three taps, once. Safari can't send you pages until ProDeck lives on your Home Screen.\"",
    "\"Solo tenés que hacerlo una vez. Safari no puede enviar avisos hasta que agregues ProDeck a la pantalla de inicio.\"",
    1
  ],
  [
    "\"Installing lets ProDeck reach you when the app is closed.\"",
    "\"Al instalar ProDeck, podés recibir avisos aunque la aplicación esté cerrada.\"",
    1
  ],
  [
    "\"Notifications are how pages reach you when your phone is in your pocket. Without them ProDeck is silent.\"",
    "\"Las notificaciones permiten recibir avisos cuando guardás el celular. Sin ellas, ProDeck no te avisa.\"",
    1
  ],
  [
    "\"If pages seem to arrive late, allow ProDeck to run in the background in your battery settings.\"",
    "\"Si los avisos llegan tarde, permití que ProDeck funcione en segundo plano desde la configuración de batería.\"",
    1
  ],
  [
    "          Install\n",
    "          Instalar\n",
    1
  ],
  [
    "          Skip for now",
    "          Omitir por ahora",
    1
  ],
  [
    "\"I've added it\" : \"Continue in the browser\"",
    "\"Ya lo agregué\" : \"Continuar en el navegador\"",
    1
  ]
];
it("protects src/mobile/CrewOnboard.tsx behavior and values outside reviewed copy", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/CrewOnboardJoinBaseline.txt", "utf8");
 for (const [from, to, count] of copy) { expect(expected.split(from)).toHaveLength(count + 1); expected = expected.split(from).join(to); }
 expect(readFileSync("src/mobile/CrewOnboard.tsx", "utf8")).toBe(expected);
});
