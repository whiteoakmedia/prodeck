# ProDeck Crew: Google Play listing

Draft for Play Console, for Zach to check and paste. Nothing here is uploaded
from this repo. It mirrors design/APP_STORE.md so both stores say the same.

## App

- **App name (30):** ProDeck Crew
- **Package:** app.prodeck.crew
- **Default language:** English (United States)
- **App or game:** App. **Free.** No ads, no in-app purchases.
- **Category:** Productivity. **Tags:** Productivity, Communication.
- **Contact email:** zach@whiteoakmedia.io
- **Website:** https://www.whiteoakmedia.io/tools/support
- **Privacy policy URL:** the published docs/PRIVACY.md (whiteoakmedia.github.io/prodeck, privacy page).
  Its ProDeck Crew section now names Google's push service for Android.

## Short description (80)

> Pages, chat, checklists and the plan for your church's production team.

(71 characters.)

## Full description (4000)

> ProDeck Crew connects your church's production volunteers to the ProDeck
> booth: the computer that runs your service.
>
> • Pages: when the booth needs you, your phone rings. Tap Got it so they know
>   you saw it, right from the notification.
> • Chat with your team and your role's channel.
> • This week's plan, songs, keys and charts from Planning Center.
> • Your checklist and check in for the morning.
> • Turn your phone into a tally light for your camera.
>
> Scan the crew code on your church's poster with the camera, or find the
> booth on the church Wi-Fi. Your church runs its own ProDeck booth; this app
> connects to it.
>
> Curious first? Try the demo: a pretend Sunday, no booth needed.
>
> ProDeck is free, from White Oak Media.

## Graphics (all in this folder)

| Play asks for | File |
| --- | --- |
| App icon, 512 × 512 PNG | `icon-512.png` (same artwork as the iPhone icon) |
| Feature graphic, 1024 × 500 | `feature-graphic-1024x500.png` |
| Phone screenshots, 2 to 8, 9:16 | `screenshots-phone/01-welcome.png` to `05-tally.png`, 1080 × 1920 |

The screenshots are the same five screens as the App Store set (welcome, the
demo's Home mid service, setlist, team chat, tally), taken on the Android
emulator with a clean status bar. Tablet screenshots are optional; skip them
unless Play asks.

## Data safety

Answers that match docs/PRIVACY.md. Play counts data as collected when it
leaves the phone for the developer, so only what reaches White Oak Media is
declared. Names, PINs, chat and check ins go to the church's own booth, which
the church runs, not to White Oak Media.

- **Does your app collect or share any of the required user data types?** Yes.
- **Is all of the user data collected by your app encrypted in transit?** Yes
  (the relay and Sentry are https only).
- **Do you provide a way for users to request that their data is deleted?**
  Yes: More, Delete my account removes the crew account from the church's
  booth; pages stop as soon as notifications are off. White Oak Media keeps
  nothing from the relay.

Data types:

| Type | Collected | Shared | Optional | Purpose | Notes |
| --- | --- | --- | --- | --- | --- |
| Device or other IDs | Yes | No | Yes (only if notifications are allowed) | App functionality | The push token, passed to Google to deliver pages. Not kept. |
| Crash logs | Yes | No | No | App functionality, analytics: no | Sentry. Addresses and booth names removed on the phone. |
| Diagnostics | Yes | No | No | App functionality | Same reports, app version and Android version. |

Everything else: not collected. No location, no contacts, no photos (the
camera only reads the crew code and nothing is saved), no audio collected
(crew comms is live audio to the church's own booth, not stored by White Oak
Media), no web history, no app activity analytics.

Processing is ephemeral for the push token: tick "Data is processed
ephemerally" for Device or other IDs.

## Content rating (IARC questionnaire)

- **Category:** Utility, Productivity, Communication, or Other.
- Violence, fear, sexuality, language, controlled substances, gambling: none.
- **Do users interact or exchange content?** Yes: crew chat with their own
  church's team. Moderation: the church's booth admin can remove crew accounts.
  Chat is only with people their church has let in, not strangers.
- **Does the app share the user's location?** No.
- **Does the app allow purchases of digital goods?** No.
- Expected rating: **Everyone** (with "Users interact").

## Target audience and other declarations

- **Target age:** 18 and over (volunteers on a church production team). Not
  designed for children; nothing appeals to children. This keeps it out of the
  Families program.
- **Ads:** No ads.
- **App access:** Some functionality is restricted. Tell the reviewer:

  > ProDeck Crew connects to a church's own ProDeck booth on the church
  > network, so a reviewer won't have one. On the first screen tap "Try a
  > demo": it opens the full crew app with sample data (plan, chat, checklist,
  > tally), entirely on the phone, no sign in.

- **Government app:** No. **Financial features:** None. **Health:** No.
- **News app:** No.
- **Permissions Play may ask about:** Camera (scan the crew code),
  Microphone (crew comms, only while you talk), Notifications (pages). No
  sensitive or restricted permissions are used.
