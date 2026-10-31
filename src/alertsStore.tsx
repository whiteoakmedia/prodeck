import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useProDeck } from "./store";
import { usePco , isDeclined } from "./pcoStore";
import { useChecklists } from "./checklistStore";
import { confirmedMutes, wavesState, fmtSince } from "./lib/deskConfidence";
import { avantisState, on } from "./lib/tauri";
import { describeAlert, hasSignal, micAlerts, micPhase, type WatchedMic } from "./lib/micCheck";

// ---------------------------------------------------------------------------
// System health + smart alerts. One place that watches every subsystem the
// production director cares about and raises an alarm before it hits the air.
// ---------------------------------------------------------------------------

export type HealthState = "ok" | "warn" | "bad" | "idle";

export interface Subsystem {
  key: string;
  label: string;
  state: HealthState;
  detail: string;
}

export interface Alert {
  id: string;
  severity: "warn" | "crit";
  message: string;
  ts: number;
}

export interface AlertConfig {
  enabled: boolean;
  audioSilence: boolean;
  silenceDb: number; // dBFS floor below which the input counts as "dead"
  silenceSecs: number;
  overSpl: boolean;
  overSplValue: number;
  overSecs: number;
  ndiLoss: boolean;
  ppDisconnect: boolean;
  tapPushFail: boolean;
  /// A person is scheduled on a mic, the service window is live, and that
  /// mic's desk channel is muted.
  micMuted: boolean;
  /** The outboard rig (Waves) was switched off by a scene recall near or during a service. */
  wavesOff: boolean;
  /// A scheduled mic is OPEN at the desk but carrying no signal — a dead
  /// battery, an unplugged XLR, a capsule that failed. `micMuted` cannot see
  /// any of those: the channel is unmuted, so the desk believes it is fine.
  /// Needs each watched mic routed to its own channel on the booth's audio
  /// input (Settings → Audio), because Allen & Heath's control protocol
  /// carries no metering.
  micSilent: boolean;
}

// How long a failed TapLink push keeps raising an alert. Long enough to be
// seen mid-service, short enough that a Thursday failure isn't still up on
// Sunday — and a later successful push clears it immediately anyway.
const TAP_FAIL_TTL = 15 * 60_000;

const DEFAULT_CONFIG: AlertConfig = {
  enabled: true,
  audioSilence: true,
  silenceDb: -80,
  silenceSecs: 4,
  overSpl: true,
  overSplValue: 100,
  overSecs: 6,
  ndiLoss: true,
  ppDisconnect: true,
  tapPushFail: true,
  micMuted: true,
  wavesOff: true,
  micSilent: true,
};

const CFG_KEY = "prodeck.alertConfig";
function loadConfig(): AlertConfig {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CFG_KEY) || "{}") };
  } catch {
    return DEFAULT_CONFIG;
  }
}

interface NdiStat {
  alive: boolean;
  fps: number;
  lastSeen: number;
}

interface AlertsCtx {
  subsystems: Subsystem[];
  alerts: Alert[];
  dismiss: (id: string) => void;
  config: AlertConfig;
  setConfig: (patch: Partial<AlertConfig>) => void;
}

const Ctx = createContext<AlertsCtx | null>(null);


function sameSubs(a: Subsystem[], b: Subsystem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.state === b[i].state && s.detail === b[i].detail);
}
function sameAlerts(a: Alert[], b: Alert[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.id === b[i].id && x.message === b[i].message);
}

export function AlertsProvider({ children }: { children: ReactNode }) {
  const pl = useProDeck();
  const pco = usePco();
  const [config, setConfigState] = useState<AlertConfig>(loadConfig);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [subsystems, setSubsystems] = useState<Subsystem[]>([]);

  // Fresh values for the 1 Hz detector without re-subscribing.
  const plRef = useRef(pl);
  plRef.current = pl;
  const pcoRef = useRef(pco);
  pcoRef.current = pco;
  const checklists = useChecklists();
  const clRef = useRef(checklists);
  clRef.current = checklists;
  const cfgRef = useRef(config);
  cfgRef.current = config;

  const ndi = useRef<Map<string, NdiStat>>(new Map());
  const avantisUp = useRef(false);
  /** The backend's last desk connect failure, shown on the Sound desk light. */
  const avantisError = useRef<string | null>(null);
  const avantisMutes = useRef<Record<string, boolean>>({});
  const avantisScene = useRef<{ scene: number | null; at: number | null }>({ scene: null, at: null });
  const tapFail = useRef<{ ts: number; message: string } | null>(null);
  const muted = useRef<Set<string>>(new Set());
  const conds = useRef<Map<string, Alert>>(new Map());
  const since = useRef<{ silence: number | null; over: number | null }>({
    silence: null,
    over: null,
  });
  const everConnected = useRef(false);
  // Silence only alarms when signal stopped RECENTLY: "monitoring on, band
  // not playing yet" is Sunday-normal and used to shout a red banner at
  // whoever opened the app first. A latch wasn't enough — one startup pop
  // armed it forever — so the alarm needs signal within this window.
  const SIGNAL_RECENT_MS = 10 * 60_000;
  const lastSignalAt = useRef<number | null>(null);

  // When each input channel last carried signal, for the per-mic watch. Kept
  // in a ref because `audio:channels` arrives several times a second and none
  // of it belongs on the render path — the 1 Hz detector below reads it.
  const chanLastSound = useRef<Map<number, number>>(new Map());
  useEffect(() => {
    const un = on<number[]>("audio:channels", (peaks) => {
      const now = Date.now();
      for (let i = 0; i < peaks.length; i++) {
        if (hasSignal(peaks[i])) chanLastSound.current.set(i + 1, now);
      }
    });
    return () => void un.then((f) => f());
  }, []);

  // Per-source NDI heartbeats from the backend.
  useEffect(() => {
    const un = on<{ source: string; alive: boolean; fps: number; stopped: boolean }>(
      "ndi:status",
      (s) => {
        if (s.stopped) ndi.current.delete(s.source);
        else ndi.current.set(s.source, { alive: s.alive, fps: s.fps, lastSeen: Date.now() });
      },
    );
    const unAv = on<{ connected: boolean }>("avantis:status", (s) => {
      avantisUp.current = !!s.connected;
    });
    const unAvState = on<{ connected: boolean; mutes: Record<string, boolean>; lastError?: string | null }>(
      "avantis:state",
      (s) => {
        avantisUp.current = !!s.connected;
        avantisError.current = s.lastError ?? null;
        // Only mutes the desk has confirmed this connection — a remembered
        // mute raised "Mic 3 is muted" while the desk plainly wasn't.
        avantisMutes.current = confirmedMutes(s as any);
        avantisScene.current = { scene: (s as any).scene ?? null, at: (s as any).sceneAt ?? null };
      },
    );
    // Status only fires on change — a client that loads after the desk
    // connected would show it red forever without this one-shot.
    avantisState()
      .then((s) => {
        avantisUp.current = !!s.connected;
        avantisError.current = s.lastError ?? null;
        avantisMutes.current = confirmedMutes(s);
        avantisScene.current = { scene: s.scene ?? null, at: s.sceneAt ?? null };
      })
      .catch(() => {});
    return () => {
      un.then((f) => f());
      unAv.then((f) => f());
      unAvState.then((f) => f());
    };
  }, []);

  // TapLink push failures. These arrive as one-shot events, but the detector
  // below rebuilds its alert set from scratch every tick — so latch the
  // failure here and let a successful push (or the TTL) clear it. Without a
  // latch the alert would flash for a single frame and vanish.
  useEffect(() => {
    const subs = [
      on<{ state: string; error: string }>("tap:error", (p) => {
        tapFail.current = {
          ts: Date.now(),
          message: `TapLink push failed (${p.state}) — NFC discs may point at the wrong page: ${p.error}`,
        };
      }),
      on("tap:pushed", () => {
        tapFail.current = null;
      }),
    ];
    return () => {
      subs.forEach((u) => u.then((f) => f()));
    };
  }, []);

  // The detector — runs once a second, evaluates every condition, reconciles
  // the active-alert set, and recomputes the health strip.
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const cfg = cfgRef.current;
      const p = plRef.current;
      const pc = pcoRef.current;
      const active = new Map<string, { severity: "warn" | "crit"; message: string }>();

      // Cameras / NDI feeds.
      let alive = 0;
      let total = 0;
      for (const [name, st] of ndi.current) {
        total++;
        const down = !st.alive || now - st.lastSeen > 3000;
        if (!down) alive++;
        else if (cfg.enabled && cfg.ndiLoss)
          // The only NDI source in this room is ProPresenter's stage output.
          active.set(`ndi:${name}`, {
            severity: "crit",
            message: `Stage feed lost: ${name} — check ProPresenter's NDI output and the network.`,
          });
      }

      // Audio: silence + sustained over-SPL.
      let audioState: HealthState = "idle";
      let audioDetail = "off";
      if (!p.audioRunning && p.audioError) {
        // The meter tried and the audio system refused or never answered.
        // "off" looked like a choice; this is a fault someone can act on.
        audioState = "warn";
        audioDetail = "not answering — retrying";
      }
      if (p.audioRunning) {
        const level = p.audioLevel;
        // "Dead feed" detection uses PEAK, not RMS: real program material dips
        // in RMS between transients (so RMS would false-alarm), but if there's
        // any audio at all the peak stays well above the floor. Only a genuinely
        // disconnected/silent input has no peaks.
        const peakDbfs = p.audioPeak > 0 ? 20 * Math.log10(p.audioPeak) : -120;
        audioState = "ok";
        audioDetail = "signal";
        if (cfg.enabled && cfg.audioSilence) {
          if (peakDbfs < cfg.silenceDb) {
            since.current.silence ??= now;
            if (now - (since.current.silence ?? now) >= cfg.silenceSecs * 1000) {
              const recent =
                lastSignalAt.current != null &&
                now - lastSignalAt.current < SIGNAL_RECENT_MS;
              if (recent) {
                // Signal was flowing minutes ago and stopped — a real problem.
                active.set("audio:silence", {
                  severity: "crit",
                  message:
                    "Audio signal lost — sound was coming in and stopped. Audio arrives over Dante: check the Dante route to this Mac (Dante Controller) and the network switch, then Settings → Audio. The Routing page shows the full chain.",
                });
                audioState = "bad";
                audioDetail = "lost";
              } else {
                // Nothing playing for a while (or ever): quiet chip on the
                // health strip, no banner.
                audioState = "idle";
                audioDetail = "quiet";
              }
            }
          } else {
            since.current.silence = null;
            lastSignalAt.current = now;
          }
        }
        if (cfg.enabled && cfg.overSpl) {
          const spl = level > 0 ? 20 * Math.log10(level) + p.splCalibration : -100;
          if (spl > cfg.overSplValue) {
            since.current.over ??= now;
            if (now - (since.current.over ?? now) >= cfg.overSecs * 1000) {
              active.set("audio:over", {
                severity: "warn",
                message: `Audio sustained over ${cfg.overSplValue} dB SPL`,
              });
              if (audioState === "ok") {
                audioState = "warn";
                audioDetail = "hot";
              }
            }
          } else since.current.over = null;
        }
      } else {
        since.current.silence = null;
        since.current.over = null;
        lastSignalAt.current = null;
      }

      // ProPresenter connection.
      if (p.connected) everConnected.current = true;
      if (cfg.enabled && cfg.ppDisconnect && everConnected.current && !p.connected)
        active.set("pp:disc", {
          severity: "crit",
          message:
            "ProPresenter disconnected — make sure it's open on the presentation Mac. ProDeck reconnects on its own; if this stays red, open the ProPresenter page.",
        });

      // TapLink: a push that never landed. Critical because it's silent by
      // nature — the discs keep working, they just send people somewhere the
      // operator didn't choose.
      if (tapFail.current && now - tapFail.current.ts > TAP_FAIL_TTL) tapFail.current = null;
      if (cfg.enabled && cfg.tapPushFail && tapFail.current)
        active.set("tap:push", { severity: "crit", message: tapFail.current.message });

      // The Waves rig switched off by a scene recall. Sound quality changes a
      // lot with it off, so around a service that is worth a banner even
      // though nothing is "broken".
      {
        const onS = p.settings?.avantis_waves_on_scene ?? 0;
        const offS = p.settings?.avantis_waves_off_scene ?? 0;
        const ws = wavesState(avantisScene.current.scene, onS, offS);
        const startTs = pc.serviceTimes?.find((t: any) => t.id === pc.selectedServiceTimeId)?.ts || null;
        const nearService = !!startTs && now >= startTs - 90 * 60_000 && now <= startTs + 2 * 3600_000;
        if (cfg.enabled && cfg.wavesOff && avantisUp.current && ws === "off" && nearService) {
          const when = fmtSince(avantisScene.current.at, now);
          active.set("desk:waves-off", {
            severity: "warn",
            message: `Waves is OFF on the desk (scene ${offS}${when ? ` recalled ${when}` : ""}) — vocals and the stream are running without Waves processing. Recall scene ${onS} to bring it back.`,
          });
        }
      }

      // A scheduled mic muted on the desk. No time window — if someone is on
      // the plan and their mapped channel is muted, say so; the banner is
      // dismissible when it's a deliberate setup-time mute.
      if (cfg.enabled && cfg.micMuted && avantisUp.current) {
        for (const m of pc.team) {
          if (isDeclined(m.status)) continue;
          const mic = pc.micFor(m.id, m.position).mic;
          if (!mic) continue;
          const deskId = pc.micDeskMap[mic];
          if (deskId && avantisMutes.current[deskId] === true) {
            active.set(`mic:${mic}`, {
              severity: "warn",
              message: `Mic ${mic} (${m.name} — ${m.position}) is muted on the desk.`,
            });
          }
        }

      // The same question the mute check asks, for the failure it cannot see.
      // A muted channel is somebody's decision; an OPEN channel with nothing
      // coming down it is a flat battery, a pulled XLR or a dead capsule, and
      // the desk has no idea — its meters are not on the wire ProDeck can
      // read, which is why each watched mic is routed to its own input
      // channel instead.
      //
      // Two moments only, both asked for by name: ninety seconds before the
      // service, which is long enough to walk to the stage and swap a
      // battery; and while a song is live. Outside those, a quiet mic is just
      // a quiet mic.
      const micChans = (plRef.current.settings?.audio_mic_channels ?? {}) as Record<string, number>;
      if (cfg.enabled && cfg.micSilent && Object.keys(micChans).length) {
        const liveItem = (pc.items ?? []).find((i: any) => i.id === pc.liveItemId);
        const serviceStartTs =
          pc.serviceTimes?.find((t: any) => t.id === pc.selectedServiceTimeId)?.ts || null;
        const phase = micPhase(serviceStartTs, liveItem?.type === "song", now);

        // Who is on each mic today, from the plan — not from the mic map,
        // which lists every mic the building owns including the spares.
        const person: Record<string, string> = {};
        for (const m of pc.team) {
          if (isDeclined(m.status)) continue;
          const mic = pc.micFor(m.id, m.position).mic;
          if (mic) person[mic] = m.name;
        }

        // Mute state comes from whichever desk is mirroring. All four
        // supported models feed the same map — Avantis and dLive as MIDI note
        // messages, SQ as NRPN, X32/M32 as OSC — so the suppression works on
        // any of them. With no desk connected there is simply no mute
        // information, which is NOT the same as "nothing is muted": saying so
        // is the difference between a useful alert and one that cries wolf at
        // a channel somebody muted on purpose.
        const deskKnowsMutes = avantisUp.current;
        const watched: WatchedMic[] = Object.entries(micChans).map(([mic, channel]) => ({
          mic,
          channel,
          person: person[mic],
          // Muted is already the other alert's job. Excluding it here keeps a
          // deliberately muted mic from raising two alarms that say different
          // things about the same channel.
          muted: deskKnowsMutes && avantisMutes.current[pc.micDeskMap[mic] ?? ""] === true,
          lastSoundMs: chanLastSound.current.get(channel) ?? 0,
        }));

        for (const a of micAlerts(watched, phase, now)) {
          const tail = phase === "precheck" ? " — service starts in under two minutes" : "";
          const caveat = deskKnowsMutes ? "" : " (desk not connected — can't tell if it's muted)";
          active.set(`mic-silent:${a.mic}`, {
            severity: phase === "worship" ? "crit" : "warn",
            message: describeAlert(a) + tail + caveat,
          });
        }
      }

        // Per-song, as the service progresses. The live item follows BOTH
        // drivers — PCO Live and ProPresenter (Follow Pro matches the active
        // presentation to a plan item) — so this works however the service is
        // being advanced. The song's leader (incl. booth overrides) resolves
        // to a mic via micForLeader; the LIVE song muted is critical, the
        // NEXT song is a heads-up so it's fixed before the transition.
        const items = pc.items ?? [];
        const liveIdx = items.findIndex((i: any) => i.id === pc.liveItemId);
        const checkSong = (item: any, when: "live" | "next") => {
          if (!item || item.type !== "song" || !item.leader) return;
          const mic = pc.micForLeader(item.leader);
          const deskId = mic ? pc.micDeskMap[mic] : undefined;
          if (deskId && avantisMutes.current[deskId] === true) {
            active.set(`mic:song-${when}`, {
              severity: when === "live" ? "crit" : "warn",
              message:
                when === "live"
                  ? `"${item.title}" is LIVE — ${item.leader} (leader, Mic ${mic}) is muted!`
                  : `Next song "${item.title}": ${item.leader} leads on Mic ${mic} — currently muted.`,
            });
          }
        };
        if (liveIdx >= 0) {
          checkSong(items[liveIdx], "live");
          checkSong(
            items.slice(liveIdx + 1).find((i: any) => i.type === "song"),
            "next",
          );
        }
      }

      // Overdue checklists (past their due time with steps still unchecked).
      if (cfg.enabled) {
        for (const c of clRef.current.overdue(now)) {
          const { done, total } = clRef.current.progress(c);
          active.set(`checklist:${c.id}`, {
            severity: "warn",
            message: `Checklist "${c.name}" overdue — ${done}/${total} done`,
          });
        }
      }

      // Reconcile the active alert set against what we're already showing.
      for (const key of Array.from(conds.current.keys())) {
        if (!active.has(key)) {
          conds.current.delete(key);
          muted.current.delete(key);
        }
      }
      for (const [key, info] of active) {
        const existing = conds.current.get(key);
        if (!existing) {
          conds.current.set(key, {
            id: key,
            severity: info.severity,
            message: info.message,
            ts: now,
          });
        } else {
          existing.message = info.message;
          existing.severity = info.severity;
        }
      }
      const visible = Array.from(conds.current.values())
        .filter((a) => !muted.current.has(a.id))
        .sort((x, y) => y.ts - x.ts);
      setAlerts((prev) => (sameAlerts(prev, visible) ? prev : visible));

      // Health strip.
      const subs: Subsystem[] = [
        {
          key: "pp",
          label: "Pro",
          state: p.connected ? "ok" : everConnected.current ? "bad" : "idle",
          detail: p.connected ? p.host || "connected" : "offline",
        },
        {
          key: "pco",
          label: "PCO",
          state: pc.syncing ? "ok" : pc.selectedPlanId ? "warn" : "idle",
          detail: pc.syncing ? "live" : pc.selectedPlanId ? "not syncing" : "no plan",
        },
        { key: "audio", label: "Audio", state: audioState, detail: audioDetail },
        // Only present when the mirror is enabled — a feature that's off is
        // not a subsystem that's down.
        ...(p.settings?.avantis_enabled
          ? [
              {
                key: "desk",
                label: "Desk",
                state: (avantisUp.current ? "ok" : "bad") as HealthState,
                detail: avantisUp.current ? "mirroring" : avantisError.current || "unreachable",
              },
            ]
          : []),
        {
          key: "cam",
          label: "Stage",
          state: total === 0 ? "idle" : alive < total ? "bad" : "ok",
          detail: total === 0 ? "none" : `${alive}/${total}`,
        },
      ];
      setSubsystems((prev) => (sameSubs(prev, subs) ? prev : subs));
    };

    const id = setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
  }, []);

  function dismiss(id: string) {
    muted.current.add(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  function setConfig(patch: Partial<AlertConfig>) {
    setConfigState((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(CFG_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const value = useMemo<AlertsCtx>(
    () => ({ subsystems, alerts, dismiss, config, setConfig }),
    [subsystems, alerts, config],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAlerts(): AlertsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAlerts must be used within AlertsProvider");
  return ctx;
}
