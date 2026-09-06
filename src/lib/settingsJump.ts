// A one-shot "scroll to this Settings card when the page mounts" handoff.
// The onboarding sets a target, navigates to Settings, and Settings consumes it
// on mount — so "Set up audio" lands you on the exact card, not the page top.

let pending: string | null = null;

export function requestSettingsJump(anchorId: string) {
  pending = anchorId;
}

export function consumeSettingsJump(): string | null {
  const a = pending;
  pending = null;
  return a;
}
