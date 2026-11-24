import { describe, expect, it } from "vitest";
import { SECTIONS, sectionOf } from "../lib/settingsSections";
import { PERMS } from "../lib/tauri";

describe("vocabulario de configuración", () => {
  it("conserva identificadores y ubicaciones, y muestra las secciones traducidas", () => {
    expect(SECTIONS.map(({ id, label }) => [id, label])).toEqual([
      ["connections", "Conexiones"], ["sound", "Sonido"], ["automation", "Automatización"],
      ["online", "En línea"], ["crew", "Equipo y pantallas"], ["app", "Aplicación y ayuda"],
    ]);
    expect(SECTIONS.map(s => s.blurb)).toEqual([
      "ProPresenter, consola de sonido, OBS y señales de cámara.",
      "Audio que recibe ProDeck, grabación, tonalidades y música de entrada.",
      "Seguimiento de la letra, mezcla de la banda, micrófonos de voz y acciones de botones.",
      "Church Online, audiencia en vivo y discos de donaciones TapLink.",
      "Cuentas del equipo, avisos programados, celulares, pantallas públicas, Tally y comunicaciones.",
      "Actualizaciones, ayuda, resolución de problemas, copias de seguridad y apariencia de ProDeck.",
    ]);
    expect(sectionOf("set-pp")).toBe("connections");
    expect(sectionOf("set-crew")).toBe("crew");
    expect(sectionOf("set-unknown")).toBe("app");
  });
  it("traduce permisos sin cambiar sus claves ni su orden", () => {
    expect(PERMS.map(({ id, label, blurb }) => [id, label, blurb])).toEqual([
      ["page", "Avisos", "Enviar avisos y volver a notificarlos"],
      ["stage", "Escenario", "Mostrar texto en las pantallas de escenario y Pantalla Retorno"],
      ["control", "Control", "Controlar ProPresenter, la consola de sonido, escenas de OBS y Planning Center LIVE"],
      ["tap", "Discos TapLink", "Cambiar el destino de los discos NFC del vestíbulo"],
      ["manage", "Administrar equipo", "Aprobar, editar y quitar integrantes; gestionar invitaciones y acceso"],
      ["director", "Director", "Pestaña Director en el celular: avisos, cronograma, pantallas y video. Incluye Avisos, Escenario y Control"],
    ]);
  });
});
