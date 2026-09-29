import { useEffect, useMemo, useState } from "react";
import { avantisPatchGet, danteSnapshot, IS_WEB, on, type AvantisPatch, type DanteSnapshot } from "../lib/tauri";

// Routing → Live: what the network and the desk say right now, read by
// ProDeck on its own — Dante subscriptions straight from each device (read
// only, every 30 s), and the Avantis input patch from the newest show export.

const ago = (t: number) => {
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : new Date(t * 1000).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
};

export function LiveRouting() {
  const [dante, setDante] = useState<DanteSnapshot | null>(null);
  const [patch, setPatch] = useState<AvantisPatch | null>(null);
  const [device, setDevice] = useState<string>("");
  const [onlySubscribed, setOnlySubscribed] = useState(true);

  useEffect(() => {
    if (IS_WEB) return;
    danteSnapshot().then(setDante).catch(() => {});
    avantisPatchGet().then((p) => p && setPatch(p)).catch(() => {});
    const a = on<DanteSnapshot>("routing:dante", (s) => s && setDante(s));
    const b = on<AvantisPatch>("routing:avantis_patch", (p) => p && setPatch(p));
    return () => {
      a.then((f) => f());
      b.then((f) => f());
    };
  }, []);

  const devices = dante?.devices ?? [];
  const cur = devices.find((d) => d.name === device) ?? devices.find((d) => d.name === dante?.localName) ?? devices[0];
  const rows = useMemo(() => (cur?.rx ?? []).filter((r) => !onlySubscribed || r.txDevice), [cur, onlySubscribed]);

  if (IS_WEB) return <p className="muted">Live routing is read by the booth.</p>;

  return (
    <div className="lr">
      <section className="card">
        <div className="card-head">
          <h3>Dante — live</h3>
          <span className="muted small">{dante ? `${devices.length} devices · read ${ago(dante.at)}` : "looking for devices…"}</span>
        </div>
        <p className="muted small">
          Read straight from each device on the network, every 30 seconds. Read-only — ProDeck never changes a subscription.
        </p>
        {devices.length > 0 && (
          <div className="lr-devices" role="tablist" aria-label="Dante devices">
            {devices.map((d) => (
              <button key={d.name} role="tab" aria-selected={cur?.name === d.name} className={`btn small ${cur?.name === d.name ? "primary" : "ghost"}`} onClick={() => setDevice(d.name)}>
                {d.name}
                <span className="muted small"> {d.rxCount ?? d.rx.length}×{d.txCount ?? d.tx.length}</span>
              </button>
            ))}
          </div>
        )}
        {cur && (
          <>
            <div className="lr-sub">
              <span className="muted small">
                {cur.model ? `${cur.model} · ` : ""}
                {cur.ip}
                {cur.error ? ` · ${cur.error}` : ""}
              </span>
              <label className="field check small">
                <input type="checkbox" checked={onlySubscribed} onChange={(e) => setOnlySubscribed(e.target.checked)} />
                <span>Only subscribed channels</span>
              </label>
            </div>
            <div className="rec-table-wrap">
              <table className="rec-table">
                <thead>
                  <tr>
                    <th>Receive</th>
                    <th>Name</th>
                    <th>From</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.ch}>
                      <td className="mono rec-in">{r.ch}</td>
                      <td>{r.name}</td>
                      <td>{r.txDevice ? `${r.txDevice} · ${r.txChannel}` : <span className="muted">—</span>}</td>
                      <td>
                        <span className={`rec-state ${r.ok ? "signal" : r.txDevice ? "none" : "idle"}`}>{r.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && <p className="muted small">No subscriptions on {cur.name}.</p>}
            </div>
          </>
        )}
        {(dante?.changes?.length ?? 0) > 0 && (
          <>
            <h4 className="lr-h">Changes seen</h4>
            <ul className="lr-changes small">
              {dante!.changes.slice(0, 30).map((c, i) => (
                <li key={i}>
                  <span className="mono muted">{ago(c.at)}</span> {c.text}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Desk patch</h3>
          <span className="muted small">{patch ? (patch.live ? "live from the desk" : `from ${patch.file.split("/").pop()} · exported ${ago(patch.exportedAt)}`) : "no patch read yet"}</span>
        </div>
        {patch?.live ? (
          <p className="muted small">
            An X32 or M32 reports its patch over the network, so this is live. Channel sources and input blocks are read with
            the console's documented messages{patch.unverified ? " — new in this version; if a line doesn't match your desk, tell us" : ""}.
          </p>
        ) : (
          <p className="muted small">
            An Allen &amp; Heath desk (Avantis, dLive, SQ) doesn't report its patch over the network, so this comes from a show
            file: save the show to a USB stick on the desk (or from Avantis Director) and plug it into this Mac, or drop the file
            in Downloads — ProDeck picks up a newer one within a minute and notes what changed. Avantis inputs and Dante outputs
            are decoded; dLive and SQ show files aren't yet. Behringer X32 / Midas M32: read live, nothing to do.
          </p>
        )}
        {patch && (
          <>
            {patch.changes?.length > 0 && (
              <ul className="lr-changes small">
                {patch.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
            <div className="lr-two">
            {(patch.danteOut?.length ?? 0) > 0 && (
              <div className="rec-table-wrap">
                <table className="rec-table">
                  <thead>
                    <tr>
                      <th>Dante out</th>
                      <th>Sends</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patch.danteOut!
                      .filter((o) => o.text !== "—")
                      .map((o) => (
                        <tr key={o.out}>
                          <td className="mono rec-in">{o.out}</td>
                          <td>{o.text}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="rec-table-wrap">
              <table className="rec-table">
                <thead>
                  <tr>
                    <th>Ch</th>
                    <th>Input</th>
                  </tr>
                </thead>
                <tbody>
                  {patch.inputs
                    .filter((r) => r.socket != null)
                    .map((r) => (
                      <tr key={r.ch}>
                        <td className="mono rec-in">{r.ch}</td>
                        <td>{r.text}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
