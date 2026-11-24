import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const baseline = readFileSync("src/__tests__/fixtures/localization/healthStripBaseline.txt", "utf8");
const actual = readFileSync("src/components/HealthStrip.tsx", "utf8");
const copy: [string, string][] = [
  ["The slides computer. ProDeck follows it for lyrics, slides, and triggers.", "La computadora de proyección. ProDeck recibe de ella la letra, las diapositivas y las activaciones."],
  ["Connected and healthy.", "Conectado y funcionando."],
  ["Connection lost. Make sure ProPresenter is open on the presentation Mac — ProDeck reconnects by itself. Still red after a minute? Open the ProPresenter page and press Find.", "Se perdió la conexión con ProPresenter. Comprobá que esté abierto en la computadora de proyección. ProDeck se reconecta solo. Si después de un minuto sigue en rojo, abrí ProPresenter y seleccioná Buscar."],
  ["Not connected yet this session. Open the ProPresenter page and press Find.", "Todavía no se conectó en esta sesión. Abrí ProPresenter y seleccioná Buscar."],
  ["The service plan — the rundown, the team, call times.", "El plan del evento: el Crono, el equipo y los horarios de llegada."],
  ["Synced and live.", "Sincronizado y en vivo."],
  ["A plan is loaded but not syncing — open Planning Center and press Sync.", "Hay un plan cargado, pero no se está sincronizando. Abrí Planning Center y seleccioná Sincronizar."],
  ["No plan selected. Open Planning Center and pick this week's plan.", "No hay un plan seleccionado. Abrí Planning Center y elegí el plan de esta semana."],
  ["The mix feed ProDeck listens to (over the Dante network) for SPL and the phone Listen stream.", "La mezcla que ProDeck recibe por la red Dante para medir SPL y transmitir audio a los celulares."],
  ["Hearing sound.", "Recibiendo sonido."],
  ["Quiet — monitoring is off, or nothing is playing yet. That's normal before the band starts.", "No se recibe sonido. El monitoreo puede estar desactivado o todavía no hay reproducción. Es normal antes de que empiece la banda."],
  ["Sound was flowing and then stopped. Audio comes in over Dante — check the Dante route to this Mac and the network switch. The Routing page walks the whole chain.", "El sonido se interrumpió. Revisá el ruteo Dante hacia esta computadora y el switch de red. La página Ruteo muestra toda la cadena."],
  ["The room has been very loud for a while. Nothing is broken — check levels.", "El nivel de sonido de la sala lleva un tiempo muy alto. Revisá los niveles."],
  ["name: \"Sound desk\"", "name: \"Consola de sonido\""],
  ["Your sound console: Allen & Heath (Avantis, dLive, SQ, Qu-5/6/7), Behringer X32 / Midas M32, or Yamaha (CL, QL, TF). ProDeck mirrors mutes, faders, scenes and channel names.", "Tu consola de sonido: Allen & Heath (Avantis, dLive, SQ, Qu-5/6/7), Behringer X32 / Midas M32 o Yamaha (CL, QL, TF). ProDeck refleja el estado de muteo, los faders, las escenas y los nombres de canales."],
  ["name: \"Stage feed\"", "name: \"Señal de escenario\""],
  ["ProPresenter's stage output shared over the network (NDI) — the confidence screen.", "La salida de escenario de ProPresenter compartida por la red mediante NDI: la Pantalla Retorno."],
  ["Feed alive.", "Señal activa."],
  ["The stage feed dropped. Check ProPresenter is running and its NDI output is on, then the network.", "Se interrumpió la señal de escenario. Comprobá que ProPresenter esté abierto y su salida NDI activada; después revisá la red."],
  ["No stage feed in use right now.", "No se está usando una señal de escenario."],
  [": ${s.detail} — click for what to do", ": ${s.detail}. Seleccioná para ver qué hacer"],
];
it("preserves shared connection behavior outside reviewed text", () => {
  let expected = baseline;
  for (const [from, to] of copy) {
    expect(expected.split(from)).toHaveLength(2);
    expected = expected.replace(from, to);
  }
  expect(actual).toBe(expected);
});
