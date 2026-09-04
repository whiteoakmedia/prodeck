import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { mjpegUrl, ndiDiscover, ndiStart, ndiStop, type NdiSource } from "../lib/tauri";

interface Tile {
  source: NdiSource;
  port: number | null;
}

export function Multiview() {
  const [sources, setSources] = useState<NdiSource[]>([]);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [scanning, setScanning] = useState(false);

  // Leaving the page must stop the tiles' receivers — without this they kept
  // capturing + JPEG-encoding ~15 fps on the booth Mac for the rest of the day.
  const tilesRef = useRef<Tile[]>([]);
  tilesRef.current = tiles;
  useEffect(
    () => () => {
      for (const t of tilesRef.current) ndiStop(t.source.name).catch(() => {});
    },
    [],
  );

  async function scan() {
    setScanning(true);
    try {
      setSources(await ndiDiscover());
    } finally {
      setScanning(false);
    }
  }

  async function addTile(source: NdiSource) {
    if (tiles.some((t) => t.source.name === source.name)) return;
    const port = await ndiStart(source.name).catch(() => null);
    setTiles((prev) => [...prev, { source, port }]);
  }

  async function removeTile(name: string) {
    await ndiStop(name).catch(() => {});
    setTiles((prev) => prev.filter((t) => t.source.name !== name));
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Multiview</h1>
        <button className="btn ghost small" onClick={scan} disabled={scanning}>
          <Icon name="search" size={14} />
          {scanning ? "Scanning…" : "Scan NDI"}
        </button>
      </header>

      <div className="multiview-layout">
        <aside className="ndi-sources">
          <div className="card-head">
            <h3>NDI Sources</h3>
            <span className="count">{sources.length}</span>
          </div>
          {sources.length === 0 ? (
            <p className="muted">
              {scanning
                ? "Searching the network…"
                : "Nothing found yet. Camera and ProPresenter feeds shared over the network (NDI) appear here — press Scan NDI to look again."}
            </p>
          ) : (
            <div className="source-list">
              {sources.map((s) => (
                <button
                  key={s.name}
                  className="source-item"
                  onClick={() => addTile(s)}
                >
                  <span className="dot online" />
                  <span className="s-name">{s.name}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className="viewer-grid">
          {tiles.length === 0 ? (
            <div className="viewer-empty">
              <Icon name="grid" size={32} />
              <p className="muted">
                Select an NDI source to add it to the multiview.
              </p>
            </div>
          ) : (
            tiles.map((t) => (
              <div key={t.source.name} className="viewer-tile">
                <div className="tile-video">
                  {t.port ? (
                    <img
                      className="tile-stream"
                      src={mjpegUrl(t.port)}
                      alt={t.source.name}
                    />
                  ) : (
                    <div className="tile-note">Receiver unavailable</div>
                  )}
                  <div className="tile-overlay">
                    <span className="rec-dot" />
                    <span className="tile-name">{t.source.name}</span>
                  </div>
                </div>
                <div className="tile-foot">
                  <span className="muted small">{t.source.url_address}</span>
                  <button
                    className="btn small ghost"
                    onClick={() => removeTile(t.source.name)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <p className="hint multiview-hint">
        These are live previews of video feeds shared over the network (NDI) —
        low-bandwidth proxies, so they may look softer than the real output.
        Click sources on the left to build your multiview.
      </p>
    </div>
  );
}
