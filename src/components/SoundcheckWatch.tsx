import { useEffect, useState } from "react";
import { danteSnapshot, IS_WEB, on, playbackStatus, playbackStop, type DanteSnapshot, type PlaybackStatus } from "../lib/tauri";
import { requestNavigate } from "../lib/navigate";
import { stillPatched } from "../lib/soundcheckSheet";
import { SOUNDCHECK_TX_KEY } from "./SoundcheckPanel";

// The one thing soundcheck playback must never do is follow the church into a
// service. This stays on screen, on every page, while soundcheck audio is
// playing or the console is still listening to this Mac's soundcheck outputs.

const CONSOLE_NAME = /allen|avantis|dlive|dante64|^ah[-\s]/i;

function soundcheckTx(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(SOUNDCHECK_TX_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

export function SoundcheckWatch() {
  const [dante, setDante] = useState<DanteSnapshot | null>(null);
  const [play, setPlay] = useState<PlaybackStatus>({ playing: false });
  useEffect(() => {
    if (IS_WEB) return;
    danteSnapshot().then(setDante).catch(() => {});
    playbackStatus().then(setPlay).catch(() => {});
    const a = on<DanteSnapshot>("routing:dante", (d) => d && setDante(d));
    const b = on<PlaybackStatus>("playback:status", (s) => s && setPlay(s));
    return () => {
      a.then((f) => f());
      b.then((f) => f());
    };
  }, []);
  if (IS_WEB) return null;

  const localName = dante?.localName ?? "";
  const local = dante?.devices.find((d) => d.name === localName);
  const consoleDev = dante?.devices.find((d) => CONSOLE_NAME.test(d.name) || CONSOLE_NAME.test(d.model ?? ""));
  const patched = stillPatched(consoleDev, localName, local, soundcheckTx());
  if (!play.playing && patched.length === 0) return null;

  return (
    <div className="sc-watch" role="status">
      <span className="sc-watch-dot" aria-hidden="true" />
      <span>
        {play.playing && <strong>Soundcheck playback is playing. </strong>}
        {patched.length > 0 && (
          <>
            The console is still patched for soundcheck: {patched.length} of its Dante inputs listen to this Mac. Before the service, turn Virtual SoundCheck off on
            the desk and apply your Sunday preset in Dante Controller.
          </>
        )}
      </span>
      {play.playing && (
        <button className="btn small" onClick={() => playbackStop().catch(() => {})}>
          Stop playback
        </button>
      )}
      <button className="btn small ghost" onClick={() => requestNavigate("recording")}>
        Open Recording
      </button>
    </div>
  );
}
