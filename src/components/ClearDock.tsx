import { useEffect, useState } from "react";
import { useProDeck } from "../store";
import { ppClearLayer } from "../lib/tauri";
import { Icon } from "./Icon";

// ProPresenter clear layers (same keys the API accepts via /v1/clear/layer/{key}).
const CLEAR_LAYERS = [
  { key: "slide", label: "Slide" },
  { key: "media", label: "Media" },
  { key: "props", label: "Props" },
  { key: "messages", label: "Messages" },
  { key: "announcements", label: "Announce" },
  { key: "audio", label: "Audio" },
  { key: "video_input", label: "Video" },
];

// A sticky, collapsible "clear" control pinned to the right edge — available on
// every page while ProPresenter is connected, so the operator can always blank
// the screen (or a single layer) no matter where they are in the app.
export function ClearDock() {
  const { connected } = useProDeck();
  const [open, setOpen] = useState(
    () => localStorage.getItem("prodeck.clearDock") !== "0",
  );
  const [flash, setFlash] = useState<string | null>(null);

  // MUST run before the early return below: hooks cannot be conditional, and
  // putting this after `if (!connected)` meant the component rendered two
  // hooks while disconnected and three once ProPresenter connected — React
  // error #310, which blanks the entire app the instant a connection lands.
  useEffect(() => {
    document.documentElement.dataset.clearDock = connected && open ? "open" : "closed";
    return () => {
      delete document.documentElement.dataset.clearDock;
    };
  }, [open, connected]);

  if (!connected) return null;

  const clear = (layer: string) => {
    ppClearLayer(layer).catch(() => {});
    setFlash(layer);
    setTimeout(() => setFlash((f) => (f === layer ? null : f)), 400);
  };
  const clearAll = () => {
    CLEAR_LAYERS.forEach((l) => ppClearLayer(l.key).catch(() => {}));
    setFlash("all");
    setTimeout(() => setFlash((f) => (f === "all" ? null : f)), 400);
  };
  const toggle = () =>
    setOpen((v) => {
      const n = !v;
      localStorage.setItem("prodeck.clearDock", n ? "1" : "0");
      return n;
    });

  return (
    <div className={`clear-dock ${open ? "open" : "closed"}`}>
      <button
        className="clear-dock-tab"
        onClick={toggle}
        title={open ? "Hide clear controls" : "Show clear controls"}
      >
        <Icon name="clear" size={15} />
      </button>
      {open && (
        <div className="clear-dock-body">
          <span className="cd-title">Clear</span>
          <button
            className={`cd-btn all ${flash === "all" ? "flash" : ""}`}
            onClick={clearAll}
            title="Clear all layers"
          >
            <span className="cd-x">✕</span> Clear All
          </button>
          {CLEAR_LAYERS.map((l) => (
            <button
              key={l.key}
              className={`cd-btn ${flash === l.key ? "flash" : ""}`}
              onClick={() => clear(l.key)}
              title={`Clear ${l.label}`}
            >
              <Icon name="clear" size={12} /> {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
