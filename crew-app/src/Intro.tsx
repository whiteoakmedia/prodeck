import { useEffect } from "react";

// The loading intro: the three blocks of the ProDeck mark start apart and come
// together, the blue one landing last. The phone's own launch screen can't
// animate, so it's plain ProDeck dark and this plays as the app's first
// moment. Reduce Motion shows the finished mark instead.

/** How long the intro holds the screen before handing over. */
export const INTRO_MS = 1700;

export function Intro({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    // ?intro holds it on screen, for stepping through the frames in a preview.
    if (new URLSearchParams(location.search).has("intro")) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(onDone, reduce ? 700 : INTRO_MS);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="intro" role="img" aria-label="ProDeck Crew">
      <svg className="intro-mark" viewBox="0 0 100 100" aria-hidden>
        <g fill="none">
          <rect className="blk blk-tall" x="11.25" y="11.25" width="25.5" height="77.5" rx="7.25" stroke="#eef3fa" strokeWidth="10.5" />
          <rect className="blk blk-low" x="53.25" y="63.25" width="35.5" height="25.5" rx="7.25" stroke="#eef3fa" strokeWidth="10.5" />
          <rect className="blk blk-blue" x="48" y="6" width="46" height="46" rx="16" fill="#5b8def" />
        </g>
      </svg>
      <div className="intro-name">ProDeck Crew</div>
    </div>
  );
}
