// App-wide "take me to this page" without prop-drilling. Widgets and empty
// states dispatch; the desktop Shell (App.tsx) listens and switches pages.
export const NAVIGATE_EVENT = "prodeck:navigate";

export function requestNavigate(page: string, settingsAnchor?: string) {
  window.dispatchEvent(
    new CustomEvent(NAVIGATE_EVENT, { detail: { page, settingsAnchor } }),
  );
}
