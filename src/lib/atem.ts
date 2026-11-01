// What the ATEM tile shows: one button per source on the tile's M/E, lit red
// when it's on Program and green when it's on Preview, like the switcher's own
// panel. Each tile can pick its M/E and arrange its own buttons (order, hidden
// sources, its own labels, where Cut and Auto sit); that lives in the tile's
// config, so two tiles on two screens can differ.

import type { AtemSnapshot } from "./tauri";

export interface AtemButton {
  id: number;
  /** The tile's own label if set, else the switcher's name, which the crew already know. */
  label: string;
  short: string;
  program: boolean;
  preview: boolean;
  /** Only in edit mode: a source this tile hides. */
  hidden: boolean;
}

export type AtemActionsAt = "below" | "above" | "side";

export interface AtemTileConfig {
  /** 0-based M/E. Absent = the one chosen in Settings. */
  me?: number;
  /** Source ids in the tile's order. Sources not listed follow, cameras first. */
  order?: number[];
  hidden?: number[];
  /** Unused inputs ("--") this tile shows anyway; they're hidden by default. */
  show?: number[];
  /** Source id → the tile's own label. */
  labels?: Record<string, string>;
  actions?: AtemActionsAt;
  /** Buttons per row. 0 or absent = as many as fit. */
  cols?: number;
  /** Downstream key buttons on the tile (default: on when the switcher has keys). */
  keys?: boolean;
  /** A Fade to Black button (default on). */
  ftb?: boolean;
}

export interface AtemBus {
  program: number | null;
  preview: number | null;
  inTransition: boolean;
}

/**
 * An input the church hasn't named, or named "--" to mark it unused. Hidden
 * by default everywhere: a Constellation has twenty inputs and most churches
 * use a handful.
 */
export function isPlaceholder(i: { name: string; short: string }): boolean {
  return /^[\s\-–—_.]*$/.test(i.name) && /^[\s\-–—_.\d]*$/.test(i.short.replace(/^\d+$/, ""));
}

/** The M/E this tile shows: its own choice if the switcher has it, else the default. */
export function tileMe(snap: AtemSnapshot | null, cfg: AtemTileConfig = {}): number {
  if (!snap) return 0;
  const n = Math.max(1, snap.mes || 1);
  return typeof cfg.me === "number" && cfg.me >= 0 && cfg.me < n ? cfg.me : snap.me;
}

/** Program, Preview and transition for an M/E. */
export function atemBus(snap: AtemSnapshot | null, me: number): AtemBus {
  if (!snap) return { program: null, preview: null, inTransition: false };
  const b = snap.buses?.[me];
  if (b) return b;
  // Before M/E support the snapshot only carried the default M/E.
  if (me === snap.me) return { program: snap.program, preview: snap.preview, inTransition: snap.inTransition };
  return { program: null, preview: null, inTransition: false };
}

/**
 * The tile's buttons. Order: the tile's saved order, then any source it
 * hasn't placed yet (a new camera on the switcher), cameras first.
 */
export function atemButtons(
  snap: AtemSnapshot | null,
  cfg: AtemTileConfig = {},
  opts: { includeHidden?: boolean } = {},
): AtemButton[] {
  if (!snap) return [];
  const me = tileMe(snap, cfg);
  const bus = atemBus(snap, me);
  const bit = 1 << me;
  const hidden = new Set(cfg.hidden ?? []);
  const show = new Set(cfg.show ?? []);
  for (const i of snap.inputs) if (isPlaceholder(i) && !show.has(i.id)) hidden.add(i.id);
  const rows = snap.inputs
    .filter((i) => i.meMask === undefined || (i.meMask & bit) !== 0)
    .map((i) => {
      const own = cfg.labels?.[String(i.id)]?.trim();
      const name = i.name.trim();
      return {
        id: i.id,
        label: own || name || i.short.trim() || `Source ${i.id}`,
        short: i.short.trim() || name.slice(0, 4) || String(i.id),
        program: bus.program === i.id,
        preview: bus.preview === i.id,
        hidden: hidden.has(i.id),
        camera: i.camera,
      };
    });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const placed = (cfg.order ?? []).filter((id) => byId.has(id));
  const placedSet = new Set(placed);
  const rest = rows.filter((r) => !placedSet.has(r.id));
  const ordered = [...placed.map((id) => byId.get(id)!), ...rest.filter((r) => r.camera), ...rest.filter((r) => !r.camera)];
  return ordered
    .filter((r) => opts.includeHidden || !r.hidden)
    .map(({ camera: _camera, ...b }) => b);
}

/** "Camera 2 Pulpit" for a source id (the tile's own label if it has one), or a plain fallback. */
export function atemName(snap: AtemSnapshot | null, id: number | null, cfg: AtemTileConfig = {}): string {
  if (id === null || !snap) return "Nothing";
  const own = cfg.labels?.[String(id)]?.trim();
  if (own) return own;
  return snap.inputs.find((i) => i.id === id)?.name.trim() || `Source ${id}`;
}

/** The new saved order after moving the button at `from` to `to` (indices into what edit mode shows). */
export function moveSource(shown: number[], from: number, to: number): number[] {
  if (from === to || from < 0 || from >= shown.length) return shown;
  const next = shown.slice();
  const [id] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
  return next;
}

/** Show or hide one source: the config patch. `nowHidden` = how edit mode shows it now. */
export function toggleHidden(cfg: AtemTileConfig, id: number, nowHidden: boolean): { hidden: number[]; show: number[] } {
  const h = new Set(cfg.hidden ?? []);
  const s = new Set(cfg.show ?? []);
  if (nowHidden) {
    h.delete(id);
    s.add(id);
  } else {
    h.add(id);
    s.delete(id);
  }
  return { hidden: [...h], show: [...s] };
}

/** Set or clear (empty text) a tile's own label for a source. */
export function withLabel(cfg: AtemTileConfig, id: number, text: string): Record<string, string> {
  const labels = { ...(cfg.labels ?? {}) };
  const t = text.trim();
  if (t) labels[String(id)] = t;
  else delete labels[String(id)];
  return labels;
}

/** "DSK 1" with what it keys, from its fill source: "DSK 2 · Media Player 1". */
export function dskLabel(snap: AtemSnapshot | null, index: number): { name: string; source: string } {
  const k = snap?.dsks?.[index];
  const src = k?.fill != null ? snap?.inputs.find((i) => i.id === k.fill) : undefined;
  return { name: `DSK ${index + 1}`, source: src ? src.name || src.short : "" };
}

export interface MacroTileConfig {
  /** Macro slots in the tile's order; ones not listed follow, by slot. */
  order?: number[];
  hidden?: number[];
}

/** The macros a Macros tile shows, in its order. */
export function macroButtons(
  snap: AtemSnapshot | null,
  cfg: MacroTileConfig = {},
  opts: { includeHidden?: boolean } = {},
): { index: number; name: string; description: string; running: boolean; hidden: boolean }[] {
  const list = snap?.macros ?? [];
  const hidden = new Set(cfg.hidden ?? []);
  const by = new Map(list.map((m) => [m.index, m]));
  const placed = (cfg.order ?? []).filter((i) => by.has(i));
  const set = new Set(placed);
  const ordered = [...placed.map((i) => by.get(i)!), ...list.filter((m) => !set.has(m.index))];
  return ordered
    .map((m) => ({
      index: m.index,
      name: m.name.trim() || `Macro ${m.index + 1}`,
      description: m.description,
      running: snap?.macroRunning === m.index,
      hidden: hidden.has(m.index),
    }))
    .filter((m) => opts.includeHidden || !m.hidden);
}
