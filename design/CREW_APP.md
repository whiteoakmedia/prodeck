# ProDeck Crew: the native phone app

Status: being built (2026-11-02). Code in `crew-app/`.

## Why a native app

The crew web app works, but the browser keeps getting in the way, and the
volunteer audit (design/VOLUNTEER_AUDIT.md) traces most P0s back to it:

- **Pages:**
  - An iPhone only buzzes for a web app added to the Home Screen with
    notifications on. Only 4 of 13 Cornerstone crew got that far.
  - There's no lock-screen "Got it".
  - Focus modes silence web push.
- **Comms:**
  - The microphone needs https.
  - A locked iPhone stops a web page's audio.
- **Getting in:** the Home Screen copy doesn't share Safari's sign-in.
  Rotating the crew link strands it. iPads pretend to be Macs.

A native app gets real push (APNs and FCM), the microphone on any address,
Apple's Push to Talk framework (comms from a locked phone and the lock
screen), and one install from the App Store or Play Store.

## Shape: a companion app, like Home Assistant's

The booth already serves the whole crew app. The native app doesn't rebuild
it; it **finds the booth, opens the booth's crew app inside itself, and adds the
native parts** the web can't do. Every church runs its own booth, so:

1. **Connect.** Scan the church's crew poster or invite QR, pick a booth found
   on the Wi-Fi (Bonjour `_prodeck._tcp`, already announced by tv.rs), or type
   an address. The app remembers churches. A volunteer at two churches can
   switch.
2. **Open.** A web view loads the booth's crew app at that address. Plain
   http on the church network is fine: there's no microphone or push limit in
   a native app, so the secure local address becomes optional.
3. **Native bridge** (Capacitor plugins, added in phases):
   - **Push:** the app's device token goes to the booth. The booth sends pages
     through a White Oak relay Worker that holds the APNs and FCM keys; churches
     never hold Apple keys. Lock-screen "Got it" and Time Sensitive delivery
     (gets through Focus) are included.
   - **Comms:** Push to Talk framework on iOS (talk from the lock screen,
     background audio), foreground service on Android.
   - **Tally:** keep the screen awake, no sleep while on a camera.

## Phases

1. **Shell:** the connect flow, saved churches, and opening the booth's app.
   Visible now in the browser preview (`crew-app`, port 5180), then on an
   Android emulator, then the iOS simulator once Xcode is installed.
2. **Push:** relay Worker, booth support for device tokens alongside web push,
   lock-screen actions.
3. **Comms:** Push to Talk.
4. **Store:** icons, screenshots, privacy labels, TestFlight, review.

## Notes

- Capacitor keeps one project for iOS and Android, and the shell's screens are
  React, like the rest of ProDeck.
- App Store guideline 4.2 (minimum functionality): native push, Push to Talk
  and discovery make this more than a wrapped website, the same reasoning as
  Home Assistant's app.
- Bundle id: `app.prodeck.crew` (White Oak Media's developer account).
