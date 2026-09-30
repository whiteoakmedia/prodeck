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
import { invoke } from "./lib/tauri";
import { getVersion } from "@tauri-apps/api/app";
import { IS_DEMO, IS_WEB } from "./lib/tauri";
import { SHOT_UPDATE } from "./lib/demo";

declare const __APP_VERSION__: string;

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

const DISMISS_KEY = "prodeck.updateDismissed";

const Ctx = createContext<UpdaterCtx | null>(null);

export function UpdaterProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);

  async function doCheck(silent = false) {
    setStatus("checking");
    setError(null);
    try {
      const u = await check();
      if (u) {
        updateRef.current = u;
        setNewVersion(u.version);
        setNotes(u.body ?? null);
        let dismissed = "";
        try {
          dismissed = localStorage.getItem(DISMISS_KEY) ?? "";
        } catch {
          /* storage unavailable */
        }
        // An explicit "Check for updates" always shows the result; only the
        // automatic launch check honours a dismissal.
        setStatus(!silent || dismissed !== u.version ? "available" : "idle");
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
      // Drop the single-instance lock first. relaunch() spawns the new copy
      // and exits without running the Exit event that would normally release
      // it, so the new copy sees us as "already running", defers, and quits —
      // leaving the freshly installed update not running at all. Seen on the
      // first real in-app update on this channel.
      await invoke<void>("release_single_instance").catch(() => {});
      // Tauri's relaunch() exec()s the new binary as our child and exits 0.
      // Under a launchd watchdog that child dies with our process group and
      // the job is not restarted — the update installs and the app never
      // comes back (seen 2026-09-23). relaunch_after_update knows the two safe
      // paths (exit non-zero under launchd; `open -n` otherwise) and exits the
      // process itself. If it is not applicable here, fall back to the stock path.
      const handled = await invoke<string>("relaunch_after_update").then(() => true).catch(() => false);
      if (handled) {
        await new Promise((r) => setTimeout(r, 5000)); // the process exits underneath us
        return;
      }
      await relaunch();
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  // Remember WHICH version was dismissed. Setting status back to "idle" only
  // hid it until the next launch, when the 4s auto-check found the same
  // version and put the banner straight back — the "it won't go away" half of
  // the bug report. A newer version still gets to interrupt.
  function dismiss() {
    try {
      if (newVersion) localStorage.setItem(DISMISS_KEY, newVersion);
    } catch {
      /* storage unavailable — falls back to hiding for this session */
    }
    setStatus("idle");
  }

  useEffect(() => {
    if (IS_WEB) {
      setVersion("web");
      return; // the desktop host owns updates
    }
    if (IS_DEMO) {
      setVersion(__APP_VERSION__); // demo/screenshot mode in a browser: no updater, no Tauri
      if (SHOT_UPDATE) {
        // The announcement as churches will see it: the next patch version
        // and its notes file (release-notes/<version>.md, published as-is).
        const [a, b, c] = __APP_VERSION__.split(".").map(Number);
        const next = `${a}.${b}.${c + 1}`;
        const files = import.meta.glob("../release-notes/*.md", { query: "?raw", import: "default" });
        const load = files[`../release-notes/${next}.md`];
        setNewVersion(next);
        setStatus("available");
        if (load) load().then((t) => setNotes(String(t))).catch(() => {});
      }
      return;
    }
    getVersion().then(setVersion).catch(() => {});
    // Auto-check a few seconds after launch (silent if the server is unreachable).
    const t = setTimeout(() => {
      doCheck(true);
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
