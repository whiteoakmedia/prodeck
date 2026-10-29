import { useEffect, useRef, useState } from "react";
import { atemState, on, onGatewayState, TALLY_OPTS, type AtemSnapshot } from "../lib/tauri";
import { boardSources, cardLabel, findSource, liveAndNext, tallyOf, tallySources, tallyView, type Tally } from "../lib/tally";
import type { AtemInput } from "../lib/tauri";

// Tally screen (?tally=<camera>&token=…): a phone or tablet mounted on a
// camera, full screen red when that camera is on air and green when it's
// next (on Preview). Three views (lib/tally.ts tallyView): the plain light,
// "operator" (this camera big, what's live and next along the bottom) and
// "board" (?tally=all: every camera at once, for an iPad at the director's
// desk or side of stage). Built to be left alone for months: no sign-in, keeps the screen
// awake, reconnects by itself, reloads after the booth has been away (so it
// picks up a new ProDeck), and never shows "off air" when it simply doesn't
// know. That last one matters most: dark means "safe to move the camera".

/** Re-read the switcher this often even if events are flowing. */
const POLL_MS = 2_000;
/** This many failed reads in a row = we can't trust what's on screen. */
const FAILS_FOR_NO_TALLY = 2;
const PICK_KEY = "prodeck.tallyCamera";

type Shown = Tally | "unknown";

export function TallyPage({ param }: { param: string }) {
  const [snap, setSnap] = useState<AtemSnapshot | null>(null);
  const [fails, setFails] = useState(0);
  const [gateway, setGateway] = useState(true);
  const [chosen, setChosen] = useState(() => param || readPick());
  const [info, setInfo] = useState(false);
  const [picking, setPicking] = useState(false);

  // Live updates, plus a steady re-read so a missed event can't leave a
  // stale colour up.
  useEffect(() => {
    let alive = true;
    const read = () =>
      atemState()
        .then((s) => {
          if (!alive) return;
          setSnap(s);
          setFails(0);
        })
        .catch(() => alive && setFails((n) => n + 1));
    read();
    const iv = setInterval(read, POLL_MS);
    const un = on<AtemSnapshot>("atem:state", (s) => {
      if (!alive || !s) return;
      setSnap(s);
      setFails(0);
    });
    return () => {
      alive = false;
      clearInterval(iv);
      un.then((f) => f());
    };
  }, []);

  // After the booth has been unreachable, reload once it's back: it may be
  // a new version of ProDeck, and a device on a camera never gets refreshed
  // by hand.
  const awaySince = useRef<number | null>(null);
  useEffect(
    () =>
      onGatewayState((up) => {
        setGateway(up);
        if (!up) awaySince.current ??= Date.now();
        else if (awaySince.current && Date.now() - awaySince.current > 10_000) location.reload();
        else awaySince.current = null;
      }),
    [],
  );

  useWakeLock();

  const view = tallyView(TALLY_OPTS.view, param);
  const src = findSource(snap, chosen);
  useHomeScreenApp(view === "board" ? "Tally board" : `Tally ${src?.short || src?.name || ""}`.trim());
  const known = !!snap && snap.connected && snap.ready && gateway && fails < FAILS_FOR_NO_TALLY;
  let shown: Shown = known && src ? tallyOf(snap, src.id, TALLY_OPTS.me) : "unknown";
  if (shown === "preview" && !TALLY_OPTS.preview) shown = "off";

  // A buzz on going live, where the device can (Android).
  const prev = useRef<Shown>("unknown");
  useEffect(() => {
    if (shown === "program" && prev.current !== "program") navigator.vibrate?.(150);
    prev.current = shown;
  }, [shown]);

  // Info overlay hides itself.
  useEffect(() => {
    if (!info) return;
    const t = setTimeout(() => setInfo(false), 6_000);
    return () => clearTimeout(t);
  }, [info]);

  const choose = (id: number) => {
    const v = String(id);
    setChosen(v);
    try {
      localStorage.setItem(PICK_KEY, v);
    } catch {
      /* private window: it asks again next time */
    }
    const u = new URL(location.href);
    u.searchParams.set("tally", v);
    history.replaceState(null, "", u.toString());
    setPicking(false);
  };

  const why = !gateway || fails >= FAILS_FOR_NO_TALLY
    ? "Can't reach ProDeck"
    : snap && !snap.connected
      ? "ProDeck can't reach the switcher"
      : !snap || !snap.ready
        ? "Reading the switcher"
        : "";

  if (view === "board") return <TallyBoard snap={snap} known={known} why={why} />;

  // No camera chosen, or it isn't on this switcher (renamed, or a new one).
  if ((snap && !src) || picking) {
    const list = tallySources(snap);
    return (
      <div className="tally tally-pick">
        <h1>Which camera is this?</h1>
        {chosen && !picking && <p>"{chosen}" isn't on the switcher any more. Choose again.</p>}
        <div className="tally-pick-list">
          {list.map((i) => (
            <button key={i.id} type="button" className="tally-pick-btn" onClick={() => choose(i.id)}>
              <strong>{i.short || i.id}</strong>
              <span>{i.name}</span>
            </button>
          ))}
        </div>
        {list.length === 0 && <p>Waiting for the switcher…</p>}
      </div>
    );
  }

  const name = src?.name || src?.short || (chosen ? `Camera ${chosen}` : "Camera");
  const word = shown === "program" ? "LIVE" : shown === "preview" ? "NEXT" : shown === "off" ? "" : "NO TALLY";
  const ln = liveAndNext(snap, TALLY_OPTS.me);

  return (
    <div
      className={`tally tally-${shown}${TALLY_OPTS.dim ? " tally-dim" : ""}${view === "operator" ? " tally-op" : ""}`}
      onClick={() => {
        setInfo(true);
        document.documentElement.requestFullscreen?.().catch(() => {});
      }}
      role="status"
      aria-live="assertive"
      aria-label={`${name}: ${word || "off air"}`}
    >
      {word && <div className="tally-word">{word}</div>}
      <div className="tally-name">{name}</div>
      {shown === "unknown" && <div className="tally-why">{why}. Don't trust this light.</div>}
      {view === "operator" && known && (
        <div className="tally-strip">
          <span className="tally-strip-cell live">
            <b>LIVE</b> {names(ln.live)}
          </span>
          <span className="tally-strip-cell next">
            <b>NEXT</b> {names(ln.next)}
          </span>
        </div>
      )}
      {info && (
        <div className="tally-info" onClick={(e) => e.stopPropagation()}>
          <span>
            {src ? `Source ${src.id}` : ""}
            {snap?.product ? ` on ${snap.product}` : ""}
            {typeof TALLY_OPTS.me === "number" ? `, M/E ${TALLY_OPTS.me + 1}` : ""}
          </span>
          <button type="button" className="tally-info-btn" onClick={() => setPicking(true)}>
            Change camera
          </button>
        </div>
      )}
    </div>
  );
}

const names = (l: AtemInput[]) => (l.length ? l.map((i) => i.name || i.short || `Source ${i.id}`).join(" + ") : "Nothing");

/**
 * Every camera at once: what's live, what's next, the rest dark. Sources
 * that aren't cameras (ProPresenter, a media player) only get a card while
 * they're live or next, so the board stays about the cameras.
 */
function TallyBoard({ snap, known, why }: { snap: AtemSnapshot | null; known: boolean; why: string }) {
  const me = TALLY_OPTS.me;
  const ln = liveAndNext(snap, me);
  const cards = boardSources(snap, TALLY_OPTS.cams, me);
  // Fill the screen: as many columns as suit its shape, so four cameras on an
  // iPad are four big cards, not a strip of small ones.
  const [aspect, setAspect] = useState(() => window.innerWidth / Math.max(1, window.innerHeight));
  useEffect(() => {
    const on = () => setAspect(window.innerWidth / Math.max(1, window.innerHeight));
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const n = Math.max(1, cards.length);
  const cols = Math.min(n, Math.max(1, Math.round(Math.sqrt(n * aspect))));
  return (
    <div className={`tally-board${known ? "" : " unknown"}`} role="status" aria-live="polite">
      <header className="tally-board-head">
        <span className="tally-board-now live">
          <b>LIVE</b> <span>{known ? names(ln.live) : "?"}</span>
        </span>
        <span className="tally-board-now next">
          <b>NEXT</b> <span>{known ? names(ln.next) : "?"}</span>
        </span>
      </header>
      {!known && <p className="tally-board-why">{why || "Waiting for the switcher"}. Don't trust these lights.</p>}
      <div className="tally-board-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {cards.map((i) => {
          const t = known ? tallyOf(snap, i.id, me) : "unknown";
          const l = cardLabel(i);
          return (
            <div key={i.id} className={`tally-card ${t}`}>
              <span className="tally-card-word">{t === "program" ? "LIVE" : t === "preview" ? "NEXT" : "\u00a0"}</span>
              <strong className="tally-card-short">{l.big}</strong>
              {l.small && <span className="tally-card-name">{l.small}</span>}
            </div>
          );
        })}
        {cards.length === 0 && <p className="tally-board-why">Waiting for the switcher…</p>}
      </div>
    </div>
  );
}

/**
 * Add to Home Screen should open THIS tally screen, full screen. The app's
 * manifest starts at "/" (the main app), so on this page it's swapped for one
 * whose start is this exact link, served by the booth (/tally.webmanifest).
 * iPadOS also reads the apple-mobile-web-app tags; the name under the icon
 * is the camera.
 */
function useHomeScreenApp(title: string) {
  useEffect(() => {
    const here = location.pathname + location.search;
    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "manifest";
      document.head.appendChild(link);
    }
    link.href = `/tally.webmanifest?start=${encodeURIComponent(here)}&name=${encodeURIComponent(title)}`;
    setMeta("apple-mobile-web-app-capable", "yes");
    setMeta("mobile-web-app-capable", "yes");
    setMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
    setMeta("apple-mobile-web-app-title", title);
    setMeta("theme-color", "#000000");
    // Full bleed in a Home Screen app (the CSS keeps clear of the notch and
    // rounded corners with safe-area insets). Only here: the rest of the app
    // doesn't expect it.
    const vp = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (vp && !vp.content.includes("viewport-fit")) vp.content += ", viewport-fit=cover";
    document.title = title;
  }, [title]);
}

function setMeta(name: string, content: string) {
  let m = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!m) {
    m = document.createElement("meta");
    m.name = name;
    document.head.appendChild(m);
  }
  m.content = content;
}

function readPick(): string {
  try {
    return localStorage.getItem(PICK_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Keep the screen on while the page is showing; re-ask when it comes back. */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const want = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (wl && document.visibilityState === "visible") lock = await wl.request("screen");
      } catch {
        /* not allowed (no HTTPS, low battery): the device's own Auto-Lock setting applies */
      }
    };
    want();
    const onVis = () => {
      if (document.visibilityState === "visible") want();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, []);
}
