import { useEffect, useRef, useState } from "react";
import mark from "./mark.svg";
import { Intro } from "./Intro";
import { readLink, type LinkAction } from "./links";
import { forget, parseTarget, pickBase, remember, shortName, type Church, type Target } from "./connect";
import { captureError, reportNoBooth } from "./crash";
import { checkBooth, crewAddress, findBooths, isNative, loadChurches, pushToken, saveChurches, scanCode, secureBase, type Found } from "./native";

// ProDeck Crew: find your church's booth, then open its crew app.
// (design/CREW_APP.md)

type Screen =
  | { kind: "home" }
  | { kind: "scan" }
  | { kind: "nearby" }
  | { kind: "type" }
  | { kind: "checking"; target: Target; name: string }
  | { kind: "opening"; church: Church }
  | { kind: "open"; church: Church; url: string };

const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
/** The booth's Switch church button comes back here with ?home=1. */
const asked = params.has("home");
/** The booth's Turn on notifications button comes back here with ?notify=1. */
const askNotify = params.has("notify");

export function App() {
  const [churches, setChurches] = useState<Church[]>(() => loadChurches());
  const [screen, setScreen] = useState<Screen>({ kind: "home" });
  const [err, setErr] = useState("");
  // The intro plays once per launch, not when coming back from a church.
  const [intro, setIntro] = useState(!asked && !askNotify);
  // A link that opened the app (links.ts), acted on once the intro is done.
  const [link, setLink] = useState<LinkAction>(null);
  // Bumped whenever a new place to go is chosen. A church still being checked
  // when a link or a tap picks somewhere else gives up instead of winning.
  const openGen = useRef(0);
  useEffect(() => {
    if (!isNative()) {
      // Preview: ?link=prodeckcrew://… stands in for opening a link.
      const l = new URLSearchParams(location.search).get("link");
      if (l) setLink(readLink(l));
      return;
    }
    let off: (() => void) | undefined;
    import("@capacitor/app").then(async ({ App: Cap }) => {
      const launch = await Cap.getLaunchUrl().catch(() => undefined);
      if (launch?.url) setLink(readLink(launch.url));
      const h = await Cap.addListener("appUrlOpen", (e) => setLink(readLink(e.url)));
      off = () => void h.remove();
    });
    return () => off?.();
  }, []);

  // Opening the app goes straight to the church you used last, once the intro
  // has played; the churches list is for switching. (On a phone only: the
  // preview stays on the list.)
  const introDone = () => {
    if (link) {
      setIntro(false);
      return; // the link decides where to go (below)
    }
    if (isNative() && !asked && churches.length > 0) {
      void openChurch(churches[0]);
      return;
    }
    setIntro(false);
  };

  const go = (s: Screen) => {
    setErr("");
    setScreen(s);
  };

  /** Try a scanned or typed address. */
  const tryInput = (input: string, name?: string) => {
    openGen.current++;
    const t = parseTarget(input);
    if (!t) return setErr("That doesn't look like a booth address. It should look like 192.168.1.20 or booth.yourchurch.org.");
    go({ kind: "checking", target: t, name: name || shortName(t.base) });
  };

  const openChurch = async (c: Church, path = "/", o: { ask?: boolean; checked?: boolean } = {}) => {
    const gen = ++openGen.current;
    const next = remember(churches, { ...c, lastMs: Date.now() });
    setChurches(next);
    saveChurches(next);
    let url = `${c.base}${path}`;
    if (isNative()) {
      setIntro(false);
      go({ kind: "opening", church: c });
      // Off the church Wi-Fi a saved booth can't be reached, and the phone
      // would sit on a blank page. Its crew address (if the booth has one)
      // still works from anywhere, booth on or off; else say so on the list.
      if (!o.checked) {
        const base = await pickBase(c, async (b) => (await checkBooth(b, 5000)).ok);
        if (gen !== openGen.current) return;
        if (!base) {
          go({ kind: "home" });
          setErr(`Couldn't reach ${c.name}. Check you're on the church Wi-Fi, and that ProDeck is open at the booth.`);
          return;
        }
        // The crew address opens at its start: the booth's own path (a
        // scanned /join) means nothing there while the booth is off.
        if (base !== c.base) url = `${base}/`;
      }
      // Learn (or refresh) the crew address while the booth answers, for next time.
      // Briefly: the page is about to be replaced, and that would cut it off.
      if (url.startsWith(c.base)) {
        const crew = await Promise.race([crewAddress(c.base), new Promise<string>((r) => setTimeout(() => r(""), 1500))]);
        if (gen !== openGen.current) return;
        if (crew && crew !== c.crew) {
          const list = remember(loadChurches(), { ...c, crew });
          setChurches(list);
          saveChurches(list);
        }
      }
      // A fresh token each time: the phone can change it.
      const push = await pushToken(!!o.ask);
      if (gen !== openGen.current) return;
      window.location.href = push ? `${url}#crewpush=${encodeURIComponent(push)}` : url;
      return;
    }
    go({ kind: "open", church: c, url });
  };

  // Back from the booth's Turn on notifications button: ask the phone, then
  // straight back to that church.
  useEffect(() => {
    if (askNotify && churches[0]) void openChurch(churches[0], "/", { ask: true });
    else if (askNotify) setIntro(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The crew app's own demo, built into this app (npm run demo): a pretend
  // Sunday with no booth, for the curious and for App Review.
  const openDemo = () => {
    const url = "./demo/index.html?shots=1&phone=1";
    if (isNative()) {
      window.location.href = url;
      return;
    }
    go({ kind: "open", church: { base: "", name: "Demo", lastMs: 0 }, url });
  };

  // Act on a link once the intro has played.
  useEffect(() => {
    if (intro || !link) return;
    const l = link;
    setLink(null);
    if (l.kind === "demo") openDemo();
    else if (l.kind === "home") go({ kind: "home" });
    else tryInput(l.to);
  }, [intro, link]); // eslint-disable-line react-hooks/exhaustive-deps

  if (intro) return <Intro onDone={introDone} />;
  if (screen.kind === "open") return <Opened url={screen.url} church={screen.church} onBack={() => go({ kind: "home" })} />;

  return (
    <div className="app">
      {screen.kind === "home" && (
        <Home
          churches={churches}
          onOpen={(c) => void openChurch(c)}
          onForget={(c) => {
            const next = forget(churches, c.base);
            setChurches(next);
            saveChurches(next);
          }}
          onScan={() => go({ kind: "scan" })}
          onNearby={() => go({ kind: "nearby" })}
          onType={() => go({ kind: "type" })}
          onDemo={openDemo}
          err={err}
        />
      )}
      {screen.kind === "opening" && (
        <main className="screen center">
          <div className="pulse big" />
          <p className="sub">Opening {screen.church.name}…</p>
        </main>
      )}
      {screen.kind === "scan" && <Scan onBack={() => go({ kind: "home" })} onCode={(c) => tryInput(c)} err={err} />}
      {screen.kind === "nearby" && (
        <Nearby onBack={() => go({ kind: "home" })} onPick={(f) => tryInput(f.base, f.name)} onType={() => go({ kind: "type" })} />
      )}
      {screen.kind === "type" && <TypeIn onBack={() => go({ kind: "home" })} onGo={(v) => tryInput(v)} err={err} />}
      {screen.kind === "checking" && (
        <Checking
          target={screen.target}
          name={screen.name}
          onBack={() => go({ kind: "home" })}
          onReady={(base) => void openChurch({ base, name: screen.name, lastMs: Date.now() }, screen.target.open, { checked: true })}
        />
      )}
    </div>
  );
}

function Home(p: {
  churches: Church[];
  onOpen: (c: Church) => void;
  onForget: (c: Church) => void;
  onScan: () => void;
  onNearby: () => void;
  onType: () => void;
  onDemo: () => void;
  err: string;
}) {
  const returning = p.churches.length > 0;
  return (
    <main className="screen home">
      <div className={`home-hero${returning ? " small" : ""}`}>
        <img src={mark} alt="" className="home-mark" />
        <h1 className="title">ProDeck Crew</h1>
        {!returning && <p className="home-tag">For your church's production team</p>}
      </div>

      {p.err && <p className="err" role="alert">{p.err}</p>}
      {returning && (
        <section className="list home-list" aria-label="Your churches">
          {p.churches.map((c) => (
            <div key={c.base} className="church">
              <button className="church-open" onClick={() => p.onOpen(c)}>
                <span className="church-name">{c.name}</span>
                <span className="church-addr mono">{shortName(c.base)}</span>
              </button>
              <button className="church-forget" aria-label={`Forget ${c.name}`} onClick={() => p.onForget(c)}>
                ✕
              </button>
            </div>
          ))}
        </section>
      )}

      <div className="home-actions">
        <button className={`btn${returning ? "" : " primary"}`} onClick={p.onScan}>
          {returning ? "Scan another church" : "Scan crew code"}
        </button>
        <button className="btn" onClick={p.onNearby}>
          Find on this Wi-Fi
        </button>
        <div className="home-links">
          <button className="link" onClick={p.onType}>
            Enter address
          </button>
          <span className="home-dot" aria-hidden>
            ·
          </span>
          <button className="link" onClick={p.onDemo}>
            Try a demo
          </button>
        </div>
      </div>
    </main>
  );
}

function Back({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <header className="bar">
      <button className="back" onClick={onBack} aria-label="Back">
        ‹
      </button>
      <h2>{title}</h2>
    </header>
  );
}

function Scan({ onBack, onCode, err }: { onBack: () => void; onCode: (c: string) => void; err: string }) {
  const [pasted, setPasted] = useState("");
  const [camera, setCamera] = useState(isNative());
  useEffect(() => {
    if (!camera) return;
    // The camera is done either way: a code that isn't a booth's must land
    // on the message and Scan again, not a viewfinder with no camera.
    scanCode()
      .then((c) => {
        setCamera(false);
        if (c) onCode(c);
      })
      .catch((e: unknown) => {
        captureError(e);
        setCamera(false);
      });
  }, [camera]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <main className="screen">
      <Back onBack={onBack} title="Scan the crew code" />
      <div className="viewfinder" aria-hidden>
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
        <p>
          {camera
            ? "Point the camera at the code"
            : isNative()
              ? "Scanning stopped. Allow the camera for ProDeck Crew if you were asked."
              : "The camera opens here on your phone"}
        </p>
      </div>
      {!camera && isNative() && (
        <button className="btn primary" onClick={() => setCamera(true)}>
          Scan again
        </button>
      )}
      {!camera && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            onCode(pasted);
          }}
        >
          <label className="field">
            <span>Or paste the link from the code</span>
            <input
              className="input"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="https://…/join"
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="url"
            />
          </label>
          {err && <p className="err">{err}</p>}
          <button className="btn primary" disabled={!pasted.trim()}>
            Connect
          </button>
        </form>
      )}
    </main>
  );
}

function Nearby({ onBack, onPick, onType }: { onBack: () => void; onPick: (f: Found) => void; onType: () => void }) {
  const [found, setFound] = useState<Found[] | null>(null);
  const [phoneIp, setPhoneIp] = useState("");
  const [detail, setDetail] = useState("");
  const [progress, setProgress] = useState("");
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    setFound(null);
    setProgress("");
    findBooths((m) => alive && setProgress(m))
      .then((r) => {
        if (!alive) return;
        setPhoneIp(r.phoneIp);
        setDetail(r.detail);
        setFound(r.found);
        if (r.found.length === 0) reportNoBooth(r.detail);
      })
      // A search that throws must still end in "No booth found" with a way to
      // try again, not a spinner forever.
      .catch((e: unknown) => {
        if (!alive) return;
        captureError(e);
        setDetail("");
        setFound([]);
      });
    return () => {
      alive = false;
    };
  }, [round]);
  return (
    <main className="screen">
      <Back onBack={onBack} title="On this Wi-Fi" />
      {found === null && (
        <div className="searching">
          <span className="pulse" />
          <p>Looking for ProDeck on this Wi-Fi…</p>
          {progress && <p className="hint mono">{progress}</p>}
        </div>
      )}
      {found && found.length > 0 && (
        <section className="list">
          {found.map((f) => (
            <button key={f.base} className="church church-open" onClick={() => onPick(f)}>
              <span className="church-name">{f.name}</span>
              <span className="church-addr mono">{shortName(f.base)}</span>
            </button>
          ))}
        </section>
      )}
      {found && found.length === 0 && (
        <div className="empty">
          <h2>No booth found</h2>
          <p className="hint">
            {phoneIp ? (
              <>
                Check ProDeck is open at the booth. This phone is at <span className="mono">{phoneIp}</span>.
              </>
            ) : (
              "This phone doesn't seem to be on Wi-Fi."
            )}
          </p>
          {detail && <p className="hint mono detail">{detail}</p>}
          <button className="btn" onClick={() => setRound((n) => n + 1)}>
            Look again
          </button>
          <button className="link" onClick={onType}>
            Enter address
          </button>
        </div>
      )}
    </main>
  );
}

function TypeIn({ onBack, onGo, err }: { onBack: () => void; onGo: (v: string) => void; err: string }) {
  const [v, setV] = useState("");
  return (
    <main className="screen">
      <Back onBack={onBack} title="The booth's address" />
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onGo(v);
        }}
      >
        <label className="field">
          <span>Address</span>
          <input
            className="input"
            autoFocus
            value={v}
            onChange={(e) => setV(e.target.value)}
            placeholder="192.168.1.20 or booth.yourchurch.org"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="url"
          />
        </label>
        <p className="hint">Whoever runs the booth can read it from Settings, Browser Access.</p>
        {err && <p className="err">{err}</p>}
        <button className="btn primary" disabled={!v.trim()}>
          Connect
        </button>
      </form>
    </main>
  );
}

function Checking({ target, name, onBack, onReady }: { target: Target; name: string; onBack: () => void; onReady: (base: string) => void }) {
  const [why, setWhy] = useState("");
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    setWhy("");
    checkBooth(target.base).then(async (r) => {
      if (!alive) return;
      if (!r.ok) return setWhy(r.why);
      // Prefer the booth's secure address when this phone can reach it.
      const base = await secureBase(target.base);
      if (alive) onReady(base);
    });
    return () => {
      alive = false;
    };
  }, [target.base, round]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <main className="screen center">
      {!why ? (
        <>
          <span className="pulse big" />
          <h2>Connecting to {name}</h2>
          <p className="mono hint">{shortName(target.base)}</p>
        </>
      ) : (
        <>
          <h2>Can't connect</h2>
          <p className="sub">{why}</p>
          <div className="actions">
            <button className="btn primary" onClick={() => setRound((n) => n + 1)}>
              Try again
            </button>
            <button className="link" onClick={onBack}>
              Back
            </button>
          </div>
        </>
      )}
    </main>
  );
}

/**
 * The browser preview's stand-in for the native web view: the booth's crew
 * app, full screen, with a way back to the churches list. On a phone the app
 * itself navigates to the booth.
 */
function Opened({ url, church, onBack }: { url: string; church: Church; onBack: () => void }) {
  return (
    <div className="opened">
      <iframe title={church.name} src={url} className="booth-frame" allow="microphone; autoplay" />
      <button className="switch" onClick={onBack} aria-label="Churches">
        ⌂ {church.name}
      </button>
    </div>
  );
}
