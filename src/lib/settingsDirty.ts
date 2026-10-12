// Whether the Settings page has unsaved changes, so leaving it from the
// sidebar can ask first instead of silently throwing the edits away.

let dirty = false;

export function setSettingsDirty(on: boolean): void {
  dirty = on;
}

export function isSettingsDirty(): boolean {
  return dirty;
}
