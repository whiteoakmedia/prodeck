# ProDeck Crew: App Store submission

Draft for App Store Connect. Everything here is for Zach to check and paste;
nothing is submitted from this repo.

## App record

- **Name:** ProDeck Crew
- **Subtitle (30):** Your church production team
- **Bundle ID:** app.prodeck.crew (team 2B77WL3HZ6)
- **SKU:** prodeck-crew
- **Primary category:** Productivity. Secondary: Utilities.
- **Price:** Free. No in-app purchases. No tips in the phone app (guideline
  3.1.1).
- **Seller name:** your developer account's name. Right now that's "Zachary
  Green", because the membership is an individual one. It becomes "White Oak
  Media" only with an organization membership; decide before the first
  release.

## Description

> ProDeck Crew connects your church's production volunteers to the ProDeck
> booth: the computer that runs your service.
>
> - Pages: when the booth needs you, your phone tells you. Tap Got it so they
>   know you saw it.
> - Chat with your team and your role's channel.
> - This week's plan, songs, keys and charts from Planning Center.
> - Your checklist and check-in for the morning.
> - Turn your phone into a tally light for your camera.
>
> Scan the crew code on your church's poster, or find the booth on the church
> Wi-Fi. Your church runs its own ProDeck booth; this app connects to it.
> Curious first? Look around with a pretend Sunday, no booth needed.
>
> ProDeck is free, from White Oak Media.

**Keywords (100):** church,production,volunteer,worship,tech,crew,ProPresenter,Planning Center,tally,pages

- **Support URL:** https://www.whiteoakmedia.io/tools/support
- **Privacy policy URL:** the published docs/PRIVACY.md. It needs a short
  section on the crew app before submission (below).

## App Privacy (the "nutrition label")

The app itself sends nothing to White Oak Media. Volunteers' names, PINs,
chat and check-ins go to **their own church's booth**, which the church runs.
Apple counts data as "collected" when it leaves the device for the developer
or its partners, so the honest answer is:

- **Data collection:** only the push token (below). Everything else goes to
  the church's own booth, not to the developer.
- If Apple pushes back (some reviewers treat any server as collection),
  declare:
  - **Contact Info, Name:** App Functionality, linked to the user, not used
    for tracking.
  - **User Content, Other (chat messages):** App Functionality, linked, not
    tracking.
- Page notifications go through White Oak's relay (push-edge/, prodeck-push
  Worker): the push token and the page's words pass through and nothing is
  kept. So the honest answer is **Data Collected**, one type:
  **Identifiers, Device ID:** App Functionality, not linked to the user, not
  used for tracking. (The relay never sees a name: the booth sends it only
  the token and the notification text.)

Add to docs/PRIVACY.md: what the crew app stores on the phone (the churches
list), that everything else goes to the church's own booth, and how to delete
your crew account (More, Delete my account).

## Review notes (Apple's reviewers have no booth)

> ProDeck Crew is a companion app for church production volunteers. Each
> church runs the free ProDeck desktop app on its booth computer, and this app
> connects to that computer on the church's own network.
>
> To review without a booth: on the first screen, tap "Look around first,
> with a pretend Sunday". It opens the full crew experience with sample data
> (plan, chat, checklist, pages, tally), entirely on the device.
>
> Camera: used only to scan a church's crew QR code. Local network: used to
> find the church's booth on the Wi-Fi (Bonjour, _prodeck._tcp). Accounts are
> created on the church's own booth; More, Delete my account removes it there.

## Screenshots

- iPhone 6.9" (1320 × 2868), at least 3. Take them from the iOS simulator
  running the demo: Home, a page with Got it, the plan with charts, the tally
  light, chat.
- iPad 13" only if iPad support is kept on. The app runs on iPad in the crew
  layout.

## Before submitting

- [ ] Account deletion in the app (required, guideline 5.1.1(v))
- [ ] The demo works offline on a fresh install
- [ ] The privacy policy updated and published
- [ ] Version 1.0 (1), archived with the team above, uploaded through Xcode
      or Transporter, then TestFlight on your own phone before review
