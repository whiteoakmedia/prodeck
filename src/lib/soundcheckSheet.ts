// The soundcheck patch sheet (pure; tested in soundcheckSheet.test.ts).
//
// A recorded service played back into the console's Virtual SoundCheck needs
// three things to agree: which console channel each track belongs to, which
// of the console's Dante inputs carries it during soundcheck, and which of
// this Mac's Dante outputs ProDeck plays it on. This works all three out from
// what ProDeck already reads: the tracks' Dante sources (saved with the
// recording), the console's show file (which Dante output is which channel's
// direct out, which channel reads which Dante input) and the live Dante
// subscriptions.
//
// It changes nothing. It's a sheet a person applies when no service is on.

import type { AvantisPatch, DanteDevice, DanteRx } from "./tauri";

export interface SheetRow {
  /** Console input channel. */
  ch: number;
  chName: string;
  track: number;
  trackName: string;
  /** The console's Dante input (I/O Port 1 channel) the track arrives on. */
  rx: number;
  /** What that Dante input listens to on Sundays ("" = nothing). */
  rxWas: string;
  /** This Mac's Dante output ProDeck plays the track on. */
  tx: number;
}

export interface Sheet {
  rows: SheetRow[];
  /** Tracks that don't go back to a console channel, and why. */
  skipped: { track: number; name: string; why: string }[];
  /** Channels that go quiet during soundcheck: their Dante input is borrowed. */
  silent: { ch: number; name: string; was: string }[];
  /** This Mac's outputs the sheet uses (for the "still patched" check). */
  txUsed: number[];
  notes: string[];
}

export interface SheetInput {
  tracks: { n: number; name: string }[];
  /** This Mac's Dante inputs when the recording was made. */
  recordedRx: DanteRx[];
  /** True when recordedRx is today's routing, not the recording's own. */
  routingIsToday: boolean;
  localName: string;
  /** This Mac's Dante device now (for output channel names and what listens to them). */
  local?: DanteDevice;
  console: DanteDevice;
  /** Every device on the network now (to see which of this Mac's outputs are in use). */
  devices: DanteDevice[];
  patch: AvantisPatch;
  /** Console channel names, by channel number. */
  deskNames: Record<number, string>;
  /** Channels whose console input and output are already settled (the saved layout). */
  fixed?: { ch: number; rx: number; tx: number }[];
}

/** The Waves insert loop and the console's own loopbacks are never borrowed. */
const NEVER_BORROW = /waves|soundgrid/i;
/** This Mac's outputs 1 and 2 are its system audio (Spotify, alerts): never used. */
const RESERVED_TX = new Set([1, 2]);
const DIRECT_OUT = 4;

const chNo = (dev: DanteDevice | undefined, name: string | null | undefined): number | null => {
  if (!name) return null;
  const hit = dev?.tx?.find((t) => t.name === name);
  if (hit) return hit.ch;
  const n = parseInt(name, 10);
  return Number.isFinite(n) ? n : null;
};

const describe = (r: DanteRx | undefined) => (r?.txDevice ? `${r.txDevice} ${r.txChannel ?? ""}`.trim() : "");

export function buildSheet(inp: SheetInput): Sheet {
  const skipped: Sheet["skipped"] = [];
  const notes: string[] = [];
  const consoleRx = new Map(inp.console.rx.map((r) => [r.ch, r]));
  const inputs = inp.patch.inputs ?? [];
  const byDanteSocket = (socket: number) => inputs.filter((i) => i.port === 1 && i.socket === socket).map((i) => i.ch);
  const chName = (ch: number) => inp.deskNames[ch] || `Ch ${ch}`;

  // 1. Which console channel each track belongs to.
  const wanted: { ch: number; track: number; trackName: string }[] = [];
  const claimed = new Map<number, number>();
  for (const t of inp.tracks) {
    const src = inp.recordedRx.find((r) => r.ch === t.n);
    if (!src?.txDevice) {
      skipped.push({ track: t.n, name: t.name, why: "No Dante source was recorded for it" });
      continue;
    }
    let chans: number[] = [];
    if (src.txDevice === inp.console.name) {
      const out = chNo(inp.console, src.txChannel);
      const o = inp.patch.danteOut?.find((d) => d.out === out);
      if (!o) {
        skipped.push({ track: t.n, name: t.name, why: `Console Dante output ${out ?? "?"} isn't in the show file` });
        continue;
      }
      if (o.code !== DIRECT_OUT) {
        skipped.push({ track: t.n, name: t.name, why: `It's ${o.text}, not one channel` });
        continue;
      }
      const own = inputs.find((i) => i.ch === o.index + 1);
      if (own && own.socket == null) {
        skipped.push({ track: t.n, name: t.name, why: `${chName(o.index + 1)} has no input patched on the console` });
        continue;
      }
      chans = [o.index + 1];
    } else {
      // Recorded straight from another device (wireless, playback rig): the
      // console channels that read the same source on Sundays.
      const rx = inp.console.rx.find((r) => r.txDevice === src.txDevice && r.txChannel === src.txChannel);
      chans = rx ? byDanteSocket(rx.ch) : [];
      if (!chans.length) {
        skipped.push({ track: t.n, name: t.name, why: `${src.txDevice} ${src.txChannel} doesn't reach a console channel` });
        continue;
      }
    }
    for (const ch of chans) {
      if (claimed.has(ch)) {
        skipped.push({ track: t.n, name: t.name, why: `Same channel as track ${claimed.get(ch)} (${chName(ch)})` });
        continue;
      }
      claimed.set(ch, t.n);
      wanted.push({ ch, track: t.n, trackName: t.name });
    }
  }

  // 2. A console Dante input for each: its own when it already lives on
  //    Dante (wireless), else one that's free, else one whose Sunday source
  //    isn't needed while the recording plays. Never the Waves loop.
  const borrowable = (n: number) => !NEVER_BORROW.test(consoleRx.get(n)?.txDevice ?? "") && consoleRx.get(n)?.txDevice !== inp.console.name;
  const inputOf = (ch: number) => inputs.find((i) => i.ch === ch);
  const taken = new Set<number>();
  const assign = new Map<number, number>();
  // Tracks sharing one source (a vocal on two channels) share one input.
  const trackRx = new Map<number, number>();
  const fixed = new Map((inp.fixed ?? []).map((f) => [f.ch, f]));
  for (const w of wanted) {
    const f = fixed.get(w.ch);
    if (!f) continue;
    assign.set(w.ch, f.rx);
    taken.add(f.rx);
    trackRx.set(w.track, f.rx);
  }
  for (const w of wanted) {
    if (assign.has(w.ch)) continue;
    const inp1 = inputOf(w.ch);
    if (inp1?.port === 1 && inp1.socket && borrowable(inp1.socket) && (!taken.has(inp1.socket) || trackRx.get(w.track) === inp1.socket)) {
      assign.set(w.ch, inp1.socket);
      taken.add(inp1.socket);
      trackRx.set(w.track, inp1.socket);
    }
  }
  const total = Math.max(64, inp.console.rxCount ?? 0, ...inp.console.rx.map((r) => r.ch));
  const all = Array.from({ length: total }, (_, i) => i + 1);
  const free = all.filter((n) => !consoleRx.get(n)?.txDevice && borrowable(n));
  const others = all.filter((n) => consoleRx.get(n)?.txDevice && borrowable(n));
  const pool = [...free, ...others].filter((n) => !taken.has(n));
  for (const w of wanted) {
    if (assign.has(w.ch)) continue;
    const shared = trackRx.get(w.track);
    const n = shared ?? pool.shift();
    if (n == null) {
      skipped.push({ track: w.track, name: w.trackName, why: "No console Dante input left to borrow" });
      continue;
    }
    assign.set(w.ch, n);
    taken.add(n);
    trackRx.set(w.track, n);
  }

  // 3. An output of this Mac for each track: the same number as the console
  //    input when it's free (so the Dante subscription reads 7 ← 07), else
  //    the next free one. Never 1 and 2, never one something listens to now.
  const inUse = new Set<number>(RESERVED_TX);
  for (const d of inp.devices) {
    if (d.name === inp.localName) continue;
    for (const r of d.rx) if (r.txDevice === inp.localName) {
      const n = chNo(inp.local, r.txChannel);
      // A borrowed console input's own Sunday subscription doesn't count:
      // that's exactly the one the soundcheck preset replaces.
      if (n != null && !(d.name === inp.console.name && taken.has(r.ch))) inUse.add(n);
    }
  }
  const localCount = Math.max(64, inp.local?.txCount ?? 0);
  const txOf = new Map<number, number>();
  const usedTx = new Set<number>((inp.fixed ?? []).map((f) => f.tx));
  const nextFree = () => {
    for (let n = 3; n <= localCount; n++) if (!inUse.has(n) && !usedTx.has(n)) return n;
    return null;
  };
  const rows: SheetRow[] = [];
  for (const w of [...wanted].sort((a, b) => a.ch - b.ch)) {
    const rx = assign.get(w.ch);
    if (rx == null) continue;
    let tx = txOf.get(w.track) ?? fixed.get(w.ch)?.tx;
    if (tx != null) txOf.set(w.track, tx);
    if (tx == null) {
      tx = !inUse.has(rx) && !usedTx.has(rx) && rx <= localCount ? rx : (nextFree() ?? undefined);
      if (tx == null) {
        skipped.push({ track: w.track, name: w.trackName, why: "This Mac has no Dante output left" });
        continue;
      }
      txOf.set(w.track, tx);
      usedTx.add(tx);
    }
    rows.push({ ch: w.ch, chName: chName(w.ch), track: w.track, trackName: w.trackName, rx, rxWas: describe(consoleRx.get(rx)), tx });
  }

  // 4. Channels that lose their Sunday input while it's borrowed.
  const rowChans = new Set(rows.map((r) => r.ch));
  const borrowedRx = new Set(rows.map((r) => r.rx));
  const silent: Sheet["silent"] = [];
  for (const i of inputs) {
    if (i.port === 1 && i.socket && borrowedRx.has(i.socket) && !rowChans.has(i.ch)) {
      silent.push({ ch: i.ch, name: chName(i.ch), was: describe(consoleRx.get(i.socket)) });
    }
  }

  if (inp.routingIsToday) {
    notes.push("This recording was made before ProDeck saved its routing, so the sheet uses today's. If something was repatched since, check those channels.");
  }
  return { rows, skipped, silent: silent.sort((a, b) => a.ch - b.ch), txUsed: [...usedTx].sort((a, b) => a - b), notes };
}

// ---------------------------------------------------------------------------
// The saved layout
//
// Worked out once, from the Sunday routing, for every source this Mac records
// (not just one recording's tracks), then kept. Each channel always comes back
// on the same console input from the same output of this Mac, so one Dante
// preset and one Virtual SoundCheck matrix fit every recording. Working it out
// again from the live network was what broke this: once the console listened
// to the soundcheck outputs, the Sunday sources were gone and the sheet
// reshuffled itself away from the patch just made.

export interface LayoutRow {
  ch: number;
  chName: string;
  rx: number;
  /** What that console input listens to on Sundays. */
  rxWas: string;
  tx: number;
  /** The Sunday source this Mac records the channel from (srcKey). */
  src: string;
}

export interface SoundcheckLayout {
  v: 1;
  console: string;
  local: string;
  made: number;
  rows: LayoutRow[];
}

/** One name for a Dante source, however its channel is spelled ("09", "9"). */
export function srcKey(device: string, channel: string | null | undefined): string {
  const c = (channel ?? "").trim();
  const n = parseInt(c, 10);
  return `${device} · ${/^\d+$/.test(c) && Number.isFinite(n) ? n : c}`;
}

export function isLayout(v: unknown): v is SoundcheckLayout {
  const l = v as SoundcheckLayout | null;
  return !!l && l.v === 1 && typeof l.console === "string" && Array.isArray(l.rows);
}

/**
 * Is the console listening to this Mac for anything beyond its own audio
 * (outputs 1 and 2)? Then the Sunday routing isn't in place to work from.
 */
export function listensToSoundcheck(consoleDev: DanteDevice, localName: string, local?: DanteDevice): boolean {
  return consoleDev.rx.some((r) => {
    if (r.txDevice !== localName) return false;
    const n = chNo(local, r.txChannel);
    return n == null || !RESERVED_TX.has(n);
  });
}

export type LayoutInput = Omit<SheetInput, "tracks" | "recordedRx" | "routingIsToday" | "fixed"> & {
  /** This Mac's Dante inputs now: every source it records. */
  localRx: DanteRx[];
  /** The layout so far. Its channels keep their inputs and outputs; only new ones are added. */
  keep?: SoundcheckLayout | null;
};

export function buildLayout(inp: LayoutInput, now = Date.now()): SoundcheckLayout {
  const keep = inp.keep && inp.keep.console === inp.console.name ? inp.keep : null;
  const subscribed = inp.localRx.filter((r) => r.txDevice);
  const sheet = buildSheet({
    ...inp,
    tracks: subscribed.map((r) => ({ n: r.ch, name: r.name })),
    recordedRx: subscribed,
    routingIsToday: false,
    fixed: keep?.rows.map(({ ch, rx, tx }) => ({ ch, rx, tx })),
  });
  const rows: LayoutRow[] = [...(keep?.rows ?? [])];
  const have = new Set(rows.map((r) => r.ch));
  for (const r of sheet.rows) {
    if (have.has(r.ch)) continue;
    const src = subscribed.find((x) => x.ch === r.track);
    rows.push({ ch: r.ch, chName: r.chName, rx: r.rx, rxWas: r.rxWas, tx: r.tx, src: srcKey(src?.txDevice ?? "", src?.txChannel) });
  }
  rows.sort((a, b) => a.ch - b.ch);
  return { v: 1, console: inp.console.name, local: inp.localName, made: keep?.made ?? now, rows };
}

/** One recording's sheet, from the saved layout. Nothing here reads the live network. */
export function sheetFromLayout(
  layout: SoundcheckLayout,
  inp: { tracks: { n: number; name: string }[]; recordedRx: DanteRx[]; routingIsToday: boolean; patch: AvantisPatch; deskNames: Record<number, string> },
): Sheet {
  const skipped: Sheet["skipped"] = [];
  const rows: SheetRow[] = [];
  const claimed = new Map<number, number>();
  const bySrc = new Map<string, LayoutRow[]>();
  for (const r of layout.rows) bySrc.set(r.src, [...(bySrc.get(r.src) ?? []), r]);
  for (const t of inp.tracks) {
    const src = inp.recordedRx.find((r) => r.ch === t.n);
    if (!src?.txDevice) {
      skipped.push({ track: t.n, name: t.name, why: "No Dante source was recorded for it" });
      continue;
    }
    const hits = bySrc.get(srcKey(src.txDevice, src.txChannel)) ?? [];
    if (!hits.length) {
      const out = src.txDevice === layout.console ? parseInt(src.txChannel ?? "", 10) : NaN;
      const o = inp.patch.danteOut?.find((d) => d.out === out);
      skipped.push({ track: t.n, name: t.name, why: o && o.code !== DIRECT_OUT ? `It's ${o.text}, not one channel` : "Not in the soundcheck layout" });
      continue;
    }
    for (const h of hits) {
      if (claimed.has(h.ch)) {
        skipped.push({ track: t.n, name: t.name, why: `Same channel as track ${claimed.get(h.ch)} (${inp.deskNames[h.ch] || h.chName})` });
        continue;
      }
      claimed.set(h.ch, t.n);
      rows.push({ ch: h.ch, chName: inp.deskNames[h.ch] || h.chName, track: t.n, trackName: t.name, rx: h.rx, rxWas: h.rxWas, tx: h.tx });
    }
  }
  rows.sort((a, b) => a.ch - b.ch);
  // The preset borrows every input in the layout, whichever tracks play.
  const layoutCh = new Set(layout.rows.map((r) => r.ch));
  const borrowed = new Map(layout.rows.map((r) => [r.rx, r.rxWas]));
  const silent: Sheet["silent"] = (inp.patch.inputs ?? [])
    .filter((i) => i.port === 1 && i.socket && borrowed.has(i.socket) && !layoutCh.has(i.ch))
    .map((i) => ({ ch: i.ch, name: inp.deskNames[i.ch] || `Ch ${i.ch}`, was: borrowed.get(i.socket!) ?? "" }))
    .sort((a, b) => a.ch - b.ch);
  const notes: string[] = [];
  if (inp.routingIsToday) {
    notes.push("This recording was made before ProDeck saved its routing, so its tracks are matched by today's. If something was repatched since, check those channels.");
  }
  return { rows, skipped, silent, txUsed: [...new Set(layout.rows.map((r) => r.tx))].sort((a, b) => a - b), notes };
}

/** Playback routes for ProDeck: track number → this Mac's output. */
export function routesOf(sheet: Sheet): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of sheet.rows) out[String(r.track)] = r.tx;
  return out;
}

/** The sheet as plain text, for printing or pasting into a message. */
export function sheetText(sheet: Sheet, localName: string, consoleName: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const lines = [
    "SOUNDCHECK PATCH SHEET",
    "",
    "Dante Controller (save your Sunday preset first):",
    ...[...new Map(sheet.rows.map((r) => [r.rx, r])).values()].map((r) => `  ${consoleName} input ${r.rx}  <-  ${localName} ${pad(r.tx)}${r.rxWas ? `   (Sunday: ${r.rxWas})` : ""}`),
    "",
    "Avantis, I/O, Virtual SoundCheck matrix (I/O Port 1):",
    ...sheet.rows.map((r) => `  Ch ${r.ch} ${r.chName}  <-  I/O Port 1 channel ${r.rx}   (track ${r.track} ${r.trackName})`),
    "  Every other channel: off.",
  ];
  if (sheet.silent.length) lines.push("", "Quiet during soundcheck (their Dante input is borrowed):", ...sheet.silent.map((s) => `  Ch ${s.ch} ${s.name}${s.was ? ` (Sunday: ${s.was})` : ""}`));
  return lines.join("\n");
}

/** Is the console still listening to the sheet's soundcheck outputs? */
export function stillPatched(consoleDev: DanteDevice | undefined, localName: string, local: DanteDevice | undefined, txUsed: number[]): number[] {
  if (!consoleDev || !txUsed.length) return [];
  const used = new Set(txUsed);
  return consoleDev.rx.filter((r) => r.txDevice === localName && used.has(chNo(local, r.txChannel) ?? -1)).map((r) => r.ch);
}
