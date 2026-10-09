import { useEffect, useState } from "react";
import { activePlaylistId, resolveLiveItem, type LiveItem } from "./livePlaylistItem";
import { ppGet } from "./tauri";

/**
 * The live playlist item (see lib/livePlaylistItem), looked up again whenever
 * the live presentation or its cue count changes. `undefined` while looking,
 * `null` when the live song wasn't started from a playlist.
 */
export function useLiveItem(connected: boolean, presUuid: string, cues: number | null): LiveItem | null | undefined {
  const [live, setLive] = useState<LiveItem | null | undefined>(undefined);
  useEffect(() => {
    if (!connected || !presUuid) {
      setLive(null);
      return;
    }
    let stale = false;
    setLive(undefined);
    (async () => {
      try {
        const active = await ppGet("playlist/active");
        const id = activePlaylistId(active);
        const pl = id ? await ppGet(`playlist/${encodeURIComponent(id)}`) : null;
        if (!stale) setLive(pl ? resolveLiveItem(active, pl, presUuid) : null);
      } catch {
        if (!stale) setLive(null);
      }
    })();
    return () => {
      stale = true;
    };
  }, [connected, presUuid, cues]);
  return live;
}

