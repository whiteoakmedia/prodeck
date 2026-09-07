//! Allen & Heath console address maps and MIDI dialects.
//!
//! Three consoles, two dialects:
//!   * Avantis and dLive share the "MIDI over TCP" dialect — Note On mutes,
//!     NRPN 0x17 faders, one SysEx family for names/colours — and differ only
//!     in the address map (how many of each channel type, at which note).
//!   * SQ is a different protocol: EVERYTHING is NRPN (mutes included), on a
//!     single MIDI channel, 14-bit levels, and there are no name/colour
//!     messages at all.
//! Sources: dLive MIDI Over TCP/IP V2.0, Avantis MIDI TCP V1.10, SQ MIDI
//! Protocol Issue 5 — byte sequences below are quoted from those documents.

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum DeskModel {
    #[default]
    Avantis,
    DLive,
    Sq,
    /// Behringer X32 / Midas M32 — OSC over UDP, not MIDI over TCP.
    X32,
}

impl DeskModel {
    pub fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "dlive" => DeskModel::DLive,
            "sq" | "sq5" | "sq6" | "sq7" | "sq-5" | "sq-6" | "sq-7" => DeskModel::Sq,
            "x32" | "m32" | "x32/m32" => DeskModel::X32,
            _ => DeskModel::Avantis,
        }
    }
    pub fn id(self) -> &'static str {
        match self {
            DeskModel::Avantis => "avantis",
            DeskModel::DLive => "dlive",
            DeskModel::Sq => "sq",
            DeskModel::X32 => "x32",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            DeskModel::Avantis => "Avantis",
            DeskModel::DLive => "dLive",
            DeskModel::Sq => "SQ",
            DeskModel::X32 => "X32 / M32",
        }
    }
    /// Highest base MIDI channel the desk lets you pick (1-based).
    pub fn max_base(self) -> u8 {
        match self {
            DeskModel::Sq => 16,
            _ => 12, // five-channel range must fit in 16
        }
    }
    pub fn max_scene(self) -> u32 {
        match self {
            DeskModel::Sq => 300,
            DeskModel::X32 => 100,
            _ => 500,
        }
    }

    /// True for consoles spoken to over OSC/UDP rather than MIDI over TCP.
    /// The MIDI mirror must stand down for these; x32.rs drives them.
    pub fn is_osc(self) -> bool {
        self == DeskModel::X32
    }
    /// SQ has no name/colour messages in its MIDI protocol.
    pub fn has_names(self) -> bool {
        self != DeskModel::Sq
    }
    /// Note On = mute on Avantis/dLive; on SQ a Note On can only be a softkey.
    pub fn note_mutes(self) -> bool {
        self != DeskModel::Sq && !self.is_osc()
    }
}

pub const SYSEX_HEADER: [u8; 8] = [0xF0, 0x00, 0x00, 0x1A, 0x50, 0x10, 0x01, 0x00];

// ---------------------------------------------------------------- note maps

/// One channel type on a Note-dialect desk: MIDI channel offset from the
/// base, first note, how many.
pub struct NoteRange {
    pub kind: &'static str,
    pub off: u8,
    pub first: u8,
    pub count: u8,
}

const fn r(kind: &'static str, off: u8, first: u8, count: u8) -> NoteRange {
    NoteRange { kind, off, first, count }
}

/// Avantis MIDI TCP Protocol V1.10, "Channel Selection".
const AVANTIS: &[NoteRange] = &[
    r("input", 0, 0x00, 64),
    r("grp", 1, 0x00, 40),
    r("sgrp", 1, 0x40, 20),
    r("aux", 2, 0x00, 40),
    r("saux", 2, 0x40, 20),
    r("mtx", 3, 0x00, 40),
    r("smtx", 3, 0x40, 20),
    r("fxs", 4, 0x00, 12),
    r("sfxs", 4, 0x10, 12),
    r("fxr", 4, 0x20, 12),
    r("main", 4, 0x30, 3),
    r("dca", 4, 0x36, 16),
    r("mgrp", 4, 0x46, 8),
];

/// dLive MIDI Over TCP/IP Protocol V2.0, "Channel Selection". Note that the
/// DCA block is longer (24), which pushes Mute Groups to 4E — the two desks
/// genuinely disagree on what note 0x46 means.
const DLIVE: &[NoteRange] = &[
    r("input", 0, 0x00, 128),
    r("grp", 1, 0x00, 62),
    r("sgrp", 1, 0x40, 31),
    r("aux", 2, 0x00, 62),
    r("saux", 2, 0x40, 31),
    r("mtx", 3, 0x00, 62),
    r("smtx", 3, 0x40, 31),
    r("fxs", 4, 0x00, 16),
    r("sfxs", 4, 0x10, 16),
    r("fxr", 4, 0x20, 16),
    r("main", 4, 0x30, 6),
    r("dca", 4, 0x36, 24),
    r("mgrp", 4, 0x4E, 8),
    r("ufxs", 4, 0x56, 8),
    r("ufxr", 4, 0x5E, 8),
];

pub fn note_map(model: DeskModel) -> &'static [NoteRange] {
    match model {
        DeskModel::Avantis => AVANTIS,
        DeskModel::DLive => DLIVE,
        // Neither speaks the Note dialect: SQ is all-NRPN, and the X32 isn't
        // MIDI at all (OSC over UDP — see x32.rs).
        DeskModel::Sq | DeskModel::X32 => &[],
    }
}

fn split_id(id: &str) -> Option<(&str, u8)> {
    let (kind, idx) = id.split_once(':')?;
    let i: u8 = idx.parse().ok()?;
    if i == 0 {
        return None;
    }
    Some((kind, i))
}

/// "kind:idx" → (MIDI channel nibble, note) on a Note-dialect desk.
pub fn note_encode(model: DeskModel, base_nibble: u8, id: &str) -> Option<(u8, u8)> {
    let (kind, i) = split_id(id)?;
    let rg = note_map(model).iter().find(|r| r.kind == kind && i <= r.count)?;
    let chan = base_nibble.checked_add(rg.off)?;
    let note = rg.first as u16 + (i as u16 - 1);
    if chan > 0x0F || note > 0x7F {
        return None;
    }
    Some((chan, note as u8))
}

/// (MIDI channel nibble, note) → (kind, 1-based index) on a Note-dialect desk.
pub fn note_decode(model: DeskModel, base_nibble: u8, chan: u8, note: u8) -> Option<(&'static str, u8)> {
    let off = chan.checked_sub(base_nibble)?;
    note_map(model).iter().find_map(|r| {
        if r.off != off {
            return None;
        }
        let n = note as u16;
        let lo = r.first as u16;
        let hi = lo + r.count as u16; // exclusive
        (lo..hi).contains(&n).then(|| (r.kind, (n - lo + 1) as u8))
    })
}

// ------------------------------------------------------------------- SQ map

/// One channel type on the SQ: NRPN parameter bases (14-bit, MSB<<7 | LSB)
/// for its mute and for its "fader" (LR send for sources, master level for
/// mixes). `level == NONE` means the type has no level (mute groups).
pub struct SqRange {
    pub kind: &'static str,
    pub count: u8,
    pub mute: u16,
    pub level: u16,
}
const NONE: u16 = 0xFFFF;
const fn p(msb: u8, lsb: u8) -> u16 {
    ((msb as u16) << 7) | lsb as u16
}
const fn s(kind: &'static str, count: u8, mute: u16, level: u16) -> SqRange {
    SqRange { kind, count, mute, level }
}

/// SQ MIDI Protocol Issue 5, reference tables (Mute Parameter Numbers; Level
/// Parameter Numbers – Inputs to LR; Master Sends "Output"). SQ-5/6/7 share it.
pub const SQ: &[SqRange] = &[
    s("input", 48, p(0x00, 0x00), p(0x40, 0x00)),
    s("grp", 12, p(0x00, 0x30), p(0x40, 0x30)),
    s("fxr", 8, p(0x00, 0x3C), p(0x40, 0x3C)),
    s("main", 1, p(0x00, 0x44), p(0x4F, 0x00)), // LR
    s("aux", 12, p(0x00, 0x45), p(0x4F, 0x01)), // "Mix 1-12" on the desk
    s("fxs", 4, p(0x00, 0x51), p(0x4F, 0x0D)),
    s("mtx", 3, p(0x00, 0x55), p(0x4F, 0x11)),
    s("dca", 8, p(0x02, 0x00), p(0x4F, 0x20)),
    s("mgrp", 8, p(0x04, 0x00), NONE),
];

pub fn sq_split(param: u16) -> (u8, u8) {
    (((param >> 7) & 0x7F) as u8, (param & 0x7F) as u8)
}

pub fn sq_mute_param(id: &str) -> Option<u16> {
    let (kind, i) = split_id(id)?;
    let rg = SQ.iter().find(|r| r.kind == kind && i <= r.count)?;
    Some(rg.mute + (i as u16 - 1))
}

pub fn sq_level_param(id: &str) -> Option<u16> {
    let (kind, i) = split_id(id)?;
    let rg = SQ.iter().find(|r| r.kind == kind && i <= r.count && r.level != NONE)?;
    Some(rg.level + (i as u16 - 1))
}

pub fn sq_decode_mute(param: u16) -> Option<(&'static str, u8)> {
    SQ.iter().find_map(|r| {
        (r.mute..r.mute + r.count as u16).contains(&param).then(|| (r.kind, (param - r.mute + 1) as u8))
    })
}

pub fn sq_decode_level(param: u16) -> Option<(&'static str, u8)> {
    SQ.iter().filter(|r| r.level != NONE).find_map(|r| {
        (r.level..r.level + r.count as u16).contains(&param).then(|| (r.kind, (param - r.level + 1) as u8))
    })
}

// ------------------------------------------------------ SQ level ↔ dB table

/// "Example Linear Taper Level Values" — (dB, VC, VF). -inf is 00 00.
const SQ_TAPER: &[(f32, u8, u8)] = &[
    (-89.0, 0x24, 0x16), (-85.0, 0x27, 0x71), (-80.0, 0x2C, 0x42), (-75.0, 0x31, 0x14),
    (-70.0, 0x35, 0x65), (-65.0, 0x3A, 0x37), (-60.0, 0x3F, 0x09), (-55.0, 0x43, 0x5A),
    (-50.0, 0x48, 0x2C), (-45.0, 0x4C, 0x7D), (-40.0, 0x51, 0x4F), (-38.0, 0x53, 0x3C),
    (-36.0, 0x55, 0x2A), (-35.0, 0x56, 0x21), (-34.0, 0x57, 0x17), (-33.0, 0x58, 0x0E),
    (-32.0, 0x59, 0x05), (-31.0, 0x59, 0x7C), (-30.0, 0x5A, 0x72), (-29.0, 0x5B, 0x69),
    (-28.0, 0x5C, 0x60), (-27.0, 0x5D, 0x56), (-26.0, 0x5E, 0x4D), (-25.0, 0x5F, 0x44),
    (-24.0, 0x60, 0x3B), (-23.0, 0x61, 0x31), (-22.0, 0x62, 0x28), (-21.0, 0x63, 0x1F),
    (-20.0, 0x64, 0x16), (-19.0, 0x65, 0x0C), (-18.0, 0x66, 0x03), (-17.0, 0x66, 0x7A),
    (-16.0, 0x67, 0x70), (-15.0, 0x68, 0x67), (-14.0, 0x69, 0x5E), (-13.0, 0x6A, 0x55),
    (-12.0, 0x6B, 0x4B), (-11.0, 0x6C, 0x42), (-10.0, 0x6D, 0x39), (-9.0, 0x6E, 0x2F),
    (-8.0, 0x6F, 0x26), (-7.0, 0x70, 0x1D), (-6.0, 0x71, 0x14), (-5.0, 0x72, 0x0A),
    (-4.0, 0x73, 0x01), (-3.0, 0x73, 0x78), (-2.0, 0x74, 0x6F), (-1.0, 0x75, 0x65),
    (0.0, 0x76, 0x5C), (1.0, 0x77, 0x53), (2.0, 0x78, 0x49), (3.0, 0x79, 0x40),
    (4.0, 0x7A, 0x37), (5.0, 0x7B, 0x2E), (6.0, 0x7C, 0x24), (7.0, 0x7D, 0x1B),
    (8.0, 0x7E, 0x12), (9.0, 0x7F, 0x08), (10.0, 0x7F, 0x7F),
];

fn taper_val(vc: u8, vf: u8) -> f32 {
    p(vc, vf) as f32
}

/// 14-bit SQ level → dB (None = -inf). Piecewise-linear over the A&H table.
pub fn sq_level_to_db(v: u16) -> Option<f32> {
    if v == 0 {
        return None;
    }
    let x = v as f32;
    let first = SQ_TAPER[0];
    if x <= taper_val(first.1, first.2) {
        return Some(first.0);
    }
    for w in SQ_TAPER.windows(2) {
        let (a, b) = (w[0], w[1]);
        let (xa, xb) = (taper_val(a.1, a.2), taper_val(b.1, b.2));
        if x <= xb {
            let t = (x - xa) / (xb - xa).max(1.0);
            return Some(a.0 + t * (b.0 - a.0));
        }
    }
    Some(10.0)
}

/// dB → 14-bit SQ level (clamped to the table; None/very low = -inf = 0).
pub fn sq_db_to_level(db: Option<f32>) -> u16 {
    let Some(db) = db else { return 0 };
    let first = SQ_TAPER[0];
    if db <= first.0 {
        return 0; // below the quietest table row: treat as -inf
    }
    for w in SQ_TAPER.windows(2) {
        let (a, b) = (w[0], w[1]);
        if db <= b.0 {
            let t = (db - a.0) / (b.0 - a.0);
            let (xa, xb) = (taper_val(a.1, a.2), taper_val(b.1, b.2));
            return (xa + t * (xb - xa)).round() as u16;
        }
    }
    p(0x7F, 0x7F)
}

/// ProDeck's fader scale is the Avantis/dLive one: 0-127 with
/// dB = v/127·64 − 54 (0 = -inf). SQ levels are converted onto it so every
/// widget and watchdog line reads the same regardless of desk.
pub fn fader_u8_from_db(db: Option<f32>) -> u8 {
    match db {
        None => 0,
        Some(d) => (((d + 54.0) / 64.0) * 127.0).round().clamp(1.0, 127.0) as u8,
    }
}
pub fn db_from_fader_u8(v: u8) -> Option<f32> {
    if v == 0 {
        None
    } else {
        Some((v as f32 / 127.0) * 64.0 - 54.0)
    }
}

// -------------------------------------------------------- message builders

/// Mute/unmute one channel. Note dialect: Note On vel 7F/3F then vel 00 (as
/// the protocol prescribes). SQ: NRPN mute with 06 00 / 26 01|00.
pub fn mute_bytes(model: DeskModel, base_nibble: u8, id: &str, muted: bool) -> Option<Vec<u8>> {
    if model.note_mutes() {
        let (chan, note) = note_encode(model, base_nibble, id)?;
        let status = 0x90 | chan;
        let vel = if muted { 0x7F } else { 0x3F };
        Some(vec![status, note, vel, status, note, 0x00])
    } else {
        let (msb, lsb) = sq_split(sq_mute_param(id)?);
        let b = 0xB0 | (base_nibble & 0x0F);
        Some(vec![b, 0x63, msb, b, 0x62, lsb, b, 0x06, 0x00, b, 0x26, if muted { 0x01 } else { 0x00 }])
    }
}

/// Set one fader, value on ProDeck's 0-127 scale.
pub fn fader_bytes(model: DeskModel, base_nibble: u8, id: &str, v: u8) -> Option<Vec<u8>> {
    let v = v.min(0x7F);
    if model.note_mutes() {
        let (chan, note) = note_encode(model, base_nibble, id)?;
        let status = 0xB0 | chan;
        Some(vec![status, 0x63, note, status, 0x62, 0x17, status, 0x06, v])
    } else {
        let (msb, lsb) = sq_split(sq_level_param(id)?);
        let (vc, vf) = sq_split(sq_db_to_level(db_from_fader_u8(v)));
        let b = 0xB0 | (base_nibble & 0x0F);
        Some(vec![b, 0x63, msb, b, 0x62, lsb, b, 0x06, vc, b, 0x26, vf])
    }
}

/// Rename a channel (SysEx op 03). None on SQ — no such message exists.
pub fn name_bytes(model: DeskModel, base_nibble: u8, id: &str, clean: &str) -> Option<Vec<u8>> {
    if !model.has_names() {
        return None;
    }
    let (chan, note) = note_encode(model, base_nibble, id)?;
    let mut msg = Vec::with_capacity(20);
    msg.extend_from_slice(&SYSEX_HEADER);
    msg.push(chan);
    msg.push(0x03);
    msg.push(note);
    msg.extend(clean.bytes());
    msg.push(0xF7);
    Some(msg)
}

/// Bank Select + Program Change on the base channel (identical on all three).
pub fn scene_bytes(base_nibble: u8, scene: u32) -> Vec<u8> {
    let z = scene - 1;
    let b = base_nibble & 0x0F;
    vec![0xB0 | b, 0x00, (z / 128) as u8, 0xC0 | b, (z % 128) as u8]
}

/// Everything to ask the desk on connect so the mirror starts knowing.
/// Avantis: names + colours (its protocol has no mute/fader GET).
/// dLive: names + colours, PLUS Get Mute (05 09) and Get Fader (05 0B 17).
/// SQ: Get (60 7F) for every mute and level.
pub fn query_bytes(model: DeskModel, base_nibble: u8) -> Vec<u8> {
    let mut out = Vec::new();
    match model {
        DeskModel::Sq => {
            let b = 0xB0 | (base_nibble & 0x0F);
            for rg in SQ {
                for i in 0..rg.count as u16 {
                    let (m, l) = sq_split(rg.mute + i);
                    out.extend_from_slice(&[b, 0x63, m, b, 0x62, l, b, 0x60, 0x7F]);
                    if rg.level != NONE {
                        let (m, l) = sq_split(rg.level + i);
                        out.extend_from_slice(&[b, 0x63, m, b, 0x62, l, b, 0x60, 0x7F]);
                    }
                }
            }
        }
        _ => {
            // Volunteer-facing surfaces first; the widget's big toggles and
            // the watchdog's FX lines need names to read as names.
            let wanted: &[&str] = &["input", "main", "dca", "mgrp", "fxs", "sfxs", "fxr", "ufxs", "ufxr"];
            let mut sysex = |chan: u8, op: u8, tail: &[u8]| {
                out.extend_from_slice(&SYSEX_HEADER);
                out.push(chan);
                out.push(op);
                out.extend_from_slice(tail);
                out.push(0xF7);
            };
            for rg in note_map(model).iter().filter(|r| wanted.contains(&r.kind)) {
                let chan = base_nibble + rg.off;
                for i in 0..rg.count as u16 {
                    let note = (rg.first as u16 + i) as u8;
                    sysex(chan, 0x01, &[note]); // get name
                    sysex(chan, 0x04, &[note]); // get colour
                    if model == DeskModel::DLive {
                        sysex(chan, 0x05, &[0x09, note]); // get mute status
                        if rg.kind != "mgrp" {
                            sysex(chan, 0x05, &[0x0B, 0x17, note]); // get fader level
                        }
                    }
                }
            }
        }
    }
    out
}

/// Human label for a channel key ("FX Return 2", not "fxr:2").
pub fn pretty_kind(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "input" => "Ch",
        "grp" => "Group",
        "sgrp" => "Group(st)",
        "aux" => "Aux",
        "saux" => "Aux(st)",
        "mtx" => "Matrix",
        "smtx" => "Matrix(st)",
        "fxs" => "FX Send",
        "sfxs" => "FX Send(st)",
        "fxr" => "FX Return",
        "ufxs" => "UFX Send",
        "ufxr" => "UFX Return",
        "main" => "Main",
        "dca" => "DCA",
        "mgrp" => "Mute Grp",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn avantis_map_matches_v1_10_doc() {
        // Base channel 12 → nibble 0x0B. Inputs on N, Mute Groups at N+4 46..4D.
        assert_eq!(note_encode(DeskModel::Avantis, 0x0B, "input:1"), Some((0x0B, 0x00)));
        assert_eq!(note_encode(DeskModel::Avantis, 0x0B, "input:64"), Some((0x0B, 0x3F)));
        assert_eq!(note_encode(DeskModel::Avantis, 0x0B, "input:65"), None);
        assert_eq!(note_encode(DeskModel::Avantis, 0x0B, "dca:16"), Some((0x0F, 0x45)));
        assert_eq!(note_encode(DeskModel::Avantis, 0x0B, "mgrp:1"), Some((0x0F, 0x46)));
        assert_eq!(note_decode(DeskModel::Avantis, 0x0B, 0x0F, 0x46), Some(("mgrp", 1)));
        assert_eq!(note_encode(DeskModel::Avantis, 0x0B, "dca:17"), None);
    }

    #[test]
    fn dlive_map_matches_v2_0_doc() {
        // dLive: 128 inputs, 24 DCAs (36..4D), Mute Groups shift to 4E..55, UFX after.
        assert_eq!(note_encode(DeskModel::DLive, 0x00, "input:128"), Some((0x00, 0x7F)));
        assert_eq!(note_encode(DeskModel::DLive, 0x00, "dca:24"), Some((0x04, 0x4D)));
        assert_eq!(note_encode(DeskModel::DLive, 0x00, "mgrp:1"), Some((0x04, 0x4E)));
        assert_eq!(note_encode(DeskModel::DLive, 0x00, "mgrp:8"), Some((0x04, 0x55)));
        assert_eq!(note_encode(DeskModel::DLive, 0x00, "ufxs:1"), Some((0x04, 0x56)));
        assert_eq!(note_encode(DeskModel::DLive, 0x00, "ufxr:8"), Some((0x04, 0x65)));
        assert_eq!(note_encode(DeskModel::DLive, 0x00, "main:6"), Some((0x04, 0x35)));
        assert_eq!(note_encode(DeskModel::DLive, 0x00, "sgrp:31"), Some((0x01, 0x5E)));
        // The same note means different things on the two desks.
        assert_eq!(note_decode(DeskModel::DLive, 0x00, 0x04, 0x46), Some(("dca", 17)));
        assert_eq!(note_decode(DeskModel::Avantis, 0x00, 0x04, 0x46), Some(("mgrp", 1)));
        // Doc example: "Mute on for Inputs 1, 2 and 3 on MIDI channel 12": 9B 00 7F …
        assert_eq!(mute_bytes(DeskModel::DLive, 0x0B, "input:1", true), Some(vec![0x9B, 0x00, 0x7F, 0x9B, 0x00, 0x00]));
        // Round-trip every address.
        for rg in DLIVE {
            for i in 1..=rg.count {
                let id = format!("{}:{}", rg.kind, i);
                let (c, n) = note_encode(DeskModel::DLive, 0x00, &id).expect(&id);
                assert_eq!(note_decode(DeskModel::DLive, 0x00, c, n), Some((rg.kind, i)), "{id}");
            }
        }
    }

    #[test]
    fn sq_mutes_match_issue5_examples() {
        // "Ip1, Mute On, Ch1  B0 63 00 B0 62 00 B0 06 00 B0 26 01"
        assert_eq!(
            mute_bytes(DeskModel::Sq, 0, "input:1", true),
            Some(vec![0xB0, 0x63, 0x00, 0xB0, 0x62, 0x00, 0xB0, 0x06, 0x00, 0xB0, 0x26, 0x01])
        );
        // "LR mix, Mute Off, Ch1  B0 63 00 B0 62 44 B0 06 00 B0 26 00"
        assert_eq!(
            mute_bytes(DeskModel::Sq, 0, "main:1", false),
            Some(vec![0xB0, 0x63, 0x00, 0xB0, 0x62, 0x44, 0xB0, 0x06, 0x00, 0xB0, 0x26, 0x00])
        );
        // "Mute Grp 4, Mute On, Ch7  B6 63 04 B6 62 03 B6 06 00 B6 26 01"
        assert_eq!(
            mute_bytes(DeskModel::Sq, 6, "mgrp:4", true),
            Some(vec![0xB6, 0x63, 0x04, 0xB6, 0x62, 0x03, 0xB6, 0x06, 0x00, 0xB6, 0x26, 0x01])
        );
        assert_eq!(sq_decode_mute(p(0x04, 0x03)), Some(("mgrp", 4)));
        assert_eq!(sq_decode_mute(p(0x00, 0x44)), Some(("main", 1)));
        assert_eq!(sq_decode_mute(p(0x00, 0x2F)), Some(("input", 48)));
        assert_eq!(sq_decode_mute(p(0x00, 0x30)), Some(("grp", 1)));
        assert_eq!(sq_decode_mute(p(0x02, 0x07)), Some(("dca", 8)));
        assert_eq!(sq_mute_param("input:49"), None);
        // No stereo variants on SQ.
        assert_eq!(sq_mute_param("sgrp:1"), None);
    }

    #[test]
    fn sq_levels_match_issue5_tables() {
        // "Ip1 to LR, 0dB, Ch1  B0 63 40 B0 62 00 B0 06 76 B0 26 5C"
        let v0 = fader_u8_from_db(Some(0.0));
        let b = fader_bytes(DeskModel::Sq, 0, "input:1", v0).unwrap();
        assert_eq!(&b[..6], &[0xB0, 0x63, 0x40, 0xB0, 0x62, 0x00]);
        // Value survives the 0-127 round-trip to within a dB of the table row.
        let vc = b[8] as u16;
        let vf = b[11] as u16;
        let db = sq_level_to_db((vc << 7) | vf).unwrap();
        assert!(db.abs() < 1.0, "0 dB round-trip gave {db}");
        // Table anchors decode exactly.
        assert_eq!(sq_level_to_db(p(0x76, 0x5C)), Some(0.0));
        assert_eq!(sq_level_to_db(p(0x64, 0x16)), Some(-20.0));
        assert_eq!(sq_level_to_db(p(0x7F, 0x7F)), Some(10.0));
        assert_eq!(sq_level_to_db(0), None);
        // "Grp5 to LR … B4 63 40 B4 62 34" → group level base 40:30.
        assert_eq!(sq_level_param("grp:5"), Some(p(0x40, 0x34)));
        // Master sends table: LR 4F 00, Aux1 4F 01, FX1Snd 4F 0D, Mtx1 4F 11, DCA1 4F 20.
        assert_eq!(sq_level_param("main:1"), Some(p(0x4F, 0x00)));
        assert_eq!(sq_level_param("aux:12"), Some(p(0x4F, 0x0C)));
        assert_eq!(sq_level_param("fxs:4"), Some(p(0x4F, 0x10)));
        assert_eq!(sq_level_param("mtx:3"), Some(p(0x4F, 0x13)));
        assert_eq!(sq_level_param("dca:8"), Some(p(0x4F, 0x27)));
        assert_eq!(sq_level_param("mgrp:1"), None);
        assert_eq!(sq_decode_level(p(0x4F, 0x20)), Some(("dca", 1)));
        assert_eq!(sq_decode_level(p(0x40, 0x3C)), Some(("fxr", 1)));
        // Mute and level parameter spaces never collide.
        for rg in SQ {
            for i in 0..rg.count as u16 {
                assert!(sq_decode_level(rg.mute + i).is_none(), "{}:{} mute param decodes as a level", rg.kind, i + 1);
            }
        }
    }

    #[test]
    fn scene_bytes_match_docs() {
        // SQ: "Scene 156, Ch3  B2 00 01 C2 1B"; dLive/Avantis use the same format.
        assert_eq!(scene_bytes(2, 156), vec![0xB2, 0x00, 0x01, 0xC2, 0x1B]);
        assert_eq!(scene_bytes(0, 7), vec![0xB0, 0x00, 0x00, 0xC0, 0x06]);
    }

    #[test]
    fn names_only_where_the_protocol_has_them() {
        assert!(name_bytes(DeskModel::Sq, 0, "input:1", "Vox").is_none());
        let n = name_bytes(DeskModel::DLive, 0x0B, "input:1", "Vox").unwrap();
        assert_eq!(&n[..8], &SYSEX_HEADER);
        assert_eq!(&n[8..11], &[0x0B, 0x03, 0x00]);
        assert_eq!(*n.last().unwrap(), 0xF7);
    }
}
