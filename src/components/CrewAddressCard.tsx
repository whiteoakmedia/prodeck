import { useEffect, useState } from "react";
import { crewCloudRename, crewCloudRetry, crewCloudStatus, on, type CrewCloudStatus, type Settings } from "../lib/tauri";
import { localNameProblem } from "../lib/localHttps";

// Settings, Crew & screens: the crew address (<name>-crew.prodeck.live,
// src-tauri/src/crewcloud.rs). On for every booth unless switched off here.
// The switch is part of the page's form (Save applies it), like Comms.

function ago(ms: number): string {
  if (!ms) return "todavía no";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return "hace un momento";
  const m = Math.round(s / 60);
  if (m < 90) return `hace ${m} minutos`;
  return new Date(ms).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function CrewAddressCard({ form, set }: { form: Settings; set: (on: boolean) => void }) {
  const [st, setSt] = useState<CrewCloudStatus | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [, tick] = useState(0);

  useEffect(() => {
    crewCloudStatus().then(setSt).catch(() => {});
    const un = on<CrewCloudStatus>("crewcloud:status", (s) => s && setSt(s));
    const iv = setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      un.then((f) => f());
      clearInterval(iv);
    };
  }, []);

  const run = async (f: () => Promise<CrewCloudStatus>) => {
    setBusy(true);
    setErr("");
    try {
      setSt(await f());
      setRename(null);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const enabled = form.crew_cloud !== false;
  const url = st?.url || form.crew_url || "";
  const waiting = enabled && st?.phase === "waiting";
  const chip = !enabled
    ? { cls: "", text: "desactivado" }
    : waiting
      ? { cls: "", text: "todavía no disponible" }
      : st?.linked
      ? { cls: "online", text: "conectado" }
      : st?.phase === "error"
        ? { cls: "warn", text: "problema" }
        : { cls: "", text: "iniciando" };
  const problem = rename !== null ? localNameProblem(rename) : "";

  return (
    <section className="card">
      <div className="card-head">
        <h3 id="set-crewaddr">Dirección del equipo</h3>
        <span className={`chip ${chip.cls}`}>{chip.text}</span>
      </div>
      <label className="field check">
        <input type="checkbox" checked={enabled} onChange={(e) => set(e.target.checked)} />
        <span>Permitir que el equipo acceda a ProDeck desde cualquier lugar y vea la semana con esta computadora apagada</span>
      </label>
      <p className="muted small">
        El equipo puede abrir esta dirección desde su casa o con datos móviles y acceder a Control en vivo mientras ProDeck está abierto.
        Con la computadora apagada, puede ver el último plan, las listas de tareas y el chat enviados; los cambios y mensajes
        quedan pendientes hasta que Control vuelva a conectarse. No hace falta configurar puertos ni un dominio. Las comunicaciones
        y señales de cámara permanecen en el Wi-Fi de la iglesia. Presioná Guardar para aplicar los cambios.
      </p>
      {waiting && (
        <p className="hint">
          White Oak Media todavía no habilitó las direcciones del equipo. Hasta entonces, esta computadora no envía información
          ni reserva un nombre; comprueba la disponibilidad una vez por hora.
        </p>
      )}
      {enabled && !waiting && (
        <>
          {url ? (
            <p style={{ margin: "6px 0" }}>
              <code className="kiosk-url">{url}</code>
            </p>
          ) : (
            <p className="muted small">Preparando la dirección. Los celulares podrán usarla cuando esté disponible, normalmente en unos minutos.</p>
          )}
          <p className="muted small">
            {st?.linked ? "Conectado: los celulares fuera de la iglesia acceden a Control en vivo." : "Sin conexión por ahora."} Última copia
            enviada {ago(st?.last_sync_ms ?? 0)}. El código del equipo y el afiche apuntan a la dirección del equipo para funcionar desde cualquier lugar.
            Los celulares conectados al Wi-Fi de la iglesia siguen comunicándose directamente con esta computadora.
          </p>
          {st?.error && (
            <div className="hint">
              <p style={{ margin: 0 }}>{st.error}</p>
              <button className="btn small" disabled={busy} style={{ marginTop: 6 }} onClick={() => void run(crewCloudRetry)}>
                {busy ? "Reintentando" : "Reintentar"}
              </button>
            </div>
          )}
          {!form.local_name &&
            (rename === null ? (
              <button className="btn ghost small" disabled={busy} onClick={() => setRename(st?.name || form.crew_name || "")}>
                Cambiar el nombre
              </button>
            ) : (
              <div style={{ marginTop: 6 }}>
                <div className="local-name-row">
                  <input
                    className="input"
                    value={rename}
                    maxLength={32}
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(e) => setRename(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  />
                  <span className="local-suffix">-crew.prodeck.live</span>
                </div>
                {problem && <p className="small local-name-bad">{problem}</p>}
                <div className="kiosk-actions">
                  <button className="btn small primary" disabled={busy || !!problem} onClick={() => void run(() => crewCloudRename(rename))}>
                    {busy ? "Guardando" : "Usar este nombre"}
                  </button>
                  <button className="btn small ghost" disabled={busy} onClick={() => setRename(null)}>
                    Cancelar
                  </button>
                </div>
                <p className="muted small">Los celulares recibirán la nueva dirección la próxima vez que accedan a Control.</p>
              </div>
            ))}
          {form.local_name && (
            <p className="muted small">Usa el mismo nombre que la dirección local segura.</p>
          )}
          <details className="small muted" style={{ marginTop: 8 }}>
            <summary>Qué información sale del edificio</summary>
            <p>
              Una copia del plan de esta semana tal como aparece en ProDeck (canciones, tonalidades, líderes, horarios, integrantes,
              puestos, horarios de convocatoria y guías), las listas de tareas, los nombres y roles del equipo y el chat.
              White Oak Media guarda esta información en Cloudflare para que el equipo pueda consultarla. Las contraseñas no salen
              en su forma original: solo se envía una representación que permite verificarlas sin revelarlas. Los datos de acceso
              a Planning Center permanecen en esta computadora. Mientras está conectado, las solicitudes de los celulares a Control
              pasan por el servicio sin guardarse. Al desactivar esta opción, se elimina la copia.
            </p>
          </details>
        </>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  );
}
