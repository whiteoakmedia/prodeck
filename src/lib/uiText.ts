// Application-owned presentation only. Never apply these entries as replacements
// to user content, identifiers, integration payloads or persisted data.
export const glossary = {
  // Church program/service only, never technical service identifiers.
  service: "Evento", program: "Evento",
  autoFollow: "Seguimiento automático", confidenceBanner: "Aviso en Pantalla Retorno",
  rundown: "Crono",
  runOrderNowNext: "En curso y próximo", // Run Order (Now/Next)
  runOfShowTiming: "Tiempos del Crono", // Run-of-Show Timing
  showFlow: "Orden del evento", // Show Flow
  nowHeading: "Ahora", nowItemState: "En curso", next: "Próximo",
  // Hold/Release on Automix only, not generic pause/resume actions.
  automixHold: "Pausar automatización", automixRelease: "Reanudar automatización",
  crew: "Equipo", booth: "Control", stage: "Escenario", page: "Aviso", paging: "Enviar aviso",
  routing: "Ruteo", setup: "Configuración inicial", soundDesk: "Consola de sonido", console: "Consola de sonido",
  commandCenter: "Centro de control", dashboard: "Panel de control", dashboardExpanded: "Panel de control",
  settings: "Configuración", team: "Equipo", devices: "Dispositivos", equipment: "Equipamiento",
} as const;

export const preservedTerms = ["Props", "Clear", "Automix", "Home", "Tally"] as const;

export const uiText = {
  cancel: "Cancelar",
  ok: "Aceptar",
  close: "Cerrar",
  back: "Atrás",
  step: (current: number, total: number): string => `Paso ${current} de ${total}`,
};
