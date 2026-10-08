import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  discoverServices,
  getSettings,
  IS_WEB,
  on,
  ppConnect,
  ppDisconnect,
  ppNext,
  ppPrevious,
  ppClearLayer,
  startAudioCapture,
  updateSettings,
  type Json,
  type Settings,
  setPublicUrl,
} from "./lib/tauri";
import { DB_FLOOR, ballisticsDt, toDbfs } from "./lib/audioMeter";
import { setCrashReportsEnabled } from "./lib/crashReports";
import { audioStartMessage } from "./lib/audioError";

export interface PpStatus {
  layers: Json | null;
  slideIndex: Json | null;
  activePresentation: Json | null;
  /** Announcements layer's active deck — a separate slide state in PP
   *  (pre-service loops live there). Streamed since 0.1.76. */
  activeAnnouncement: Json | null;
  currentTimers: Json | null;
  currentLook: Json | null;
  stageMessage: Json | null;
}

export interface Caption {
  text: string;
  ts: number;
}

export interface LogLine {
  ts: number;
  text: string;
}

const emptyStatus: PpStatus = {
  layers: null,
  slideIndex: null,
  activePresentation: null,
  activeAnnouncement: null,
  currentTimers: null,
  currentLook: null,
  stageMessage: null,
};

interface Store {
  connected: boolean;
  host: string;
  status: PpStatus;
  captions: Caption[];
  captionStatus: string;
  audioLevel: number;
  audioPeak: number;
  // Smoothed, floored dBFS for display — see lib/audioMeter. Use these for any
  // readout or bar; the raw linear levels above jitter far too much to show.
  audioDb: number;
  /** A-weighted level, dBFS. Add splCalibration for dB(A). */
  audioDbA: number;
  /** C-weighted level, dBFS. */
  audioDbC: number;
  audioPeakDb: number;
  audioRunning: boolean;
  /** Why the meter is not running, when a start attempt was refused. */
  audioError: string | null;
  lufs: { m: number; s: number; i: number; peak: number } | null;
  splCalibration: number;
  setSplCalibration: (n: number) => void;
  /** Start the audio input. Never throws: a refusal lands in `audioError`, worded for the booth. */
  startAudio: (device: string | null) => Promise<void>;
  midiLog: LogLine[];
  oscLog: LogLine[];
  settings: Settings | null;
  connect: (host: string, port: number) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  clearCaptions: () => void;
  connectError: string;
  /**
   * True while the booth is still trying to reach ProPresenter on its own and
   * hasn't given up. Surfaces as "connecting…" rather than a failure, because
   * the first attempt after launch almost always fails: `.local` names resolve
   * over mDNS, which isn't ready in the second or two after the process
   * starts. Reporting that as "unreachable / firewalled" sent people hunting
   * through firewall settings for a connection that arrived by itself moments
   * later — every single time ProDeck restarted.
   */
  ppConnecting: boolean;
}

const Ctx = createContext<Store | null>(null);

const cap = <T,>(arr: T[], n: number) => (arr.length > n ? arr.slice(arr.length - n) : arr);

export function ProDeckProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [host, setHost] = useState("");
  const [status, setStatus] = useState<PpStatus>(emptyStatus);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [captionStatus, setCaptionStatus] = useState("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioPeak, setAudioPeak] = useState(0);
  const [audioDb, setAudioDb] = useState(DB_FLOOR);
  // Both curves, always measured. C minus A is the size of the bottom end —
  // the thing an A-weighted reading is deaf to and complaints are made of.
  const [audioDbA, setAudioDbA] = useState(DB_FLOOR);
  const [audioDbC, setAudioDbC] = useState(DB_FLOOR);
  const [audioPeakDb, setAudioPeakDb] = useState(DB_FLOOR);
  const [audioRunning, setAudioRunning] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [lufs, setLufs] = useState<{ m: number; s: number; i: number; peak: number } | null>(
    null,
  );
  const [splCalibration, setSplCal] = useState(100);
  const [midiLog, setMidiLog] = useState<LogLine[]>([]);
  const [oscLog, setOscLog] = useState<LogLine[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  // Crash reports follow Settings → Help & support. Until settings arrive
  // (or on a browser that can't read them) nothing is sent.
  useEffect(() => setCrashReportsEnabled(settings?.crash_reports !== false && settings != null), [settings]);
  // Keep the module-level PUBLIC_URL in sync with the configured public
  // origin, so QR/join links and the edge fallback use the operator's domain.
  useEffect(() => {
    if (settings?.public_url) setPublicUrl(settings.public_url);
  }, [settings?.public_url]);
  const [connectError, setConnectError] = useState("");
  // Retries since the last success. Drives ppConnecting below.
  const [ppFails, setPpFails] = useState(0);

  const connectedRef = useRef(false);
  connectedRef.current = connected;
  // Timestamp of the last audio:level frame — freshness drives audioRunning.
  const lastLevelAt = useRef(0);
  // Reconnect targets, mirrored from settings via refs so the reconnect loop
  // mounts once and never churns on settings updates.
  const autoRef = useRef(false);
  const hostRef = useRef("");
  const portRef = useRef(0);

  async function connect(h: string, port: number) {
    setConnectError("");
    try {
      await ppConnect({ host: h, port });
      setPpFails(0);
      setHost(`${h}:${port}`);
      // Remember any working connection — including one picked from a network
      // scan — so the app reconnects automatically next launch.
      try {
        const s = await getSettings();
        if (s.pp_host !== h || s.pp_port !== port || !s.pp_auto_connect) {
          const next = { ...s, pp_host: h, pp_port: port, pp_auto_connect: true };
          setSettings(next);
          await updateSettings(next);
        }
      } catch {
        /* persistence is best-effort */
      }
    } catch (e) {
      setConnectError(String(e));
      setPpFails((n) => n + 1);
      throw e;
    }
  }

  async function disconnect() {
    await ppDisconnect();
    // An explicit disconnect should stick — don't auto-reconnect next launch.
    try {
      const s = await getSettings();
      if (s.pp_auto_connect) {
        const next = { ...s, pp_auto_connect: false };
        setSettings(next);
        await updateSettings(next);
      }
    } catch {
      /* best-effort */
    }
  }

  async function refreshSettings() {
    const s = await getSettings();
    setSettings(s);
    setSplCal(s.spl_calibration ?? 100);
  }

  // A button press that fails used to reject into nothing (PRODECK-4).
  async function startAudio(device: string | null) {
    try {
      await startAudioCapture(device);
      setAudioError(null);
    } catch (e) {
      setAudioError(audioStartMessage(String(e), device));
    }
  }

  // Global SPL calibration (dB SPL at 0 dBFS) — shared by SPL meter + tracking.
  async function setSplCalibration(n: number) {
    setSplCal(n);
    try {
      const s = await getSettings();
      const next = { ...s, spl_calibration: n };
      setSettings(next);
      await updateSettings(next);
    } catch {
      /* ignore */
    }
  }

  // Map MIDI / OSC inputs to ProPresenter actions.
  function runAction(action: string) {
    if (!connectedRef.current) return;
    if (action === "next") ppNext();
    else if (action === "previous") ppPrevious();
    else if (action.startsWith("clear/")) ppClearLayer(action.slice("clear/".length));
  }

  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [];
    const sub = <T,>(ev: string, cb: (p: T) => void) => unlisteners.push(on<T>(ev, cb));

    sub<{ host: string; port: number }>("pp:connected", (cfg) => {
      setConnected(true);
      if (cfg && cfg.host) setHost(`${cfg.host}:${cfg.port}`);
    });
    sub("pp:disconnected", () => {
      setConnected(false);
      setStatus(emptyStatus);
    });
    sub<{ stream: string; data: Json }>("pp:status", ({ stream, data }) => {
      setStatus((prev) => {
        switch (stream) {
          case "layers":
            return { ...prev, layers: data };
          case "slide_index":
            return { ...prev, slideIndex: data };
          case "active_presentation":
            return { ...prev, activePresentation: data };
          case "active_announcement":
            return { ...prev, activeAnnouncement: data };
          case "current_timers":
            return { ...prev, currentTimers: data };
          case "current_look":
            return { ...prev, currentLook: data };
          case "stage_message":
            return { ...prev, stageMessage: data };
          default:
            return prev;
        }
      });
    });

    sub<{ text: string; ts: number }>("caption:line", (c) =>
      setCaptions((prev) => cap([...prev, c], 200)),
    );
    sub<string>("caption:status", (s) => setCaptionStatus(s));

    sub<{ rms: number; peak: number; slow?: number; slowA?: number; slowC?: number }>(
      "audio:level",
      (m) => {
      // Freshness IS the "running" signal: a web client that joins after the
      // booth started capture never sees the one-shot audio:started event
      // reliably (phones showed "not measuring" against a live meter). Any
      // level frame proves the meter is alive; a watchdog below turns it off
      // when frames stop.
      const now = Date.now();
      const dt = lastLevelAt.current ? now - lastLevelAt.current : 83;
      lastLevelAt.current = now;
      setAudioRunning(true);
      setAudioLevel(m.rms);
      setAudioPeak(m.peak);
      // SPL rides the backend's time-weighted level, which integrates the
      // MEAN SQUARE with one symmetric time constant — what IEC 61672 calls
      // Slow or Fast, and what the handheld meter this gets calibrated
      // against is doing. Applying the ballistics below to it as well would
      // smooth it twice and drag it behind the room.
      //
      // The ballistics stay for the fallback, and for the peak meter where
      // fast-attack/slow-release is the right behaviour. They are NOT sound
      // level meter weighting: asymmetric, and applied to dB rather than to
      // mean square, which both biases a random signal like pink noise high
      // and leaves it visibly swaying.
      if (typeof m.slow === "number") setAudioDb(toDbfs(m.slow));
      else setAudioDb((p) => ballisticsDt(p, toDbfs(m.rms), dt));
      setAudioPeakDb((p) => ballisticsDt(p, toDbfs(m.peak), dt));
      if (typeof m.slowA === "number") setAudioDbA(toDbfs(m.slowA));
      if (typeof m.slowC === "number") setAudioDbC(toDbfs(m.slowC));
      },
    );
    sub<number>("audio:started", () => {
      setAudioRunning(true);
      setAudioError(null);
    });
    sub("audio:stopped", () => {
      lastLevelAt.current = 0;
      setAudioRunning(false);
      setAudioDb(DB_FLOOR);
      setAudioDbA(DB_FLOOR);
      setAudioDbC(DB_FLOOR);
      setAudioPeakDb(DB_FLOOR);
      setLufs(null);
    });
    sub<{ m: number; s: number; i: number; peak: number }>("audio:lufs", (r) => setLufs(r));

    sub<Json>("midi:message", (m) => {
      const line = `${m.kind} ch${m.channel} ${m.data1} ${m.data2}`;
      setMidiLog((prev) => cap([...prev, { ts: Date.now(), text: line }], 100));
      if (m.kind === "note_on") {
        // Default learn-free mapping: C3=prev (48), D3=next (50), E3=clear all (52)
        if (m.data1 === 50) runAction("next");
        else if (m.data1 === 48) runAction("previous");
        else if (m.data1 === 52) runAction("clear/slide");
      }
    });

    sub<Json>("osc:message", (m) => {
      const line = `${m.addr} ${JSON.stringify(m.args ?? [])}`;
      setOscLog((prev) => cap([...prev, { ts: Date.now(), text: line }], 100));
      const addr: string = m.addr ?? "";
      if (addr === "/prodeck/next" || addr === "/next") runAction("next");
      else if (addr === "/prodeck/previous" || addr === "/previous")
        runAction("previous");
      else if (addr.startsWith("/prodeck/clear/"))
        runAction("clear/" + addr.slice("/prodeck/clear/".length));
    });

    return () => {
      unlisteners.forEach((u) => u.then((fn) => fn()));
    };
  }, []);

  // Meter-freshness watchdog: levels arrive ~12×/s while capture runs, so a
  // 4s silence means the meter is genuinely off (booth stopped, SSE dropped,
  // or app quit) — show "not measuring" instead of a stale floor value.
  useEffect(() => {
    const iv = setInterval(() => {
      if (lastLevelAt.current && Date.now() - lastLevelAt.current > 4000) {
        lastLevelAt.current = 0;
        setAudioRunning(false);
        setAudioDb(DB_FLOOR);
        setAudioPeakDb(DB_FLOOR);
      }
    }, 2000);
    return () => clearInterval(iv);
  }, []);

  // Load settings + optional auto-connect on first mount.
  useEffect(() => {
    (async () => {
      const s = await getSettings();
      setSettings(s);
      setSplCal(s.spl_calibration ?? 100);
      if (s.pp_auto_connect) {
        connect(s.pp_host, s.pp_port).catch(() => {});
      }
      // Auto-start audio capture so metering + the overflow "Listen" stream are
      // always live, without anyone clicking Start on the booth Mac. Only the
      // desktop host grabs the device — web/phone clients would just thrash it.
      if (!IS_WEB) {
        startAudioCapture(s.audio_input ?? null).catch((e) => setAudioError(audioStartMessage(String(e), s.audio_input)));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep trying. The one start above used to be the only attempt: when the
  // audio interface was mid-restart at launch (Dante Virtual Soundcard does
  // this), the meter stayed off until someone restarted ProDeck — a whole
  // service without SPL. Retry every 30 s while nothing is running; once the
  // stream is up this does nothing.
  const audioRunningRef = useRef(false);
  audioRunningRef.current = audioRunning;
  useEffect(() => {
    if (IS_WEB) return;
    const iv = setInterval(() => {
      if (audioRunningRef.current) return;
      getSettings()
        .then((s) =>
          startAudioCapture(s.audio_input ?? null)
            .then(() => setAudioError(null))
            .catch((e) => setAudioError(audioStartMessage(String(e), s.audio_input))),
        )
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(iv);
  }, []);

  // Mirror reconnect targets from settings.
  useEffect(() => {
    autoRef.current = !!settings?.pp_auto_connect;
    hostRef.current = settings?.pp_host ?? "";
    portRef.current = settings?.pp_port ?? 0;
  }, [settings]);

  // While auto-connect is enabled and we're offline, keep retrying — covers
  // ProPresenter launching after this app, a sleep/wake, or a dropped link.
  // The ProPresenter Mac is on DHCP and hops IPs, so after a few dead retries
  // the host also rescans Bonjour and follows ProPresenter to its new address
  // (self-heal). The API port is a ProPresenter setting, not per-address, so
  // the configured port is reused; connect() persists whatever works.
  // Roughly the first half-minute of retries (the loop runs every ~6s). Long
  // enough to cover mDNS waking up and ProPresenter finishing its own launch,
  // short enough that a genuinely wrong address still gets reported.
  const GRACE_ATTEMPTS = 5;
  const ppConnecting =
    !connected && !!settings?.pp_auto_connect && !!settings?.pp_host && ppFails < GRACE_ATTEMPTS;

  const failsRef = useRef(0);
  const healBusyRef = useRef(false);
  useEffect(() => {
    const iv = setInterval(async () => {
      if (!autoRef.current || connectedRef.current || !hostRef.current) return;
      if (healBusyRef.current) return; // a slow scan is still running
      healBusyRef.current = true;
      try {
        await connect(hostRef.current, portRef.current);
        failsRef.current = 0;
      } catch {
        failsRef.current += 1;
        const n = failsRef.current;
        // After 3 dead retries (~18s), then every 5th after, hunt via mDNS.
        if (!IS_WEB && (n === 3 || (n > 3 && (n - 3) % 5 === 0))) {
          try {
            const found = await discoverServices(4);
            // "stage" counts too: the REST API often isn't on the port
            // Bonjour advertises (that's the stage display), which is exactly
            // why connect() falls back to 1025. The manual Find button has
            // always accepted both — this unattended path filtering them out
            // meant the self-heal missed hosts the operator could see.
            outer: for (const s of found.filter(
              (x) => x.kind === "propresenter" || x.kind === "stage",
            )) {
              for (const h of [s.host, ...s.addresses]) {
                if (!h || h === hostRef.current) continue;
                try {
                  await connect(h, portRef.current);
                  failsRef.current = 0;
                  break outer;
                } catch {
                  /* try the next candidate address */
                }
              }
            }
          } catch {
            /* mDNS scan failed; plain retry continues next cycle */
          }
        }
      } finally {
        healBusyRef.current = false;
      }
    }, 6000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: Store = {
    connected,
    host,
    status,
    captions,
    captionStatus,
    audioLevel,
    audioPeak,
    audioDb,
    audioDbA,
    audioDbC,
    audioPeakDb,
    audioRunning,
    audioError,
    lufs,
    splCalibration,
    setSplCalibration,
    startAudio,
    midiLog,
    oscLog,
    settings,
    connect,
    disconnect,
    refreshSettings,
    clearCaptions: () => setCaptions([]),
    connectError,
    ppConnecting,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProDeck(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProDeck must be used within ProDeckProvider");
  return ctx;
}
