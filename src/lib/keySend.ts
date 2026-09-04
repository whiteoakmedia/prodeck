import { useEffect, useMemo, useRef, useState } from "react";
import { usePco } from "../pcoStore";
import { useProDeck } from "../store";
import { matchPresentationToItem } from "./proFollow";
import {
  getSettings,
  connectMidiOut,
  disconnectMidiOut,
  midiSendKey,
  oscSendKey,
  IS_WEB,
  type Settings,
} from "./tauri";

const BASE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const PC_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

// Parse a key label ("G", "Ab", "C#m", "Bb (Capo 1)") to its ROOT pitch class
// 0–11 — ignoring minor/major + capo annotations. null if unparseable.
export function keyToPitchClass(name: string | null | undefined): number | null {
  if (!name) return null;
  const m = name.trim().match(/^([A-Ga-g])\s*([#♯b♭]?)/);
  if (!m) return null;
  let pc = BASE[m[1].toLowerCase()];
  if (pc == null) return null;
  if (m[2] === "#" || m[2] === "♯") pc += 1;
  else if (m[2] === "b" || m[2] === "♭") pc -= 1;
  return ((pc % 12) + 12) % 12;
}

export const pitchClassName = (pc: number) => PC_NAMES[((pc % 12) + 12) % 12];

// Push a key out to the rig per the saved config (OSC + MIDI PC/CC). Used by the
// live auto-send and the Settings "test" button.
export async function sendKey(s: Settings, key: string, midiConnected: boolean) {
  const pc = keyToPitchClass(key);
  if (pc == null) return;
  const tasks: Promise<unknown>[] = [];
  if (s.keysend_osc_host)
    tasks.push(oscSendKey(s.keysend_osc_host, s.keysend_osc_port, key || pitchClassName(pc), pc));
  if (midiConnected) tasks.push(midiSendKey(s.keysend_midi_channel, pc, s.keysend_cc));
  await Promise.allSettled(tasks);
}

// Mounted once. Watches the LIVE song's effective key (PCO key or override) and
// pushes it to the backing-track / vocal-tune rig whenever it changes.
export function useKeySend() {
  const { items, liveItemId, followPro, effectiveLink, library } = usePco();
  const { status } = useProDeck();
  const cfgRef = useRef<Settings | null>(null);
  const connectedPort = useRef<string | null>(null);
  const lastSent = useRef<number | null>(null);
  const [ver, setVer] = useState(0);

  // (Re)load config and bring the MIDI-out connection in line with it.
  async function reload() {
    if (IS_WEB) return; // MIDI/OSC output lives on the desktop (booth) instance
    const s = await getSettings().catch(() => null);
    if (!s) return;
    cfgRef.current = s;
    const wantPort = s.keysend_enabled ? s.keysend_midi_port : null;
    if (wantPort !== connectedPort.current) {
      if (wantPort) {
        await connectMidiOut(wantPort)
          .then(() => (connectedPort.current = wantPort))
          .catch(() => (connectedPort.current = null));
      } else {
        await disconnectMidiOut().catch(() => {});
        connectedPort.current = null;
      }
    }
    lastSent.current = null; // resend the current key under the new config
    setVer((v) => v + 1);
  }

  useEffect(() => {
    reload();
    const onChange = () => reload();
    // Manual one-shot send (the Key Change dashboard widget). Pushes a key to the
    // rig right now, reusing this hook's config + open MIDI connection. Always
    // sends — even the same key again — so it doubles as a "re-send" button.
    const onSend = (e: Event) => {
      if (IS_WEB) return;
      const cfg = cfgRef.current;
      const key = (e as CustomEvent).detail?.key as string | undefined;
      if (!cfg || !cfg.keysend_enabled || !key) return;
      const pc = keyToPitchClass(key);
      if (pc == null) return;
      // Prime the dedupe only when something can actually leave the machine —
      // otherwise a tap with the rig offline marked the pc as "sent" and the
      // next legitimate auto-send of that key was skipped.
      if (!cfg.keysend_osc_host && !connectedPort.current) return;
      lastSent.current = pc; // keep the live-key effect from re-firing the same pc
      sendKey(cfg, key, !!connectedPort.current);
    };
    window.addEventListener("prodeck:keysend", onChange);
    window.addEventListener("prodeck:sendkey", onSend as EventListener);
    return () => {
      window.removeEventListener("prodeck:keysend", onChange);
      window.removeEventListener("prodeck:sendkey", onSend as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve the live song as FAST as possible. When Following ProPresenter we
  // match the active presentation directly the instant Pro reports it — instead
  // of waiting for the ~2.5s settle + step loop that gates the PCO tracker
  // (liveItemId). Falls back to liveItemId for manual selection / non-follow.
  const active = (status.activePresentation as any)?.presentation?.id ?? null;
  const presUuid: string | null = active?.uuid ?? null;
  const presName: string | null = active?.name ?? null;
  // Memoized: this provider re-renders ~12×/s while audio meters run, and the
  // matcher is O(plan items × PP library) with fresh tokenization — unmemoized
  // it burned real CPU all Sunday. Only re-match when its inputs change.
  const followedId = useMemo(
    () =>
      followPro ? matchPresentationToItem(items, effectiveLink, presUuid, presName) : null,
    // effectiveLink is a stable-behaviored closure over items/library/rules;
    // items + library cover its meaningful inputs here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [followPro, items, library, presUuid, presName],
  );
  const liveSongId = followedId ?? liveItemId;
  const liveItem = items.find((i) => i.id === liveSongId) ?? null;
  const liveKey = liveItem && liveItem.type === "song" ? liveItem.key : "";

  // The rig often boots AFTER ProDeck (its network-MIDI port appears late), and
  // one failed connect used to leave key-sends silently OSC-only until someone
  // re-saved Settings. Retry on a slow tick; on success, re-fire the current
  // key so the rig lands on the right scene immediately.
  useEffect(() => {
    if (IS_WEB) return;
    const iv = setInterval(() => {
      const cfg = cfgRef.current;
      const want = cfg?.keysend_enabled ? cfg.keysend_midi_port : null;
      if (!want || connectedPort.current) return;
      connectMidiOut(want)
        .then(() => {
          connectedPort.current = want;
          lastSent.current = null;
          setVer((v) => v + 1);
        })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (IS_WEB) return;
    const cfg = cfgRef.current;
    if (!cfg || !cfg.keysend_enabled) return;
    const pc = keyToPitchClass(liveKey);
    if (pc == null || lastSent.current === pc) return;
    lastSent.current = pc;
    sendKey(cfg, liveKey, !!connectedPort.current);
  }, [liveKey, ver]);
}
