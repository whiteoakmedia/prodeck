/**
 * ProDeck's help, as data.
 *
 * This is the single source of truth for in-app help: the Help page renders it,
 * search indexes it, the `?` on every Settings card jumps into it, and when a
 * Gemini key is configured the assistant answers ONLY from it. Keep it plain and
 * specific — name the page, the card, the button. The reader is usually a
 * volunteer with a service starting soon.
 *
 * Body markup is deliberately tiny: a line starting "- " is a bullet, "1. " is a
 * numbered step, "> " is a callout, and **text** is bold. Nothing else.
 *
 * `aliases` are the ways someone might actually ask — search scores them
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
    aliases: ["what does prodeck do", "overview", "what is this app for", "features"],
    body: `ProDeck is the production booth in one place. It sits on the booth computer and connects to the things a service runs on, then puts what they know onto dashboards that anyone on the team can see — on the booth screen, on a phone, or on a TV in the office.

- **ProPresenter** — live slide, timers, layers, stage message. Read and control.
- **Planning Center Services** — the plan, the team, call times, chord charts, LIVE control.
- **Sound console** — Allen & Heath Avantis, dLive and SQ; Behringer X32 / Midas M32. Mutes, faders, names, scenes.
- **OBS Studio** — are we streaming, are we recording, dropped frames.
- **NDI cameras** — a stage feed on any dashboard or kiosk.
- **Crew phones** — a web app your volunteers add to their home screen: check-in, chat, pages that buzz, chord charts, checklists.
- **TapLink** — NFC discs in the lobby that always open the right link for the moment in the service.
- **Reports** — what actually happened each Sunday: timing, SPL, tap counts.

Nothing needs an account or a licence. The booth computer holds everything; phones and kiosks talk to it over your Wi-Fi.`,
    guide: "top",
    related: ["first-run", "setup-page"],
  },
  {
    id: "first-run",
    group: "Getting started",
    title: "The first-run setup, and how to run it again",
    aliases: ["setup wizard", "onboarding", "how do I start over", "re-run setup", "I skipped a step"],
    body: `The first time ProDeck opens it walks you through connecting each tool, one step at a time, and actually connects them — it doesn't just tell you where to click later. Every step is skippable and your progress is saved if you close mid-way.

To run it again: **Setup** (in the sidebar) → **Run the setup again**. Nothing you've already configured is touched; each step shows what is connected and lets you change it.

> The **Setup** page is also the place to look when something isn't green. One row per connection, what the state means, and the one thing to try.`,
    related: ["setup-page", "demo-mode"],
  },
  {
    id: "setup-page",
    group: "Getting started",
    title: "The Setup page: is everything connected?",
    aliases: ["status page", "why is something red", "what does attention mean", "connection status"],
    body: `**Setup** in the sidebar shows one row per thing ProDeck talks to, with a live state:

- **Connected** — working now.
- **Not set up** — you haven't configured it. That's fine; only connect what you use.
- **Attention** — configured, but something is off (a plan isn't selected, the console dropped, OBS closed).
- **Problem** — it's configured and failing. The row says what to try.

Each row has a jump to the Settings card where it's configured. Come here before asking anyone: nine times in ten the answer is on this page.`,
    related: ["first-run"],
  },
  {
    id: "demo-mode",
    group: "Getting started",
    title: "Demo mode — see it working before connecting anything",
    aliases: ["try it without hardware", "sample data", "how do I see what it does", "explore"],
    body: `Demo mode fills every dashboard with a pretend Sunday — a plan, a team with check-ins, a live slide, sound levels, a mirrored console — so you can see what ProDeck does before wiring up your booth.

Turn it on from the welcome screen, or **Settings → Help & support → Try demo mode**. A banner stays up the whole time. It saves nothing and can't touch your equipment. **Exit demo** in the banner puts everything back.`,
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
    body: `Two separate things decide what a phone can do, and it helps to keep them apart.

**1. The gateway password — what a phone may DO.** There are two: the **admin** password (full control: ProPresenter, console, settings, sending pages) and the **crew / member** password (look, chat, check in, confirm pages, see the plan). A phone types one of these once. Set both in **Settings → Browser Access**.

**2. A crew account — WHO the phone is.** Each volunteer picks their name and a 4-digit PIN. That name is what appears on chat messages, who a page is addressed to, and who the leader board says has arrived. Accounts live in **Settings → Crew Members**.

Joining does both at once: the join link carries the crew password, and the volunteer then creates their account. New accounts wait for your approval unless they came in through a personal invite.

**3. Grants — what a specific person may do beyond looking.** On top of the crew password, you can give an individual account permissions: **Page**, **Stage**, **Control**, **Tap discs**, **Manage crew**. Set them per person in **Settings → Crew Members → Edit**. A volunteer with no grants is a viewer, which is what most of the team should be.`,
    settings: "set-crew",
    guide: "phase1",
    related: ["crew-joining", "crew-approve", "crew-roles", "crew-permissions", "gateway-passwords"],
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
      "needs admin access on my phone",
      "grants",
      "per person permissions",
    ],
    body: `Every phone signed in with the crew password is a **viewer**: dashboards, the plan, chat, check-in, confirming pages, cameras. The admin password unlocks everything. In between, you can grant a specific person exactly what their job needs — without handing them the admin password.

**Settings → Crew Members → Edit** on the person, then tick:

- **Page** — send pages and re-buzz them. Give this to whoever runs the room, not to everyone.
- **Stage** — put text on the stage displays and confidence screens, and clear it. Kids ministry, for child alerts.
- **Control** — drive ProPresenter (next/previous, clear, macros, looks), the sound console, OBS scenes, and Planning Center LIVE. Your ProPresenter operator and worship leader.
- **Tap discs** — override where the lobby NFC discs point.
- **Manage crew** — approve, edit and remove crew, create invites, open joining. Your team lead. It does **not** include granting permissions; only the admin password can grant.

Grants take effect on their phone within a few seconds, no sign-out needed. Revoking approval removes every grant at once. If a phone reports *"needs the page permission"*, that's exactly what to tick.

> Why not just give them the admin password? Because it can't be taken back from one person — you'd rotate it for everyone. A grant can.`,
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
      "invite someone",
      "joining is closed",
      "why does the join link not work",
      "open joining",
    ],
    body: `There are two ways in. Both end with the volunteer adding ProDeck to their home screen so pages reach them with the app closed.

**The poster (shared link).** **Settings → Crew Members → Crew invite link** gives you a QR code and a **Print poster** button. Hang it in the booth or green room. Scanning it joins with the crew password and asks the person for a name and PIN; **you then approve them once**.

The poster only works **while joining is open**: press **Open for 15 min** (or 1 hour) on the same card when you're signing people up. It closes itself. Anyone already joined is unaffected — this only gates first-time signups. If someone scans while it's closed they see *"Joining is closed right now — ask whoever is at the production computer to open joining."*

> Why the window? That link hands out a real credential and a printed code has nobody to ask for a password, so time is the only honest gate. Before this, anyone anywhere could request it.

**A personal invite (one person).** On the same card, **Personal invites**: type their name and role, press Create, send them the link. It's good for a week, works once, and they arrive **pre-approved** with name and role already filled in — the invite is the approval. Best for new team members you already know.`,
    settings: "set-crew",
    related: ["crew-approve", "crew-signout", "gateway-passwords"],
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
    body: `**Settings → Crew Members** lists everyone. A **pending** badge on the Settings nav means someone is waiting.

- **Approve** — makes the account live. Until then their phone shows a waiting screen.
- **Edit** — fix a typo in a name without breaking their PIN, add a **nickname** (also works to sign in), set their **role**, and choose exactly which **Planning Center person** they are. A link you set by hand is pinned; the weekly automatic matching never overwrites it.
- **Remove** — signs that phone out and deletes the account. Their chat history stays.

If someone forgets their PIN there is no reset — remove the account and have them join again. PINs identify people; the gateway password is what protects anything.`,
    settings: "set-crew",
    related: ["crew-roles", "crew-signout"],
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
    body: `A role is what a person is doing this Sunday — "Camera 1", "Audio A2", "Lyrics", "Stage". Roles drive three things:

- **The leader board** sorts by exception: "Camera 1 — not here yet" is actionable in a way "Sam — not here yet" isn't.
- **Role channels in chat.** Every role gets its own conversation ("role:Camera") next to the team channel, so the camera ops can talk without paging the whole crew.
- **Checklists.** A checklist can be assigned to a role so the right people see it on their phone.

**Your church's roles** live in **Settings → Crew Members → Roles you use**. They appear as suggestions wherever a role is typed — when a volunteer joins, when you edit a person, on a personal invite. Any text is still allowed; the list just keeps spelling consistent so the board and the channels don't fragment into "Camera 1", "Cam 1" and "camera1".

> Where possible, roles come from Planning Center: when a phone picks their name off this week's team, their PCO position becomes their role automatically.`,
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
    ],
    body: `On the phone, **More** has two different exits:

- **Lock (PIN again)** — keeps the account on this phone, asks for the PIN next time. Use this on a shared device.
- **Sign out completely** — forgets the account on this phone. Your account still exists at the booth; scan the poster or open the app again and **sign in with the same name and PIN**.

If you type your own name and see *"that name is taken"*, the app now tries your PIN against the existing account — that IS the sign-in path.

**Locked out after wrong PINs.** Five wrong attempts locks that name for five minutes. Wait it out; a fresh streak starts after. If a volunteer has genuinely forgotten their PIN, remove the account at the booth and have them rejoin.`,
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
    ],
    body: `A page is the emergency channel: it takes over the recipient's phone with a siren and heavy vibration until they tap **Got it**. Send one from the chat panel (**Page** on the booth, or the page composer on a phone with the admin password): pick people, pick a preset or type, send.

- **Got it** confirms. The sender sees who has and hasn't, and can **Re-buzz** the rest.
- Pages arrive as a **lock-screen notification** too, if the phone allowed notifications when it joined. iPhones can only buzz from the notification — Safari has no vibration control — so the notification is the buzz on an iPhone.
- A page the booth can no longer accept a confirmation for (the booth restarted, or it's old) shows a **Dismiss** option instead of ringing forever.

**Pages not arriving?** On the phone: **More → Page notifications** must say **on**, and the app must be added to the home screen. On the booth: **Settings → Crew Members** shows the person as approved.`,
    related: ["crew-overview", "phones-install"],
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
    body: `TapLink is NFC discs in your lobby that all open **one** link — and that link's destination follows the service. When the giving slide goes live in ProPresenter, every disc in the building points at giving. When the sermon notes slide is up, they point at notes. Afterwards they fall back to your default (usually a connect card).

The discs themselves are dumb: each one is written once with a URL like **https://go.yourchurch.org/now** and never rewritten. All the intelligence lives on a tiny web service ("the edge") that you deploy once on Cloudflare's free tier. ProDeck tells it what's live; it redirects taps accordingly and counts them.

You need three things: **a Cloudflare account** (free), **a computer with Node.js** to deploy from (once), and **NFC discs or stickers** (NTAG213 or better, a few dollars each).`,
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
    body: `**Settings → TapLink** walks you through this with the exact commands to copy. In outline:

1. Get the ProDeck source (**ProDeck on GitHub** in Help & support) and open the **taplink-edge** folder in a terminal.
2. \`npm install\`, then \`npx wrangler login\` — it opens Cloudflare in your browser; a free account is fine.
3. \`npx wrangler deploy\`. It prints your worker's URL — that's your **Edge URL**.
4. Create a token and store it as a secret: \`openssl rand -hex 32 | npx wrangler secret put TAPLINK_TOKEN\`. The value it printed is your **API token** — paste the same value into ProDeck.
5. Optional: a short domain like **go.yourchurch.org**. Uncomment \`routes\` in wrangler.jsonc, set your domain, deploy again. Cloudflare creates the DNS record.

Back in **Settings → TapLink**, paste the Edge URL and token and press **Save & test connection**. Green means the edge is reachable and the token works. Then set your links (**Keywords & links**) and write the discs.

> Keep the token private — it's what lets ProDeck retarget every disc in your building.`,
    settings: "set-taplink",
    related: ["taplink-discs", "taplink-keywords"],
  },
  {
    id: "taplink-discs",
    group: "TapLink",
    title: "Writing the NFC discs",
    aliases: ["what url goes on the disc", "nfc writer app", "ntag213", "how do I program the tags"],
    body: `Every disc gets the same URL: your edge URL followed by **/now** — for example **https://go.yourchurch.org/now**. **Settings → TapLink** shows yours ready to copy.

Write it with any NFC-writer phone app (NFC Tools is common and free): choose *URL*, paste, hold the disc to the phone. Use **NTAG213 or better** — the cheap NTAG203 tags are too small for a URL on some phones.

Because every disc carries the same fixed URL, you can add discs forever without ever rewriting one. Where the tap goes is decided by the edge at the moment of the tap.`,
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
    body: `In **Settings → TapLink → Keywords & links** you map short words to URLs: \`give\` → your giving page, \`connect\` → your connect card, \`prayer\` → the prayer form, and a **default** for when nothing is live. Each keyword can have its own timer; \`give\` typically reverts after 15 minutes so a disc tapped during coffee doesn't still say "give".

Then in ProPresenter, put **\`tap:give\`** (or \`tap: give\` — both work) in the **notes** of the slide that should switch the discs. When that slide goes live, every disc points at that link until another keyword fires, you override it, or its timer runs out.

- \`tap:default\` on a slide sends the discs back to the default.
- Renaming or removing a keyword does not touch ProPresenter — a slide still tagged with the old word silently stops switching until you re-tag it. The editor warns before saving such a change.
- The **TapLink widget** shows what the discs point at right now and how many taps today.`,
    settings: "set-taplink",
    related: ["taplink-override", "taplink-overview"],
  },
  {
    id: "taplink-override",
    group: "TapLink",
    title: "Overriding the discs by hand",
    aliases: ["force giving", "manual override", "discs are pointing at the wrong thing", "resume following"],
    body: `The **TapLink** dashboard widget has a button per keyword. Pressing one pins the discs to that link regardless of what's on screen; **Resume** hands control back to the slides. Only the admin password can override — crew phones can see the state but not change it.

The same buttons are on the edge's own emergency page at **your-edge-url/admin/‹admin key›**, which works even if the booth computer is off. Save it to the booth phone's home screen.`,
    settings: "set-taplink",
    related: ["taplink-keywords"],
  },

  // ------------------------------------------------------------- propresenter
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
    body: `In ProPresenter: **Settings → Network → Enable Network**. Note the port (usually 1025 for the API — the port Bonjour advertises is often the stage display's, and ProDeck knows to try 1025).

In ProDeck: **Settings → ProPresenter → Find** lists Pro instances on your network; pick one, or type the address. Once it has connected successfully, ProDeck reconnects on its own — including finding Pro again if its address changes, which matters when the Pro Mac is on DHCP.

If the header says Connected but nothing moves: ProDeck now notices when Pro stops sending and reconnects. If it stays stuck, quit and reopen ProPresenter — its network service occasionally wedges after a sleep.`,
    settings: "set-pp",
    guide: "features",
  },
  {
    id: "stage-message",
    group: "ProPresenter",
    title: "Stage messages and child alerts",
    aliases: ["put a message on stage", "child alert", "parent needed", "stage display text", "clear the stage message"],
    body: `The **Stage Message (Alerts)** widget puts a line of text on ProPresenter's stage displays and takes it off again — from any dashboard, including a phone with the admin password. Type a message, or press one of the quick buttons; **Clear** removes it.

It exists mainly for child alerts: the person who knows a parent is needed is rarely at the booth. Turn on **Auto-clear** (30, 60 or 120 s) in the widget's edit mode so an alert can't be left up all service; a countdown shows and **Keep up** cancels it. The countdown runs only while a dashboard showing the widget is open.

Edit the quick buttons in the widget's edit mode — one per line.`,
    related: ["dashboards-widgets"],
  },

  // ----------------------------------------------------------- planning center
  {
    id: "pco-connect",
    group: "Planning Center",
    title: "Connecting Planning Center (Personal Access Token)",
    aliases: [
      "pco 401",
      "planning center rejected credentials",
      "application id and secret",
      "personal access token",
      "nothing loads after entering pco credentials",
    ],
    body: `Credentials go on the **Planning Center** page (not Settings). You need a **Personal Access Token** — at api.planningcenteronline.com, open *Personal Access Tokens* and create one. It gives you an **Application ID** and a **Secret**; paste both.

> The same site also offers *OAuth applications* with a Client ID and Secret. They look nearly identical and **will not work here**. If ProDeck says the credentials were rejected, this is the usual cause.

The account that created the token needs access to **Services**. ProDeck verifies the credentials before it saves them, then lists your service types and plans. Pick this week's plan and the team, times and songs load.`,
    guide: "features",
    related: ["pco-live"],
  },
  {
    id: "pco-live",
    group: "Planning Center",
    title: "Planning Center LIVE: Take control, Next and Previous",
    aliases: ["take control", "next does nothing", "someone else is controlling", "auto advance", "follow propresenter"],
    body: `Planning Center only moves LIVE for whoever holds the **controller**. An untouched plan has nobody holding it, which is why Next did nothing on its own. ProDeck takes control for you when the plan is free, and refuses — telling you who has it — when a teammate is driving from their own device.

- **Take control / Release** is on the Planning Center page.
- **Auto-advance** moves LIVE when ProPresenter moves to the next item. **Follow ProPresenter** does the reverse.
- If Next appears to do nothing, look for the message under the buttons: it names who holds control, or says it couldn't confirm and to try again.`,
    related: ["pco-connect"],
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
    body: `The **Keys to the Stage** widget is for a screen where the worship team waits — a green room, the office, wherever breakfast is. It counts down the live item's planned length and, when songs come next, **five minutes before that item is due to end** it turns into a call: *TO THE STAGE*, the countdown, and the next songs with their **keys** in the biggest type on the wall.

- The classic case is the closing set after the sermon, but it works for any run of songs after any timed item — including the opening set after a pre-service countdown.
- The start time comes from service tracking, so a screen that comes on mid-sermon still knows where it is. If the start genuinely isn't known, it shows the songs and keys without a countdown rather than guess.
- If the sermon runs long the call stays up and shows *over by* how much.
- Change the lead time (3, 5, 7 or 10 minutes) in the widget's edit mode.

Pair it with **Service Countdown**, **Show Flow** and **Song Leaders**, and turn on **Room audio** for the dashboard so the room hears the service without a tile. The **Green Room** template is exactly this layout.`,
    related: ["kiosk", "dashboards-widgets", "pco-connect"],
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
    ],
    body: `**Settings → Browser Access** turns on the web gateway: the same ProDeck, served to phones and kiosks on your Wi-Fi at **http://‹booth-name›.local:8088**.

- **Admin password** — full control. Give it to people who run the booth.
- **Crew (member) password** — look, chat, check in, confirm pages, watch cameras. This is what the join link carries, and what a kiosk bookmark should use.

Use long passwords. The gateway is reachable from anywhere you expose it (a public URL through Cloudflare, for instance), and the crew password is the durable credential every phone holds. Rotating the crew password signs every phone out.`,
    settings: "set-web",
    guide: "phase1",
    related: ["kiosk", "phones-install", "public-url"],
  },
  {
    id: "phones-install",
    group: "Phones & kiosks",
    title: "Adding ProDeck to a phone's home screen",
    aliases: ["install on iphone", "add to home screen", "notifications on the phone", "app keeps signing me out"],
    body: `Open the join link in the phone's browser, then:

- **iPhone (Safari):** Share → **Add to Home Screen**. Open it from the icon, not Safari. Allow notifications when asked — on an iPhone, the notification is the only buzz a page can make.
- **Android (Chrome):** menu → **Add to Home screen**, or **Install app** if offered. Allow notifications.

From the icon, the app remembers the account and reconnects by itself. If it ever lands on the password screen, the crew password changed — get the new join link.`,
    related: ["pages", "gateway-passwords"],
  },
  {
    id: "kiosk",
    group: "Phones & kiosks",
    title: "Kiosk screens: an office TV or a switcher monitor",
    aliases: ["kiosk mode", "office tv", "chromeless dashboard", "?kiosk=", "mac mini setup", "camera not showing on kiosk"],
    body: `A kiosk is a browser showing one dashboard, full screen, with nothing to click. **Settings → Kiosk screens**: pick the dashboard, copy the link (or scan the QR), and follow the steps for a Mac, Windows PC or iPad.

The link carries the **crew password** so a keyboard-less machine never has to type it. Leave the machine on: if the booth goes away the kiosk shows an "offline — reconnecting" splash and comes back by itself, picking up any ProDeck update along the way. Layout changes made on the booth appear within a minute.

Cameras, the sound desk and OBS all work on a kiosk. (Before 0.9.75 they didn't — the tiles sat blank.)

**Room audio without a tile.** Edit the dashboard and press **Room audio: on**. Any kiosk showing that dashboard plays the room's audio in the background — no Overflow Listen tile taking up space. On a Mac mini the Chrome flag \`--autoplay-policy=no-user-gesture-required\` is what lets it start with nobody clicking; set the volume on the TV.

**It fills the screen.** A kiosk scales the layout so the tallest column exactly fills the TV, whatever size it is.`,
    settings: "set-kiosk",
    related: ["gateway-passwords", "ndi"],
  },
  {
    id: "public-url",
    group: "Phones & kiosks",
    title: "Reaching the booth from outside the building",
    aliases: ["public url", "cloudflare tunnel", "use from home", "prodeck.live", "booth off fallback"],
    body: `By default phones only reach the booth on the church Wi-Fi. **Settings → Browser Access → Public URL** is where you put your own domain if you set up a Cloudflare Tunnel to the booth computer. Then the same join link works from anywhere, and with the optional edge worker the week's plan and chat keep working even when the booth is off.

This is the most involved optional setup. The Adopter's Guide covers it end to end; do it after everything else is working.`,
    settings: "set-web",
    guide: "phase3",
  },

  // --------------------------------------------------------------- dashboards
  {
    id: "dashboards-widgets",
    group: "Dashboards",
    title: "Dashboards and widgets",
    aliases: ["add a widget", "adding widgets doesn't work", "edit layout", "new dashboard", "starter templates", "widget is blank"],
    body: `A dashboard is a grid of widgets. Press the **pencil** to edit, then **Add Widget**; drag to move, drag the corner to resize, × to remove. Edits save automatically. New widgets are added at the **bottom** — ProDeck scrolls to them and highlights them.

- **Templates** (in the dashboard menu) create ready-made layouts — FOH, Production Manager, Director, Mics & Worship — from what you have connected.
- Dashboards can be edited from a browser signed in with the admin password, not just the booth.
- A widget that says what to connect and offers a **Set up** button hasn't got its source yet. One that says *offline* has a source that isn't reachable right now.`,
    related: ["kiosk"],
  },

  // -------------------------------------------------------------- sound console
  {
    id: "console",
    group: "Sound console",
    title: "Connecting a sound console",
    aliases: ["avantis", "dlive", "sq5", "x32", "m32", "console shows disconnected", "midi over tcp", "osc port 10023"],
    body: `**Settings → Sound Console**: pick the model, type the console's IP, and watch it connect.

- **Allen & Heath Avantis / dLive / SQ** — MIDI over TCP. Avantis and dLive use port 51325 (dLive Surface: 51328). Match the **MIDI base channel** to the console's *Utility → Control → MIDI* setting.
- **Behringer X32 / Midas M32** — OSC, port 10023. Nothing to configure on the console.

Once connected, the **Sound Desk** widget mirrors mutes, faders and names, and the desk watchdog can page one person when something changes during a service. Control (mute, fader, scene recall) needs the admin password.

> Only the Avantis has been run against real hardware. The others are built from the manufacturers' published protocols and covered by tests — the console picker says which is which. If yours is one of those, a report either way is genuinely useful.`,
    settings: "set-avantis",
  },

  // -------------------------------------------------------------------- video
  {
    id: "ndi",
    group: "Video",
    title: "NDI cameras and the Stage Feed widget",
    aliases: ["ndi not showing", "stage feed", "camera on dashboard", "ndi runtime", "no sources found"],
    body: `**Settings → Stage feed (NDI)** lists every NDI source ProDeck can see on your network — which also proves NDI itself is working. The source is chosen **inside the Stage Feed widget**: add it to a dashboard, press the pencil, pick the camera.

- Nothing listed? The NDI runtime must be installed on the booth computer, and the camera or software must be on the same network and actually sending.
- Feeds are shared: several widgets and kiosks can watch one camera and the booth encodes it once.
- Cameras work on kiosks and phones since 0.9.75.`,
    settings: "set-ndi",
    related: ["kiosk"],
  },
  {
    id: "obs",
    group: "Video",
    title: "OBS Studio: are we live?",
    aliases: ["obs websocket", "streaming status", "recording status", "dropped frames", "skipped frames"],
    body: `In OBS: **Tools → WebSocket Server Settings**, enable it, note the port (4455) and set a password. In ProDeck: **Settings → OBS Studio**, enter the port and password.

The **OBS** widget then shows the current scene, whether you're **streaming** and **recording** with elapsed time, and **% skipped (encoder)** — frames the encoder couldn't keep up with, which points at the computer rather than the network. When OBS can't reach the streaming service at all, that's shown as its own state.`,
    settings: "set-obs",
  },

  // -------------------------------------------------------------------- audio
  {
    id: "audio-spl",
    group: "Audio",
    title: "SPL meter and calibration",
    aliases: ["how loud is it", "db meter", "calibrate spl", "match a real spl meter", "rta"],
    body: `**Settings → Audio & Captions** picks the input (a room mic, or a Dante channel). The **SPL + RTA** widget then shows level and spectrum.

Calibration is on the widget itself: press **Calibrate** while holding a real SPL meter next to the mic and enter what it reads. The offset applies everywhere ProDeck shows SPL, including reports. Without calibration the numbers are relative, not real dB.`,
    settings: "set-audio",
  },

  // ---------------------------------------------------------- updates & backup
  {
    id: "updates",
    group: "Updates & backup",
    title: "Updating ProDeck",
    aliases: ["update available banner", "install and restart", "update failed", "check for updates", "download it again"],
    body: `ProDeck checks a few seconds after launch and shows a banner with the release notes and **Install & Restart**. **Later** remembers that version and won't nag; a newer one still gets to interrupt. **Settings → Software Update → Check for updates** always reports.

If an update fails, the banner says what went wrong with **Try again** and **Download it manually**. If updates keep failing, download a fresh copy from **whiteoakmedia.io/tools** and drag it over the old one — your settings, dashboards, crew and reports live outside the app and are untouched.`,
    settings: "set-update",
    guide: "care",
  },
  {
    id: "backup",
    group: "Updates & backup",
    title: "Backup and restore",
    aliases: ["move to a new mac", "backup file", "restore from backup", "what's in the backup"],
    body: `**Settings → Backup & restore → Back up now** writes one file holding your settings, dashboards, crew accounts, checklists, schedules, reports and position files. **Restore from a backup…** replaces this computer's data with the file's and **restarts ProDeck** — the restart is required; without it the running app would write its old data back.

> The backup contains your passwords and API keys — that's what makes it a full restore. Keep it like a password: a drive in a safe or an encrypted cloud folder, not email.

ProDeck also keeps rolling backups of every data file beside the original (\`*.bak.json\`) and, if a file is ever damaged, keeps the damaged copy and recovers from the backup rather than starting empty.`,
    settings: "set-backup",
    guide: "care",
  },
  {
    id: "keep-running",
    group: "Updates & backup",
    title: "Keeping ProDeck running unattended",
    aliases: ["watchdog", "start at login", "relaunch after crash", "sleep guard", "mac went to sleep"],
    body: `**Settings → Reliability** has two switches for a booth computer: a **watchdog** that starts ProDeck at login and relaunches it within seconds of a crash (Mac; on Windows it can start at login but not relaunch), and a **sleep guard** so the machine never dozes mid-service.

Move ProDeck to the Applications folder first — the watchdog needs a path that won't change. A deliberate Quit stays quit; only crashes are relaunched.`,
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

- **The booth is running an older ProDeck** than the one with the fix. Kiosks and phones are served by the booth, so they can't be newer than it. Check **Settings → Software Update** on the booth.
- **That widget needs the admin password** and the screen signed in with the crew one. Control widgets do; viewing widgets shouldn't — if a purely viewing widget is blank on the crew password, that's a bug worth reporting.

Reload the phone or kiosk after updating the booth.`,
    related: ["updates", "gateway-passwords", "report-problem"],
  },
  {
    id: "report-problem",
    group: "Troubleshooting",
    title: "Reporting a problem",
    aliases: ["found a bug", "how do I report", "diagnostics", "send logs", "contact"],
    body: `**Settings → Help & support**: describe what happened and press **Report on GitHub**. ProDeck opens a pre-filled issue and puts a diagnostics bundle on your clipboard to paste in — every password, key and token is removed first, and so is your Planning Center ID and public address.

The more specific the better: what you pressed, what you expected, what happened, and roughly when. **Show recent log** on the same card often has the line that explains it.`,
    settings: "set-help",
    guide: "honest",
  },

  // ----------------------------------------------------------------- security
  {
    id: "security-posture",
    group: "Security",
    title: "What ProDeck protects, and what it doesn't",
    aliases: ["is this secure", "who can see what", "passwords in the clear", "security model"],
    body: `Honest summary, so you can decide what to expose:

- **Two shared passwords** decide what a phone may do. Anyone with the crew password is crew. Choose long ones; rotate the crew password if a phone is lost (it signs everyone out — send the new join link).
- **Crew PINs are four digits.** They identify people, they don't protect anything; the passwords do. Wrong PINs lock the name for five minutes.
- **Joining is time-gated.** The poster link only works while you've opened joining.
- **The web gateway throttles password guessing** and refuses requests from other websites.
- **Secrets never leave the booth in the clear**: phones receive settings with every password and key removed; the diagnostics bundle is scrubbed before it's copied.
- **A kiosk bookmark holds the crew password** and can be read off that machine. Don't put the admin password in one.

- **Grants are per person and revocable.** Giving someone Page or Control doesn't hand them the admin password, and revoking their approval removes every grant at once.

Security problems: **SECURITY.md** in the repository explains how to report privately.`,
    guide: "honest",
    related: ["gateway-passwords", "crew-overview"],
  },
];

export const HELP_BY_ID: Record<string, HelpTopic> = Object.fromEntries(
  HELP_TOPICS.map((t) => [t.id, t]),
);
