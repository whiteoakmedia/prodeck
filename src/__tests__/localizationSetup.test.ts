import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baseline = readFileSync("src/__tests__/fixtures/localization/setupBaseline.txt", "utf8");
const actual = readFileSync("src/pages/Setup.tsx", "utf8");
const copy: [string, string][] = [
  ["ok: \"Connected\"", "ok: \"Conectado\""],
  ["idle: \"Not set up\"", "idle: \"Sin configurar\""],
  ["warn: \"Attention\"", "warn: \"Atención\""],
  ["bad: \"Problem\"", "bad: \"Problema\""],
  ["<h1>Setup</h1>", "<h1>Configuración</h1>"],
  ["{greens}/{rows.length} connected", "{greens}/{rows.length} conexiones activas"],
  ["ProDeck is the hub — it only shows what your other tools tell it. Each\n            row below is one connection: green means it's working, anything else\n            says exactly what to do. Nothing here is required; set up what you use\n            and ignore the rest.", "ProDeck reúne la información que recibe de tus otras herramientas. Cada\n            fila representa una conexión: el verde indica que funciona y los demás\n            estados explican qué hacer. Configurá lo que uses; el resto es opcional."],
  ["s.state === \"idle\" ? \"Set up\" : \"Fix\"", "s.state === \"idle\" ? \"Configurar\" : \"Resolver\""],
  ["<h3>Add the rest</h3>", "<h3>Configurá lo demás</h3>"],
  ["Browser access &amp; crew", "Acceso desde el navegador y equipo"],
  ["Dashboards on phones and kiosks, crew approvals, passwords.", "Paneles de control en celulares y pantallas públicas, aprobación de integrantes y contraseñas."],
  ["Audio, console &amp; MIDI", "Audio, consola de sonido y MIDI"],
  ["SPL metering, the Allen &amp; Heath console mirror, song-key send — each its own card.", "Medición de SPL, conexión con la consola Allen &amp; Heath y envío de tonalidad. Cada opción tiene su propia sección."],
  ["Live viewers &amp; reports", "Audiencia en vivo e informes"],
  ["GA4 watch-page count and per-service timing / SPL reports.", "Cantidad de espectadores de GA4 e informes de tiempos y SPL por evento."],
  ["Multitrack recording", "Grabación multipista"],
  ["Record every channel to its own track: pick the source, check levels, name tracks, choose a drive.", "Grabá cada canal en una pista: elegí la fuente, revisá los niveles, nombrá las pistas y seleccioná una unidad."],
  ["Let ProDeck ride your faders through each song: your console, which fader is which, and song timing.", "Dejá que ProDeck ajuste los faders durante cada canción: configurá la consola, los faders y los tiempos."],
  ["Re-run the walkthrough", "Volver a Primeros pasos"],
  ["The guided first-run tour: what ProDeck does, what it connects, and each connection step by step.", "La guía inicial: qué hace ProDeck, con qué se conecta y cómo configurar cada conexión."],
  ["The full phased guide — tap discs, kiosks, your own domain, booth-off\n        resilience — is <code>docs/ADOPTERS_GUIDE.html</code> in the ProDeck\n        download.", "La guía completa por etapas incluye discos de acceso, pantallas públicas,\n        dominio propio y funcionamiento sin Control. Está en <code>docs/ADOPTERS_GUIDE.html</code>\n        dentro de la descarga de ProDeck."],
  ["Start by connecting ProPresenter above.", "Empezá conectando ProPresenter arriba."],
];
describe("setup localization", () => {
  it("preserves source outside reviewed presentation", () => {
    let expected = baseline;
    for (const [from, to] of copy) {
      expect(expected.split(from)).toHaveLength(2);
      expected = expected.replace(from, to);
    }
    expect(actual).toBe(expected);
  });
});
