import { useEffect, useRef, useState } from "react";
import { useLiveSong } from "./liveSong";
import {
  getSettings,
  connectMidiOut,
  disconnectMidiOut,
  midiSendKey,
  oscSendKey,
  keysendSetState,
  followDebugLog,
  on,
  IS_WEB,
  type KeySendState,
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

/** Program number a key name becomes: 0–11 for a key, 12 for "off" — the
 *  rig's thirteenth scene (TUNE OFF on an LV1 whose scenes are C…B, TUNE OFF). */
export const TUNE_OFF_PROGRAM = 12;
export const isTuneOff = (key: string | null | undefined) => !!key && /^(off|tune\s*off|none)$/i.test(key.trim());
export function keyToProgram(key: string | null | undefined): number | null {
  if (isTuneOff(key)) return TUNE_OFF_PROGRAM;
  return keyToPitchClass(key);
}
export const programName = (p: number) => (p === TUNE_OFF_PROGRAM ? "Tune off" : pitchClassName(p));

/** The twelve keys plus Tune off, in the order the rig's scenes run. */
export const KEY_CHOICES = [...PC_NAMES, "off"];

// Push a key out to the rig per the saved config (OSC + MIDI PC/CC). Used by the
// live auto-send and the Settings "test" button.
export async function sendKey(s: Settings, key: string, midiConnected: boolean) {
  const pc = keyToProgram(key);
  if (pc == null) return;
  const tasks: Promise<unknown>[] = [];
  if (s.keysend_osc_host)
    tasks.push(oscSendKey(s.keysend_osc_host, s.keysend_osc_port, isTuneOff(key) ? "off" : key || pitchClassName(pc), pc));
  if (midiConnected) tasks.push(midiSendKey(s.keysend_midi_channel, pc, s.keysend_cc));
  await Promise.allSettled(tasks);
}

// Mounted once. Watches the LIVE song's effective key (PCO key or override) and
// pushes it to the backing-track / vocal-tune rig whenever it changes.
export function useKeySend() {
  const { item: liveItem } = useLiveSong();
  const cfgRef = useRef<Settings | null>(null);
  const connectedPort = useRef<string | null>(null);
  const lastSent = useRef<number | null>(null);
  const last = useRef<{ key: string | null; program: number | null; at: number | null; by: string | null }>({ key: null, program: null, at: null, by: null });
  const liveRef = useRef<{ song: string | null; key: string | null }>({ song: null, key: null });
  const [ver, setVer] = useState(0);

  // Everyone else — the ProPresenter page, the Key widget, phones — reads
  // this. Published on every change; the booth is the only writer.
  const publish = () => {
    if (IS_WEB) return;
    const cfg = cfgRef.current;
    const st: KeySendState = {
      enabled: !!cfg?.keysend_enabled,
      midiPort: cfg?.keysend_midi_port ?? null,
      midiConnected: !!connectedPort.current,
      oscHost: cfg?.keysend_osc_host ?? "",
      liveSong: liveRef.current.song,
      liveKey: liveRef.current.key,
      lastKey: last.current.key,
      lastProgram: last.current.program,
      lastAt: last.current.at,
      lastBy: last.current.by,
    };
    keysendSetState(st).catch(() => {});
  };
  const record = (key: string, by: string) => {
    last.current = { key, program: keyToProgram(key), at: Date.now(), by };
    publish();
  };

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
    publish();
  }

  useEffect(() => {
    reload();
    const onChange = () => reload();
    // Manual one-shot send (the Key Change dashboard widget). Pushes a key to the
    // rig right now, reusing this hook's config + open MIDI connection. Always
    // sends — even the same key again — so it doubles as a "re-send" button.
    const manual = (key: string | undefined, by: string) => {
      if (IS_WEB) return;
      const cfg = cfgRef.current;
      if (!cfg || !cfg.keysend_enabled || !key) return;
      const pc = keyToProgram(key);
      if (pc == null) return;
      // Prime the dedupe only when something can actually leave the machine —
      // otherwise a tap with the rig offline marked the pc as "sent" and the
      // next legitimate auto-send of that key was skipped.
      if (!cfg.keysend_osc_host && !connectedPort.current) return;
      lastSent.current = pc; // keep the live-key effect from re-firing the same pc
      sendKey(cfg, key, !!connectedPort.current);
      record(key, by);
    };
    const onSend = (e: Event) => manual((e as CustomEvent).detail?.key as string | undefined, "booth");
    // A phone or another browser asked, through the gateway (Control perm).
    const unReq = on<{ key?: string; who?: string }>("keysend:request", (r) => manual(r?.key, r?.who || "browser"));
    window.addEventListener("prodeck:keysend", onChange);
    window.addEventListener("prodeck:sendkey", onSend as EventListener);
    return () => {
      window.removeEventListener("prodeck:keysend", onChange);
      window.removeEventListener("prodeck:sendkey", onSend as EventListener);
      unReq.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const liveKey = liveItem && liveItem.type === "song" ? liveItem.key : "";
  useEffect(() => {
    liveRef.current = { song: liveItem && liveItem.type === "song" ? liveItem.title : null, key: liveKey || null };
    publish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveItem?.id, liveKey]);

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
          publish();
        })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (IS_WEB) return;
    const cfg = cfgRef.current;
    const song = liveItem && liveItem.type === "song" ? liveItem.title : null;
    const log = (text: string) => song && followDebugLog({ kind: "key", song, key: liveKey || null, text }).catch(() => {});
    if (!cfg) return;
    if (!cfg.keysend_enabled) return void log("key-send is off (Settings → Song key → Waves)");
    const pc = keyToPitchClass(liveKey);
    if (pc == null) return void log("no key on this song in Planning Center");
    if (lastSent.current === pc) return;
    lastSent.current = pc;
    sendKey(cfg, liveKey, !!connectedPort.current);
    record(liveKey, "auto");
    log(connectedPort.current ? `sent ${liveKey}` : `sent ${liveKey} over OSC only — MIDI port ${cfg.keysend_midi_port} isn't connected (retrying every 15 s)`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey, ver]);
}
