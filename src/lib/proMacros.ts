// ProPresenter 7 macros for the ProPresenter Macros tile (pure; tested in
// proMacros.test.ts). Pro's API lists each macro as
// { id: { uuid, name, index }, color: { red, green, blue, alpha } } with
// channels 0..1; the tile shows each button in that colour so it matches
// what the operator sees in Pro.

export interface ProMacro {
  uuid: string;
  name: string;
  /** "rgb(…)" from Pro's macro colour, if it has one. */
  color: string | null;
}

export interface ProMacroTileConfig {
  /** Macro uuids in the tile's order; any not listed follow in Pro's order. */
  order?: string[];
  hidden?: string[];
}

const channel = (v: unknown) => Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 255);

/** Pro's /v1/macros answer, in whatever wrapper it comes, as a list. */
export function parseProMacros(json: unknown): ProMacro[] {
  let arr: unknown = json;
  if (!Array.isArray(arr)) arr = arr && typeof arr === "object" ? Object.values(arr).find(Array.isArray) ?? [] : [];
  return (arr as Record<string, any>[]).flatMap((x, i) => {
    const uuid = x?.id?.uuid ?? x?.uuid;
    if (!uuid) return [];
    const c = x?.color;
    const color = c && typeof c === "object" && (c.alpha ?? 1) > 0 ? `rgb(${channel(c.red)}, ${channel(c.green)}, ${channel(c.blue)})` : null;
    return [{ uuid: String(uuid), name: String(x?.id?.name ?? x?.name ?? `Macro ${i + 1}`), color }];
  });
}

/** The tile's buttons, in its order; hidden ones only while editing. */
export function proMacroButtons(
  list: ProMacro[],
  cfg: ProMacroTileConfig = {},
  opts: { includeHidden?: boolean } = {},
): (ProMacro & { hidden: boolean })[] {
  const by = new Map(list.map((m) => [m.uuid, m]));
  const placed = (cfg.order ?? []).filter((u) => by.has(u));
  const set = new Set(placed);
  const hidden = new Set(cfg.hidden ?? []);
  return [...placed.map((u) => by.get(u)!), ...list.filter((m) => !set.has(m.uuid))]
    .map((m) => ({ ...m, hidden: hidden.has(m.uuid) }))
    .filter((m) => opts.includeHidden || !m.hidden);
}

/** Readable text on a macro's colour: dark on light colours, white on dark. */
export function textOn(color: string | null): string | undefined {
  const m = color?.match(/rgb\((\d+), (\d+), (\d+)\)/);
  if (!m) return undefined;
  const [r, g, b] = m.slice(1).map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111" : "#fff";
}
