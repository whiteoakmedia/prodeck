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
import { nameProblem, suggestName } from "../../local-edge/src/names";
import { askConfirm } from "../lib/dialogs";
import { localPhaseLabel } from "../lib/localHttps";

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
  const problem = nameProblem(name);
  useEffect(() => {
    if (st?.name || problem) return setCheck(null);
    const n = ++seq.current;
    const t = setTimeout(() => {
      localHttpsCheck(name)
        .then((r) => {
          if (n !== seq.current) return;
          if (r.error) setCheck({ name, ok: false, text: r.error });
          else setCheck({ name, ok: !!r.available, text: r.available ? "Available" : r.problem || "Taken. Try another." });
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
        <h3 id="set-local">Secure local address</h3>
        <span className={`chip ${label.tone}`}>{label.text}</span>
      </div>
      <p className="muted small">
        Gives phones on your church Wi-Fi a secure (https) address for ProDeck. That's what comms, the microphone on
        camera stations and page notifications need. No domain, no account, nothing to install: claim a name and this
        computer does the rest, and keeps it working.
      </p>
      {hasPublic && (
        <p className="hint">
          You already have a public address (<code>{form.public_url}</code>), and links use it. A secure local address
          is only needed without one.
        </p>
      )}

      {!claimed ? (
        <>
          <label className="field">
            <span>Choose a name</span>
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
              Your crew address moves to this name too ({name || "your-church"}-crew.prodeck.live), and{" "}
              {form.crew_name}-crew.prodeck.live is given back. Phones learn the new one the next time they reach the booth.
            </p>
          )}
          <p className={`small ${problem || (check && !check.ok) ? "local-name-bad" : "muted"}`}>
            {problem || (check?.name === name ? check.text : "Checking…")}
          </p>
          <button
            className="btn primary"
            disabled={busy || !!problem || !(check?.name === name && check.ok)}
            onClick={() => void run(() => localHttpsClaim(name))}
          >
            {busy ? "Claiming…" : "Claim this address"}
          </button>
          <p className="muted small">
            The name is public: anyone can look it up, but it only leads to this computer from inside your building.
            Certificates come from Let's Encrypt, and claiming agrees to their{" "}
            <a href="https://letsencrypt.org/repository/" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
              Subscriber Agreement
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
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="muted small">
                  Scan the code with a phone on the church Wi-Fi to test it. Crew links, the poster and camera tally
                  codes use this address now{hasPublic ? " when there's no public address" : ""}.
                </p>
              </>
            )}
            {!!st?.expires_ms && (
              <p className="muted small">Certificate renews by itself (current one valid until {new Date(st.expires_ms).toLocaleDateString()}).</p>
            )}
            {(st?.ips?.length ?? 0) > 1 && (
              <label className="field">
                <span>Phones reach this computer at</span>
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
                  <option value="">Automatic ({st?.ip || "the main network"})</option>
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
                  {busy ? "Trying…" : "Try again"}
                </button>
              </div>
            )}
            <details className="small muted" style={{ marginTop: 8 }}>
              <summary>Phones can't open it?</summary>
              <ul>
                <li>The phone must be on the church Wi-Fi, not cellular or a guest network.</li>
                <li>
                  Some web filters (Cisco Umbrella, OpenDNS, some routers) block names that point inside your network.
                  Allow <code>local.prodeck.live</code> in yours.
                </li>
                <li>If this computer has more than one network, pick the one the phones are on above.</li>
              </ul>
            </details>
            <button
              className="btn ghost small"
              disabled={busy}
              style={{ marginTop: 8 }}
              onClick={async () => {
                if (!(await askConfirm(`Give back ${st?.host}? Phones using it stop working until you claim one again.`, "Give it back")))
                  return;
                void run(localHttpsRelease);
              }}
            >
              Give this address back
            </button>
          </div>
          {qr && <img src={qr} alt={`Secure address ${url}`} className="kiosk-qr" />}
        </div>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  );
}
