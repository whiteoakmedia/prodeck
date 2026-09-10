# Crew — accounts, joining, roles and permissions

This is how volunteers get onto their phones and what decides what a phone can
do. It is written for the person running the booth.

## Two things, kept separate

**1. The gateway password decides what a phone may *do*.** There are two:

| Password | Who gets it | What it allows |
|---|---|---|
| **Admin** | People who run the booth | Everything: control ProPresenter and the console, change settings, send pages, override the tap discs, edit dashboards. |
| **Crew (member)** | Everyone else on the team | Look at dashboards and the plan, chat, check in, confirm pages, watch cameras, tick checklists. |

Both are set in **Settings → Browser Access**. Use long ones. The crew password
is the durable credential every phone holds; rotating it signs every phone out.

**2. A crew account decides *who* the phone is.** Name + 4-digit PIN. That name
is on chat messages, is who a page is addressed to, and is who the leader board
says has arrived. Accounts live in **Settings → Crew Members**.

**3. Grants decide what a specific person may do beyond looking.** On a crew
account, an admin can tick any of:

| Grant | Unlocks |
|---|---|
| **Page** | Send pages, re-buzz |
| **Stage** | Stage-display and confidence text, and clearing it |
| **Control** | ProPresenter, the console, OBS scenes, Planning Center LIVE |
| **Tap discs** | Override the lobby NFC discs |
| **Manage crew** | Approve / edit / remove crew, invites, open joining — but **not** granting |

A phone signed in with the crew password and a crew account gets exactly its
grants. The admin password still means everything. Only the admin password can
grant; revoking approval removes all grants at once.

## Getting people on

**The poster (shared).** Settings → Crew Members → *Crew invite link*: a QR code
and a **Print poster** button. Scanning it joins with the crew password and asks
for a name and PIN. **You then approve the person once.**

The poster works **only while joining is open** — press **Open for 15 min** or
**1 hour** on the same card when you're signing people up; it closes itself.
Anyone already joined is unaffected. Scanning while closed shows *"Joining is
closed right now — ask whoever is at the production computer to open joining."*

Why a window: that link hands out a real credential, and a printed code has
nobody to ask for a password. Time is the only honest gate.

**A personal invite (one person).** *Personal invites* on the same card: type
their name, press Create, send the link. Good for a week, works once, arrives
**pre-approved** with name and role filled in. Best for someone you already
know is joining.

## Approving and editing

**Settings → Crew Members** lists everyone; a *pending* badge on the nav means
someone is waiting.

- **Approve** makes the account live. Until then the phone shows a waiting screen.
- **Edit** fixes a name without breaking the PIN, adds a **nickname** (also works
  to sign in), and chooses exactly which **Planning Center person** they are. A
  link set by hand is pinned — the weekly auto-match never overwrites it.
- **Remove** signs that phone out and deletes the account.

There is no PIN reset: PINs identify, they don't protect. Remove and rejoin.
Five wrong PINs lock the name for five minutes.

## Roles

A role is what a person is doing this Sunday. It drives the **leader board**
("Camera 1 — not here yet"), the **role channels** in chat, and which
**checklists** a phone sees.

**Where roles come from.** If you use Planning Center, a person's role is their
position on **this week's plan**, via the PCO link on their account — it updates
each week and is shown read-only on the crew row. Roles are typed by hand only
where there's no plan to read: a church without Planning Center, a personal
invite, or the join form.

**Roles you use** (Settings → Crew Members) is the list offered as suggestions in
those places, so the board and the channels don't fragment into "Camera 1",
"Cam 1" and "camera1". Any text is still allowed.

## Signing out and getting back in

On the phone, **More**:

- **Lock (PIN again)** keeps the account on the phone; asks for the PIN next time.
- **Sign out completely** forgets it on this phone. The account still exists —
  open the app or scan the poster and sign in with the same name and PIN. If
  the app says the name is taken, it tries your PIN against that account; that
  *is* the sign-in.

## Pages

A page takes over the recipient's phone with a siren and heavy vibration until
they tap **Got it**. The sender sees who has and hasn't and can **Re-buzz**. A
page the booth can no longer accept a confirmation for offers **Dismiss**.

iPhones can only buzz from the lock-screen notification, so the app must be
added to the home screen and notifications allowed when joining.
