/**
 * ProDeck's help, as data.
 *
 * This is the single source of truth for in-app help: the Help page renders it,
 * search indexes it, the `?` on every Settings card jumps into it, and when a
 * Gemini key is configured the assistant answers ONLY from it. Keep it plain and
 * specific: name the page, the card, the button. The reader is usually a
 * volunteer with a service starting soon.
 *
 * Body markup is deliberately tiny: a line starting "- " is a bullet, "1. " is a
 * numbered step, "> " is a callout, and **text** is bold. Nothing else.
 *
 * House rules for anything a user reads here: plain words, no dashes as
 * punctuation, at most one exclamation mark. Settings paths are written
 * "Settings, Crew & screens, Comms" (section, then card).
 *
 * `aliases` are the ways someone might actually ask. Search scores them
 * heavily, so write them as questions and phrases, not keywords.
 */

export type HelpGroup =
  | "Getting started"
  | "ProPresenter"
  | "Planning Center"
  | "Phones & kiosks"
  | "Crew"
  | "TapLink"
  | "Sound console"
  | "Video"
  | "Audio"
  | "Dashboards"
  | "Updates & backup"
  | "Troubleshooting"
  | "Security";

export const HELP_GROUP_ORDER: HelpGroup[] = [
  "Getting started",
  "Crew",
  "TapLink",
  "ProPresenter",
  "Planning Center",
  "Phones & kiosks",
  "Dashboards",
  "Sound console",
  "Video",
  "Audio",
  "Updates & backup",
  "Troubleshooting",
  "Security",
];

export interface HelpTopic {
  id: string;
  group: HelpGroup;
  title: string;
  /** Question-shaped phrasings; weighted heavily in search. */
  aliases: string[];
  body: string;
  /** Settings card anchor (id of the <h3>) this topic is about, if any. */
  settings?: string;
  /** Section of the Adopter's Guide with the long-form version. */
  guide?: string;
  related?: string[];
}

export const HELP_TOPICS: HelpTopic[] = [
  // ------------------------------------------------------------ getting started
  {
    id: "what-is-prodeck",
    group: "Getting started",
    title: "What ProDeck is, in one page",
    aliases: ["what does prodeck do", "overview", "what is this app for", "features", "what can it connect to"],
    body: `ProDeck is the production booth in one place. It runs on the booth computer, connects to the things a service runs on, and puts what they know onto dashboards anyone on the team can see: on the booth screen, on a phone, or on a TV in the green room.

- **ProPresenter:** the live slide, timers, layers, stage messages, macros and child calls. Read and control, or view only.
- **Planning Center Services:** the plan, the team, call times, chord charts and LIVE control.
- **Sound console:** Allen & Heath Avantis, dLive, SQ and Qu; Behringer X32, Midas M32 and Behringer WING; Yamaha CL, QL and TF (view only for now). Mutes, faders, names and scenes.
- **Video:** Blackmagic ATEM switchers (Program, Preview, keys, macros), camera tally on any phone or iPad, OBS Studio, NDI cameras and your Resi stream.
- **Church Online Platform:** your online service's countdown, who watched and chatted, prayer requests and salvation responses, with pages to the prayer team.
- **Your crew:** the ProDeck Crew app (iPhone, iPad and Android), or the same thing in a phone's browser. Check in, chat, pages that ring until someone answers, comms, a tally light, chord charts and checklists.
- **TV screens:** any dashboard on a Fire TV Stick or Android TV box, and messages to the green room in big type.
- **TapLink:** NFC discs in the lobby that always open the right link for the moment in the service.
- **Walk-in music:** Spotify or Apple Music on the booth computer, faded out by itself before each service.
- **Reports:** what actually happened each Sunday: timing, SPL, tap counts.

Nothing needs an account or a licence. The booth computer holds everything; phones and TVs talk to it over your Wi-Fi, and your church's crew address lets the crew see the week from anywhere.`,
    guide: "top",
    related: ["first-run", "setup-page", "whats-new"],
  },
  {
    id: "first-run",
    group: "Getting started",
    title: "The first-run setup, and how to run it again",
    aliases: ["setup wizard", "onboarding", "how do I start over", "re-run setup", "I skipped a step", "walkthrough"],
    body: `The first time ProDeck opens it walks you through connecting each tool, one step at a time, and actually connects them. It doesn't just tell you where to click later. Every step can be skipped, and your progress is saved if you close it part way.

**To run it again:** **Setup** in the sidebar, then **Re-run the walkthrough** under *Add the rest*. Nothing you've already set up is touched; each step shows what is connected and lets you change it.

> The **Setup** page is also the place to look when something isn't green. One row per connection, what the state means, and the one thing to try.`,
    related: ["setup-page", "demo-mode"],
  },
  {
    id: "whats-new",
    group: "Getting started",
    title: "What's new: the tour after an update",
    aliases: ["whats new", "what's new", "new features", "what changed", "release notes", "tour", "show me the new stuff"],
    body: `After an update that brings new features, the booth opens **What's new in ProDeck**: a short animated tour of everything added, with where to turn each thing on.

- Each card has **How to set it up** in a few steps, a button that jumps straight to the right Settings card, and **Read more** for the full help topic.
- **Open it again any time** with **What's new** at the top of the Help page, or **Settings, App & help, Help & support, What's new**.
- It only opens on the booth computer, never on phones, kiosks or TVs, and never while a service is running by the clock. It waits until the service is over.
- A brand new install skips it: everything is new, and the Setup page is the better first screen.

The full list of changes for each version is in the release notes the update banner shows.`,
    settings: "set-help",
    related: ["updates", "what-is-prodeck"],
  },
  {
    id: "back-navigation",
    group: "Getting started",
    title: "Going back to where you were",
    aliases: ["back button", "go back", "previous screen", "swipe back", "command [", "mouse back button", "how do I get back"],
    body: `Back takes you to the screen you were on before, on the booth and on phones.

**On the booth computer:**
- Press **Command and [** on a Mac (**Ctrl and [** on Windows).
- Use the **back button** on a mouse that has one.
- Or click the **arrow next to the ProDeck logo** at the top of the sidebar.

**On a crew phone:**
- **Swipe in from the left edge** of the screen to go back one screen. This works in the ProDeck Crew app and in ProDeck added to the Home Screen.
- On Android, the phone's own **back** gesture or button works too.
- The Leader board has its own **Back** arrow at the top.

Tapping the tab you're already on, in the bar along the bottom of a phone, jumps back to the top of that tab.`,
    related: ["crew-app", "phones-install"],
  },
  {
    id: "mac-permissions",
    group: "Getting started",
    title: "macOS asked for permission: what to allow",
    aliases: ["local network", "allow access", "microphone permission", "removable volume", "desktop folder", "ProPresenter offline after update", "no route to host", "macOS 27", "tahoe", "sequoia", "privacy and security", "open anyway", "signed", "notarized"],
    body: `ProDeck runs on macOS 10.15 and newer and is tested on the current release, macOS 27. ProDeck for Mac is **signed and checked by Apple**, so it opens like any other app, with no trip to Privacy & Security first.

The first time it needs something, macOS asks. **Allow each one:**

- **Local network:** ProPresenter, your sound console, Dante, NDI, Companion and your team's phones. Without it ProDeck can reach nothing but itself: every light goes grey and Dante devices say "no route to host".
- **Microphone:** your audio input (a Dante card, a console's USB audio) for SPL, RTA, Auto-Follow, the stream report and recording.
- **Desktop, Documents, Downloads:** ProDeck looks there for console show files and Dante presets you save, to keep the routing map current.
- **Removable volumes:** recording to an external drive, and show files on a USB stick.
- **Automation:** only if you use Walk-in Music, so ProDeck can control Spotify or Music.

Said **Don't Allow** by mistake? **System Settings, Privacy & Security**, then Local Network (or Microphone, Files and Folders, or Automation), switch ProDeck on, then quit and reopen ProDeck.

> The first update to the signed version may ask once more for things you allowed before, like the Downloads folder or the microphone. Choose Allow, and later updates keep your answers.`,
    related: ["setup-page", "first-run", "updates"],
  },
  {
    id: "setup-page",
    group: "Getting started",
    title: "The Setup page: is everything connected?",
    aliases: ["status page", "why is something red", "what does attention mean", "connection status"],
    body: `**Setup** in the sidebar shows one row per thing ProDeck talks to, with a live state:

- **Connected:** working now.
- **Not set up:** you haven't set it up. That's fine; only connect what you use.
- **Attention:** set up, but something is off (a plan isn't selected, the console dropped, OBS closed).
- **Problem:** it's set up and failing. The row says what to try.

Each row jumps to the Settings card where it's set up. Come here before asking anyone: nine times in ten the answer is on this page. Further down, **Add the rest** has the step by step setup for recording and Automix, and **Re-run the walkthrough**.`,
    related: ["first-run"],
  },
  {
    id: "demo-mode",
    group: "Getting started",
    title: "Demo mode: see it working before connecting anything",
    aliases: ["try it without hardware", "sample data", "how do I see what it does", "explore"],
    body: `Demo mode fills every dashboard with a pretend Sunday (a plan, a team with check-ins, a live slide, sound levels, a mirrored console) so you can see what ProDeck does before wiring up your booth.

Turn it on from the welcome screen, or **Settings, App & help, Help & support, Try demo mode**. A banner stays up the whole time. It saves nothing and can't touch your equipment. **Exit demo** in the banner puts everything back.

The ProDeck Crew app has its own **Try a demo** on its first screen, for a volunteer who wants a look before joining.`,
    settings: "set-help",
  },

  // -------------------------------------------------------------------- crew
  {
    id: "crew-overview",
    group: "Crew",
    title: "How the crew system works",
    aliases: [
      "how do volunteers sign in",
      "what is a crew member",
      "how does the phone app work",
      "explain crew accounts",
      "member vs admin",
    ],
    body: `Three separate things decide what a phone can do, and it helps to keep them apart.

**1. The gateway password: what a phone may DO.** There are two. The **admin** password is full control: ProPresenter, console, settings, sending pages. The **crew (member)** password is for looking, chatting, checking in, confirming pages and seeing the plan. A phone gets one of these once, usually from the crew code, so nobody types it. Set both in **Settings, Crew & screens, Browser Access**.

**2. A crew account: WHO the phone is.** Each volunteer picks their name and a 4-digit PIN. That name is what appears on chat messages, who a page is addressed to, and who the leader board says has arrived. Accounts live in **Settings, Crew & screens, Crew Members**.

**3. Grants: what a specific person may do beyond looking.** On top of the crew password, you can give one person's account permissions: **Page**, **Stage**, **Control**, **Tap discs**, **Manage crew**. Set them per person under **Crew Members, Edit**. A volunteer with no grants is a viewer, which is what most of the team should be.

**How volunteers get in.** They install the **ProDeck Crew** app (App Store or Google Play) and scan your crew code, or scan it with the phone's camera and use ProDeck in the browser. Either way joining does the first two at once: the code carries the crew password, and the volunteer then creates their account. New accounts wait for your approval unless they came in through a personal invite.`,
    settings: "set-crew",
    guide: "phase1",
    related: ["crew-joining", "crew-app", "crew-approve", "crew-roles", "crew-permissions", "gateway-passwords"],
  },
  {
    id: "crew-permissions",
    group: "Crew",
    title: "Permissions: letting one person page, control, or manage",
    aliases: [
      "give someone permission to page",
      "who can send pages",
      "let a volunteer control propresenter",
      "needs the page permission",
      "needs the control permission",
      "needs admin access on my phone",
      "grants",
      "per person permissions",
    ],
    body: `Every phone signed in with the crew password is a **viewer**: dashboards, the plan, chat, check-in, confirming pages, cameras. The admin password unlocks everything. In between, you can grant one person exactly what their job needs, without handing them the admin password.

**Settings, Crew & screens, Crew Members**, press **Edit** on the person, then tick:

- **Page:** send pages and re-buzz them. Give this to whoever runs the room, not to everyone.
- **Stage:** put text on the stage displays, confidence screens and TV screens, and clear it. Kids ministry, for child alerts.
- **Control:** drive ProPresenter (next and previous, clear, macros, looks, child calls), the sound console, the ATEM switcher, OBS scenes, walk-in music and Planning Center LIVE. Your ProPresenter operator, director and worship leader.
- **Tap discs:** override where the lobby NFC discs point.
- **Manage crew:** approve, edit and remove crew, create invites, open joining. Your team lead. It does **not** include granting permissions; only the admin password can grant.

Grants take effect on their phone within a few seconds, no sign out needed. Revoking approval removes every grant at once. If a phone says *"needs the page permission"* (or control, or stage), that's exactly what to tick.

> Why not just give them the admin password? Because it can't be taken back from one person: you'd change it for everyone. A grant can be taken back.`,
    settings: "set-crew",
    related: ["crew-overview", "gateway-passwords", "pages"],
  },
  {
    id: "crew-joining",
    group: "Crew",
    title: "Getting a volunteer onto their phone",
    aliases: [
      "how do people join",
      "join link",
      "the poster QR code",
      "crew code",
      "scan crew code",
      "invite someone",
      "joining is closed",
      "why does the join link not work",
      "open joining",
      "ask to join",
    ],
    body: `There are two ways in: the crew poster for everyone, and a personal invite for one person.

**The crew poster (one crew code for everything).** **Settings, Crew & screens, Crew Members**, under **Crew invite link**, shows the QR code and a **Print poster** button. Hang it in the booth or the green room. The same code is on the Join QR tile for TVs and kiosks. When your crew address is on, the code points at it, so it works from anywhere:

- **An iPhone or iPad** with ProDeck Crew opens straight into your church. Without the app, it offers **Get ProDeck Crew** from the App Store, with **Continue in the browser** one tap away.
- **An Android phone** does the same, with Google Play.
- Either way the person picks their name and a PIN, and **you approve them once**.

**While joining is closed** (the usual state), the poster still works: people ask to join with a name and PIN, a banner appears at the booth, and they wait under **Crew Members** for approval. The moment you approve them, their phone is let in, as long as they keep the page open (or scan again). **While joining is open** (press **Open for 15 min** or **1 hour** on the same card, handy at a volunteer meeting), scanning lets people straight in. Anyone already joined is unaffected.

> Why not always let people straight in? The poster has nobody to ask for a password, and it can be scanned from anywhere. So while joining is closed nobody gets in until you approve them, and only a dozen requests can wait at once.

**A personal invite (one person).** On the same card, **Personal invites**: type their name and role, press Create, and send them the link. It's good for a week, works once, and they arrive **pre-approved** with name and role filled in: the invite is the approval. Best for new team members you already know.

Someone who already has an account and gets a new phone just signs in with the same name and PIN.`,
    settings: "set-crew",
    related: ["crew-app", "crew-approve", "crew-signout", "gateway-passwords", "crew-address"],
  },
  {
    id: "crew-app",
    group: "Crew",
    title: "ProDeck Crew: the volunteer app for iPhone, iPad and Android",
    aliases: [
      "prodeck crew",
      "crew app",
      "app store",
      "google play",
      "android app",
      "iphone app",
      "download the app",
      "install the app",
      "allow local network",
      "no booth found",
      "two churches",
    ],
    body: `**ProDeck Crew** is ProDeck as a real app for your volunteers, free on the **App Store** (iPhone and iPad) and **Google Play** (Android). It does everything the crew pages in a browser do, and it's the best way to get pages with the phone locked.

**On a big screen.** Open an iPhone Duo, or use an iPad, and the tabs move to a sidebar on the left. Chat keeps the channel list beside the conversation, and with room for both (iPhone Duo turned sideways, an iPad) More keeps its list beside the screen it opens. Fold the phone and it goes back to the phone layout, right where you were.

**Getting started:**
1. Search the App Store or Google Play for **ProDeck Crew** and install it. (Or scan your crew poster with the phone's camera: it offers the app.)
2. Open it and tap **Scan crew code**, then scan the crew poster. Or tap **Find on this Wi-Fi** at church to find the booth, or **Enter address** to type it (Settings, Crew & screens, Browser Access shows it).
3. Pick your name and a PIN, and wait for the booth to approve you, unless you came in with a personal invite.

**What the app adds:**
- **It remembers your church** and opens straight into it, at church or away. With the booth computer off, it opens your crew address's copy of the week. Someone who serves at two churches can add both and switch between them.
- **Pages you can't miss.** A page has its own alert sound and rings again with each repeat until you tap **Got it**. With the app open, it rings and shows a banner.
- **Got it from the lock screen.** On an iPhone, swipe the notification left, tap **View**, then **Got it**. On Android, **Got it** is a button right on the notification. Either way it's confirmed without opening the app.

**If it can't find the booth:**
- **"Allow Local Network"** on an iPhone means the app was told not to look at devices on the Wi-Fi. Open the phone's **Settings, Privacy & Security, Local Network** and turn on ProDeck Crew, then tap **Look again**.
- **"No booth found"** means ProDeck isn't open at the booth, or the phone isn't on the church Wi-Fi. Scanning the crew code works from anywhere when your crew address is on.

> On an iPhone set to silent, a page only buzzes if **Settings, Sounds & Haptics, Haptics** is set to **Always Play**. The app shows this tip once after page notifications are turned on.`,
    related: ["crew-joining", "pages", "phones-install", "crew-address"],
  },
  {
    id: "crew-approve",
    group: "Crew",
    title: "Approving, editing and removing crew",
    aliases: [
      "pending approval",
      "someone is waiting",
      "how do I approve a volunteer",
      "remove a crew member",
      "change someone's name",
      "link to planning center person",
    ],
    body: `**Settings, Crew & screens, Crew Members** lists everyone. A **pending** badge on Settings in the sidebar means someone is waiting.

- **Approve:** makes the account live. Until then their phone shows a waiting screen.
- **Edit:** fix a typo in a name without breaking their PIN, add a **nickname** (it also works to sign in), set their **role**, choose exactly which **Planning Center person** they are, and give them permissions. A link you set by hand is pinned; the weekly automatic matching never overwrites it.
- **Remove:** signs that phone out and deletes the account. Their chat history stays.

If someone forgets their PIN there is no reset: remove the account and have them join again. PINs identify people; the gateway password is what protects anything.`,
    settings: "set-crew",
    related: ["crew-roles", "crew-signout", "crew-permissions"],
  },
  {
    id: "crew-roles",
    group: "Crew",
    title: "Roles: what they do and how to set yours",
    aliases: [
      "what is a role",
      "camera 1 audio a2",
      "role channels",
      "how do roles work",
      "set up positions",
      "leader board",
    ],
    body: `A role is what a person is doing this Sunday: "Camera 1", "Audio A2", "Lyrics", "Stage". Roles drive three things:

- **The leader board** sorts by exception: "Camera 1, not here yet" is something you can act on in a way "Sam, not here yet" isn't.
- **Role channels in chat.** Every role gets its own conversation ("role:Camera") next to the team channel, so the camera ops can talk without paging the whole crew.
- **Checklists.** A checklist can be assigned to a role so the right people see it on their phone.

**Your church's roles** live in **Settings, Crew & screens, Crew Members, Roles you use**. They appear as suggestions wherever a role is typed: when a volunteer joins, when you edit a person, on a personal invite. Any text is still allowed; the list just keeps spelling consistent so the board and the channels don't split into "Camera 1", "Cam 1" and "camera1".

> Where possible, roles come from Planning Center: when a phone picks their name off this week's team, their position becomes their role automatically.`,
    settings: "set-crew",
    related: ["crew-overview", "crew-approve"],
  },
  {
    id: "crew-signout",
    group: "Crew",
    title: "Signing out, forgetting a device, and getting back in",
    aliases: [
      "locked out",
      "PIN again",
      "sign out completely",
      "name is taken",
      "too many attempts",
      "I can't log back in",
      "new phone",
    ],
    body: `On the phone, **More** has two different exits:

- **Lock (PIN again):** keeps the account on this phone and asks for the PIN next time. Use this on a shared device.
- **Sign out completely:** forgets the account on this phone. Your account still exists at the booth; scan the poster or open the app again and **sign in with the same name and PIN**.

**A new phone?** Sign in with your name and PIN; there's no need to join again. If you type your own name and see *"that name is taken"*, the app tries your PIN against the existing account. That IS the sign in.

**Locked out after wrong PINs.** Five wrong attempts locks that name for five minutes. Wait it out; a fresh streak starts after. If a volunteer has really forgotten their PIN, remove the account at the booth and have them join again.`,
    related: ["crew-approve", "crew-joining"],
  },
  {
    id: "pages",
    group: "Crew",
    title: "Pages: paging one person, and confirming",
    aliases: [
      "page someone",
      "how do pages work",
      "phone won't stop buzzing",
      "got it button",
      "page not arriving",
      "re-buzz",
      "notifications off",
      "page everyone",
      "page sound",
    ],
    body: `A page is the emergency channel: it takes over the recipient's phone and keeps ringing until they tap **Got it**.

**Sending one.** On the booth, open **Messages** in the sidebar and press **Page someone**. On a phone with the admin password or the **Page** permission, send one from **Chat**. Pick people (or a role, or everyone), pick a preset or type, and send.

- **Got it** confirms. The sender sees who has and hasn't, and can **Re-buzz** the rest.
- In the **ProDeck Crew** app a page has its own alert sound, rings again with each repeat until it's confirmed, and can be confirmed from the lock screen. See *ProDeck Crew: the volunteer app*.
- In a phone's browser (ProDeck added to the Home Screen), pages arrive as a **lock-screen notification** if that phone turned notifications on. On an iPhone the notification is the buzz, because Safari has no vibration control.
- A page the booth can no longer accept a confirmation for (the booth restarted, or it's old) shows **Dismiss** instead of ringing forever.

**Who gets a page to everyone.** **This Sunday** means everyone checked in **and** everyone scheduled on this week's Planning Center plan, whether or not they've opened ProDeck today. People off the plan are left out unless you tick **Include people not here or on this week's plan**.

**Pages not arriving?** A page only reaches a locked phone if that phone turned notifications on. The composer marks those people **notifications off** before you send; they'll only see the page with ProDeck open. On the phone: **More, Page notifications** must say **on**. In a browser the app must be added to the Home Screen and on the secure address. On the booth: **Crew Members** shows the person as approved.

For pages that go out by themselves at a set time, see *Scheduled alerts*.`,
    related: ["crew-app", "scheduled-alerts", "crew-overview", "phones-install"],
  },
  {
    id: "scheduled-alerts",
    group: "Crew",
    title: "Scheduled alerts: pages that send themselves",
    aliases: [
      "scheduled alerts",
      "scheduled page",
      "automatic page",
      "page before service",
      "five minutes before service",
      "remind the team",
      "mic check page",
      "only people who have checked in",
      "every service",
    ],
    body: `A scheduled alert is a real page that ProDeck sends at a set time: "Mic check, all positions" 30 minutes before, "Places" 5 minutes before. Set them up in **Settings, Crew & screens, Scheduled alerts** and press **Add alert**.

For each alert:

- **When:** **Before service** and a number of minutes (a negative number means after the start), or **At a time** of day.
- **Before service fires for every service time** on the day's plan, not just the first. Two services on Sunday morning means it pages before each one.
- **What it says**, and **Buzz until read** to keep it ringing until people tap Got it.
- **Which service:** **Any service**, or one service type from Planning Center, and which **days** it runs (none picked means any day). Scoping keeps a Sunday alert out of the way of a midweek service.
- **Who:** pick people from your crew, or choose a **Planning Center team**. A team alert follows whoever is on this week's plan, so you never update the list.

**Team alerts reach everyone on the plan.** Everyone from that team on this week's plan is paged, in the ProDeck Crew app on locked phones, whether or not they've checked in yet. Tick **Only people who have checked in** to page just the people already here.

Under each alert a line says when it will next fire. Each alert fires once per service.`,
    settings: "set-schedule",
    related: ["pages", "crew-app", "pco-connect"],
  },
  {
    id: "messages",
    group: "Crew",
    title: "Messages: the team, the stage and the screens",
    aliases: [
      "messages",
      "chat",
      "team chat",
      "send a message",
      "message the stage",
      "confidence banner",
      "message to the tv",
      "message all screens",
    ],
    body: `**Messages** in the booth's sidebar is the crew chat, and the way to put words on a screen. Choose where a message goes in the box above the typing line:

- **Team:** the crew chat everyone sees on their phones. The booth signs its messages as **Booth**.
- **Stage:** text on ProPresenter's stage displays.
- **Confidence:** a banner across the confidence screens.
- **Kiosks and TV screens:** **All screens**, or one dashboard's screens (say **Green Room screen**). It goes across those screens in big type with a soft chime, and comes down after three minutes, when you send another, or when you press **Clear**.

**Page someone** on the same line sends a page instead, which rings until it's confirmed.

On a phone, **Chat** is the team channel and the role channels. Sending to the stage or the screens needs the admin password or the **Stage** permission; crew phones can always chat with the team.

The booth computer never plays the screen chime itself, so nothing reaches the house.`,
    related: ["pages", "stage-message", "tv-screens", "crew-roles"],
  },
  {
    id: "next-slide",
    group: "Crew",
    title: "Next Slide, the game for while the booth is off",
    aliases: ["next slide", "game", "leaderboard", "nickname", "streak", "something to do while waiting"],
    body: `**Next Slide** is a small game for crew while the booth computer is off. A lyric line lights up word by word on a pretend stage screen; tap **Next slide** right as the last word is sung. It gets quicker with every slide. It's silent, so it's fine to play in the room.

**Where it is:** on the crew screen people see while the booth is off (from the crew address, or in ProDeck Crew), press **Play Next Slide**.

**The leaderboard** covers every church using ProDeck, this week (from Monday morning) and all time. Nobody is on it unless they choose to be: save a nickname under **Your name on the board** and your best streak goes up. The board shows your nickname, your church's crew name and your best streak. **Change** renames you.`,
    related: ["crew-address"],
  },
  {
    id: "comms",
    group: "Crew",
    title: "Comms: talking to the crew from phones",
    aliases: ["comms", "intercom", "headset", "talk to the crew", "push to talk", "hold to talk", "open mic", "party line", "clearcom", "radio"],
    body: `Comms turns crew phones and iPads into a hold to talk intercom. It's **off until you turn it on** in **Settings, Crew & screens, Comms**; leave it off if your team already has an intercom, and it appears nowhere.

**On a phone:** **More, Comms, Join comms**, allow the microphone, pick the line to talk on, and hold the big button while you speak.

- **Four lines:** **All**, **Cameras**, **Stage** and **Booth**. Choose which ones you listen to; everyone hears All unless they turn it off.
- A chip at the top of every screen shows who's talking and has its own **Talk** button.
- **Open mic** is for hands-free comms: you talk without holding anything until you turn it off, and the big button (and the chip's) becomes **Mute** and **Unmute**. Open mic always starts muted when you join, so a mic never opens by itself.

Phones talk straight to each other over the church Wi-Fi, so the delay is a fraction of a second. ProDeck only connects them, and the booth computer never plays comms: it can't reach the house.

**What it needs:**

- **A secure address.** Phones only allow the microphone on https. Claim a **secure local address** in Settings (it takes a minute, nothing to set up), or use your own public address. On the plain local address, Join comms explains this instead of starting.
- **Phones on the church Wi-Fi.** A phone on cellular still joins, but it can't reach the other phones, so nobody hears it. A guest network that keeps devices apart does the same. Use the staff network. **On comms** says **can't reach** next to anyone this happens with.
- **The app open, screen on.** A locked iPhone stops a web app's sound and microphone. Comms suits people at a post with the phone in view, like a camera operator using the phone as a tally. Use earbuds so the phone's speaker doesn't feed back into its mic.

**Camera stations.** An iPad that lives on a camera doesn't need anyone's account. Make its code in **Settings, Crew & screens, Camera tally**, scan it on the iPad, add it to the Home Screen, and tap the tally once to **Join comms**. It shows up on comms under the camera's name, with Talk or Mute in the corner and Open mic in the tap menu, and rejoins by itself (muted) whenever it reopens. Plug a headset into it, set Auto-Lock to Never, and use Guided Access to keep it on the tally.

A device that was on comms rejoins by itself when it reopens. If the phone wants a tap before it hands over the microphone, it shows **Tap to rejoin comms**. **Leave comms** stops that until you join again.

Up to 16 devices can be on comms at once.`,
    settings: "set-comms",
    related: ["atem-tally", "secure-local", "pages", "phones-install"],
  },

  // ------------------------------------------------------------------ taplink
  {
    id: "taplink-overview",
    group: "TapLink",
    title: "What TapLink is",
    aliases: [
      "nfc discs",
      "tap disks",
      "what is taplink",
      "giving link that changes",
      "overflow tap",
      "lobby discs",
    ],
    body: `TapLink is NFC discs in your lobby that all open **one** link, and that link's destination follows the service. When the giving slide goes live in ProPresenter, every disc in the building points at giving. When the sermon notes slide is up, they point at notes. Afterwards they fall back to your default (usually a connect card).

The discs themselves are simple: each one is written once with a link like **https://go.yourchurch.org/now** and never rewritten. All the thinking happens on a tiny web service ("the edge") that you deploy once on Cloudflare's free tier. ProDeck tells it what's live; it redirects taps to match and counts them.

You need three things: **a Cloudflare account** (free), **a computer with Node.js** to deploy from (once), and **NFC discs or stickers** (NTAG213 or better, a few dollars each). Set it up in **Settings, Online, TapLink**.`,
    settings: "set-taplink",
    guide: "phase3",
    related: ["taplink-deploy", "taplink-discs", "taplink-keywords", "taplink-override"],
  },
  {
    id: "taplink-deploy",
    group: "TapLink",
    title: "Deploying your own TapLink edge",
    aliases: [
      "edge url",
      "api token",
      "cloudflare worker",
      "wrangler",
      "how do I set up taplink",
      "where do I get the token",
    ],
    body: `**Settings, Online, TapLink** walks you through this with the exact commands to copy. In outline:

1. Get the ProDeck source (**ProDeck on GitHub** in Settings, App & help, Help & support) and open the **taplink-edge** folder in a terminal.
2. \`npm install\`, then \`npx wrangler login\`. It opens Cloudflare in your browser; a free account is fine.
3. \`npx wrangler deploy\`. It prints your worker's address: that's your **Edge URL**.
4. Create a token and store it as a secret: \`openssl rand -hex 32 | npx wrangler secret put TAPLINK_TOKEN\`. The value it printed is your **API token**. Paste the same value into ProDeck.
5. Optional: a short domain like **go.yourchurch.org**. Uncomment \`routes\` in wrangler.jsonc, set your domain, and deploy again. Cloudflare creates the DNS record.

Back in **Settings, Online, TapLink**, paste the Edge URL and token and press **Save & test connection**. Green means the edge is reachable and the token works. Then set your links (**Keywords & links**) and write the discs.

> Keep the token private. It's what lets ProDeck point every disc in your building somewhere new.`,
    settings: "set-taplink",
    related: ["taplink-discs", "taplink-keywords"],
  },
  {
    id: "taplink-discs",
    group: "TapLink",
    title: "Writing the NFC discs",
    aliases: ["what url goes on the disc", "nfc writer app", "ntag213", "how do I program the tags"],
    body: `Every disc gets the same link: your edge URL followed by **/now**, for example **https://go.yourchurch.org/now**. **Settings, Online, TapLink** shows yours ready to copy.

Write it with any NFC writer app on a phone (NFC Tools is common and free): choose *URL*, paste, and hold the disc to the phone. Use **NTAG213 or better**. The cheap NTAG203 tags are too small for a link on some phones.

Because every disc carries the same fixed link, you can add discs forever without ever rewriting one. Where the tap goes is decided by the edge at the moment of the tap.`,
    settings: "set-taplink",
    related: ["taplink-deploy", "taplink-keywords"],
  },
  {
    id: "taplink-keywords",
    group: "TapLink",
    title: "Keywords: tagging slides so the discs follow the service",
    aliases: [
      "tap: give",
      "slide notes keyword",
      "how do I make the discs point at giving",
      "keywords and links",
      "ttl",
      "default link",
    ],
    body: `In **Settings, Online, TapLink, Keywords & links** you match short words to links: \`give\` to your giving page, \`connect\` to your connect card, \`prayer\` to the prayer form, and a **default** for when nothing is live. Each keyword can have its own timer; \`give\` usually goes back after 15 minutes so a disc tapped during coffee doesn't still say "give".

Then in ProPresenter, put **\`tap:give\`** (or \`tap: give\`, both work) in the **notes** of the slide that should switch the discs. When that slide goes live, every disc points at that link until another keyword fires, you override it, or its timer runs out.

- \`tap:default\` on a slide sends the discs back to the default.
- Renaming or removing a keyword doesn't touch ProPresenter. A slide still tagged with the old word quietly stops switching until you tag it again. The editor warns before saving a change like that.
- The **TapLink** tile shows what the discs point at right now and how many taps today.`,
    settings: "set-taplink",
    related: ["taplink-override", "taplink-overview", "analytics-services"],
  },
  {
    id: "taplink-override",
    group: "TapLink",
    title: "Overriding the discs by hand",
    aliases: ["force giving", "manual override", "discs are pointing at the wrong thing", "resume following"],
    body: `The **TapLink** dashboard tile has a button per keyword. Pressing one pins the discs to that link whatever is on screen; **Resume** hands control back to the slides. The admin password or the **Tap discs** permission can override; other crew phones see the state but can't change it.

The same buttons are on the edge's own emergency page at **your-edge-url/admin/‹admin key›**, which works even if the booth computer is off. Save it to the booth phone's Home Screen.`,
    settings: "set-taplink",
    related: ["taplink-keywords", "crew-permissions"],
  },

  // ------------------------------------------------------------- propresenter
  {
    id: "pp-macros",
    group: "ProPresenter",
    title: "ProPresenter macros on a dashboard",
    aliases: ["macros", "propresenter macros", "pro macros", "run a macro", "macro buttons"],
    body: `Add the **ProPresenter Macros** tile to a dashboard. It shows every macro in ProPresenter as a button, in the colour you gave it in Pro, so it matches what the operator sees there. Tap one to run it.

- Edit the dashboard to drag them into your order or hide the ones nobody uses here. New macros made in Pro appear by themselves within a minute.
- On a phone, running a macro needs the **Control** permission. With **View only** on (Settings, Connections, ProPresenter) the buttons show but don't run.
- ProPresenter doesn't report when a macro finishes, so a button just flashes when it runs.`,
    settings: "set-pp",
    related: ["pp-view-only", "dashboards-widgets"],
  },
  {
    id: "pp-view-only",
    group: "ProPresenter",
    title: "View only: watch ProPresenter without changing it",
    aliases: ["view only", "read only propresenter", "monitor only", "don't control propresenter", "second computer", "disable slide control"],
    body: `For a second computer, or a church that runs slides from ProPresenter itself: **Settings, Connections, ProPresenter**, tick **View only**.

ProDeck then still shows everything live (the current slide, playlists, timers, stage messages, slide pictures) but never changes ProPresenter. No triggers, clears, stage messages, messages, child calls, macros, timer controls or playlist edits, from the booth or from any phone, and Stream Deck slide buttons stop too. The tiles show as monitors, the Clear buttons are hidden and the top bar says **VIEW ONLY**.

Auto-Follow only practises while view only is on: it says where it would have moved, without moving anything.

It's enforced in ProDeck's core, so nothing in the app can get past it. Untick it to take control again.`,
    settings: "set-pp",
    related: ["pp-connect", "auto-follow"],
  },
  {
    id: "pp-connect",
    group: "ProPresenter",
    title: "Connecting ProPresenter",
    aliases: [
      "propresenter won't connect",
      "enable network",
      "find propresenter",
      "port 1025",
      "connected but nothing updates",
    ],
    body: `**In ProPresenter:** **Settings, Network, Enable Network**. Note the port (usually 1025 for the API). The port Bonjour advertises is often the stage display's, and ProDeck knows to try 1025.

**In ProDeck:** **Settings, Connections, ProPresenter**. **Find** lists Pro on your network; pick one, or type the address. Once it has connected successfully, ProDeck reconnects on its own, including finding Pro again if its address changes, which matters when the Pro computer gets its address from the router.

**Connected but nothing moves?** ProDeck notices when Pro stops sending and reconnects. If it stays stuck, quit and reopen ProPresenter: its network service occasionally gets stuck after the computer sleeps.`,
    settings: "set-pp",
    guide: "features",
    related: ["pp-view-only", "mac-permissions"],
  },
  {
    id: "stage-message",
    group: "ProPresenter",
    title: "Stage messages and child alerts",
    aliases: ["put a message on stage", "child alert", "parent needed", "stage display text", "clear the stage message"],
    body: `The **Stage Message (Alerts)** tile puts a line of text on ProPresenter's stage displays and takes it off again, from any dashboard, including a phone with the admin password or the **Stage** permission. Type a message, or press one of the quick buttons; **Clear** removes it.

It exists mainly for child alerts to the people on stage: the person who knows a parent is needed is rarely at the booth. Turn on **Auto-clear** (30, 60 or 120 seconds) in the tile's edit mode so an alert can't be left up all service; a countdown shows and **Keep up** cancels it. The countdown runs only while a dashboard showing the tile is open.

Edit the quick buttons in the tile's edit mode, one per line.

> To put a child call on the **audience** screens instead, use the **Child Call** tile.`,
    related: ["child-call", "messages", "dashboards-widgets"],
  },
  {
    id: "child-call",
    group: "ProPresenter",
    title: "Child calls on the main screens",
    aliases: ["child call", "parent pager", "nursery number", "pro message", "propresenter messages", "show a message on screen", "make a child call message"],
    body: `The **Child Call (Pro Messages)** tile shows one of ProPresenter's own messages on the audience screens, with the blank filled in, so nobody has to interrupt the person running slides.

**Using it:** add the tile to a dashboard, pick the message, type the number and press **Show** (or Enter). **Clear** takes it down. **On screen** shows while it's up, even if it was put up from ProPresenter, and **Show** becomes **Update** so you can change the number.

**The message.** Make it in ProPresenter's Messages panel with a text blank where the number goes, like "Parent of {Number}, please come to the nursery". The tile finds a message named like a child call on its own; pick another from the list and the tile remembers it.

**No message with a blank yet?** The tile offers **Make a child call message** (on the booth or with the admin password). Type what the screens should say, with {Code} where the code goes, and ProDeck makes the message in ProPresenter for you, in the look of your other messages. ProPresenter needs at least one message already for it to copy the look from.

Timers and clocks in a message fill themselves. Phones need the **Control** permission to use it, and it does nothing while ProPresenter is view only.`,
    related: ["stage-message", "pp-view-only", "dashboards-widgets"],
  },
  {
    id: "auto-follow",
    group: "ProPresenter",
    title: "Auto-Follow: slides that change themselves as the song is sung",
    aliases: ["auto follow", "lyric follow", "follow lyrics", "slides by themselves", "whisper", "slides late", "slides early", "follow the singing"],
    body: `**Auto‑Follow** is in the sidebar, under ProPresenter. Choose the Sunday playlist and press **Start auto‑follow**. From then on ProDeck listens to the singing, works out which song in the playlist it is, and moves ProPresenter's slides as each slide's **last line finishes**: a beat early rather than late, because a late slide is the one the room notices.

How it knows where it is:
- **It hears.** Whisper runs on this computer (audio never leaves the building) on four second slices every two seconds. When the words it hears are the end of the slide on screen, the next slide is due.
- **It knows the song.** Each song's **BPM from Planning Center** tells it how long a line lasts (about two bars), so a slide that sings the same line twice ("Gloria… Gloria…") isn't left after the first one.
- **It learns.** Every time a slide changes, by Follow or by you, it remembers how long that slide lasted, per song. Rehearsal teaches Sunday. If the BPM changes the next week, the learned lengths stretch to match.
- **It asks, rarely.** When two slides are equally likely, it asks Claude to read the lyric (a few times a song), with the Anthropic key from Settings, App & help, Troubleshooter, on its own monthly budget. No key: it follows by ear alone.

What it won't do: move on words it isn't sure of. In a guitar solo Whisper often "hears" the song's own lyrics; those windows are marked low confidence and can't move a slide by themselves.

**You are always in charge.** Click any slide in ProPresenter and Follow picks up from there. **Back one** and **Forward one** on the Auto‑Follow page do the same and teach it. **Stop follow** hands everything back.

The card shows the song, the section, a bar for how far through the slide the learned clock thinks you are, and why the last move happened (heard it, on the clock, the model, or moved in ProPresenter).

**Setup:** *Auto‑Follow listens to* in **Settings, Sound, Audio & Captions** picks the channels Whisper hears. Empty means the Listen channels (a board mix); a vocals only feed is best of all. **Settings, Automation, Auto‑Follow** sets the model and the monthly cap. Whisper's model is found automatically in ProDeck's models folder.`,
    settings: "set-gemini",
    related: ["song-key-waves", "pp-view-only"],
  },

  // ----------------------------------------------------------- planning center
  {
    id: "analytics-services",
    group: "Planning Center",
    title: "Service analytics: services, practice and taps",
    aliases: ["analytics", "service report", "reset analytics", "rehearsal tracking", "practice", "tap counts", "duplicate taps", "per service"],
    body: `ProDeck times every plan item and records sound levels for each service, using the service times in Planning Center.

**Which service it is, by the clock.** Each service has its own window: from 15 minutes before its start (pre-service slides and the countdown belong to it) until the next service's window, or the plan's length plus 45 minutes for the last one. Activity inside a window goes to that service.

**Everything else is practice.** A Thursday rehearsal, a Sunday morning run through, Monday with last week's plan still up: it all goes to that day's **Practice** report, kept out of every service. Leave Follow Pro on all week; there's nothing to reset. The **Rehearsal / Service** switch on the Service Tracking tile overrides the clock for one-off cases, and **Auto** goes back.

**NFC taps** are counted only inside a service's own window, so one service can't count another's taps, and practice counts none. TapLink counts one tap per phone per minute and ignores link previews, prefetches and bots, so a phone that opens the link twice counts once.

Services recorded before this change may have run on into the week: their tap counts are now clipped to three hours, but the minutes they collected stay as they were.`,
    related: ["pco-live", "taplink-keywords"],
  },
  {
    id: "pco-connect",
    group: "Planning Center",
    title: "Connecting Planning Center",
    aliases: [
      "pco 401",
      "planning center rejected credentials",
      "connect planning center",
      "sign in to planning center",
      "application id and secret",
      "personal access token",
      "nothing loads after entering pco credentials",
      "disconnect planning center",
    ],
    body: `Go to the **Planning Center** page and press **Connect**. Your browser opens Planning Center's own sign in page; approve ProDeck there and the page fills in behind you. Pick this week's plan and the team, times and songs load.

ProDeck asks for two products and no others: **Services** (the plan, its running order, the team and LIVE) and **People** (only to show whose account it's connected as). It never sees your password, and you can take its access away any time, from the **Disconnect** button here or from your Planning Center account.

The sign in lasts as long as ProDeck keeps running or is opened at least every 90 days. If it does lapse, the page says so and Connect puts it back.

- **"Waiting for your browser…" and nothing happened:** the sign in opened in your default browser, which may not be the one you're signed into Planning Center on. Close that tab, press Connect again, and paste the address it shows into the right browser.
- **Nothing to press but a Client ID box:** this copy of ProDeck has no Planning Center application to sign in through yet. See *Registering a Planning Center application*.

> **A Personal Access Token** still works and is what older installs run on. It's under *Use a Personal Access Token instead* on the same panel. But the token is a password that doesn't expire and carries that person's whole Planning Center account, so signing in is the better option where you have it.

**Service setup** (picking the plan, mics and leader scenes) is on the Planning Center page whenever you want it. It no longer opens by itself each morning.`,
    guide: "features",
    related: ["pco-register-app", "pco-live"],
  },
  {
    id: "pco-register-app",
    group: "Planning Center",
    title: "Registering a Planning Center application",
    aliases: [
      "client id",
      "redirect uri",
      "oauth application",
      "public application",
      "invalid_client",
      "planning center developers page",
      "no planning center application configured",
    ],
    body: `Signing in needs a Planning Center **application** to sign in through. Most churches never touch this: ProDeck comes with one. You only do this if ProDeck asks for a Client ID, or if you'd rather your church's connection went through your own application.

Only an **Organization Administrator** can create one (Planning Center's rule since March 2023). It takes about five minutes:

1. Go to api.planningcenteronline.com, **Developers**, **My Applications**, **New Application**.
2. Name it **ProDeck** and set the type to **Public**.
3. Paste the three redirect URIs ProDeck shows you into the **Redirect URIs** field: all three, exactly as written.
4. Save, copy the **Client ID**, and paste it into ProDeck.

> A **public** application has no secret. That's correct, not a missing step: anyone who downloads ProDeck has its code, so it can't keep one. The sign in is protected by PKCE instead, which proves the copy of ProDeck finishing the sign in is the one that started it.

- **"Planning Center doesn't recognise this Client ID":** the application is registered as *confidential* rather than *public*. Change its type.
- **"Planning Center rejected the redirect address":** one of the three URIs is missing or mistyped. They must match character for character, port numbers included.`,
    guide: "features",
    related: ["pco-connect"],
  },
  {
    id: "pco-live",
    group: "Planning Center",
    title: "Planning Center LIVE: Take control, Next and Previous",
    aliases: ["take control", "next does nothing", "someone else is controlling", "auto fire slides", "follow propresenter", "live moved during practice", "rehearsal moved live", "reset live"],
    body: `Planning Center only moves LIVE for whoever holds the **controller**. An untouched plan has nobody holding it, which is why Next did nothing on its own.

- **Take control of PCO Live** on the Planning Center page makes this booth the controller; then **Prev** and **Next** appear. ProDeck takes control for you when the plan is free, and refuses, telling you who has it, when a teammate is driving from their own device.
- **Follow ProPresenter:** when ProPresenter changes presentation, LIVE moves to the matching item by name.
- **Auto-fire slides** does the reverse: when the live item changes, its linked ProPresenter presentation fires (slide actions included).
- If Next seems to do nothing, look for the message under the buttons: it names who holds control, or says it couldn't confirm and to try again.

**Practice never moves LIVE.** Follow ProPresenter only moves Planning Center LIVE from 5 minutes before each service time until that service is over. Click through the slides at a rehearsal or a Sunday morning run through and LIVE stays where it is, so the service's real timings aren't spoiled before it starts (Planning Center can't reset them). While it's holding, the Planning Center page says so and when it will start. When the window opens with pre-service slides already up, LIVE catches up by itself. A plan with no service times in Planning Center isn't held, and Next and Previous by hand always work.`,
    related: ["pco-connect", "analytics-services"],
  },
  {
    id: "stage-call",
    group: "Planning Center",
    title: "Keys to the Stage: calling the worship team back",
    aliases: [
      "keys to the stage",
      "sermon countdown",
      "call the worship team",
      "closing set keys",
      "green room widget",
      "when are we on",
    ],
    body: `The **Keys to the Stage** tile is for a screen where the worship team waits: a green room, the office, wherever breakfast is. It counts down to the **end of the service** and, **five minutes before**, turns into a call: *TO THE STAGE*, the countdown, and the closing songs with their **keys** in the biggest type on the wall.

- The service end is Planning Center's start time for the service happening now, plus the items that run *during* the service. Pre-service items (a rehearsal, pre-service slides, the countdown video) sit before the start time in Planning Center and don't push the end out. With back to back services that end is the hard limit and the sermon is what flexes, so the call comes at the right time however long the message ran. It fires off the clock, whether or not anyone is driving LIVE.
- Change an item's length or add one during the morning and the end moves with it.
- The songs shown are the ones after the live item when those are songs; otherwise the plan's closing set.
- Prefer a cue off the **live item's own countdown** (the sermon item ending) instead? Switch it in the tile's edit mode. That's right for a church not running services back to back.
- If the service runs past its planned end the call stays up and shows *over by* how much.
- Change the lead time (3, 5, 7 or 10 minutes) in the tile's edit mode.

Pair it with **Service Countdown**, **Show Flow** and **Song Leaders**, and turn on **Room audio** for the dashboard so the room hears the service without a tile. The **Green Room** template is exactly this layout, and it works well on a TV screen.`,
    related: ["tv-screens", "kiosk", "dashboards-widgets", "pco-connect"],
  },

  // ---------------------------------------------------------- phones & kiosks
  {
    id: "gateway-passwords",
    group: "Phones & kiosks",
    title: "Browser access: the two passwords",
    aliases: [
      "web access password",
      "admin password vs crew password",
      "which password do I give volunteers",
      "phones can't reach the booth",
      "port 8088",
      "member password",
    ],
    body: `**Settings, Crew & screens, Browser Access** turns on the web gateway: the same ProDeck, served to phones, kiosks and TVs on your Wi-Fi at **http://‹booth-name›.local:8088**.

- **Admin password:** full control. Give it to people who run the booth.
- **Member (crew) password:** look, chat, check in, confirm pages, watch cameras. This is what the crew code carries, and what kiosk links, TV screens and camera tally links use.

Use long passwords. The crew password is the lasting credential every phone holds. Changing it signs every phone out, and disconnects every TV and tally link, so send the new crew code and pair TVs again.

Only real password guessing is slowed down: one old phone still trying a password you've changed can't lock everyone else out.`,
    settings: "set-web",
    guide: "phase1",
    related: ["kiosk", "phones-install", "secure-local", "crew-address"],
  },
  {
    id: "phones-install",
    group: "Phones & kiosks",
    title: "Getting ProDeck onto a phone or iPad",
    aliases: ["install on iphone", "add to home screen", "notifications on the phone", "app keeps signing me out", "ipad crew view", "full view"],
    body: `**The easiest way is the app.** **ProDeck Crew** is free on the App Store (iPhone and iPad) and Google Play (Android). Install it, tap **Scan crew code**, and scan the crew poster. See *ProDeck Crew: the volunteer app*.

**Or use the browser.** Scan the crew poster with the phone's camera, choose **Continue in the browser**, then add it to the Home Screen so pages reach it with the app closed:

- **iPhone (Safari):** Share, **Add to Home Screen**, Add. Then open ProDeck from the icon, not Safari: the icon's copy arrives already connected to the booth, and the volunteer signs in there with their name and PIN once. On an iPhone the notification is the only buzz a page can make, so notifications only work from the icon.
- **Android (Chrome):** menu, **Add to Home screen**, or **Install app** if offered.

**The last step is notifications.** Until they're on, Home shows a card that says exactly what to do: a **Turn on notifications** button, how to unblock them in the phone's Settings, or how to get onto the secure address (notifications don't work on the plain local address). **Not now** hides it for half a day.

**iPad crew view.** An iPad that came from the poster or an invite opens in the crew view: comms, the tally light and the phone tabs, sized for the iPad. **Full view** at the bottom of **More** switches to every page and dashboard, and **Crew view** at the bottom of the sidebar switches back.

From the app or the icon, ProDeck remembers the account and reconnects by itself, within a minute of the booth coming back or the phone waking. If it ever lands on the password screen, the crew password changed: scan the crew code again.`,
    related: ["crew-app", "pages", "gateway-passwords", "secure-local"],
  },
  {
    id: "kiosk",
    group: "Phones & kiosks",
    title: "Kiosk screens: an office TV or a switcher monitor",
    aliases: ["kiosk mode", "office tv", "chromeless dashboard", "?kiosk=", "mac mini setup", "camera not showing on kiosk"],
    body: `A kiosk is a browser showing one dashboard, full screen, with nothing to click. **Settings, Crew & screens, Kiosk screens**: pick the dashboard, copy the link (or scan the QR), and follow the steps for a Mac, Windows PC or iPad. For a TV with a Fire TV Stick or Android TV box, use **TV screens** instead.

The link carries the **crew password** so a machine with no keyboard never has to type it. Leave the machine on: if the booth goes away the kiosk shows an "offline, reconnecting" screen and comes back by itself, picking up any ProDeck update along the way. Layout changes made on the booth appear within a minute.

Cameras, the sound desk and OBS all work on a kiosk.

**It fills the screen.** A kiosk scales the layout to fill the screen. A dashboard too tall to fit at a readable size scales down evenly so the whole thing shows, still filling the width.

**Room audio without a tile.** Edit the dashboard and press **Room audio: on**. Any kiosk or TV showing that dashboard plays the room's audio in the background, with no Overflow Listen tile taking up space. On a Mac mini the Chrome flag \`--autoplay-policy=no-user-gesture-required\` is what lets it start with nobody clicking; set the volume on the TV.

**Messages to a kiosk.** In **Messages**, send to **All screens** or that dashboard's screen and it shows across the kiosk in big type.`,
    settings: "set-kiosk",
    related: ["tv-screens", "gateway-passwords", "ndi", "messages"],
  },
  {
    id: "tv-screens",
    group: "Phones & kiosks",
    title: "TV screens: a Fire TV Stick or Android TV in the green room",
    aliases: ["fire tv", "firestick", "android tv", "green room tv", "message the green room", "update the tv app", "prodeck display", "pair a tv", "tv code", "update all"],
    body: `A Fire TV Stick or Android TV box runs the free **ProDeck Display** app, which shows one dashboard (or the camera tally board) full screen. It opens by itself every time, keeps the screen on, and comes back after a power cut.

**Adding a TV.** **Settings, Crew & screens, TV screens** has the steps. It needs **Browser Access** on with a member password.
1. **Once per Fire TV:** Settings, My Fire TV, About: click the device name seven times. Then Developer Options, Install unknown apps: allow Downloader.
2. Install **Downloader** from the Fire TV app store, open it and type the address the card shows.
3. Install and open **ProDeck Display**. It finds ProDeck on the network and shows a six character code, which appears on the card within a few seconds.
4. Check the code matches, choose a dashboard and press **Send to TV**.

Tick **Leave a margin round the edges** for TVs that crop the picture.

**Changing what a TV shows.** Under **Your TVs**, choose a dashboard next to the TV and press **Show**; the TV switches within a minute. Or press **Menu** (or the centre button) on the TV's remote: every dashboard, the camera tally board, the edge margin, and connecting to a different ProDeck.

**Messages to a TV.** In **Messages**, set the destination to a screen: **All screens**, or one dashboard's screens (say **Green Room screen**). The message goes across those TVs in big type with a soft chime, and comes down after three minutes, when you send another, or when you press **Clear**. Sending to screens needs the admin password or the **Stage** permission.

**Updating the TV app.** When a ProDeck update brings a new ProDeck Display, **Your TVs** says so next to each TV. Press **Update** (or **Update all**). The TV downloads it and asks; someone presses **Update** on the remote, then opens ProDeck Display again. Nothing is uninstalled and the TV keeps its screen. The first time, the TV asks you to allow installing apps for ProDeck Display. TVs set up before 0.9.115 need the new app installed over the top once with Downloader, and update from here after that.

**If the booth moves or goes away,** the TV shows "Looking for ProDeck on the network" and finds the booth again by itself within a minute, even on a new address. Changing the member password disconnects every TV: open ProDeck Display on each and pair it again.

Turn on **Room audio** for a dashboard and its TVs play the service audio too. Tiles shrink their content to fit a TV, so there are no scroll bars nobody can use with a remote.`,
    settings: "set-tv",
    related: ["kiosk", "messages", "atem-tally", "gateway-passwords"],
  },
  {
    id: "secure-local",
    group: "Phones & kiosks",
    title: "A secure address for phones, with nothing to set up",
    aliases: ["https", "secure address", "secure local address", "certificate", "microphone blocked", "notifications don't work", "no domain", "ssl", "claim this address"],
    body: `Phones only allow comms, a camera station's microphone and page notifications on a secure (https) address. A booth that only lives on the church network has a plain one, so none of those work until it has a secure address.

**Claim one in Settings, Crew & screens, Secure local address.** Pick a name (your church's, say), check it's free, and press **Claim this address**. In about a minute this computer has **https://yourname.local.prodeck.live**, and every crew link, the poster and camera tally codes use it. It keeps working by itself: if the computer's address on the network changes, the name follows, and the certificate renews on its own. Your crew address takes the same name.

**How it works:** the name points at this computer's address *inside* your building, and the booth gets its own certificate for it from Let's Encrypt. Phones on the church Wi-Fi talk to the booth directly; nothing goes through the internet except looking up the name. From outside the building the name leads nowhere.

If phones can't open it:

- They must be on the church Wi-Fi, not cellular or a guest network.
- Some web filters (Cisco Umbrella, OpenDNS, some routers) block names that point inside the network. Allow names ending in **.local.prodeck.live** in yours.
- If the computer is on two networks (Wi-Fi and a Dante network), pick the one phones are on in the card.

Already have your own public address (a domain with a tunnel)? Links use that, and you don't need this. **Give this address back** frees the name.`,
    settings: "set-local",
    related: ["comms", "phones-install", "crew-address", "public-url"],
  },
  {
    id: "crew-address",
    group: "Phones & kiosks",
    title: "Reaching ProDeck away from church, and while the booth is off",
    aliases: ["crew address", "-crew.prodeck.live", "from home", "outside the building", "cellular", "booth is off", "remote access", "away", "offline plan", "booth offline"],
    body: `Every booth has a **crew address**, **https://yourname-crew.prodeck.live**. It's on unless you turn it off in **Settings, Crew & screens, Crew address**, and there's nothing to set up: no port forwarding, no domain, no tunnel.

**With ProDeck open at the booth,** crew open the crew address from home or on cellular and get the live booth, the same as on the church Wi-Fi. The booth keeps one connection out to White Oak Media's service, and phones' requests come to it that way. Passwords and permissions are checked by the booth, as always. Comms, camera feeds and the overflow audio stay on the church Wi-Fi.

**With the booth computer off,** the crew address shows the last copy the booth sent: what's happening at the top, the person's call time and position, then this week's plan laid out clearly (songs, keys, leaders, times, who's on and position guides), the checklist and team chat. A line at the top says plainly that the booth is off, with the time the copy was sent. Checklist ticks, chat messages and signups made then wait there and reach the booth when it's back. There's also **Play Next Slide**, a game for while you wait.

**One crew code.** The crew QR in Settings, on the printed poster and on TV screens points at the crew address, so it works from anywhere, and offers the ProDeck Crew app on phones. A phone that can't reach the booth on its usual address reads the copy from the crew address by itself, and moves over to it when the booth is on but out of reach (the phone left the building), keeping its sign in. ProDeck Crew does the same.

**The name** is your secure local address's name if you claimed one, otherwise one made from your church's name in Planning Center (change it in the card). What the copy holds is under **What leaves the building** on the card: the plan, checklists, crew names and roles, and team chat, kept by White Oak Media. Passwords are only kept as a scrambled check, never the password itself. Turning the crew address off deletes the copy.`,
    settings: "set-crewaddr",
    related: ["secure-local", "next-slide", "crew-app", "public-url", "crew-overview"],
  },
  {
    id: "public-url",
    group: "Phones & kiosks",
    title: "Your own public address for the booth",
    aliases: ["public url", "cloudflare tunnel", "own domain", "use from home", "booth off fallback"],
    body: `Most churches don't need this: the **crew address** already lets the crew reach the booth from anywhere, and see the week while it's off, with nothing to set up.

If you already run your own domain with a Cloudflare Tunnel to the booth computer, put it in **Settings, Crew & screens, Browser Access, Public URL**. Crew links then use it, and phones can reach the booth through it from anywhere. It also counts as a secure address for comms and notifications.

This is the most involved optional setup. The Adopter's Guide covers it end to end; do it after everything else is working.`,
    settings: "set-web",
    guide: "phase3",
    related: ["crew-address", "secure-local", "gateway-passwords"],
  },

  // --------------------------------------------------------------- dashboards
  {
    id: "dashboards-widgets",
    group: "Dashboards",
    title: "Dashboards and widgets",
    aliases: ["add a widget", "adding widgets doesn't work", "edit layout", "new dashboard", "starter templates", "widget is blank", "widget library", "find a widget", "tile too small", "resize a tile"],
    body: `A dashboard is a grid of widgets (tiles). Press the **pencil** at the top right to edit, then **Add Widget**. Drag a tile to move it, drag its corner to resize, and × removes it. Edits save by themselves. New tiles are added at the **bottom**; ProDeck scrolls to them and highlights them.

**The widget library.** **Add Widget** shows every tile with a small picture of what it looks like, its full name and a line on what it does, grouped by area. Search finds tiles by name or by what they do: try "slides", "mic" or "countdown".

**Tiles fit any shape.** Every tile lays itself out by its own size, so the same tile works wide and short, tall and narrow, small, or on a phone. Make a tile whatever shape suits the screen.

- **New dashboard** in the dashboard menu starts **Blank** or from a template (FOH, Production Manager, Director, Green Room, Mics & Worship and more), built from what you have connected.
- While editing: **Rename**, **Delete**, and **Room audio** for kiosks and TVs showing this dashboard.
- Dashboards can be edited from a browser signed in with the admin password, not just the booth. Crew phones see every dashboard but can't change them.
- A tile that says what to connect and offers a **Set up** button hasn't got its source yet. One that says *offline* has a source that isn't reachable right now.`,
    related: ["kiosk", "tv-screens", "blank-tile"],
  },

  // -------------------------------------------------------------- sound console
  {
    id: "console",
    group: "Sound console",
    title: "Connecting a sound console",
    aliases: ["avantis", "dlive", "sq5", "qu", "qu-5", "qu-6", "qu-7", "x32", "m32", "yamaha", "ql5", "ql1", "cl5", "cl3", "cl1", "tf5", "tf3", "tf1", "rcp", "port 49280", "digico", "presonus", "soundcraft", "my console isn't listed", "console shows disconnected", "can't reach the desk", "midi over tcp", "osc port 10023", "wing", "behringer wing", "wing compact", "wing rack", "osc port 2223"],
    body: `**Settings, Connections, Sound Console**: pick the model, type the console's IP address, and watch it connect.

- **Allen & Heath Avantis and dLive:** MIDI over TCP, port 51325 (dLive Surface: 51328). Match the **MIDI base channel** to the console's *Utility, Control, MIDI* setting.
- **Allen & Heath SQ and Qu (Qu-5, Qu-6, Qu-7):** MIDI over TCP, port 51325. Match the MIDI channel to *Utility, General, MIDI*. These desks don't send channel names. (The older Qu-16, Qu-24 and Qu-32 aren't supported.)
- **Behringer X32 and Midas M32:** OSC, port 10023. Nothing to set up on the console.
- **Behringer WING, WING Compact and WING Rack:** OSC, port 2223. Nothing to set up on the console, as long as Remote Lock for OSC is off under *Setup, Remote*. ProDeck mirrors and controls names, mutes and faders for all 40 channels, the 8 aux inputs, 16 buses, 8 matrices, 4 mains, 16 DCAs and 8 mute groups, and recalls scenes from the show open on the desk. The WING sends live changes to one OSC app at a time, so if Companion also talks OSC to it, ProDeck still catches up every 30 seconds.
- **Yamaha CL, QL and TF:** Yamaha's remote control protocol, port 49280. Nothing to set up on the console and no MIDI channel to match: pick **Yamaha CL, QL or TF**, type the desk's IP, and ProDeck works out which model it is by itself.

**Yamaha desks, step by step.** Find the console's IP address on its network setup screen, make sure the computer and the desk are on the same network, then enter that IP in Settings or on the setup step. Leave the port at 49280. ProDeck mirrors channel names, mutes and fader levels for every input, stereo input, mix bus, matrix (CL and QL), DCA and mute group, plus the stereo and mono masters and the current scene with its name. On a TF the scene shows with its bank, like A05. For now ProDeck only **watches** a Yamaha desk: mute, fader, rename and scene recall buttons stay off, and Automix can't move its faders. RIVAGE PM and DM series desks use a different scene format and aren't supported yet.

**Desk not listed?** DiGiCo, PreSonus, Soundcraft, Midas Pro or an analog desk can't be mirrored yet. Pick **Something else** on the setup step (or just skip it): everything else in ProDeck works without a console.

Once connected, the **Sound Desk** tile mirrors mutes, faders and names, and the desk watchdog can page one person when something changes during a service. Control (mute, fader, scene recall) needs the admin password or the **Control** permission, and isn't available on Yamaha desks yet.

**Can't reach the desk?** The Sound desk light names your console and says why. On an Allen & Heath desk, Companion or MIDI Control may already be holding the desk's MIDI connection. ProDeck gives up on an unreachable desk after five seconds and tries again, and an X32 or M32 stays connected while nobody is touching it.

> Only the Avantis has been run against real hardware. The others are built from the manufacturers' published protocols and covered by tests; the console picker says which is which. If yours is one of those, a report either way is really useful.`,
    settings: "set-avantis",
    related: ["routing-map", "setup-recording-automix", "report-problem"],
  },
  {
    id: "routing-map",
    group: "Sound console",
    title: "Building your routing map",
    aliases: ["routing", "patch list", "which channel is which socket", "signal map", "where does channel 39 come from", "paste patch list", "stage pockets", "stage panel", "which socket do i plug into", "floor box"],
    body: `**Routing** is every console channel, traced back to the thing that makes the sound: the stage socket, the wireless pack, the playback laptop. It is written for the volunteer who has to answer "why is there no sound" alone.

The one rule: **channel names change every service; numbers don't.** The map is keyed by numbers (console channel, door socket, receiver slot) and names arrive live from the desk. Who is singing into channel 39 comes from Planning Center.

To build yours:
1. Open **Routing**, press **Edit**, then **Paste patch list**.
2. Paste one line per channel: **CH · NAME · PORT · SOCKET · UPSTREAM**, straight from a spreadsheet (tabs) or with commas. A header row is fine.
3. **PORT** is the door the signal comes in through: SLink (a stage box), I/O Port 1 (Dante), Local (an XLR on the rack). **SOCKET** is the number on that door. **UPSTREAM** is what feeds the socket: \`stage 41\`, \`ULXD4Q-5-8 07\`, \`Playback-Mac 05\`.
4. Press **Apply**, look it over, **Save**.

- Two channels on one socket (a vocal and its duplicate) show a **+** on the socket; they share one preamp and one gain.
- Click a row for its steps: what to walk to when that channel is dead. Every kind of source starts with a sensible template; edit the text to name your building's receivers, panels and sockets.
- Tick **Dead** on a socket that looks normal and goes nowhere. The walk routes around it.
- **Mark all verified** stamps today's date on every row. The map nags after 90 days; maps go stale.

**Stage pockets.** The **Stage** tab draws the wall: each floor pocket or panel as its sockets, and for every socket the door input it reaches and the console channel that is, with the desk's live mute and any external insert on that channel. Add a pocket in Edit with a name and its socket range (Stage right front, 41 to 50). Free sockets are dashed; mark one **dead** when it looks normal and goes nowhere, and the walk will route around it. Phones get the same tiles under No sound?, Stage.

> Until you paste your own list, the page shows an example sixteen channel church. It says so at the top.`,
    related: ["routing-walk", "routing-graph", "console"],
  },
  {
    id: "routing-graph",
    group: "Sound console",
    title: "Drawing the map",
    aliases: ["node view", "routing map picture", "boxes and lines", "signal flow diagram", "connect socket to channel by dragging", "only dante", "only slink"],
    body: `**Routing, Map** draws the same map as boxes and lines: sources on the left, then the doors they come in through, console channels, buses, outputs and finally what the outputs drive. Colour is the door (amber SLink, blue Dante, green Local) and the number on each line is the socket.

Everything is laid out by kind, not by hand. New things always land in their column, so the picture stays readable as the map grows. Drag a box to nudge it and the nudge is remembered (a small dot marks it); everything else stays put.

- **Only SLink**, **Only Dante** and **Only Local** show one door's world at a time, the way you'd read it standing at the wall or in Dante Controller. **Show all** is the whole building.
- **Live:** a muted channel turns amber and says so; an open one shows its fader. A dashed box or line is marked dead. A dotted one has never been verified. A glowing line has signal ProDeck can hear on its own input.
- **Double-click** any box to walk it: the same walk a phone gets.

To change the map, press **Edit** first:
1. Drag from a box's right side port to another box's left side port to connect them. Only sensible links are allowed (a source into a door, a door into a channel, a channel into a bus, and so on). A link into a door or channel asks for the socket number.
2. Select a box or line and press Delete to remove it.
3. **Add** puts a new source, door, channel, bus, output or destination at the bottom of its column.
4. **Save.** The table and the phones see the same map: it is one map, three views.`,
    related: ["routing-map", "routing-walk"],
  },
  {
    id: "song-key-waves",
    group: "Sound console",
    title: "Song key to Waves: what was sent, and sending one by hand",
    aliases: ["waves key", "key change", "tune off", "send key to waves", "wrong key on the vocals", "auto-tune key", "song key to rig"],
    body: `When a song goes live, ProDeck sends its key (from Planning Center, or your in-app override) to the Waves rig as a scene number: C is scene 1 through B as scene 12, and **Tune off** is scene 13. The rig's vocal tuning follows.

You can see and steer this in four places:
- The **ProPresenter** page shows a strip under the transport: the key last sent (green when it matches the live song, amber when the rig is on something else), the live song's key, the MIDI link, and thirteen buttons.
- The **Song Key → Waves** dashboard tile is the same strip, for the booth or a phone.
- Any phone with **Control** can press a key too; the booth does the sending.
- On the **Stream Deck**, Production's **WAVES** key shows the key last sent (amber when the rig and the song disagree); press it for the **Keys** page: twelve keys and **Tune off**. The key the rig is on glows green, the live song's key glows amber. Companion calls \`/api/deck/key?text=G\` (or \`text=off\`).

Press a key to send it now; sending the same key again is fine. **Tune off** when a speaker or a spoken piece shouldn't be tuned.

**The rig reconnects itself.** When the output is a Network MIDI session, ProDeck watches it and remembers who was connected (the Waves PC). After either computer restarts, ProDeck asks that peer to connect again every 20 seconds until it answers, so nobody has to open Audio MIDI Setup. The strip's second chip shows it: **→ Waves-PC** (the peer's name) when connected, **waiting for …** while it keeps asking. It learns the peer the first time it sees it connected, so connect once by hand on a new setup.

What still has to be true on the Waves PC: rtpMIDI starts when Windows starts, with its session enabled, and it must be running **before LV1 opens**. LV1 only sees MIDI ports that existed when it started. If keys stop after a restart and the chip says connected, restart LV1.

Setup lives in **Settings, Sound, Song Key**: the MIDI output (your Network MIDI session) and channel.`,
    settings: "set-songkey",
    related: ["console", "ask-prodeck"],
  },

  // -------------------------------------------------------------------- video
  {
    id: "ndi",
    group: "Video",
    title: "NDI cameras and the Stage Feed widget",
    aliases: ["ndi not showing", "stage feed", "camera on dashboard", "ndi runtime", "no sources found"],
    body: `**Settings, Connections, Stage feed (NDI)** lists every NDI source ProDeck can see on your network, which also proves NDI itself is working. The source is chosen **inside the Stage Feed tile**: add it to a dashboard, press the pencil, pick the camera.

- Nothing listed? The NDI runtime must be installed on the booth computer, and the camera or software must be on the same network and actually sending.
- Feeds are shared: several tiles and kiosks can watch one camera and the booth encodes it once.
- Cameras work on the booth, kiosks, TVs and phones.

The NDI runtime comes from NDI Tools or the NDI SDK at ndi.video; ProDeck uses the copy installed on the computer and doesn't include one. NDI® is a registered trademark of Vizrt NDI AB.`,
    settings: "set-ndi",
    related: ["kiosk", "atem"],
  },
  {
    id: "atem",
    group: "Video",
    title: "ATEM switcher: Program, Preview, Cut and Auto",
    aliases: ["atem", "blackmagic", "video switcher", "switcher", "vision mixer", "cut", "auto transition", "program preview", "fade to black", "ftb", "downstream key", "dsk", "atem macros", "m/e"],
    body: `ProDeck connects to Blackmagic ATEM switchers over your network. In **Settings, Connections, ATEM Switcher**, tick **Connect to an ATEM switcher** and type its address, which ATEM Setup shows under **Network**. The switcher and the booth computer need to be on the same network.

Add the **ATEM Switcher** tile to a dashboard. It shows each source with the name you gave it on the switcher, **red** for what's on Program and **green** for what's on Preview, just like the switcher's own buttons.

- **Tap a source** to put it on Preview.
- **Cut** takes Preview live straight away. **Auto** uses the transition set on the switcher (mix, wipe and so on, at its rate).
- There's no tap to Program on purpose, so a stray tap can't cut the room and the stream to the wrong camera.
- On a phone, switching needs the **Control** permission; everyone else sees the tile read only.
- **More than one M/E:** each tile picks its own (edit the dashboard, then the M/E menu on the tile). Settings picks the default. Two tiles side by side can show M/E 1 and M/E 2.
- **Arrange the buttons:** edit the dashboard. Drag sources into your order (or use the arrows on a touch screen), tap the eye to hide one, the pencil to give it your own label, and choose whether Cut and Auto sit below, above or beside the buttons, and how many buttons per row. **Reset** puts it back. Each tile keeps its own arrangement, and a new camera on the switcher shows up at the end. Unused inputs named "--" are hidden.
- **Downstream keys and Fade to Black** sit under the buttons: each key lights red while it's on air and shows what it keys. Tap one to take it on or off with its own transition. **FTB** asks before fading to black, and lights while the output is black; tap it again to come back. Turn either off for a tile in edit mode.
- **Macros:** add the **ATEM Macros** tile. It lists the macros recorded on the switcher (ATEM Software Control, Macros). Tap one to run it; while it runs it lights, with **Stop** (and **Continue** if it waits for you). Edit the dashboard to reorder or hide them.
- **Stream Deck:** \`/api/deck/atem-cut\`, \`/api/deck/atem-auto\` and \`/api/deck/atem-preview?n=<source number>\` (admin password). Add \`&me=2\` for M/E 2. Keys: \`/api/deck/atem-dsk?n=1\` (toggle, or \`&on=1\` and \`&on=0\`) and \`/api/deck/atem-dsk-auto?n=1\`. Macros: \`/api/deck/atem-macro?n=3\` or \`?text=Sermon look\`, and \`/api/deck/atem-macro-stop\`. Fade to Black: \`/api/deck/atem-ftb\`.

**If the link drops,** the tile keeps showing the last Program and Preview, greyed, while ProDeck reconnects, and switching waits until it's back. ProDeck retries quickly after a drop and backs off if the switcher stays silent, so a switcher that's off isn't flooded. **Settings, Connections, ATEM Switcher** shows how long the link has been up and how many times it has dropped, with **Reconnect now**.

If the tile can't reach the switcher at all, check the address, that the switcher is on, and that nothing else on the network has the same address. If it says the switcher answered but sent nothing, every connection the switcher allows is in use: close ATEM Software Control on another computer.`,
    settings: "set-atem",
    related: ["atem-tally", "dashboards-widgets"],
  },
  {
    id: "atem-tally",
    group: "Video",
    title: "Camera tally on a phone or iPad",
    aliases: ["tally", "tally light", "camera tally", "on air light", "which camera is live", "ipad tally", "camera operator", "phone tally"],
    body: `Any phone or iPad can be a tally light, using the switcher's own tally, so keys and transitions count. It needs the ATEM connected first.

**From a crew phone, no link needed.** A volunteer signed in to ProDeck opens **More, Tally light**, picks their camera from the switcher's list, and the phone becomes the operator view. It stays a tally through reloads until they tap the screen and choose **Back to ProDeck**. While it's a tally the phone makes no sound and doesn't vibrate, so nothing reaches the camera's microphone or shakes the shot. A page shows as a quiet amber strip across the top with **Got it**, and the tally stays in view. If they're on comms, a **Talk** button sits in the corner.

**For a camera with nobody signed in,** make a link in **Settings, Crew & screens, Camera tally** (it needs Browser Access with a member password), then scan the code on the device. Three views:

- **Tally light:** one camera. The whole screen is red when it's **LIVE** and green when it's **NEXT** (on Preview). Mount it on the camera.
- **Operator:** one camera big, with what's live and what's next along the bottom, so the operator knows what's coming.
- **All cameras:** every camera on one screen, red for live and green for next. Good on an iPad at the director's desk or side of stage, or on a TV screen as the camera tally board.

Options: turn off green for next, or make the screen black when off air so it doesn't glow on stage.

**If it can't be sure**, it shows amber stripes and **NO TALLY**, never a dark screen that looks safe to move. That happens when it loses ProDeck or ProDeck loses the switcher. It reconnects by itself and reloads itself after ProDeck updates.

**For a permanent install:** add it to the Home Screen, set Auto-Lock to Never (iPhone and iPad) or the longest screen timeout (Android), lock it with Guided Access or App pinning, and keep it plugged in on the church Wi-Fi. Tap the screen to see which camera it is or to change it.

The link carries the member password. Changing that password stops every tally link, so scan them again.`,
    settings: "set-tally",
    related: ["atem", "comms", "tv-screens"],
  },
  {
    id: "obs",
    group: "Video",
    title: "OBS Studio: are we live?",
    aliases: ["obs websocket", "streaming status", "recording status", "dropped frames", "skipped frames"],
    body: `**In OBS:** **Tools, WebSocket Server Settings**, enable it, note the port (4455) and set a password. **In ProDeck:** **Settings, Connections, OBS Studio**, enter the port and password.

The **OBS** tile then shows the current scene, whether you're **streaming** and **recording** with elapsed time, and **% skipped (encoder)**: frames the encoder couldn't keep up with, which points at the computer rather than the network. When OBS can't reach the streaming service at all, that's shown as its own state.`,
    settings: "set-obs",
  },
  {
    id: "stream-monitor",
    group: "Video",
    title: "Watching your Resi stream in ProDeck",
    aliases: ["resi", "stream monitor", "livestream preview", "watch the stream", "is the stream live", "confidence monitor", "web player"],
    body: `The **Stream Monitor (Resi)** tile shows your Resi stream exactly as people at home see it, so you can check you're really live and it looks right.

**Set up.** In Resi Studio, open **Web Channels**, your channel, **Embed**, and copy the embed code. In ProDeck, edit a dashboard, add **Stream Monitor (Resi)**, paste the code into the tile and press **Use this stream**.

**Good to know.**
- It's the viewers' copy, usually **20 to 40 seconds behind** the room. For a picture with no delay, use the **Stage Feed (NDI)** tile with your switcher's output.
- **On the booth computer it's picture only.** ProDeck plays the stream itself there, using Resi's video only stream, so no sound is ever even downloaded to the booth (the booth's sound can feed the house). It shows "Not live right now" between services instead of replaying the last one. Mac only for now.
- On **phones and kiosks** it's Resi's own player, starting muted, and can be unmuted on that device.
- It doesn't count as a viewer in Resi's analytics.`,
    related: ["church-online", "ndi"],
  },
  {
    id: "church-online",
    group: "Video",
    title: "Church Online Platform",
    aliases: ["chop", "church online", "online service", "online church", "prayer requests online", "salvation responses", "online chat", "online attendance", "webhooks"],
    body: `ProDeck shows your Church Online Platform service on any dashboard: add the **Church Online** tile.

**Step 1: the service.** **Settings, Online, Church Online**, type your Church Online address (like \`yourchurch.online.church\`, or your own domain if you use one) and press **Check**. The tile now counts down to the next online service and shows when it's live. Nothing else to set up.

**Step 2: activity (optional).** Press **Set up webhooks** and follow the four steps on the card. In Church Online's **Admin, Integrations, Webhooks**, add a webhook with the address ProDeck gives you, tick attended, chatted, prayer requested and moment interacted, then paste the secret key Church Online shows back into ProDeck. From then on the tile shows:

- how many people **watched** and **chatted** (and how many messages),
- **prayer requests** and **salvation responses**, with the person's name, as they happen.

**Paging the prayer team.** On the same card, tick who should be paged. When someone asks for prayer or responds to a salvation moment, their phones buzz with the name, so someone can go and pray with them in Church Online.

**What it can't do.** Church Online doesn't share what people type, so chat messages and prayer requests themselves stay in Church Online, and ProDeck can't post into the chat. Some numbers (who watched, how long) may only arrive when Church Online sends them, which can be after the service.

**Privacy.** Church Online sends the activity to White Oak Media's relay, because a booth computer has no public address to receive it. The relay keeps the person's first name and last initial (never email addresses) for three days, checks every message is really from Church Online, and only your booth can read your inbox. **Disconnect** on the card deletes the inbox.`,
    settings: "set-chop",
    related: ["stream-monitor", "pages", "report-problem"],
  },

  // -------------------------------------------------------------------- audio
  {
    id: "setup-recording-automix",
    group: "Audio",
    title: "Setting up recording and Automix",
    aliases: ["multitrack", "record every channel", "usb audio", "console usb", "automix setup", "which fader", "setup wizard", "stems"],
    body: `Both have a step by step setup. Open it from **Setup** (the cards under *Add the rest*), the **Set up** button on the Recording page or the Automix tile, or **Run setup** on their cards in Settings.

**Recording** asks where the audio comes from (ProDeck's own input, usually Dante Virtual Soundcard, or a console plugged in over USB), checks which channels have signal, names the tracks (it can fill names in from Dante and from what ProDeck already knows), and picks the drive. Each Next saves that step. Recording never starts on its own: someone presses Record.

**Automix** connects the console, then asks which of your faders plays each part: guitars, keys, drums, bass, backing vocals, effects and so on. Use the faders you already mix from, usually DCAs, or type ch and a number for a single channel. It rewrites its moves for your fader names, so a desk that says "Elec Gtr" instead of "EGs" works the same. Then the instrument feeds, backing vocals, where the song timing comes from (a guide track, a click, or MIDI clock; at least one), and the speech mics. Nothing is saved until **Save** on the last step, and Automix only moves faders after someone presses **Arm**.

Running either one again starts from your current answers.`,
    related: ["console", "soundcheck-playback"],
  },
  {
    id: "soundcheck-playback",
    group: "Audio",
    title: "Mixing a recorded service on the console (Virtual SoundCheck)",
    aliases: ["virtual soundcheck", "virtual sound check", "vsc", "mix the multitrack", "playback", "practice mixing", "patch sheet"],
    body: `On the **Recording** page, press **Soundcheck** next to a recorded service. ProDeck plays it back out of Dante Virtual Soundcard, each track on its own Dante output, and writes the **patch sheet** that makes the console hear it.

**The patch sheet** lists, for every console channel it can play back:

- **Virtual SoundCheck:** the I/O Port 1 channel to set for that channel in the desk's Virtual SoundCheck matrix.
- **Dante subscription:** which console Dante input to point at which of this computer's outputs, in Dante Controller.

**The layout is fixed.** The first time, ProDeck works out a soundcheck layout from your Sunday routing and keeps it: every channel always comes back on the same console input, from the same output of this computer, whichever recording you play. So the Dante subscriptions and the Virtual SoundCheck matrix are the same every time. Set them up once and save them as a preset. ProDeck only ever adds to the layout, when this computer starts recording a new source. Open this page with your Sunday routing in place the first time: if the console is already listening to this computer, ProDeck can't see the Sunday sources and asks you to load your Sunday preset first.

It never changes anything on the desk or the network itself.

**Do it when no service is on:**

1. In Dante Controller, **save a preset of your Sunday routing first**. That's your way back.
2. Make the subscriptions on the sheet, and save them as a Soundcheck preset. Next time, just load it.
3. On the Avantis: **I/O, Virtual SoundCheck**. Pick I/O Port 1, set the matrix from the sheet, every other channel off, and switch it on.
4. Press **Play**. Jump to any song with its marker.
5. **After:** Virtual SoundCheck to Inactive on the desk, then apply your Sunday preset in Dante Controller.

Until the console stops listening to the soundcheck outputs, ProDeck shows a reminder on every page. Playing is silent until the subscriptions are made, so pressing Play by mistake during a service does nothing. The Waves loop and this computer's outputs 1 and 2 are never used. Channels whose Dante input gets borrowed are listed, since they go quiet until Sunday is back.

Recordings made with ProDeck 0.9.98 or later save their own routing. For older ones the sheet uses today's routing and says so.`,
    related: ["setup-recording-automix"],
  },
  {
    id: "audio-spl",
    group: "Audio",
    title: "SPL meter and calibration",
    aliases: ["how loud is it", "db meter", "calibrate spl", "match a real spl meter", "rta"],
    body: `**Settings, Sound, Audio & Captions** picks the input (a room mic, or a Dante channel). The **SPL + RTA** tile then shows level and spectrum.

Calibration is on the tile itself: press **Calibrate** while holding a real SPL meter next to the mic and enter what it reads. The offset applies everywhere ProDeck shows SPL, including reports. Without calibration the numbers are relative, not real dB.`,
    settings: "set-audio",
  },
  {
    id: "walk-in-music",
    group: "Audio",
    title: "Walk-in music",
    aliases: ["spotify", "apple music", "music app", "pre-service music", "walk in music", "fade out music", "house music", "background music", "countdown audio", "silent before service"],
    body: `ProDeck can control the music playing on the booth computer, in the **Spotify** app or Apple's **Music** app, from any dashboard or crew phone. There's no Spotify account to connect: ProDeck asks the app that's already open and signed in. Mac only for now.

**Set up.** **Settings, Sound, Walk-in music**: choose the app, paste the playlist **Start walk-in** should play (in Spotify: the playlist's **…**, **Share**, **Copy link**; in Music, type the playlist's name), and set the walk-in volume. Add the **Walk-in Music** tile to a dashboard. The first time, macOS asks whether ProDeck may control the app: choose **Allow**. If you said no, switch it on in **System Settings, Privacy & Security, Automation**, under ProDeck.

**On the tile:** what's playing, play and pause, skip, volume, **Start walk-in** (plays the playlist and fades it up over a few seconds) and **Fade out**. Crew phones need the **Control** permission to use the buttons; everyone else sees what's playing.

**The automatic fade.** With **Fade out by itself before each service starts** ticked, ProDeck fades the music over the **Fade length** you set, so it's silent as each service time in Planning Center starts, once per service, then pauses it and puts the volume back for next time. Rehearsal and call times never trigger it.

**Quiet before a countdown.** If your countdown video has its own audio near the end, set **Silent this many minutes before the service** (up to 30, in half minutes). The music is then already silent that many minutes before each service starts. Leave it at 0 to fade right at the start time.

**Licensing.** Spotify's and Apple's terms are for personal listening. Check your church's music licensing before using them for walk-in music.`,
    settings: "set-music",
    related: ["mac-permissions", "crew-permissions"],
  },

  // ---------------------------------------------------------- updates & backup
  {
    id: "updates",
    group: "Updates & backup",
    title: "Updating ProDeck",
    aliases: ["update available banner", "install and restart", "update failed", "check for updates", "download it again"],
    body: `ProDeck checks a few seconds after launch and shows a banner with the release notes and **Install & Restart**. **Later** remembers that version and won't nag; a newer one still gets to interrupt. **Settings, App & help, Software Update, Check for updates** always reports.

After an update with new features, the booth opens **What's new in ProDeck**, a short tour of what was added. Phones, kiosks and TVs pick up the new version from the booth by themselves.

If an update fails, the banner says what went wrong with **Try again** and **Download it manually**. If updates keep failing, download a fresh copy from **whiteoakmedia.io/tools** and drag it over the old one. Your settings, dashboards, crew and reports live outside the app and are untouched.

ProDeck for Mac is signed and checked by Apple, so a fresh copy opens like any other app. The first update to the signed version may ask once more for permissions you gave before: choose Allow.`,
    settings: "set-update",
    guide: "care",
    related: ["whats-new", "mac-permissions", "tv-screens"],
  },
  {
    id: "backup",
    group: "Updates & backup",
    title: "Backup and restore",
    aliases: ["move to a new mac", "backup file", "restore from backup", "what's in the backup"],
    body: `**Settings, App & help, Backup & restore, Back up now** writes one file holding your settings, dashboards, crew accounts, checklists, schedules, reports and position files. **Restore from a backup…** replaces this computer's data with the file's and **restarts ProDeck**. The restart is required; without it the running app would write its old data back.

> The backup contains your passwords and API keys: that's what makes it a full restore. Keep it like a password, on a drive in a safe or in an encrypted cloud folder, not email.

ProDeck also keeps rolling backups of every data file beside the original (\`*.bak.json\`) and, if a file is ever damaged, keeps the damaged copy and recovers from the backup rather than starting empty.`,
    settings: "set-backup",
    guide: "care",
  },
  {
    id: "keep-running",
    group: "Updates & backup",
    title: "Keeping ProDeck running unattended",
    aliases: ["watchdog", "start at login", "relaunch after crash", "sleep guard", "mac went to sleep"],
    body: `**Settings, App & help, Reliability** has two switches for a booth computer: a **watchdog** that starts ProDeck at login and relaunches it within seconds of a crash (Mac; on Windows it can start at login but not relaunch), and a **sleep guard** so the machine never dozes mid-service.

Move ProDeck to the Applications folder first: the watchdog needs a path that won't change. A deliberate Quit stays quit; only crashes are relaunched.`,
    settings: "set-reliability",
    guide: "care",
  },

  // ------------------------------------------------------------ troubleshooting
  {
    id: "blank-tile",
    group: "Troubleshooting",
    title: "A widget is blank on a phone or kiosk but fine on the booth",
    aliases: ["works on the booth but not my phone", "blank widget on kiosk", "tile empty on phone", "needs admin access"],
    body: `Almost always one of two things:

- **The booth is running an older ProDeck** than the one with the fix. Kiosks, TVs and phones are served by the booth, so they can't be newer than it. Check **Settings, App & help, Software Update** on the booth.
- **That tile needs the admin password or a permission** and the screen signed in with the crew one. Control tiles do; viewing tiles shouldn't. If a purely viewing tile is blank on the crew password, that's a bug worth reporting.

Reload the phone or kiosk after updating the booth.`,
    related: ["updates", "gateway-passwords", "crew-permissions", "report-problem"],
  },
  {
    id: "report-problem",
    group: "Troubleshooting",
    title: "Reporting a bug or asking for a feature",
    aliases: ["found a bug", "how do I report", "report a bug", "request a feature", "diagnostics", "send logs", "contact", "feature request", "suggestion", "idea", "feedback", "crash reports", "sentry", "usage count", "analytics", "telemetry", "privacy"],
    body: `Press **Report a bug** or **Request a feature** at the bottom of the sidebar (also on the Help page and in **Settings, App & help, Help & support**). Fill in what happened, how much it matters, and an email if you'd like a reply. It goes privately to White Oak Media, where every one is read.

Tick **Include diagnostics** and the report carries ProDeck's version, the computer's system, which connections are up, and the recent log, with every password, key and token removed first, along with your Planning Center ID and public address. **See exactly what's sent** shows it before you send. You can attach a screenshot too.

The more specific the better: what you pressed, what you expected, what happened, and roughly when.

**Crash reports.** When something breaks, ProDeck also sends White Oak Media an automatic report of what failed and where in the code: no names, plans, passwords or addresses. Turn it off in **Settings, App & help, Help & support, Send crash reports**.

**Anonymous usage count.** About once a day the booth app tells White Oak Media that one copy of ProDeck is in use: a random ID made on that computer, the ProDeck version, and Mac or Windows. Nothing about your church or anyone in it. Turn it off in **Settings, App & help, Help & support, Send an anonymous usage count**.

Rather post publicly? **Rather post it publicly on GitHub?** on the same card opens a pre-filled GitHub issue, which anyone can read.`,
    settings: "set-help",
    guide: "honest",
  },
  {
    id: "ask-prodeck",
    group: "Troubleshooting",
    title: "Ask ProDeck when something is wrong",
    aliases: ["ask prodeck", "troubleshooter chat", "ai help", "anthropic api key", "claude", "ask a question about the sound", "knowledge folder"],
    body: `**Ask ProDeck** is a box at the top of **No sound?** (phone: Home, No sound?; booth: Routing, No sound?). Type what is wrong in your own words ("the lead vocal mic is crackling", "nothing from the keys", "the stream is quiet") and it answers the way an experienced tech would: one clarifying question if it needs one, what ProDeck already checked, then the next thing to walk to and look at.

It can only say what this building's **routing map**, **knowledge files** and **live state** say. Every fact it uses is tied to a thing on the map, shown as a link under the answer; tap it to open the walk. It never touches the desk.

**To turn it on:** **Settings, App & help, Troubleshooter**, paste an Anthropic API key (console.anthropic.com), pick a model, and choose whether crew phones may ask. The key stays on the booth; phones ask through it.

- **Knowledge files.** A folder on the booth (Settings shows where) holding plain text notes about your building: machines and addresses, which scenes are safe to recall mid-service, what feeds what, known oddities. Everything in it is read on every question. Write what a new sound tech would need.
- **The log.** Every question and answer is kept on the booth so whoever owns the room can see what was asked and fix the notes.
- **The cap.** A monthly call limit, 500 by default, so a stuck phone can't run up a bill.

> Its general sound knowledge is a written method that ships with ProDeck: signal flow reasoning, symptoms and causes, wireless, Dante, scenes, rules during a service. It is told to reason from that text and this building's notes, not from memory.`,
    settings: "set-assist",
    related: ["routing-walk", "routing-map"],
  },
  {
    id: "routing-walk",
    group: "Troubleshooting",
    title: "When something has no sound",
    aliases: ["no sound", "dead mic", "mic not working", "no signal from a vocal", "troubleshooter", "where do i look when a channel is dead"],
    body: `On a phone, **Home, No sound?** On the booth, **Routing, No sound?**. Pick the person (this week's team, from their mic assignment), the channel, or the place with no sound.

ProDeck then does two things, in this order:
1. **Checks what it can see from the booth.** Is the channel muted or its fader down on the desk? Is the desk connected? Is signal reaching ProDeck's own input? Each is a ✓ or a ✗, and every ✓ is a place you don't have to walk to. A ✗ comes with the fix ("Unmute channel 39").
2. **Lists what is left to walk to, most likely first.** Pack switched on, receiver RF light, battery, then the socket, then the door, then the desk. Where a rule explains a surprise (two channels share one gain, stereo pairs are odd and even) it appears right under the step.

- Anything the church has flagged under **Things to watch** for that path shows first.
- The footer says when the map was last verified. Old maps can be wrong; tell the booth when a step was wrong.
- Phones only read the map. The booth edits it.

ProDeck never guesses here. If it can't see a step, it says so and hands you the checklist for it.`,
    related: ["routing-map", "ask-prodeck", "audio-spl", "console"],
  },

  // ----------------------------------------------------------------- security
  {
    id: "security-posture",
    group: "Security",
    title: "What ProDeck protects, and what it doesn't",
    aliases: ["is this secure", "who can see what", "passwords in the clear", "security model"],
    body: `An honest summary, so you can decide what to expose:

- **Two shared passwords** decide what a phone may do. Anyone with the crew password is crew. Choose long ones; change the crew password if a phone is lost (it signs everyone out, so send the new crew code).
- **Crew PINs are four digits.** They identify people; they don't protect anything. The passwords do. Wrong PINs lock the name for five minutes.
- **Joining needs you.** Outside a joining window you open, the poster only lets someone ask to join; nobody gets in until you approve them.
- **Grants are per person and can be taken back.** Giving someone Page or Control doesn't hand them the admin password, and revoking their approval removes every grant at once.
- **The web gateway slows down password guessing** and refuses requests from other websites.
- **Secrets never leave the booth in the clear.** Phones receive settings with every password and key removed; the diagnostics bundle is scrubbed before it's copied.
- **The crew address keeps a copy** of the week's plan, checklists, crew names and chat with White Oak Media, so crew can see it while the booth is off. Passwords are only kept there as a scrambled check. Turn the crew address off and the copy is deleted.
- **A kiosk link, TV or tally link holds the crew password** and can be read off that device. Don't put the admin password in one.

Security problems: **SECURITY.md** in the repository explains how to report privately.`,
    guide: "honest",
    related: ["gateway-passwords", "crew-overview", "crew-address"],
  },
];

export const HELP_BY_ID: Record<string, HelpTopic> = Object.fromEntries(
  HELP_TOPICS.map((t) => [t.id, t]),
);
