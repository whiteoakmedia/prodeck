import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  localHttpsCheck,
  localHttpsClaim,
  localHttpsRelease,
  localHttpsRetry,
  localHttpsSetIp,
  localHttpsStatus,
  on,
  type LocalHttpsStatus,
  type Settings,
} from "../lib/tauri";
import { suggestName } from "../../local-edge/src/names";
import { askConfirm } from "../lib/dialogs";
import { localNameProblem, localPhaseLabel } from "../lib/localHttps";

// Settings, Crew & screens: claim a secure local address
// (<name>.local.prodeck.live). One name, one button; the booth does the rest
// (localhttps.rs) and keeps it working by itself.

export function SecureLocalCard({ form }: { form: Settings }) {
  const [st, setSt] = useState<LocalHttpsStatus | null>(null);
  const [name, setName] = useState(() => suggestName(form.device_name?.replace(/\.local$/i, "") ?? ""));
  const [check, setCheck] = useState<{ name: string; ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  // The address override, kept here: the page's form was loaded before it changed.
  const [chosen, setChosen] = useState(form.local_ip || "");
  const seq = useRef(0);

  useEffect(() => {
    localHttpsStatus().then(setSt).catch(() => {});
    const un = on<LocalHttpsStatus>("localhttps:status", (s) => s && setSt(s));
    return () => {
      un.then((f) => f());
    };
  }, []);

  // Is the name free? Checked as you type, a moment after you stop.
  const problem = localNameProblem(name);
  useEffect(() => {
    if (st?.name || problem) return setCheck(null);
    const n = ++seq.current;
    const t = setTimeout(() => {
      localHttpsCheck(name)
        .then((r) => {
          if (n !== seq.current) return;
          if (r.error) setCheck({ name, ok: false, text: r.error });
          else setCheck({ name, ok: !!r.available, text: r.available ? "Disponible" : r.problem || "Ya está en uso. Probá otro." });
        })
        .catch((e) => n === seq.current && setCheck({ name, ok: false, text: String(e) }));
    }, 450);
    return () => clearTimeout(t);
  }, [name, problem, st?.name]);

  const url = st?.phase === "serving" ? st.url : "";
  useEffect(() => {
    if (!url) return setQr("");
    QRCode.toDataURL(url, { margin: 1, width: 160 }).then(setQr).catch(() => setQr(""));
  }, [url]);

  const run = async (f: () => Promise<LocalHttpsStatus>) => {
    setBusy(true);
    setErr("");
    try {
      setSt(await f());
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const claimed = !!st?.name;
  const label = localPhaseLabel(st?.phase ?? "off");
  const hasPublic = !!form.public_url?.trim();

  return (
    <section className="card">
      <div className="card-head">
        <h3 id="set-local">Dirección local segura</h3>
        <span className={`chip ${label.tone}`}>{label.text}</span>
      </div>
      <p className="muted small">
        Ofrece a los celulares conectados al Wi-Fi de la iglesia una dirección segura (https) para ProDeck. La necesitan las
        comunicaciones, el micrófono de las estaciones de cámara y las notificaciones de avisos. No hace falta un dominio,
        una cuenta ni instalar nada: reservá un nombre y esta computadora se ocupa del resto.
      </p>
      {hasPublic && (
        <p className="hint">
          Ya tenés una dirección pública (<code>{form.public_url}</code>) y los enlaces la usan. La dirección local segura
          solo es necesaria si no tenés una dirección pública.
        </p>
      )}

      {!claimed ? (
        <>
          <label className="field">
            <span>Elegí un nombre</span>
            <div className="local-name-row">
              <input
                className="input"
                value={name}
                maxLength={32}
                autoCapitalize="none"
                spellCheck={false}
                placeholder="your-church"
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              />
              <span className="local-suffix">.local.prodeck.live</span>
            </div>
          </label>
          {form.crew_cloud !== false && form.crew_name && form.crew_name !== name && (
            <p className="muted small">
              La dirección del equipo también cambiará a este nombre ({name || "your-church"}-crew.prodeck.live) y se liberará{" "}
              {form.crew_name}-crew.prodeck.live. Los celulares recibirán la nueva dirección cuando vuelvan a conectarse a Control.
            </p>
          )}
          <p className={`small ${problem || (check && !check.ok) ? "local-name-bad" : "muted"}`}>
            {problem || (check?.name === name ? check.text : "Comprobando…")}
          </p>
          <button
            className="btn primary"
            disabled={busy || !!problem || !(check?.name === name && check.ok)}
            onClick={() => void run(() => localHttpsClaim(name))}
          >
            {busy ? "Reservando…" : "Reservar esta dirección"}
          </button>
          <p className="muted small">
            El nombre es público: cualquiera puede consultarlo, pero solo permite acceder a esta computadora desde tu edificio.
            Los certificados provienen de Let's Encrypt. Al reservar la dirección, aceptás su{" "}
            <a href="https://letsencrypt.org/repository/" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
              acuerdo de suscripción
            </a>
            .
          </p>
        </>
      ) : (
        <div className="kiosk-wrap">
          <div className="kiosk-side">
            <p style={{ margin: "4px 0" }}>
              <strong>{st?.host}</strong>
            </p>
            <p className="muted small">{st?.detail}</p>
            {url && (
              <>
                <code className="kiosk-url">{url}</code>
                <div className="kiosk-actions">
                  <button
                    className="btn small"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(url)
                        .then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        })
                        .catch(() => {})
                    }
                  >
                    {copied ? "Copiado" : "Copiar"}
                  </button>
                </div>
                <p className="muted small">
                  Para probarlo, escaneá el código con un celular conectado al Wi-Fi de la iglesia. Los enlaces del equipo, el afiche
                  y los códigos de Tally de cámara usan esta dirección{hasPublic ? " cuando no hay una dirección pública" : ""}.
                </p>
              </>
            )}
            {!!st?.expires_ms && (
              <p className="muted small">El certificado se renueva automáticamente (el actual es válido hasta {new Date(st.expires_ms).toLocaleDateString()}).</p>
            )}
            {(st?.ips?.length ?? 0) > 1 && (
              <label className="field">
                <span>Los celulares acceden a esta computadora en</span>
                <select
                  className="input"
                  value={chosen}
                  disabled={busy}
                  onChange={(e) => {
                    const ip = e.target.value;
                    setChosen(ip);
                    void run(() => localHttpsSetIp(ip));
                  }}
                >
                  <option value="">Automático ({st?.ip || "la red principal"})</option>
                  {st!.ips.map((ip) => (
                    <option key={ip} value={ip}>
                      {ip}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {st?.error && (
              <div className="hint">
                <p style={{ margin: 0 }}>{st.error}</p>
                <button className="btn small" disabled={busy} style={{ marginTop: 6 }} onClick={() => void run(localHttpsRetry)}>
                  {busy ? "Reintentando…" : "Reintentar"}
                </button>
              </div>
            )}
            <details className="small muted" style={{ marginTop: 8 }}>
              <summary>¿Los celulares no pueden abrirla?</summary>
              <ul>
                <li>El celular debe estar conectado al Wi-Fi de la iglesia, no a datos móviles ni a una red de invitados.</li>
                <li>
                  Algunos filtros web (Cisco Umbrella, OpenDNS y algunos routers) bloquean nombres que apuntan a tu red.
                  Permití <code>local.prodeck.live</code> en el filtro.
                </li>
                <li>Si esta computadora tiene más de una red, elegí arriba la que usan los celulares.</li>
              </ul>
            </details>
            <button
              className="btn ghost small"
              disabled={busy}
              style={{ marginTop: 8 }}
              onClick={async () => {
                if (!(await askConfirm(`¿Liberar ${st?.host}? Los celulares que la usan dejarán de funcionar hasta que reserves otra dirección.`, "Liberar dirección")))
                  return;
                void run(localHttpsRelease);
              }}
            >
              Liberar esta dirección
            </button>
          </div>
          {qr && <img src={qr} alt={`Dirección segura ${url}`} className="kiosk-qr" />}
        </div>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  );
}
