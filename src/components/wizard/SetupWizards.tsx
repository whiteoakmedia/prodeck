import { useEffect, useState } from "react";
import { IS_WEB } from "../../lib/tauri";
import { WIZARD_EVENT, type WizardKind } from "../../lib/wizards";
import { AutomixWizard } from "./AutomixWizard";
import { RecordingWizard } from "./RecordingWizard";

const TITLE: Record<WizardKind, string> = { recording: "recording setup", automix: "Automix setup" };

/** Mounted once in App: opens whichever wizard requestWizard() asks for.
 *  A wizard can step aside to let someone fix something on another page;
 *  it stays mounted (answers kept) behind a button that brings it back. */
export function SetupWizards() {
  const [open, setOpen] = useState<WizardKind | null>(null);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const h = (e: Event) => {
      setOpen((e as CustomEvent<WizardKind>).detail);
      setAway(false);
    };
    window.addEventListener(WIZARD_EVENT, h);
    return () => window.removeEventListener(WIZARD_EVENT, h);
  }, []);
  if (IS_WEB || !open) return null;
  const close = () => {
    setOpen(null);
    setAway(false);
  };
  const stepAside = () => setAway(true);
  return (
    <>
      <div hidden={away}>{open === "recording" ? <RecordingWizard onClose={close} /> : <AutomixWizard onClose={close} onAway={stepAside} />}</div>
      {away && (
        <button className="btn primary wz-resume" onClick={() => setAway(false)}>
          Continue {TITLE[open]}
        </button>
      )}
    </>
  );
}
