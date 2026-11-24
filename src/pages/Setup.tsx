import { useAlerts } from "../alertsStore";
import { requestWizard } from "../lib/wizards";
import { useProDeck } from "../store";
import { EXPLAIN, fixText } from "../components/HealthStrip";
import { Icon } from "../components/Icon";
import { IS_WEB } from "../lib/tauri";
import { requestOnboarding } from "../lib/onboarding";

/**
 * Setup & status — the self-service page that keeps a downloaded copy from
 * becoming a support inbox. One row per connection: live status, plain-English
 * meaning, the one thing to try when it's not green, and a jump to where it's
 * configured. A confused operator comes here instead of emailing anyone.
 */

const LABEL: Record<string, string> = {
  ok: "Conectado",
  idle: "Sin configurar",
  warn: "Atención",
  bad: "Problema",
};

export function Setup({ onNavigate }: { onNavigate: (p: string) => void }) {
  const { subsystems } = useAlerts();
  const { connected, settings } = useProDeck();

  const rows = subsystems.filter((s) => !(s.key === "cam" && s.detail === "none"));
  const greens = rows.filter((s) => s.state === "ok").length;

  // Reopens the full-screen onboarding on demand (desktop only — the
  // onboarding never mounts on web clients, so send those to Settings).
  const rerun = () => {
    if (IS_WEB) onNavigate("settings");
    else requestOnboarding();
  };

  return (
    <div className="page setup-page">
      <header className="page-head">
        <h1>Configuración</h1>
        <span className="page-sub">
          {greens}/{rows.length} conexiones activas
        </span>
      </header>

      {!IS_WEB && (
        <div className="call setup-intro">
          <p>
            ProDeck reúne la información que recibe de tus otras herramientas. Cada
            fila representa una conexión: el verde indica que funciona y los demás
            estados explican qué hacer. Configurá lo que uses; el resto es opcional.
          </p>
        </div>
      )}

      <div className="setup-list">
        {rows.map((s) => {
          const info = EXPLAIN[s.key];
          if (!info) return null;
          const fix = fixText(s, settings?.avantis_model);
          return (
            <div key={s.key} className={`setup-row ${s.state}`}>
              <span className={`hl-dot ${s.state}`} />
              <div className="setup-row-body">
                <div className="setup-row-head">
                  <strong>{info.name}</strong>
                  <span className={`setup-badge ${s.state}`}>{LABEL[s.state] ?? s.state}</span>
                </div>
                <p className="muted small">{info.what}</p>
                {s.state !== "ok" && <p className="small setup-fix">{fix}</p>}
              </div>
              {info.page && s.state !== "ok" && (
                <button className="btn small" onClick={() => onNavigate(info.page!)}>
                  {s.state === "idle" ? "Configurar" : "Resolver"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="setup-more">
        <h3>Configurá lo demás</h3>
        <div className="setup-cards">
          <button className="setup-card" onClick={() => onNavigate("settings")}>
            <Icon name="settings" size={18} />
            <span className="setup-card-t">Acceso desde el navegador y equipo</span>
            <span className="setup-card-d">
              Paneles de control en celulares y pantallas públicas, aprobación de integrantes y contraseñas.
            </span>
          </button>
          <button className="setup-card" onClick={() => onNavigate("settings")}>
            <Icon name="mic" size={18} />
            <span className="setup-card-t">Audio, consola de sonido y MIDI</span>
            <span className="setup-card-d">
              Medición de SPL, conexión con la consola Allen &amp; Heath y envío de tonalidad. Cada opción tiene su propia sección.
            </span>
          </button>
          <button className="setup-card" onClick={() => onNavigate("report")}>
            <Icon name="report" size={18} />
            <span className="setup-card-t">Audiencia en vivo e informes</span>
            <span className="setup-card-d">
              Cantidad de espectadores de GA4 e informes de tiempos y SPL por evento.
            </span>
          </button>
          <button className="setup-card" onClick={() => requestWizard("recording")}>
            <Icon name="mic" size={18} />
            <span className="setup-card-t">Grabación multipista</span>
            <span className="setup-card-d">
              Grabá cada canal en una pista: elegí la fuente, revisá los niveles, nombrá las pistas y seleccioná una unidad.
            </span>
          </button>
          <button className="setup-card" onClick={() => requestWizard("automix")}>
            <Icon name="settings" size={18} />
            <span className="setup-card-t">Automix</span>
            <span className="setup-card-d">
              Dejá que ProDeck ajuste los faders durante cada canción: configurá la consola, los faders y los tiempos.
            </span>
          </button>
          <button className="setup-card" onClick={rerun}>
            <Icon name="checklist" size={18} />
            <span className="setup-card-t">Volver a Primeros pasos</span>
            <span className="setup-card-d">
              La guía inicial: qué hace ProDeck, con qué se conecta y cómo configurar cada conexión.
            </span>
          </button>
        </div>
      </div>

      <p className="setup-foot muted small">
        La guía completa por etapas incluye discos de acceso, pantallas públicas,
        dominio propio y funcionamiento sin Control. Está en <code>docs/ADOPTERS_GUIDE.html</code>
        dentro de la descarga de ProDeck.{" "}
        {!connected && "Empezá conectando ProPresenter arriba."}
      </p>
    </div>
  );
}
