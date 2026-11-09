import { useEffect, useRef, useState, type CSSProperties } from "react";
import { IS_WEB, KIOSK_DASH, TALLY_PARAM, pcoOauthStatus } from "../lib/tauri";
import { IS_DEMO, IS_SHOTS, SHOT_WHATSNEW } from "../lib/demo";
import { isFreshInstall } from "../lib/onboarding";
import { requestNavigate } from "../lib/navigate";
import { openHelp } from "../help/nav";
import { useProDeck } from "../store";
import { useTracking } from "../trackingStore";
import { openExternal } from "../lib/openExternal";
import {
  ALSO_NEW,
  HEADLINERS,
  HERO,
  SUPPORT,
  WHATS_NEW_EVENT,
  decide,
  markSeen,
  readSeen,
  settingsTarget,
  type Art,
  type Feature,
} from "../lib/whatsNew";
import { Icon } from "./Icon";
import "./whatsNew.css";

// Full screen "What's new" showcase (lib/whatsNew.ts has the rules and copy),
// in the app's own colours (App.css tokens), so it follows the theme.
// Booth only, silent (the booth feeds the house), and never over a service.

/** `blocked`: another full screen thing is up, so wait (none today). */
export function WhatsNewHost({ blocked = false }: { blocked?: boolean }) {
  const [open, setOpen] = useState(() => IS_SHOTS && SHOT_WHATSNEW);
  const [fresh, setFresh] = useState<boolean | null>(null);
  const { settings } = useProDeck();
  const tracking = useTracking();
  const inService = !tracking.rehearsal;

  // A brand new install has nothing to compare with; Setup is its first screen.
  useEffect(() => {
    if (IS_WEB || IS_DEMO || settings === null || fresh !== null) return;
    void pcoOauthStatus()
      .then((o) => o.connected)
      .catch(() => false)
      .then((pco) => setFresh(isFreshInstall(settings, pco)));
  }, [settings, fresh]);

  useEffect(() => {
    if (open) return;
    const d = decide(readSeen(), {
      isWeb: IS_WEB,
      kiosk: !!KIOSK_DASH || TALLY_PARAM !== null,
      demo: IS_DEMO,
      freshInstall: fresh,
      inService,
      otherOverlay: blocked,
    });
    if (d === "mark") markSeen();
    if (d === "show") {
      markSeen(); // seen once it's up, so a restart never loops it
      setOpen(true);
    }
  }, [fresh, inService, blocked, open]);

  useEffect(() => {
    if (IS_WEB) return;
    const reopen = () => setOpen(true);
    window.addEventListener(WHATS_NEW_EVENT, reopen);
    return () => window.removeEventListener(WHATS_NEW_EVENT, reopen);
  }, []);

  if (!open || IS_WEB) return null;
  return <WhatsNew atemOn={!!settings?.atem_enabled} onClose={() => setOpen(false)} />;
}

export function WhatsNew({ atemOn, onClose }: { atemOn: boolean; onClose: () => void }) {
  const doneRef = useRef<HTMLButtonElement>(null);
  const [closing, setClosing] = useState(false);

  const close = (then?: () => void) => {
    setClosing(true);
    setTimeout(() => {
      onClose();
      then?.();
    }, 220);
  };

  useEffect(() => {
    doneRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actions = (f: Feature) => {
    const target = settingsTarget(f, atemOn);
    return (
      <div className="wn-actions">
        {target && (
          <button className="btn small primary" onClick={() => close(() => requestNavigate("settings", target))}>
            {f.settingsLabel ?? "Set it up"}
          </button>
        )}
        {f.help && (
          <button className="btn small ghost" onClick={() => close(() => openHelp(f.help))}>
            Read more
          </button>
        )}
      </div>
    );
  };

  const support = () => openExternal(SUPPORT.url);

  return (
    <div
      className={`wn ${closing ? "wn-closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wn-title"
    >
      <div className="wn-sky" aria-hidden="true">
        <span className="wn-glow" />
        <span className="wn-gridlines" />
      </div>

      <div className="wn-bar">
        <button className="btn wn-bar-support" onClick={support}>
          <HeartIcon /> {SUPPORT.button}
        </button>
        <button ref={doneRef} className="btn primary" onClick={() => close()}>
          Done
        </button>
      </div>

      <div className="wn-scroll">
        <header className="wn-hero">
          <ProDeckMark className="wn-hero-mark" />
          <div className="wn-kicker">{HERO.kicker}</div>
          <h1 id="wn-title" className="wn-title">
            {HERO.title.replace(/ProDeck$/, "")}
            <span>ProDeck</span>
          </h1>
          <p className="wn-sub">{HERO.sub}</p>
          <button className="wn-hero-support" onClick={support}>
            <HeartIcon />
            <span>{SUPPORT.heroLine}</span>
            <b>{SUPPORT.button}</b>
          </button>
        </header>

        <section className="wn-grid">
          {HEADLINERS.map((f, i) => (
            <article key={f.id} className={`wn-card tone-${f.tone}`} style={{ "--i": i } as CSSProperties}>
              <div className="wn-art">{f.art && <ArtPiece art={f.art} />}</div>
              <div className="wn-body">
                <h2>{f.title}</h2>
                <div className="wn-tag">{f.tagline}</div>
                <p className="wn-what">{f.what}</p>
                <div className="wn-setup">
                  <div className="wn-setup-head">How to set it up</div>
                  <ol>
                    {f.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </div>
                {actions(f)}
              </div>
            </article>
          ))}
        </section>

        <h2 className="wn-also-head">Also new</h2>
        <section className="wn-also">
          {ALSO_NEW.map((f, i) => (
            <article
              key={f.id}
              className={`wn-mini tone-${f.tone}`}
              style={{ "--i": i + HEADLINERS.length } as CSSProperties}
            >
              <div className="wn-mini-icon">{f.icon && <Icon name={f.icon} size={18} />}</div>
              <h3>{f.title}</h3>
              <div className="wn-tag">{f.tagline}</div>
              <p className="wn-what">{f.what}</p>
              <p className="wn-mini-setup">{f.steps.join(" ")}</p>
              {actions(f)}
            </article>
          ))}
        </section>

        <section className="wn-support">
          <div className="wn-support-mark">
            <ProDeckMark className="wn-support-logo" loop />
          </div>
          <div className="wn-support-text">
            <div className="wn-kicker">{SUPPORT.kicker}</div>
            <h2>{SUPPORT.title}</h2>
            <p>{SUPPORT.text}</p>
            <ul>
              {SUPPORT.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <button className="btn primary wn-support-btn" onClick={support}>
              <HeartIcon /> {SUPPORT.button}
            </button>
          </div>
        </section>

        <footer className="wn-foot">
          <span>{HERO.footer}</span>
          <button className="btn" onClick={() => close()}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * The ProDeck mark coming together, exactly as the ProDeck Crew splash plays
 * it (crew-app/src/Intro.tsx): the tall and low blocks slide in, the blue
 * square lands last with a small overshoot. `loop` replays it every few
 * seconds for the small pictures.
 */
function ProDeckMark({ className, loop }: { className?: string; loop?: boolean }) {
  return (
    <svg className={`wn-mark ${loop ? "wn-mark-loop" : ""} ${className ?? ""}`} viewBox="0 0 100 100" aria-hidden="true">
      <g fill="none">
        <rect className="wn-blk wn-blk-tall" x="11.25" y="11.25" width="25.5" height="77.5" rx="7.25" strokeWidth="10.5" />
        <rect className="wn-blk wn-blk-low" x="53.25" y="63.25" width="35.5" height="25.5" rx="7.25" strokeWidth="10.5" />
        <rect className="wn-blk wn-blk-blue" x="48" y="6" width="46" height="46" rx="16" />
      </g>
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg className="wn-heart-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" />
    </svg>
  );
}

// ------------------------------------------------------------- the pictures
// Pure CSS animation (whatsNew.css); no images, no sound.

function ArtPiece({ art }: { art: Art }) {
  switch (art) {
    case "app":
      return (
        <div className="art art-app">
          <div className="phone">
            <ProDeckMark className="app-mark" loop />
          </div>
          <span className="ring r1" /><span className="ring r2" /><span className="ring r3" />
        </div>
      );
    case "page":
      return (
        <div className="art art-page">
          <div className="phone shake">
            <div className="lock-time">9:41</div>
            <div className="notif">
              <b>Page from the booth</b>
              <span>Camera 2, come to the booth</span>
              <i>Got it</i>
            </div>
          </div>
        </div>
      );
    case "comms":
      return (
        <div className="art art-comms">
          <div className="phone">
            <div className="lines"><span>All</span><span>Cameras</span><span>Stage</span><span>Booth</span></div>
            <div className="talk">Talk</div>
            <div className="bars">
              {Array.from({ length: 7 }, (_, i) => (
                <span key={i} style={{ "--i": i } as CSSProperties} />
              ))}
            </div>
          </div>
        </div>
      );
    case "tally":
      return (
        <div className="art art-tally">
          <div className="phone tally-face">
            <span className="tl-live">LIVE</span>
            <span className="tl-next">NEXT</span>
            <span className="tl-cam">Camera 2</span>
          </div>
        </div>
      );
    case "lock":
      return (
        <div className="art art-lock">
          <div className="padlock">
            <span className="shackle" />
            <span className="body" />
          </div>
          <div className="addr">
            <span className="https">https://</span>yourchurch.local.prodeck.live
          </div>
        </div>
      );
    case "tv":
      return (
        <div className="art art-tv">
          <div className="tv">
            <div className="tv-code">
              {"4729".split("").map((d, i) => (
                <span key={i} style={{ "--i": i } as CSSProperties}>{d}</span>
              ))}
            </div>
            <div className="tv-dash">
              <span /><span /><span /><span /><span /><span />
            </div>
          </div>
          <div className="tv-stand" />
        </div>
      );
    case "poster":
      return (
        <div className="art art-poster">
          <div className="qr">
            {Array.from({ length: 25 }, (_, i) => (
              <span key={i} className={QR_ON.has(i) ? "on" : ""} style={{ "--i": (i * 7) % 25 } as CSSProperties} />
            ))}
          </div>
          <div className="approve">Approved</div>
        </div>
      );
    case "ipad":
      return (
        <div className="art art-ipad">
          <div className="tablet">
            <div className="tab-tally" />
            <div className="tab-talk">Talk</div>
            <div className="tab-nav"><span /><span /><span /><span /></div>
          </div>
        </div>
      );
    case "screens":
      return (
        <div className="art art-screens">
          <div className="phone">
            <span className="row r1" /><span className="row r2" /><span className="row r3" />
            <div className="nav"><span /><span /><span /><span /></div>
          </div>
        </div>
      );
  }
}

const QR_ON = new Set([0, 1, 2, 4, 5, 7, 9, 10, 12, 14, 16, 18, 20, 21, 22, 24, 3, 15]);
