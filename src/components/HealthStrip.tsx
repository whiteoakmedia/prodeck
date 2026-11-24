import { useState } from "react";
import { useAlerts, type Subsystem } from "../alertsStore";
import { useProDeck } from "../store";
import { deskHealthText } from "../lib/consoles";

// D17 — the troubleshooting strip. Four traffic lights, always visible in the
// sidebar footer; clicking one opens a card that says what the thing IS, what
// the color means, and the one thing to try. Every red banner elsewhere is a
// symptom — this is where a volunteer goes to understand it.

export const EXPLAIN: Record<
  string,
  { name: string; what: string; page?: string; fix: Record<string, string> }
> = {
  pp: {
    name: "ProPresenter",
    what: "La computadora de proyección. ProDeck recibe de ella la letra, las diapositivas y las activaciones.",
    page: "propresenter",
    fix: {
      ok: "Conectado y funcionando.",
      bad: "Se perdió la conexión con ProPresenter. Comprobá que esté abierto en la computadora de proyección. ProDeck se reconecta solo. Si después de un minuto sigue en rojo, abrí ProPresenter y seleccioná Buscar.",
      idle: "Todavía no se conectó en esta sesión. Abrí ProPresenter y seleccioná Buscar.",
    },
  },
  pco: {
    name: "Planning Center",
    what: "El plan del evento: el Crono, el equipo y los horarios de llegada.",
    page: "planning",
    fix: {
      ok: "Sincronizado y en vivo.",
      warn: "Hay un plan cargado, pero no se está sincronizando. Abrí Planning Center y seleccioná Sincronizar.",
      idle: "No hay un plan seleccionado. Abrí Planning Center y elegí el plan de esta semana.",
    },
  },
  audio: {
    name: "Audio",
    page: "settings",
    what: "La mezcla que ProDeck recibe por la red Dante para medir SPL y transmitir audio a los celulares.",
    fix: {
      ok: "Recibiendo sonido.",
      idle: "No se recibe sonido. El monitoreo puede estar desactivado o todavía no hay reproducción. Es normal antes de que empiece la banda.",
      bad: "El sonido se interrumpió. Revisá el ruteo Dante hacia esta computadora y el switch de red. La página Ruteo muestra toda la cadena.",
      warn: "El nivel de sonido de la sala lleva un tiempo muy alto. Revisá los niveles.",
    },
  },
  desk: {
    name: "Consola de sonido",
    page: "settings",
    what: "Tu consola de sonido: Allen & Heath (Avantis, dLive, SQ, Qu-5/6/7), Behringer X32 / Midas M32 o Yamaha (CL, QL, TF). ProDeck refleja el estado de muteo, los faders, las escenas y los nombres de canales.",
    // Named for the desk actually picked: see deskHealthText.
    fix: {},
  },
  cam: {
    name: "Señal de escenario",
    page: "settings",
    what: "La salida de escenario de ProPresenter compartida por la red mediante NDI: la Pantalla Retorno.",
    fix: {
      ok: "Señal activa.",
      bad: "Se interrumpió la señal de escenario. Comprobá que ProPresenter esté abierto y su salida NDI activada; después revisá la red.",
      idle: "No se está usando una señal de escenario.",
    },
  },
};

/** The one thing to try for a light, in its current state. */
export function fixText(sub: Subsystem, deskModel: string | null | undefined): string {
  if (sub.key === "desk") return deskHealthText(deskModel, sub.state, sub.detail === "unreachable" ? null : sub.detail);
  return EXPLAIN[sub.key]?.fix[sub.state] ?? sub.detail;
}

export function HealthStrip() {
  const { subsystems } = useAlerts();
  const { host, settings } = useProDeck();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = subsystems.find((s) => s.key === openKey) ?? null;
  const info = open ? EXPLAIN[open.key] : null;

  return (
    <div className="health-strip">
      {open && info && (
        <div className="health-pop">
          <div className="health-pop-head">
            <strong>{info.name}</strong>
            <span className={`hl-dot ${open.state}`} />
            <button className="btn small ghost" onClick={() => setOpenKey(null)}>
              ×
            </button>
          </div>
          <p className="muted small">{info.what}</p>
          <p className="small">
            {fixText(open, settings?.avantis_model)}
            {open.key === "pp" && open.state === "ok" && host ? ` (${host})` : ""}
          </p>
        </div>
      )}
      <div className="health-lights">
        {/* The stage-feed light only earns its spot when a feed is actually
            in use — an always-idle fourth light is noise. */}
        {subsystems
          .filter((s) => !(s.key === "cam" && s.detail === "none"))
          .map((s: Subsystem) => (
          <button
            key={s.key}
            className={`health-light ${openKey === s.key ? "open" : ""}`}
            title={`${EXPLAIN[s.key]?.name ?? s.label}: ${s.detail}. Seleccioná para ver qué hacer`}
            onClick={() => setOpenKey(openKey === s.key ? null : s.key)}
          >
            <span className={`hl-dot ${s.state}`} />
            <span className="hl-label">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
