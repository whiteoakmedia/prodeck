// The sound consoles ProDeck can mirror, in one place: the setup step, the
// Settings card, and the dashboard tile all read from here so a desk can't be
// described one way in one screen and another way in the next.
//
// The ids are the `avantis_model` setting values the Rust side parses
// (ahmap.rs DeskModel::parse). "other" is never saved: it is the setup
// step's "my desk isn't listed" answer.

export type ConsoleId = "avantis" | "dlive" | "sq" | "x32" | "yamaha";

export interface ConsoleInfo {
  id: ConsoleId;
  /** Short name on the setup tile. */
  name: string;
  /** Longer name for the Settings dropdown. */
  option: string;
  /** Label on the Settings chip and status lines. */
  label: string;
  /** One line under the name on the setup tile. */
  hint: string;
  /** The port this desk listens on. */
  port: number;
  /** True when the desk needs a MIDI channel to match (A&H only). */
  midi: boolean;
  /** Highest MIDI channel the desk allows; 1 when there is none. */
  maxBase: number;
  /** False where ProDeck only mirrors and never writes to the desk. */
  control: boolean;
}

export const CONSOLES: ConsoleInfo[] = [
  {
    id: "avantis",
    name: "Avantis",
    option: "Allen & Heath Avantis",
    label: "Avantis",
    hint: "Allen & Heath · base MIDI channel 1 to 12 · Utility → Control → MIDI",
    port: 51325,
    midi: true,
    maxBase: 12,
    control: true,
  },
  {
    id: "dlive",
    name: "dLive",
    option: "Allen & Heath dLive (MixRack or Surface)",
    label: "dLive",
    hint: "Allen & Heath · MixRack port 51325, Surface 51328 · base MIDI channel 1 to 12",
    port: 51325,
    midi: true,
    maxBase: 12,
    control: true,
  },
  {
    id: "sq",
    name: "SQ-5 / SQ-6 / SQ-7",
    option: "Allen & Heath SQ-5 / SQ-6 / SQ-7",
    label: "SQ",
    hint: "Allen & Heath · MIDI channel 1 to 16 · Utility → General → MIDI · no channel names",
    port: 51325,
    midi: true,
    maxBase: 16,
    control: true,
  },
  {
    id: "x32",
    name: "X32 / M32",
    option: "Behringer X32 / Midas M32",
    label: "X32 / M32",
    hint: "Behringer X32 or Midas M32 · nothing to set on the desk",
    port: 10023,
    midi: false,
    maxBase: 1,
    control: true,
  },
  {
    id: "yamaha",
    name: "Yamaha",
    option: "Yamaha CL, QL or TF",
    label: "Yamaha",
    hint: "CL, QL or TF series · nothing to set on the desk · view only for now",
    port: 49280,
    midi: false,
    maxBase: 1,
    control: false,
  },
];

/** Every port that is some desk's default, so switching desks can swap it. */
const DEFAULT_PORTS = new Set([51325, 51328, 10023, 49280]);

export function consoleInfo(model: string | null | undefined): ConsoleInfo | undefined {
  return CONSOLES.find((c) => c.id === (model || "").trim().toLowerCase());
}

/** The desk's name for chips and status lines. Unknown or unset reads as Avantis, as the backend does. */
export function consoleLabel(model: string | null | undefined): string {
  return (consoleInfo(model) ?? CONSOLES[0]).label;
}

/** True when ProDeck may write to this desk (mutes, faders, names, scenes). */
export function deskControlSupported(model: string | null | undefined): boolean {
  return (consoleInfo(model) ?? CONSOLES[0]).control;
}

/** True when the desk has a MIDI channel to match. */
export function consoleNeedsMidi(model: string | null | undefined): boolean {
  return (consoleInfo(model) ?? CONSOLES[0]).midi;
}

/**
 * The port to use after switching to `next`. A port someone typed on purpose
 * is kept; one that is just another desk's default follows the desk. dLive
 * Surface (51328) only makes sense on a dLive.
 */
export function portForSwitch(next: string, currentPort: number | null | undefined): number {
  const info = consoleInfo(next) ?? CONSOLES[0];
  const cur = currentPort ?? 0;
  if (!cur || DEFAULT_PORTS.has(cur)) {
    if (cur === 51328 && info.id === "dlive") return cur;
    return info.port;
  }
  return cur;
}

/** The MIDI channel, kept inside what the next desk allows. Desks without one keep the saved value. */
export function midiBaseForSwitch(next: string, currentBase: number | null | undefined): number {
  const info = consoleInfo(next) ?? CONSOLES[0];
  const cur = Math.max(1, currentBase ?? 1);
  return info.midi ? Math.min(info.maxBase, cur) : cur;
}

// ---- the first run setup step --------------------------------------------------

/** What someone picked on the setup step: a desk, "something else", or nothing yet. */
export type SetupChoice = ConsoleId | "other" | "";

/** The "my desk isn't listed" tile. */
export const OTHER_CONSOLE = {
  id: "other" as const,
  name: "Something else",
  hint: "DiGiCo, PreSonus, Soundcraft, Midas Pro, an analog desk…",
  explain:
    "ProDeck can't mirror that desk yet. Everything else in ProDeck works without it: slides, Planning Center, crew phones, pages, the stream and the rest. Carry on, and if that changes you can add a console later in Settings.",
};

/**
 * Which fields the setup step shows for a choice. Nothing is preselected, and
 * the port and MIDI fields only appear once a desk that has them is picked.
 */
export function setupFields(choice: SetupChoice): { form: boolean; midi: boolean; port: number | null; unsupported: boolean } {
  if (choice === "other") return { form: false, midi: false, port: null, unsupported: true };
  const info = choice ? consoleInfo(choice) : undefined;
  if (!info) return { form: false, midi: false, port: null, unsupported: false };
  return { form: true, midi: info.midi, port: info.port, unsupported: false };
}

/**
 * The setup step's starting choice from saved settings. Only a desk someone
 * actually set up counts (it has an IP), never the default model, which is
 * "avantis" on every fresh install.
 */
export function setupChoiceFromSettings(s: { avantis_model?: string; avantis_host?: string } | null | undefined): SetupChoice {
  if (!s?.avantis_host?.trim()) return "";
  return consoleInfo(s.avantis_model)?.id ?? "avantis";
}
