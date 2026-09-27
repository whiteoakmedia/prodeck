import { useEffect, useRef, useState } from "react";
import { usePco } from "../pcoStore";
import { useLiveSong } from "./liveSong";
import { avantisRecallScene, followDebugLog, IS_WEB } from "./tauri";

// Desk scenes by song leader: the live song's leader → this week's mic for
// them (PCO mic assignments) → that mic's "Lead" scene on the Avantis. Its
// own feature, on its own toggle (Planning Center → Desk scenes) — nothing
// to do with Automix. Booth only; it skips the first song it sees after a
// launch so a mid-service restart can't recall a scene on its own.

export interface AutoSceneStatus {
  at: number;
  song: string;
  text: string;
  ok: boolean;
}
const EVT = "prodeck:autoscene";
let lastStatus: AutoSceneStatus | null = null;
function report(s: AutoSceneStatus) {
  lastStatus = s;
  window.dispatchEvent(new CustomEvent(EVT, { detail: s }));
  followDebugLog({ kind: "scene", ok: s.ok, song: s.song, text: s.text }).catch(() => {});
}
export function useAutoSceneStatus(): AutoSceneStatus | null {
  const [s, setS] = useState(lastStatus);
  useEffect(() => {
    const f = (e: Event) => setS((e as CustomEvent<AutoSceneStatus>).detail);
    window.addEventListener(EVT, f);
    return () => window.removeEventListener(EVT, f);
  }, []);
  return s;
}

export function useAutoScene() {
  const { autoScene, micSceneMap, micForLeader, micAssignments } = usePco();
  const { item, via } = useLiveSong();
  const st = useRef<{ prev: string | null | undefined; fired: string }>({ prev: undefined, fired: "" });
  useEffect(() => {
    if (IS_WEB) return;
    const prev = st.current.prev;
    const id = item?.id ?? null;
    st.current.prev = id;
    if (prev === undefined || prev === id || !id || !item) return; // launch, or no change
    if (item.type !== "song") return;
    const now = Date.now();
    if (!autoScene) return report({ at: now, song: item.title, ok: false, text: "Desk scenes is off (Planning Center → Desk scenes)" });
    if (!item.leader) return report({ at: now, song: item.title, ok: false, text: "no leader on this song in Planning Center — scene left as is" });
    const mic = micForLeader(item.leader);
    if (!mic) return report({ at: now, song: item.title, ok: false, text: `${item.leader} has no mic assigned this week — scene left as is` });
    const scene = micSceneMap[mic];
    if (!scene) return report({ at: now, song: item.title, ok: false, text: `Mic ${mic} has no lead scene mapped — scene left as is` });
    const key = `${id}:${scene}`;
    if (st.current.fired === key) return;
    st.current.fired = key;
    avantisRecallScene(parseInt(scene))
      .then(() => report({ at: Date.now(), song: item.title, ok: true, text: `${item.leader} → Mic ${mic} → scene ${scene}${via === "pro" ? " (from ProPresenter)" : " (from PCO LIVE)"}` }))
      .catch((e) => {
        st.current.fired = "";
        report({ at: Date.now(), song: item.title, ok: false, text: `the desk didn't take scene ${scene}: ${String(e)}` });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, autoScene, micSceneMap, micAssignments]);
}
