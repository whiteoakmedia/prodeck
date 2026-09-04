import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { emit } from "@tauri-apps/api/event";
import {
  on,
  relayBroadcast,
  relayConnectClient,
  relayStartHost,
  relayStop,
  type Json,
} from "./lib/tauri";
import { loadDashboards, type Dashboard } from "./lib/dashboards";

// Events the host forwards verbatim; the client re-emits them locally so every
// existing store mirrors with no special-casing.
const FORWARD_EVENTS = [
  "pp:connected",
  "pp:disconnected",
  "pp:status",
  "caption:line",
  "caption:status",
  "audio:started",
  "audio:stopped",
  "audio:lufs",
  "pco:items",
  "pco:team",
  "pco:live",
  "pco:sync_started",
  "pco:sync_stopped",
  "ndi:stream_started",
  "ndi:status",
];
// High-rate events forwarded at a throttled cadence.
const THROTTLED = ["audio:level", "audio:rta"];

export type RelayMode = "off" | "host" | "client";

interface RelayCtx {
  mode: RelayMode;
  hostPort: number;
  clientUrl: string;
  clients: number;
  connected: boolean;
  hostIp: string | null;
  dashboards: Dashboard[] | null; // client: dashboards relayed from host
  ndiSources: string[]; // client: NDI source names the host is streaming
  startHost: () => void;
  connectClient: () => void;
  stop: () => void;
  setHostPort: (n: number) => void;
  setClientUrl: (s: string) => void;
  // Client: the host MJPEG URL for an NDI source name, if the host is sending it.
  relayNdiUrl: (sourceName: string) => string | null;
}

const Ctx = createContext<RelayCtx | null>(null);

const KEY = { mode: "prodeck.relayMode", port: "prodeck.relayHostPort", url: "prodeck.relayClientUrl" };

export function RelayProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<RelayMode>(
    () => (localStorage.getItem(KEY.mode) as RelayMode) || "off",
  );
  const [hostPort, setHostPortState] = useState(
    () => parseInt(localStorage.getItem(KEY.port) || "") || 51421,
  );
  const [clientUrl, setClientUrlState] = useState(
    () => localStorage.getItem(KEY.url) || "",
  );
  const [clients, setClients] = useState(0);
  const [connected, setConnected] = useState(false);
  const [dashboards, setDashboards] = useState<Dashboard[] | null>(null);
  const [ndiSources, setNdiSources] = useState<string[]>([]);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const ndiMap = useRef<Record<string, number>>({});
  const lastSent = useRef<Record<string, number>>({});

  const hostIp = (() => {
    try {
      return clientUrl ? new URL(clientUrl).hostname : null;
    } catch {
      return null;
    }
  })();

  // ---- status events from the backend
  useEffect(() => {
    const un = on<any>("relay:status", (s) => {
      if (typeof s.clients === "number") setClients(s.clients);
      if (typeof s.connected === "boolean") setConnected(s.connected);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // ---- HOST: forward live events to clients
  useEffect(() => {
    if (mode !== "host") return;
    const unsubs: Promise<() => void>[] = [];
    for (const ev of FORWARD_EVENTS) {
      unsubs.push(
        on<any>(ev, (payload) => {
          if (modeRef.current !== "host") return;
          relayBroadcast({ kind: "event", event: ev, payload } as unknown as Json).catch(() => {});
        }),
      );
    }
    for (const ev of THROTTLED) {
      unsubs.push(
        on<any>(ev, (payload) => {
          if (modeRef.current !== "host") return;
          const now = Date.now();
          if (now - (lastSent.current[ev] ?? 0) < 200) return; // ~5/s
          lastSent.current[ev] = now;
          relayBroadcast({ kind: "event", event: ev, payload } as unknown as Json).catch(() => {});
        }),
      );
    }
    // Dashboards: broadcast on change (polled).
    let lastDash = "";
    const dashIv = setInterval(async () => {
      if (modeRef.current !== "host") return;
      const d = await loadDashboards().catch(() => null);
      if (!d) return;
      const json = JSON.stringify(d);
      if (json !== lastDash) {
        lastDash = json;
        relayBroadcast({ kind: "dashboards", data: d } as unknown as Json).catch(() => {});
      }
    }, 3000);
    return () => {
      unsubs.forEach((u) => u.then((f) => f()));
      clearInterval(dashIv);
    };
  }, [mode]);

  // ---- CLIENT: apply relayed messages locally
  useEffect(() => {
    const un = on<any>("relay:message", (msg) => {
      if (modeRef.current !== "client" || !msg) return;
      if (msg.kind === "event" && msg.event) {
        if (msg.event === "ndi:stream_started" && msg.payload?.source && msg.payload?.port) {
          ndiMap.current[msg.payload.source] = msg.payload.port;
          setNdiSources(Object.keys(ndiMap.current));
        }
        // Re-dispatch the host's event locally → existing stores update.
        emit(msg.event, msg.payload).catch(() => {});
      } else if (msg.kind === "dashboards" && Array.isArray(msg.data)) {
        setDashboards(msg.data as Dashboard[]);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // ---- start/stop transport when mode changes (and once on mount)
  useEffect(() => {
    if (mode === "host") relayStartHost(hostPort).catch(() => {});
    else if (mode === "client" && clientUrl) relayConnectClient(clientUrl).catch(() => {});
    else relayStop().catch(() => {});
    if (mode !== "client") setConnected(false);
    if (mode !== "host") setClients(0);
    if (mode !== "client") {
      ndiMap.current = {};
      setDashboards(null);
      setNdiSources([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, hostPort, clientUrl]);

  function persist(m: RelayMode, p: number, u: string) {
    localStorage.setItem(KEY.mode, m);
    localStorage.setItem(KEY.port, String(p));
    localStorage.setItem(KEY.url, u);
  }
  function startHost() {
    setMode("host");
    persist("host", hostPort, clientUrl);
  }
  function connectClient() {
    setMode("client");
    persist("client", hostPort, clientUrl);
  }
  function stop() {
    setMode("off");
    persist("off", hostPort, clientUrl);
  }
  function setHostPort(n: number) {
    setHostPortState(n);
    localStorage.setItem(KEY.port, String(n));
  }
  function setClientUrl(s: string) {
    setClientUrlState(s);
    localStorage.setItem(KEY.url, s);
  }
  function relayNdiUrl(sourceName: string): string | null {
    if (mode !== "client" || !hostIp) return null;
    const port = ndiMap.current[sourceName];
    return port ? `http://${hostIp}:${port}/` : null;
  }

  const value: RelayCtx = {
    mode,
    hostPort,
    clientUrl,
    clients,
    connected,
    hostIp,
    dashboards,
    ndiSources,
    startHost,
    connectClient,
    stop,
    setHostPort,
    setClientUrl,
    relayNdiUrl,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRelay(): RelayCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRelay must be used within RelayProvider");
  return ctx;
}
