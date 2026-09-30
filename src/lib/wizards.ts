// Open a setup wizard from anywhere (Setup page, Recording page, the Automix
// tile, Settings). The host, SetupWizards, is mounted once in App.

export type WizardKind = "recording" | "automix";

export const WIZARD_EVENT = "prodeck:wizard";

export function requestWizard(kind: WizardKind) {
  window.dispatchEvent(new CustomEvent<WizardKind>(WIZARD_EVENT, { detail: kind }));
}
