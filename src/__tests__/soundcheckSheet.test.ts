import { describe, expect, it } from "vitest";
import { buildSheet, routesOf, sheetText, stillPatched, type SheetInput } from "../lib/soundcheckSheet";
import type { AvantisPatch, DanteDevice, DanteRx } from "../lib/tauri";

// A small rig shaped like a real one: drums on the stage box recorded from
// the console's direct outs, wireless vocals recorded straight from the
// receivers, the playback rig and a Waves loop on the console's Dante card.

const rx = (ch: number, txDevice: string | null, txChannel: string | null): DanteRx => ({ ch, name: String(ch).padStart(2, "0"), txDevice, txChannel, status: txDevice ? "Connected" : "", ok: !!txDevice });
const pad = (n: number) => String(n).padStart(2, "0");

const CONSOLE = "FOH-Console";
const LOCAL = "Booth-Mac";

function consoleDev(extra: DanteRx[] = []): DanteDevice {
  return {
    name: CONSOLE,
    ip: "192.168.1.16",
    rxCount: 64,
    txCount: 64,
    tx: Array.from({ length: 64 }, (_, i) => ({ ch: i + 1, name: pad(i + 1) })),
    rx: [
      rx(1, "Playback-Mac", "01"),
      rx(2, "Playback-Mac", "02"),
      rx(25, "WavesBridge", "25"),
      rx(39, "ULXD4Q-1-4", "03"),
      rx(44, "ULXD4Q-5-8", "08"),
      rx(45, LOCAL, "01"),
      rx(46, LOCAL, "02"),
      ...extra,
    ],
  };
}
const local: DanteDevice = { name: LOCAL, ip: "192.168.1.20", rxCount: 64, txCount: 64, rx: [], tx: Array.from({ length: 64 }, (_, i) => ({ ch: i + 1, name: pad(i + 1) })) };

const patch: AvantisPatch = {
  file: "show.tar.gz",
  exportedAt: 0,
  changes: [],
  inputs: [
    { ch: 1, port: 3, socket: 1, text: "SLink 1" },
    { ch: 2, port: 3, socket: 7, text: "SLink 7" },
    { ch: 11, port: 1, socket: 1, text: "I/O Port 1 (Dante) 1" },
    { ch: 12, port: 1, socket: 2, text: "I/O Port 1 (Dante) 2" },
    { ch: 20, port: 3, socket: 18, text: "SLink 18" },
    { ch: 28, port: 1, socket: 39, text: "I/O Port 1 (Dante) 39" },
    { ch: 31, port: 1, socket: 39, text: "I/O Port 1 (Dante) 39" },
    { ch: 42, port: 1, socket: 44, text: "I/O Port 1 (Dante) 44" },
  ],
  danteOut: [
    { out: 1, code: 0x0a, index: 0, text: "Room L" },
    { out: 3, code: 4, index: 1, text: "Ch 2 Kick Out direct out" },
    { out: 9, code: 4, index: 0, text: "Ch 1 Kick IN direct out" },
    { out: 22, code: 4, index: 19, text: "Ch 20 EG2 R direct out" },
  ],
};

const recordedRx = [
  rx(1, CONSOLE, "01"), // Room L: a group, not a channel
  rx(9, CONSOLE, "09"), // Kick IN
  rx(21, "ULXD4Q-5-8", "08"), // a wireless vocal, straight from the receiver
  rx(22, CONSOLE, "03"), // Kick Out
  rx(26, CONSOLE, "22"), // EG2 R
  rx(27, CONSOLE, "22"), // the same source twice
  rx(28, "ULXD4Q-1-4", "03"), // John, on two console channels
];
const tracks = [
  { n: 1, name: "Room L" },
  { n: 9, name: "Kick IN" },
  { n: 21, name: "Vox 8" },
  { n: 22, name: "Kick Out" },
  { n: 26, name: "EG2 R" },
  { n: 27, name: "EG2 R again" },
  { n: 28, name: "John" },
  { n: 40, name: "Mystery" },
];

function input(con = consoleDev()): SheetInput {
  return {
    tracks,
    recordedRx,
    routingIsToday: false,
    localName: LOCAL,
    local,
    console: con,
    devices: [con, local],
    patch,
    deskNames: { 1: "Kick IN", 2: "Kick Out", 11: "Loop", 12: "Perc R", 20: "EG2 R", 28: "John", 31: "John", 42: "Vox 8" },
  };
}

describe("buildSheet", () => {
  const sheet = buildSheet(input());
  const row = (ch: number) => sheet.rows.find((r) => r.ch === ch);

  it("puts each direct-out track back on its own channel", () => {
    expect(row(1)).toMatchObject({ track: 9, trackName: "Kick IN" });
    expect(row(2)).toMatchObject({ track: 22 });
    expect(row(20)).toMatchObject({ track: 26 });
  });

  it("uses a wireless channel's own Dante input, and feeds both channels of a doubled vocal", () => {
    expect(row(42)).toMatchObject({ track: 21, rx: 44, rxWas: "ULXD4Q-5-8 08" });
    expect(row(28)).toMatchObject({ track: 28, rx: 39 });
    expect(row(31)).toMatchObject({ track: 28, rx: 39, tx: row(28)!.tx });
  });

  it("borrows free Dante inputs first, never the Waves loop", () => {
    const borrowed = sheet.rows.filter((r) => ![39, 44].includes(r.rx)).map((r) => r.rx);
    expect(borrowed).toEqual([3, 4, 5]);
    expect(sheet.rows.some((r) => r.rx === 25)).toBe(false);
  });

  it("plays on the matching output number, never this Mac's 1 and 2", () => {
    expect(row(1)!.tx).toBe(3);
    expect(sheet.rows.every((r) => r.tx >= 3)).toBe(true);
    expect(routesOf(sheet)).toEqual({ "9": 3, "22": 4, "26": 5, "28": 39, "21": 44 });
  });

  it("says why a track doesn't go back", () => {
    const why = Object.fromEntries(sheet.skipped.map((s) => [s.track, s.why]));
    expect(why[1]).toMatch(/Room L, not one channel/);
    expect(why[27]).toMatch(/Same channel as track 26/);
    expect(why[40]).toMatch(/No Dante source/);
  });

  it("lists the channels that go quiet when their input is borrowed", () => {
    // Only free inputs were needed here, so nothing goes quiet.
    expect(sheet.silent).toEqual([]);
    // A console whose Dante card is full: only the playback rig's inputs can be borrowed.
    const full = consoleDev(Array.from({ length: 64 }, (_, i) => i + 1).filter((n) => ![1, 2, 25, 39, 44, 45, 46].includes(n)).map((n) => rx(n, "WavesBridge", pad(n))));
    const s = buildSheet(input(full));
    expect(s.rows.find((r) => r.ch === 1)?.rx).toBe(1);
    expect(s.rows.find((r) => r.ch === 2)?.rx).toBe(2);
    expect(s.silent.map((x) => x.name)).toEqual(["Loop", "Perc R"]);
    // Borrowing the Spotify inputs frees their outputs... but 1 and 2 stay reserved.
    expect(s.rows.every((r) => r.tx >= 3)).toBe(true);
    // 45 and 46 (Spotify) were the last to borrow; after them it runs out.
    expect(s.skipped.find((x) => x.track === 26)).toBeUndefined();
  });

  it("warns when the routing is today's, not the recording's", () => {
    expect(buildSheet({ ...input(), routingIsToday: true }).notes[0]).toMatch(/before ProDeck saved its routing/);
  });

  it("writes a sheet a person can follow", () => {
    const text = sheetText(sheet, LOCAL, CONSOLE);
    expect(text).toContain("FOH-Console input 3  <-  Booth-Mac 03");
    expect(text).toContain("Ch 1 Kick IN  <-  I/O Port 1 channel 3");
    expect(text).toContain("(Sunday: ULXD4Q-5-8 08)");
  });
});

describe("stillPatched", () => {
  it("sees the console listening to the soundcheck outputs", () => {
    const con = consoleDev([rx(3, LOCAL, "03")]);
    expect(stillPatched(con, LOCAL, local, [3, 4])).toEqual([3]);
    // Spotify on 1 and 2 is Sunday as usual.
    expect(stillPatched(consoleDev(), LOCAL, local, [3, 4])).toEqual([]);
  });
});

import { buildLayout, listensToSoundcheck, sheetFromLayout, srcKey } from "../lib/soundcheckSheet";

describe("the saved soundcheck layout", () => {
  // This Mac's inputs on a Sunday: everything it records, not one recording's tracks.
  const localRx = recordedRx;
  const base = () => {
    const i = input();
    return { localRx, localName: LOCAL, local, console: i.console, devices: i.devices, patch, deskNames: i.deskNames };
  };
  const layout = buildLayout(base(), 1000);
  const at = (ch: number) => layout.rows.find((r) => r.ch === ch)!;

  it("is worked out once from the Sunday routing, for every source this Mac records", () => {
    expect(layout.rows.map((r) => r.ch)).toEqual([1, 2, 20, 28, 31, 42]);
    expect(at(1)).toMatchObject({ rx: 3, tx: 3, src: "FOH-Console · 9" });
    expect(at(42)).toMatchObject({ rx: 44, src: "ULXD4Q-5-8 · 8" });
  });

  it("gives every recording the same inputs and outputs, whichever tracks it has", () => {
    // A recording without Kick IN: Kick Out must not slide onto Kick IN's output.
    const s = sheetFromLayout(layout, { tracks: tracks.filter((t) => t.n !== 9), recordedRx, routingIsToday: false, patch, deskNames: {} });
    expect(s.rows.find((r) => r.ch === 2)).toMatchObject({ rx: at(2).rx, tx: at(2).tx });
    expect(s.rows.find((r) => r.ch === 1)).toBeUndefined();
    expect(Object.fromEntries(s.skipped.map((x) => [x.track, x.why]))).toMatchObject({ 1: expect.stringMatching(/Room L/), 27: expect.stringMatching(/Same channel/), 40: expect.stringMatching(/No Dante source/) });
    // The preset borrows the whole layout, so the reminder watches all of it.
    expect(s.txUsed).toEqual([...new Set(layout.rows.map((r) => r.tx))].sort((a, b) => a - b));
  });

  it("matches tracks by source, so a recording made on other inputs still lands right", () => {
    const moved = [rx(5, CONSOLE, "3")]; // Kick Out, recorded on input 5 that day
    const s = sheetFromLayout(layout, { tracks: [{ n: 5, name: "Kick Out" }], recordedRx: moved, routingIsToday: false, patch, deskNames: {} });
    expect(s.rows).toEqual([expect.objectContaining({ ch: 2, track: 5, tx: at(2).tx })]);
  });

  it("knows when the console already listens for soundcheck", () => {
    expect(listensToSoundcheck(consoleDev(), LOCAL, local)).toBe(false); // Spotify on 1 and 2 is Sunday
    expect(listensToSoundcheck(consoleDev([rx(3, LOCAL, "03")]), LOCAL, local)).toBe(true);
  });

  it("keeps what it has and only adds new sources", () => {
    const more = [...localRx, rx(30, CONSOLE, "09")];
    const patch2 = { ...patch, inputs: [...patch.inputs, { ch: 5, port: 3, socket: 5, text: "SLink 5" }], danteOut: [...(patch.danteOut ?? []), { out: 9, code: 4, index: 0, text: "x" }] };
    // Same rig a week later with the inputs reshuffled on the console: the kept rows don't move.
    const shuffled = buildLayout({ ...base(), localRx: [...more].reverse(), patch: patch2, keep: layout }, 2000);
    for (const r of layout.rows) expect(shuffled.rows.find((x) => x.ch === r.ch)).toEqual(r);
    expect(shuffled.made).toBe(1000);
  });

  it("spells a source one way", () => {
    expect(srcKey("ULXD4Q-1-4", "04")).toBe(srcKey("ULXD4Q-1-4", "4"));
    expect(srcKey("DA2EX", "CH1")).toBe("DA2EX · CH1");
  });
});
