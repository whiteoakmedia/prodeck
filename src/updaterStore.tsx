import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { IS_WEB } from "./lib/tauri";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "uptodate"
  | "available"
  | "downloading"
  | "ready"
  | "error";

interface UpdaterCtx {
  version: string;
  status: UpdateStatus;
  newVersion: string | null;
  notes: string | null;
  progress: number; // 0..100 while downloading
  error: string | null;
  check: () => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

const Ctx = createContext<UpdaterCtx | null>(null);

export function UpdaterProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);

  async function doCheck() {
    setStatus("checking");
    setError(null);
    try {
      const u = await check();
      if (u) {
        updateRef.current = u;
        setNewVersion(u.version);
        setNotes(u.body ?? null);
        setStatus("available");
      } else {
        setStatus("uptodate");
      }
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  async function install() {
    const u = updateRef.current;
    if (!u) return;
    setStatus("downloading");
    setProgress(0);
    try {
      let total = 0;
      let got = 0;
      await u.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          if (total) setProgress(Math.min(99, Math.round((got / total) * 100)));
        } else if (ev.event === "Finished") setProgress(100);
      });
      setStatus("ready");
      await relaunch();
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  function dismiss() {
    if (status === "available") setStatus("idle");
  }

  useEffect(() => {
    if (IS_WEB) {
      setVersion("web");
      return; // the desktop host owns updates
    }
    getVersion().then(setVersion).catch(() => {});
    // Auto-check a few seconds after launch (silent if the server is unreachable).
    const t = setTimeout(() => {
      doCheck();
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: UpdaterCtx = {
    version,
    status,
    newVersion,
    notes,
    progress,
    error,
    check: doCheck,
    install,
    dismiss,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUpdater(): UpdaterCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUpdater must be used within UpdaterProvider");
  return ctx;
}
