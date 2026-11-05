// "What's new in ProDeck": a full screen showcase of the features added since
// 0.9.109, shown once on the booth after the update that carries it, and
// reopened any time from Help or Settings, Help & support.
//
// It's keyed to an EDITION, not the app version: patch releases that don't
// change this list don't bring it back, and a new edition shows once more.
// The copy lives here so a test can hold it to the house rules (no dashes,
// at most one exclamation mark) and check every link goes somewhere real.

import { TIP_URL } from "./tip";

export const WHATS_NEW_EDITION = "2026-11-crew";
export const SEEN_KEY = "prodeck.whatsNewSeen";
/** Window event that reopens the showcase from anywhere (Help, Settings). */
export const WHATS_NEW_EVENT = "prodeck:whats-new";

export function openWhatsNew() {
  window.dispatchEvent(new Event(WHATS_NEW_EVENT));
}

type Store = Pick<Storage, "getItem" | "setItem">;
const local = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export function readSeen(s: Store | null = local()): string | null {
  try {
    return s?.getItem(SEEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function markSeen(s: Store | null = local(), edition = WHATS_NEW_EDITION) {
  try {
    s?.setItem(SEEN_KEY, edition);
  } catch {
    /* storage unavailable: it shows again next launch, which is harmless */
  }
}

export interface ShowContext {
  /** Phones, kiosks and other browsers never get it: the booth only. */
  isWeb: boolean;
  kiosk: boolean;
  /** Demo mode on a real machine is someone evaluating; leave it alone. */
  demo: boolean;
  /** null while settings are still loading. */
  freshInstall: boolean | null;
  /** A service is running by the clock: never cover the dashboard then. */
  inService: boolean;
  /** Another full screen thing is up (the startup service wizard). */
  otherOverlay: boolean;
}

/**
 * - "skip": not for this screen, or already seen. Do nothing.
 * - "mark": a brand new install. Everything is new, Setup is the right
 *   first screen, so record the edition as seen without showing it.
 * - "wait": not now; ask again when something changes.
 * - "show": open it (and mark it seen).
 */
export type Decision = "skip" | "mark" | "wait" | "show";

export function decide(seen: string | null, ctx: ShowContext, edition = WHATS_NEW_EDITION): Decision {
  if (ctx.isWeb || ctx.kiosk || ctx.demo) return "skip";
  if (seen === edition) return "skip";
  if (ctx.freshInstall === null) return "wait";
  if (ctx.freshInstall) return "mark";
  if (ctx.inService || ctx.otherOverlay) return "wait";
  return "show";
}

// ------------------------------------------------------------------ content

export type Art =
  | "app"
  | "page"
  | "comms"
  | "tally"
  | "lock"
  | "tv"
  | "poster"
  | "ipad"
  | "screens";

export interface Feature {
  id: string;
  title: string;
  /** One short line under the title. */
  tagline: string;
  what: string;
  /** How to set it up, in order. */
  steps: string[];
  /** Settings card anchor for the "Set it up" button. */
  settings?: string;
  /** Used instead of `settings` when the ATEM isn't connected yet. */
  settingsWithoutAtem?: string;
  /** Label for the Settings button. */
  settingsLabel?: string;
  /** Help topic id for "Read more". */
  help?: string;
  /** Big headline cards get an animated picture. */
  art?: Art;
  /** Small cards get an icon (components/Icon names). */
  icon?: string;
  /** The app's own colours (App.css tokens): accent, live, good, warn. */
  tone: "accent" | "live" | "good" | "warn";
}

export const HERO = {
  kicker: "Big update for your crew",
  title: "What's new in ProDeck",
  sub: "Phones, comms, tally lights and TVs, all set up from the booth. Here's everything that's new, and where to turn each one on.",
  footer: "You can open this again any time from Help.",
};

export const HEADLINERS: Feature[] = [
  {
    id: "crew-app",
    art: "app",
    tone: "accent",
    title: "ProDeck Crew, an app for your volunteers",
    tagline: "Coming soon to iPhone, iPad and Android.",
    what:
      "Your crew is getting ProDeck as a real app. It finds your booth on the church wifi, even on networks that hide it, remembers the church, and buzzes for pages with the phone locked. Someone who serves at two churches can switch between them.",
    steps: [
      "Nothing to do yet. It's in the works for the App Store and Google Play.",
      "Until then, volunteers join from the crew poster in their phone's browser, and everything here works there.",
      "When it arrives, they scan the same crew code, so print the poster now.",
    ],
    settings: "set-crew",
    settingsLabel: "Show the crew code",
    help: "crew-joining",
  },
  {
    id: "pages",
    art: "page",
    tone: "live",
    title: "Pages that get through",
    tagline: "On the lock screen, until they tap Got it.",
    what:
      "A page to everyone now reaches the whole team on this week's plan, even people who haven't opened ProDeck today, and the composer shows who has notifications off before you send. It keeps buzzing until they tap Got it.",
    steps: [
      "Nothing to set up at the booth.",
      "On each phone, turn on More, Page notifications.",
      "Send one from Messages with Page.",
    ],
    help: "pages",
  },
  {
    id: "comms",
    art: "comms",
    tone: "good",
    title: "Comms on every phone",
    tagline: "Hold to talk, or open mic with Mute.",
    what:
      "Crew phones and iPads become an intercom with four lines: All, Cameras, Stage and Booth. Hold the big button to talk, or turn on Open mic and use Mute. An iPad on a camera joins under the camera's name. The booth computer never plays comms, so nothing reaches the house.",
    steps: [
      "Settings, Crew & screens, Comms: turn it on.",
      "Give the booth a secure address so phones allow the microphone.",
      "On a phone: More, Comms, Join comms. Earbuds stop feedback.",
    ],
    settings: "set-comms",
    settingsLabel: "Turn on comms",
    help: "comms",
  },
  {
    id: "tally",
    art: "tally",
    tone: "live",
    title: "Any phone is a tally light",
    tagline: "Red for live, green for next.",
    what:
      "A crew phone becomes its camera's tally light, straight from the switcher. While it's a tally it makes no sound and never vibrates, so nothing shakes the shot, and a page shows as a quiet strip across the top. An iPad can show every camera at once.",
    steps: [
      "Connect your ATEM in Settings, Connections.",
      "On a crew phone: More, Tally light, then pick the camera.",
      "For a camera with nobody signed in, make a code in Settings, Camera tally and scan it.",
    ],
    settings: "set-tally",
    settingsWithoutAtem: "set-atem",
    settingsLabel: "Camera tally settings",
    help: "atem-tally",
  },
  {
    id: "secure",
    art: "lock",
    tone: "accent",
    title: "A secure address in one click",
    tagline: "yourchurch.local.prodeck.live",
    what:
      "Phones only allow comms, a camera's microphone and notifications on a secure address. Claim a name and the booth gets one in about a minute. It stays inside your building, follows the computer if its address changes, and renews itself.",
    steps: [
      "Settings, Crew & screens, Secure local address.",
      "Type a name, check it's free, and press Claim this address.",
      "Every crew link, poster and tally code switches to it by itself.",
    ],
    settings: "set-local",
    settingsLabel: "Claim an address",
    help: "secure-local",
  },
  {
    id: "tv",
    art: "tv",
    tone: "accent",
    title: "Dashboards on any TV",
    tagline: "Fire TV Stick or Android TV box.",
    what:
      "Put the free ProDeck Display app on a green room TV, pair it with a code and pick a dashboard. It opens by itself every time, even after a power cut. From the booth you can change what each TV shows, send a message across the screens, and update the TV app.",
    steps: [
      "Settings, Crew & screens, TV screens has the install steps.",
      "The TV shows a code. Type it on the booth and choose a dashboard.",
      "When a new TV app is ready, press Update all there.",
    ],
    settings: "set-tv",
    settingsLabel: "Add a TV",
    help: "tv-screens",
  },
  {
    id: "poster",
    art: "poster",
    tone: "warn",
    title: "The crew poster always works",
    tagline: "Scan, ask to join, you approve.",
    what:
      "Scanning the poster while joining was closed used to be a dead end. Now people ask to join with a name and PIN, you approve them from the banner, and their phone is in straight away.",
    steps: [
      "Settings, Crew Members, Crew invite link: Print poster.",
      "Hang it in the booth or the green room.",
      "Approve new people from the banner or under Crew Members.",
    ],
    settings: "set-crew",
    settingsLabel: "Print the poster",
    help: "crew-joining",
  },
  {
    id: "ipad",
    art: "ipad",
    tone: "accent",
    title: "Crew view on iPad",
    tagline: "Comms and tally on a bigger screen.",
    what:
      "An iPad can switch to the crew layout: comms, the tally light and the phone tabs, sized for the iPad. Switch between Crew view and Full view whenever you like.",
    steps: [
      "Open the crew link on the iPad.",
      "Full view at the bottom of More shows every page and dashboard.",
      "Crew view at the bottom of the sidebar switches back.",
    ],
    help: "phones-install",
  },
  {
    id: "screens",
    art: "screens",
    tone: "good",
    title: "Calmer crew screens",
    tagline: "A tidier phone app for everyone.",
    what:
      "A calmer Home, every dashboard on the phone, More with icons, and a bottom bar you can tap anywhere. Tap the tab you're on to jump back to the top.",
    steps: ["Nothing to do. Phones pick it up the next time they open ProDeck."],
  },
];

export const ALSO_NEW: Feature[] = [
  {
    id: "atem",
    icon: "grid",
    tone: "live",
    title: "More from your ATEM",
    tagline: "Keys, Fade to Black and macros.",
    what:
      "Downstream keys and Fade to Black on the ATEM tile, an ATEM Macros tile that Stream Deck can run too, switchers with more than one M/E, and a tile you arrange your way.",
    steps: ["Settings, Connections, ATEM Switcher, then add the tiles while editing a dashboard."],
    settings: "set-atem",
    help: "atem",
  },
  {
    id: "pro",
    icon: "slides",
    tone: "warn",
    title: "ProPresenter macros and view only",
    tagline: "Every macro as a button.",
    what:
      "A tile with every ProPresenter macro in the colour you gave it. And one switch lets ProDeck watch ProPresenter without ever changing it, for a second computer.",
    steps: ["Add the ProPresenter Macros tile while editing a dashboard. View only is in Settings, Connections, ProPresenter."],
    settings: "set-pp",
    help: "pp-macros",
  },
  {
    id: "tiles",
    icon: "dashboard",
    tone: "accent",
    title: "Tiles that fit any shape",
    tagline: "Wide, tall, small or on a phone.",
    what: "Every tile rearranges itself instead of squashing. Kiosks and TVs scale a tall dashboard down evenly so it fits the screen.",
    steps: ["Nothing to do. Resize tiles while editing a dashboard."],
    help: "dashboards-widgets",
  },
  {
    id: "analytics",
    icon: "report",
    tone: "accent",
    title: "Analytics that know the service",
    tagline: "Decided by the clock.",
    what: "ProDeck works out which service it is by the time. Rehearsals go to the day's Practice report, and NFC taps are counted once.",
    steps: ["Nothing to reset. It uses your Planning Center service times."],
    help: "analytics-services",
  },
  {
    id: "qu",
    icon: "mic",
    tone: "accent",
    title: "Allen & Heath Qu consoles",
    tagline: "The newest Qu desks.",
    what: "ProDeck mirrors a Qu's mutes, faders and scenes, just like an SQ or Avantis. The desk light names your console and says why when it can't reach it.",
    steps: ["Settings, Connections, Sound Console."],
    settings: "set-avantis",
    help: "console",
  },
];

/**
 * Supporting White Oak Media, who give ProDeck away. The same public page as
 * the sidebar's Support ProDeck link (lib/tip.ts); booth only, like the rest
 * of the showcase.
 */
export const SUPPORT = {
  /** Under the hero and in the top bar. */
  heroLine: "Free for every church, thanks to the people who support it.",
  kicker: "Keep ProDeck free",
  title: "Everything on this page is free. Help keep it that way.",
  text:
    "ProDeck is a gift from White Oak Media to every church, with no subscription. Donations from churches like yours pay for the time it takes to build what comes next.",
  points: [
    "Bring ProDeck Crew to the App Store and Google Play.",
    "Build the features churches ask for, like everything on this page.",
    "Keep ProDeck free for every church, big or small.",
  ],
  button: "Support ProDeck",
  url: TIP_URL,
};

/** Where "Set it up" goes: tally settings only exist once an ATEM is on. */
export function settingsTarget(f: Feature, atemOn: boolean): string | undefined {
  if (!atemOn && f.settingsWithoutAtem) return f.settingsWithoutAtem;
  return f.settings;
}

/** Every string a viewer sees, for the copy rules test. */
export function allCopy(): string[] {
  const out = [HERO.kicker, HERO.title, HERO.sub, HERO.footer, SUPPORT.heroLine, SUPPORT.kicker, SUPPORT.title, SUPPORT.text, ...SUPPORT.points, SUPPORT.button];
  for (const f of [...HEADLINERS, ...ALSO_NEW]) {
    out.push(f.title, f.tagline, f.what, ...f.steps);
    if (f.settingsLabel) out.push(f.settingsLabel);
  }
  return out;
}
