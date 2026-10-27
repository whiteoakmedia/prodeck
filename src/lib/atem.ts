// What the ATEM tile shows: one button per source on this M/E, lit red when
// it's on Program and green when it's on Preview, like the switcher's own panel.

import type { AtemSnapshot } from "./tauri";

export interface AtemButton {
  id: number;
  /** The switcher's own name for it, which the crew already know. */
  label: string;
  short: string;
  program: boolean;
  preview: boolean;
}

/** Cameras first (the buttons used all service), then black, bars and media players. */
export function atemButtons(snap: AtemSnapshot | null): AtemButton[] {
  if (!snap) return [];
  const rows = snap.inputs.map((i) => ({
    id: i.id,
    label: i.name.trim() || i.short.trim() || `Source ${i.id}`,
    short: i.short.trim() || i.name.trim().slice(0, 4) || String(i.id),
    program: snap.program === i.id,
    preview: snap.preview === i.id,
    camera: i.camera,
  }));
  const ordered = [...rows.filter((r) => r.camera), ...rows.filter((r) => !r.camera)];
  return ordered.map(({ camera: _camera, ...b }) => b);
}

/** "Camera 2 Pulpit" for a source id, or a plain fallback. */
export function atemName(snap: AtemSnapshot | null, id: number | null): string {
  if (id === null || !snap) return "Nothing";
  return snap.inputs.find((i) => i.id === id)?.name.trim() || `Source ${id}`;
}
