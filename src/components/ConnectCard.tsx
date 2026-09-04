import { useEffect, useState } from "react";
import { useProDeck } from "../store";
import { discoverServices, IS_WEB, type DiscoveredService } from "../lib/tauri";
import { Icon } from "./Icon";

export function ConnectCard() {
  const { connected, host: connectedHost, connect, disconnect, connectError, settings } =
    useProDeck();
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(1025);
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<DiscoveredService[]>([]);
  const [scanned, setScanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (settings) {
      setHost(settings.pp_host);
      setPort(settings.pp_port);
    }
  }, [settings]);

  // Choose the most reliable host from a discovered service: IPv4 first, then
  // the .local hostname (resolves via mDNS on macOS), then any address.
  function bestHost(s: DiscoveredService): string {
    const ipv4 = s.addresses.find((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a));
    if (ipv4) return ipv4;
    if (s.host) return s.host;
    return s.addresses[0] ?? "";
  }

  async function scan() {
    setScanning(true);
    try {
      const services = await discoverServices(4);
      setFound(services.filter((s) => s.kind === "propresenter" || s.kind === "stage"));
      setScanned(true);
    } finally {
      setScanning(false);
    }
  }

  async function doConnect() {
    setBusy(true);
    try {
      await connect(host, port);
    } catch {
      /* surfaced via connectError */
    } finally {
      setBusy(false);
    }
  }

  if (connected) {
    return (
      <div className="card connect-card">
        <div className="card-head">
          <h3>ProPresenter</h3>
          <span className="chip online">Connected</span>
        </div>
        <p className="muted">{connectedHost}</p>
        <button className="btn ghost" onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  // Browsers can't drive the connection at all (pp_connect is host-only) —
  // say that in words instead of leaking the raw dispatch error.
  if (IS_WEB) {
    return (
      <div className="card connect-card">
        <div className="card-head">
          <h3>ProPresenter</h3>
          <span className="chip">Not connected</span>
        </div>
        <p className="muted">
          ProPresenter can only be connected from the booth Mac itself — this
          browser view is along for the ride. Once the booth connects, the live
          widgets here light up on their own.
        </p>
      </div>
    );
  }

  return (
    <div className="card connect-card">
      <div className="card-head">
        <h3>Connect to ProPresenter</h3>
      </div>

      {/* Finding it is the happy path; typing an IP is the fallback. */}
      <button className="btn primary" onClick={scan} disabled={scanning}>
        <Icon name="search" size={14} />
        {scanning ? "Looking for ProPresenter…" : "Find ProPresenter on this network"}
      </button>
      {scanned && !scanning && found.length === 0 && (
        <p className="muted small">
          Nothing found. Make sure ProPresenter is open and its network API is
          on (Preferences → Network → Enable Network), then try again — or
          enter the address by hand below.
        </p>
      )}

      {found.length > 0 && (
        <div className="discovered">
          {found.map((s) => (
            <button
              key={`${s.name}-${s.kind}-${s.port}`}
              className="discovered-item"
              disabled={busy}
              onClick={async () => {
                // Use the port the service actually advertises — the host sets
                // it, not us. Fill the fields and connect straight away.
                const h = bestHost(s);
                setHost(h);
                setPort(s.port);
                setBusy(true);
                try {
                  await connect(h, s.port);
                } catch {
                  /* surfaced via connectError */
                } finally {
                  setBusy(false);
                }
              }}
            >
              <span className="dot online" />
              <span className="d-name">{s.name}</span>
              <span className={`d-kind ${s.kind}`}>
                {s.kind === "propresenter" ? "API" : "Stage"}
              </span>
              <span className="d-meta">{bestHost(s) + ":" + s.port}</span>
            </button>
          ))}
        </div>
      )}

      <button
        className="btn small ghost"
        style={{ marginTop: 10 }}
        onClick={() => setAdvanced((v) => !v)}
      >
        {advanced ? "▾" : "▸"} Enter address manually
      </button>
      {advanced && (
        <>
          <div className="field-row" style={{ marginTop: 8 }}>
            <input
              className="input"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="Host / IP"
            />
            <input
              className="input port"
              type="number"
              value={port}
              onChange={(e) => setPort(parseInt(e.target.value) || 0)}
              placeholder="Port"
            />
          </div>
          <button className="btn" onClick={doConnect} disabled={busy}>
            {busy ? "Connecting…" : "Connect"}
          </button>
          <p className="hint">
            The address is on the ProPresenter Mac under Preferences → Network
            (default port 1025).
          </p>
        </>
      )}
      {connectError && <p className="error">{connectError}</p>}
    </div>
  );
}
