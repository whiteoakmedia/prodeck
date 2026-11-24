import type { RNode, Rule, SourceKind, Transport } from "./routing";

// Presentation only. Persisted map steps and customized rules are never changed.
const sources: Record<SourceKind, string[]> = {
  wireless: [
    "¿El transmisor está encendido? Revisá su pantalla.",
    "¿Está encendida la luz de RF de ese canal en el receptor? Si no hay RF, revisá el transmisor antes que la consola.",
    "Revisá la batería. Cambiala aunque indique media carga.",
    "Si sigue sin funcionar, probá otro transmisor. Conservá el receptor: rara vez es el problema.",
  ],
  socket: [
    "¿El cable está en el conector correcto? Los conectores punteados del mapa no conectan.",
    "Probá otro cable que sepas que funciona en el mismo conector.",
    "Probá el conector libre de al lado y avisá a Control cuál usaste.",
  ],
  playback: [
    "¿La aplicación de reproducción está abierta y reproduciendo? Revisá si se mueven los medidores.",
    "¿La aplicación tiene seleccionado el dispositivo de salida correcto? Puede cambiar después de actualizar o reiniciar.",
    "¿El canal de la pista está enviado a la salida correcta de la computadora?",
  ],
  consumer: [
    "¿La aplicación está reproduciendo y no quedó pausada en otro dispositivo Bluetooth?",
    "¿La salida está configurada en la interfaz y no en los parlantes integrados?",
    "Subí el volumen de la fuente al máximo; el resto se ajusta desde la consola.",
  ],
  rackxlr: ["¿El XLR está bien conectado en ambos extremos? Probá otro cable.", "¿El equipo está encendido y enviando señal?"],
  dante: [
    "En Dante Controller, ¿el equipo aparece conectado en verde?",
    "¿Su canal sigue suscripto a la consola, con una marca verde y sin advertencias?",
    "Reloj: un solo equipo debe ser maestro. Un reloj rojo indica un problema de red, no del micrófono.",
  ],
  other: ["¿Tiene alimentación, está conectado y encendido?", "Probá otro cable."],
};
const doors: Record<Transport, string[]> = {
  slink: ["¿La caja de escenario está encendida y su luz SLink está fija? Si parpadea, no hay conexión con la consola.", "Un cable Cat5 transporta todos los canales del escenario. Si fallan varios a la vez, revisá ese cable o la caja."],
  dante: ["¿La tarjeta Dante de la consola aparece conectada en Dante Controller?", "¿La fuente sigue suscripta a esta entrada del puerto? Un cambio de ruteo puede quitarla sin avisar.", "Revisá las luces de conexión del switch de red y PoE si el equipo lo necesita."],
  local: ["¿El XLR está bien conectado en el rack? Probá otro cable."],
  me: ["¿El hub ME está encendido y el Cat5 conectado a la consola?"],
  analog: ["Probá otro cable.", "Revisá que ambos extremos estén en los conectores correctos."],
  other: ["¿La conexión entre estos dos equipos tiene alimentación y está conectada?"],
};

export function spanishDefaultSteps(n: RNode): string[] {
  if (n.kind === "source") return sources[n.sourceKind ?? "other"];
  if (n.kind === "door") return doors[n.transport ?? "other"];
  if (n.kind === "channel") {
    const channel = n.ref?.index ?? n.label;
    return [
      `En la consola, ¿el canal ${channel} está desmuteado y con el fader arriba?`,
      `¿El canal ${channel} sigue conectado al conector indicado en esta lista? Una escena puede cambiarlo.`,
      "¿El canal está asignado a la mezcla principal?",
    ];
  }
  if (n.kind === "bus") return [`¿El bus ${n.label} está desmuteado y su master arriba?`];
  if (n.kind === "output") return [`¿La salida ${n.label} está conectada y su cable bien colocado?`];
  if (n.kind === "destination") return [`¿${n.label} está encendido y tiene seleccionada la entrada correcta?`];
  return [];
}

export function spanishBuiltinRule(rule: Rule, originals: Rule[]): string {
  const original = originals.find(r => r.id === rule.id && r.when === rule.when);
  if (!original || original.text !== rule.text) return rule.text;
  switch (rule.when) {
    case "shared-socket": return "La ganancia y los 48 V pertenecen al conector, no al canal: dos canales conectados al mismo conector comparten un preamplificador. Ajustá la ganancia en la entrada.";
    case "stereo-pair": return "Un canal estéreo usa un par de conectores impar y par. El impar siempre es el izquierdo. Si falta un solo lado, revisá el cable o conector de ese lado.";
    case "names-change": return "Los nombres de canal cambian en cada evento. Guiate por los números de esta lista, no por el nombre de la consola.";
    default: return rule.text;
  }
}
