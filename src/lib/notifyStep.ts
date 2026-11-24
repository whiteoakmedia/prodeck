// The last onboarding step, on Home until it's done: page notifications. Only
// 4 of 13 Cornerstone crew had them (2026-11-01) because the switch lived in
// More and nothing ever asked. Each state says exactly what to do next.

import type { PushStatus } from "./pushClient";

export type NotifyAction = "enable" | "install" | "secure" | "none";

export interface NotifyStep {
  title: string;
  body: string;
  action: NotifyAction;
  /** The button, when there is one. */
  button?: string;
  /** A one-time tip once everything is set up, dismissed with Got it rather
   *  than snoozed. */
  tip?: boolean;
}

/** Shown once on an iPhone after page notifications are on. On silent, iOS
 *  plays no sound for any app, and whether a page buzzes is the phone's own
 *  Haptics setting, which nothing in the app can change (first real page
 *  test, 2026-11-09: a page on silent was completely still). */
export const HAPTICS_TIP: NotifyStep = {
  title: "Recibí avisos con el celular en silencio",
  body: "Con el iPhone en silencio, los avisos vibran solo si la respuesta háptica está configurada en Reproducir siempre. Abrí Configuración, elegí Sonidos y vibración, luego Respuesta háptica y Reproducir siempre.",
  action: "none",
  tip: true,
};

/** "Not now" hides the step for this long, then it asks again. */
export const SNOOZE_MS = 12 * 60 * 60 * 1000;

export function notifyStep(
  status: PushStatus,
  o: {
    ios: boolean;
    secureUrl: string;
    snoozedUntil: number;
    now: number;
    app?: boolean;
    choseOff?: boolean;
    /** The haptics tip was already dismissed on this phone. */
    hapticsTipSeen?: boolean;
  },
): NotifyStep | null {
  if (status === "on") return o.ios && !o.hapticsTipSeen ? HAPTICS_TIP : null;
  if (status === "unsupported") return null;
  // They turned pages off in More: that's an answer, not a step left to do.
  if (status === "off" && o.choseOff) return null;
  if (o.now < o.snoozedUntil) return null;
  switch (status) {
    case "off":
      return {
        title: "Último paso: activá las notificaciones de avisos",
        body: "Así, un aviso de Control puede hacer vibrar tu celular incluso con ProDeck cerrado.",
        action: "enable",
        button: "Activar notificaciones",
      };
    case "needs-install":
      return {
        title: "Agregá ProDeck a la pantalla de inicio",
        body: "En iPhone, los avisos llegan cuando ProDeck está en la pantalla de inicio. Tocá Compartir, elegí Agregar a inicio y abrí ProDeck desde allí.",
        action: "install",
        button: "Ver cómo hacerlo",
      };
    case "denied":
      // In the ProDeck Crew app the app checks again: the page can't.
      if (o.app)
        return {
          title: "Las notificaciones están bloqueadas",
          body: o.ios
            ? "Abrí Configuración del iPhone, elegí Notificaciones y ProDeck Crew, y activá Permitir notificaciones. Volvé acá y tocá Comprobar de nuevo."
            : "Abrí la configuración del celular, buscá ProDeck Crew en Notificaciones y permitilas. Volvé acá y tocá Comprobar de nuevo.",
          action: "enable",
          button: "Comprobar de nuevo",
        };
      return {
        title: "Las notificaciones están bloqueadas",
        body: o.ios
          ? "Abrí Configuración del iPhone, elegí Notificaciones y ProDeck, y activá Permitir notificaciones. Después volvé acá."
          : "Abrí la configuración del celular, buscá ProDeck o Chrome en Notificaciones y permitilas. Después volvé acá.",
        action: "none",
      };
    case "insecure":
      return o.secureUrl
        ? {
            title: "Los avisos no pueden llegar a este celular desde esta dirección",
            body: "Las notificaciones solo funcionan desde la dirección segura de Control. Abrila, ingresá con el mismo nombre y PIN, y agregala a la pantalla de inicio.",
            action: "secure",
            button: "Abrir la dirección segura",
          }
        : {
            title: "Los avisos no pueden llegar a este celular desde esta dirección",
            body: "Las notificaciones solo funcionan con una dirección segura (https). Pedila en Control.",
            action: "none",
          };
  }
  return null;
}

/** The secure address, carrying this browser's sign-in so it isn't asked for again. */
export function secureLink(publicUrl: string, token: string): string {
  const base = publicUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base)) return "";
  return token ? `${base}/?join=${encodeURIComponent(token)}` : `${base}/`;
}
