// A one-shot "open Settings at this card" handoff. Whoever links to a card
// (onboarding, Help, an empty dashboard tile) sets a target and navigates to
// Settings; Settings consumes it on mount, opens the card's section and
// scrolls to it. If Settings is already open, the event below does the same.

let pending: string | null = null;
export const SETTINGS_JUMP_EVENT = "prodeck:settings-jump";

export function requestSettingsJump(anchorId: string) {
  pending = anchorId;
  window.dispatchEvent(new Event(SETTINGS_JUMP_EVENT));
}

export function consumeSettingsJump(): string | null {
  const a = pending;
  pending = null;
  return a;
}
