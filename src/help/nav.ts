/**
 * Open the in-app Help page at a topic, from anywhere.
 *
 * A window event rather than a prop: the `?` buttons live deep inside Settings
 * cards and the Help page is a sibling route in App, so threading a callback
 * through every card would touch dozens of components for one link.
 */
export const HELP_EVENT = "prodeck:help";

export function openHelp(topic?: string) {
  window.dispatchEvent(new CustomEvent(HELP_EVENT, { detail: { topic: topic ?? "" } }));
}

/** Settings anchor → help topic, so the `?` on a card lands somewhere useful. */
export const ANCHOR_TOPIC: Record<string, string> = {
  "set-update": "updates",
  "set-pp": "pp-connect",
  "set-avantis": "console",
  "set-audio": "audio-spl",
  "set-ga4": "public-url",
  "set-gemini": "what-is-prodeck",
  "set-inputs": "pp-connect",
  "set-songkey": "console",
  "set-taplink": "taplink-overview",
  "set-crew": "crew-overview",
  "set-relay": "kiosk",
  "set-alerts": "keep-running",
  "set-web": "gateway-passwords",
  "set-appearance": "what-is-prodeck",
  "set-obs": "obs",
  "set-ndi": "ndi",
  "set-reliability": "keep-running",
  "set-kiosk": "kiosk",
  "set-backup": "backup",
  "set-help": "report-problem",
};
