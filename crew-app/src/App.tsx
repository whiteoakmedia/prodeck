import { useEffect, useState } from "react";
import mark from "./mark.svg";
import { Intro } from "./Intro";
import { forget, parseTarget, remember, shortName, type Church, type Target } from "./connect";
import { checkBooth, findBooths, isNative, loadChurches, saveChurches, scanCode, type Found } from "./native";

// ProDeck Crew: find your church's booth, then open its crew app.
// (design/CREW_APP.md)

type Screen =
  | { kind: "home" }
  | { kind: "scan" }
  | { kind: "nearby" }
  | { kind: "type" }
  | { kind: "checking"; target: Target; name: string }
  | { kind: "open"; church: Church; url: string };

/** The booth's Switch church button comes back here with ?home=1. */
const asked = typeof location !== "undefined" && new URLSearchParams(location.search).has("home");

export function App() {
  const [churches, setChurches] = useState<Church[]>(() => loadChurches());
  const [screen, setScreen] = useState<Screen>({ kind: "home" });
  const [err, setErr] = useState("");
  // The intro plays once per launch, not when coming back from a church.
  const [intro, setIntro] = useState(!asked);

  // Opening the app goes straight to the church you used last, once the intro
  // has played; the churches list is for switching. (On a phone only: the
  // preview stays on the list.)
  const introDone = () => {
    if (isNative() && !asked && churches.length > 0) {
      openChurch(churches[0]);
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
    const t = parseTarget(input);
    if (!t) return setErr("That doesn't look like a booth address. It should look like 192.168.1.20 or booth.yourchurch.org.");
    go({ kind: "checking", target: t, name: name || shortName(t.base) });
  };

  const openChurch = (c: Church, path = "/") => {
    const next = remember(churches, { ...c, lastMs: Date.now() });
    setChurches(next);
    saveChurches(next);
    const url = `${c.base}${path}`;
    if (isNative()) {
      window.location.href = url;
      return;
    }
    go({ kind: "open", church: c, url });
  };

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

  if (intro) return <Intro onDone={introDone} />;
  if (screen.kind === "open") return <Opened url={screen.url} church={screen.church} onBack={() => go({ kind: "home" })} />;

  return (
    <div className="app">
      {screen.kind === "home" && (
        <Home
          churches={churches}
          onOpen={(c) => openChurch(c)}
          onForget={(c) => {
            const next = forget(churches, c.base);
            setChurches(next);
            saveChurches(next);
          }}
          onScan={() => go({ kind: "scan" })}
          onNearby={() => go({ kind: "nearby" })}
          onType={() => go({ kind: "type" })}
          onDemo={openDemo}
        />
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
          onReady={() => openChurch({ base: screen.target.base, name: screen.name, lastMs: Date.now() }, screen.target.open)}
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
}) {
  const returning = p.churches.length > 0;
  return (
    <main className="screen center">
      <img src={mark} alt="" className="mark" />
      <h1 className="title">ProDeck Crew</h1>
      {!returning && (
        <p className="sub">Pages, chat, checklists and comms for your church's production team.</p>
      )}

      {returning && (
        <section className="list" aria-label="Your churches">
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

      <div className="actions">
        <button className="btn primary" onClick={p.onScan}>
          {returning ? "Scan another church's code" : "Scan your church's crew code"}
        </button>
        <button className="btn" onClick={p.onNearby}>
          Find my church on this Wi-Fi
        </button>
        <button className="link" onClick={p.onType}>
          Type the booth's address instead
        </button>
      </div>
      {!returning && (
        <p className="hint">The crew code is on the poster in the green room, or in the invite the booth sent you.</p>
      )}
      <button className="link" onClick={p.onDemo}>
        Look around first, with a pretend Sunday
      </button>
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
    scanCode().then((c) => (c ? onCode(c) : setCamera(false)));
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
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    setFound(null);
    findBooths().then((f) => alive && setFound(f));
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
          <p>No booth found.</p>
          <p className="hint">
            Make sure this phone is on the church Wi-Fi (not cellular or a guest network), and that ProDeck is open at
            the booth.
          </p>
          <button className="btn" onClick={() => setRound((n) => n + 1)}>
            Look again
          </button>
          <button className="link" onClick={onType}>
            Type the address instead
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

function Checking({ target, name, onBack, onReady }: { target: Target; name: string; onBack: () => void; onReady: () => void }) {
  const [why, setWhy] = useState("");
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    setWhy("");
    checkBooth(target.base).then((r) => {
      if (!alive) return;
      if (r.ok) onReady();
      else setWhy(r.why);
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
