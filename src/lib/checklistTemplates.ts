// Starter checklists — pre-built volunteer lists a new church can add with one
// click, so the Checklists page isn't empty on day one. Pure data plus two
// helpers; nothing here touches React.

import {
  loadChecklistsNow,
  saveChecklistsNow,
  uid,
  type Checklist,
  type ChItem,
  type Visibility,
} from "../checklistStore";

export interface StarterItem {
  text: string;
  /** A gotcha worth a sentence. Folded into the step text on build — ChItem
   *  has no note field and the phone UI shows one line per step. */
  note?: string;
}

export interface StarterChecklist {
  name: string;
  visibility: Visibility;
  /** PCO position when visibility is "position"; matched loosely ("Audio"
   *  covers "Audio A2"). */
  position?: string;
  items: StarterItem[];
}

export const STARTER_CHECKLISTS: StarterChecklist[] = [
  {
    name: "Booth Startup",
    visibility: "all",
    items: [
      {
        text: "Power up in order: console and stage boxes, then processing, amps last",
        note: "Amps first means every later power-on thumps through the house.",
      },
      { text: "Wake the booth Mac, open ProPresenter, confirm it is on the production network" },
      { text: "Stage displays on and showing ProPresenter's stage output, not the desktop" },
      { text: "Confidence monitor readable from the platform — lyrics, clock, and messages" },
      { text: "Stream encoder on and seeing program video with audio" },
      { text: "ProDeck connection lights green: ProPresenter, Planning Center, console" },
      { text: "Fresh batteries in every wireless mic and pack; used ones out of the drawer" },
      { text: "Load today's playlist in ProPresenter and clear to logo" },
    ],
  },
  {
    name: "Audio Engineer",
    visibility: "position",
    position: "Audio",
    items: [
      {
        text: "Recall the Sunday base scene before anyone touches a fader",
        note: "Never build on whatever Wednesday night left behind.",
      },
      { text: "Line check in order: drums, bass, keys, guitars, vocals, then speaking mics" },
      { text: "RF scan, then confirm every receiver shows lock and clean RF" },
      { text: "Set monitor mixes with the musicians on stage, one at a time" },
      {
        text: "Test the pastor's mic with the person actually speaking, at their volume",
        note: "A tech at conversational level tells you nothing about a preacher.",
      },
      { text: "Confirm the stream and record feed is getting a mix, not just the house send" },
      { text: "Arm the recording and confirm it is actually writing" },
      { text: "Save the scene under today's date — do not overwrite the base" },
      { text: "Mute all speaking mics; unmute only on cue" },
    ],
  },
  {
    name: "ProPresenter Operator",
    visibility: "position",
    position: "ProPresenter",
    items: [
      { text: "Import today's plan from Planning Center; every song is in the playlist" },
      {
        text: "Proof lyrics against the arrangement the band is actually playing — verse order, repeats, tag",
        note: "Ask the worship leader. The PCO arrangement is not always what they rehearsed.",
      },
      { text: "Every song has the right theme and background; no leftover placeholder slides" },
      { text: "Lower thirds: names and titles spelled correctly for everyone speaking today" },
      { text: "Announcement loop built, timed, and set to play pre-service" },
      { text: "Stage display layout shows lyrics plus clock; confidence monitor is not the audience feed" },
      { text: "Sermon slides loaded and scripture checked against the translation being read" },
      { text: "Run the first two songs with the band to catch slide-order surprises" },
      { text: "Clear to logo after the last cue — never leave the final slide up" },
    ],
  },
  {
    name: "Camera / Switcher",
    visibility: "position",
    position: "Camera",
    items: [
      { text: "Cameras on, lens caps off, every input showing signal on the switcher" },
      {
        text: "White balance all cameras to the same card under service lighting",
        note: "Do it with stage lights at show level, not house lights.",
      },
      { text: "Focus and frame every shot; set a safe wide as the fallback" },
      { text: "Tally lights working on every camera" },
      { text: "Program and preview inputs labeled correctly on the switcher" },
      { text: "Stream output shows the switcher's program with audio, not a test pattern" },
      { text: "Lower-thirds bus keyed and tested on preview" },
      { text: "Start the program recording and confirm it is writing" },
      { text: "Comms check with every camera operator" },
    ],
  },
  {
    name: "Production Lead — Shutdown",
    visibility: "admin",
    items: [
      {
        text: "Stop the recording; confirm the file is saved and plays back",
        note: "Check the length before you power anything down.",
      },
      { text: "End the stream on the platform, not just the encoder" },
      { text: "All wireless batteries on charge; dead ones in the charger, not the drawer" },
      { text: "Save the console show file under today's date, then power down without recalling" },
      { text: "Power down in reverse: amps first, then processing, then console and stage boxes" },
      { text: "ProPresenter cleared to logo and closed; Mac to sleep, not shut down mid-update" },
      { text: "Cameras off, lens caps on, PTZ cameras homed" },
      { text: "Stage and house lights to the lock-up preset" },
      { text: "Doors locked and booth secured" },
    ],
  },
];

const norm = (s: string) => s.trim().toLowerCase();

/** Starters not yet present, by name (case-insensitive). */
export function missingStarterChecklists(existing: Checklist[]): StarterChecklist[] {
  const have = new Set(existing.map((c) => norm(c.name)));
  return STARTER_CHECKLISTS.filter((s) => !have.has(norm(s.name)));
}

function toItem(it: StarterItem): ChItem {
  return {
    id: uid(),
    text: it.note ? `${it.text} — ${it.note}` : it.text,
    done: false,
  };
}

/** The Checklist objects to ADD for `existing`. Pure: fresh ids every call,
 *  items unchecked, starters whose name already exists are skipped. */
export function buildStarterChecklists(existing: Checklist[]): Checklist[] {
  return missingStarterChecklists(existing).map((s) => ({
    id: uid(),
    name: s.name,
    items: s.items.map(toItem),
    due: null,
    schedule: [],
    activeDue: null,
    visibility: s.visibility,
    role: s.visibility === "position" ? s.position : undefined,
  }));
}

/** Load, append the missing starters, save. Resolves to how many were added
 *  (0 when nothing was missing — no write in that case). Callable from
 *  outside React; a mounted ChecklistProvider picks the new lists up itself. */
export async function addStarterChecklists(): Promise<number> {
  const { data } = await loadChecklistsNow();
  const added = buildStarterChecklists(data);
  if (added.length === 0) return 0;
  await saveChecklistsNow([...data, ...added]);
  return added.length;
}
