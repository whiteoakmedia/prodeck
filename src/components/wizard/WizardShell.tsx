import { useEffect, type ReactNode } from "react";

// The frame both setup wizards share: steps down the left, the step on the
// right, Back and Next at the bottom. Each wizard owns its own steps and what
// "done" means; this only draws them.

export interface WizardStep {
  id: string;
  label: string;
  done?: boolean;
}

export function WizardShell(props: {
  title: string;
  steps: WizardStep[];
  at: number;
  onGo: (i: number) => void;
  onClose: () => void;
  children: ReactNode;
  /** The right-hand buttons (Next, Save…). Back is drawn here. */
  actions: ReactNode;
  busy?: boolean;
}) {
  const { title, steps, at, onGo, onClose, children, actions, busy } = props;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <div className="wz-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wz" role="dialog" aria-modal="true" aria-label={title}>
        <aside className="wz-rail">
          <div className="wz-title">{title}</div>
          <ol className="ob-steps">
            {steps.map((s, i) => (
              <li
                key={s.id}
                className={`ob-step ${i === at ? "on" : ""} ${s.done ? "done" : ""} ${i < at ? "seen" : ""}`}
                onClick={() => (i <= at || s.done) && onGo(i)}
              >
                <span className="ob-step-dot">{s.done && i !== at ? "✓" : i + 1}</span>
                {s.label}
              </li>
            ))}
          </ol>
          <button className="btn ghost small wz-close" onClick={onClose}>
            Close
          </button>
        </aside>
        <main className="wz-main">
          <div className="wz-eyebrow">
            Step {at + 1} of {steps.length}
          </div>
          <div className="wz-body">{children}</div>
          <div className="wz-actions">
            <button className="btn ghost" disabled={at === 0 || busy} onClick={() => onGo(at - 1)}>
              Back
            </button>
            <div className="wz-actions-r">{actions}</div>
          </div>
        </main>
      </div>
    </div>
  );
}

/** A live level bar for one channel, in dBFS. */
export function LevelBar({ db }: { db: number | undefined }) {
  const pct = db == null || db <= -90 ? 0 : Math.min(100, Math.max(0, ((db + 90) / 90) * 100));
  const tone = db == null || db <= -118 ? "none" : db > -60 ? "on" : "quiet";
  return (
    <span className={`wz-meter ${tone}`} aria-label={db == null || db <= -118 ? "no audio" : `${Math.round(db)} dB`}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}
