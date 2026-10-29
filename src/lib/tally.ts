// Camera tally: is this camera on air, on preview, or neither? Pure, so the
// colour a camera operator trusts is tested (tally.test.ts).
//
// The switcher's own tally (TlSr) is the truth: it already counts keys,
// transitions and every M/E. Before it has sent one (or on an older
// snapshot), fall back to the M/E's Program and Preview, with both sources
// on air during a transition, as the switcher itself does.

import { atemBus, isPlaceholder } from "./atem";
import type { AtemInput, AtemSnapshot } from "./tauri";

export type Tally = "program" | "preview" | "off";

export function tallyOf(snap: AtemSnapshot | null, source: number, me?: number): Tally {
  if (!snap) return "off";
  const t = snap.tally;
  if (t && Object.keys(t).length > 0) {
    const f = t[String(source)] ?? 0;
    if (f & 1) return "program";
    if (f & 2) return "preview";
    return "off";
  }
  const bus = atemBus(snap, me ?? snap.me);
  if (bus.program === source || (bus.inTransition && bus.preview === source)) return "program";
  if (bus.preview === source) return "preview";
  return "off";
}

/** The source a tally link names: its number, else its name or short name (any case). */
export function findSource(snap: AtemSnapshot | null, param: string): AtemInput | null {
  if (!snap || !param.trim()) return null;
  const p = param.trim();
  if (/^\d+$/.test(p)) return snap.inputs.find((i) => i.id === Number(p)) ?? null;
  const lc = p.toLowerCase();
  return snap.inputs.find((i) => i.name.trim().toLowerCase() === lc || i.short.trim().toLowerCase() === lc) ?? null;
}

/** Sources worth a tally screen: cameras first, then anything else that can go on air. Unused ("--") inputs left out. */
export function tallySources(snap: AtemSnapshot | null): AtemInput[] {
  if (!snap) return [];
  const used = snap.inputs.filter((i) => !isPlaceholder(i));
  return [...used.filter((i) => i.camera), ...used.filter((i) => !i.camera)];
}

/**
 * The board's cards: the cameras the link names (?cams=1,2,13), else every
 * named camera input. Anything else only while it's live or next.
 */
export function boardSources(snap: AtemSnapshot | null, cams: number[] | null, me?: number): AtemInput[] {
  const all = tallySources(snap);
  if (cams && cams.length) {
    const by = new Map(all.map((i) => [i.id, i]));
    return cams.map((id) => by.get(id)).filter((i): i is AtemInput => !!i);
  }
  return all.filter((i) => i.camera || tallyOf(snap, i.id, me) !== "off");
}

/** A short name for a card or a strip: the switcher's short name, else its name. */
export function cardLabel(i: AtemInput): { big: string; small: string } {
  const name = i.name.trim();
  const short = i.short.trim();
  if (!short || short === name) return { big: name || `Source ${i.id}`, small: "" };
  return { big: short, small: name };
}

/** What's live and what's next, for the board and the operator strip. Sources in the switcher's order. */
export function liveAndNext(snap: AtemSnapshot | null, me?: number): { live: AtemInput[]; next: AtemInput[] } {
  if (!snap) return { live: [], next: [] };
  const by = (t: Tally) => snap.inputs.filter((i) => !isPlaceholder(i) && tallyOf(snap, i.id, me) === t);
  return { live: by("program"), next: by("preview") };
}

/**
 * How a tally screen looks:
 * - light: one camera, the whole screen red or green (on a camera).
 * - operator: one camera big, with what's live and next along the bottom.
 * - board: every camera at once (an iPad for the director or stage manager).
 */
export type TallyView = "light" | "operator" | "board";

export function tallyView(v: string | null | undefined, param: string | null | undefined): TallyView {
  if ((param ?? "").trim().toLowerCase() === "all") return "board";
  return v === "operator" || v === "board" ? v : "light";
}

export interface TallyLinkOpts {
  preview?: boolean;
  dim?: boolean;
  /** 0-based; written 1-based in the link, like the switcher's panel. */
  me?: number;
  view?: TallyView;
  /** The board's cameras, in order. */
  cams?: number[];
}

/** "/?tally=2&token=…" for a camera's tally screen; source null = the all-cameras board. */
export function tallyQuery(source: number | null, token: string, o: TallyLinkOpts = {}): string {
  const board = source === null || o.view === "board";
  const q = new URLSearchParams({ tally: board ? "all" : String(source), token });
  if (o.view === "operator" && !board) q.set("view", "operator");
  if (board && o.cams?.length) q.set("cams", o.cams.join(","));
  if (o.preview === false) q.set("preview", "0");
  if (o.dim) q.set("dim", "1");
  if (typeof o.me === "number" && o.me > 0) q.set("me", String(o.me + 1));
  return `/?${q.toString()}`;
}
