# ProDeck Crew for Android: release

Version 1.1 (versionCode 2), matching the iPhone app. Package app.prodeck.crew.

## What's built

- **Pages through Firebase (FCM).** The app gets a Firebase token and hands it
  to the church's booth as `#crewpush=fcm:<token>` (crew-app/src/native.ts),
  the booth keeps it as platform "fcm" (src-tauri/src/push.rs), and the relay
  sends it as an FCM HTTP v1 data message (push-edge/src/payload.ts
  fcmMessage). APNs is unchanged.
- **The app draws every notification itself** (android PageAlerts.java):
  pages on a high importance "Pages" channel with the page sound
  (res/raw/page.mp3, from public/page.caf), every repeat rings again, a
  "Got it" button posts the page's confirm link without opening the app (and
  says "Not confirmed yet" if the booth can't be reached), pages show while
  the app is open, and opening the app clears them. Chat and reminders use an
  ordinary "Crew messages" channel.
- **Crew codes open the app** (Android App Links): `https://*.prodeck.live/join`
  with autoVerify. Android checks a wildcard at prodeck.live, which crew-edge
  serves from crew-cloud/src/applinks.ts. A link arriving while a church's page
  shows comes back to the app (MainActivity CrewLinks, like iOS SceneDelegate).
- **Icon and launch screen match the iPhone app**: full bleed dark, the mark at
  the iPhone icon's size, a themed (monochrome) layer for Android 13, plain
  dark launch screen. `node crew-app/scripts-make-icons.mjs` redraws them.

## The upload key

`~/.prodeck/keys/crew-upload.jks` with its passwords in
`~/.prodeck/keys/crew-upload.properties` (README.txt beside them). Never in the
repo. Back the folder up in a password manager: losing it means asking Google
for an upload key reset.

Upload key SHA-256:
`B1:F9:D5:DF:05:41:BA:D6:40:CC:82:DD:27:20:B2:34:5E:EB:42:A0:63:64:F4:70:0E:02:6A:30:AD:02:95:27`

## Build

```bash
cd crew-app && npx vite build && npx cap sync android
cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./gradlew bundleRelease
```

The AAB lands in `crew-app/android/app/build/outputs/bundle/release/app-release.aab`,
signed with the upload key. A release build refuses to run without
`crew-app/android/app/google-services.json` (pages wouldn't ring);
`-PallowNoPush` builds one anyway for testing. Bump `versionCode` in
`crew-app/android/app/build.gradle` for every upload.

## Zach's steps, in order

1. **Google Play developer account.** play.google.com/console, one time $25.
   Decide individual or organization first: an organization account shows
   "White Oak Media" as the developer and needs the D-U-N-S number (you have
   it); an individual account shows your name, needs ID verification, and a
   new personal account must run a closed test with 12 testers for 14 days
   before it can publish. The organization route skips that test, so it's the
   quicker way to the store as well.
2. **Firebase project: done 2026-11-09.** Project "ProDeck Crew"
   (`prodeck-crew`, White Oak's account, no Analytics), Android app
   `app.prodeck.crew`, FCM API (V1) on. `google-services.json` is in
   `crew-app/android/app/` on this Mac (git ignores it); the service account
   key is `~/.prodeck/keys/prodeck-crew-firebase-adminsdk-*.json`.
3. **Build the AAB** (above, now with google-services.json) and install it on
   an Android phone to try a real page before uploading.
4. **Play Console:** create the app "ProDeck Crew", fill the listing from
   design/play/LISTING.md, upload the AAB to Internal testing first, then
   Production. Accept Play App Signing (the default).
5. **Deploys:**
   - **prodeck-push relay:**
     `cd push-edge && npx wrangler secret put FCM_SERVICE_ACCOUNT < ~/.prodeck/keys/prodeck-crew-firebase-adminsdk-fbsvc-8ca41d76c3.json && npx wrangler deploy`
     `GET https://prodeck-push.taplink-edge.workers.dev/` should then say
     `"fcm": true`. APNs keeps working as today.
   - **crew-cloud and crew-edge** (with commit 95e6853, the smart crew codes):
     they serve `/.well-known/assetlinks.json`. Today prodeck.live answers that
     address with the app page, so Android can't verify the link yet.
   - **Play's signing key:** after the first upload, Play Console, Test and
     release, App integrity, App signing key certificate, copy the SHA-256 into
     `ANDROID_CERT_SHA256` in crew-cloud/src/applinks.ts (done 2026-11-10) and deploy crew-cloud
     and crew-edge again. Without it, crew codes open the browser instead of
     the app on phones that installed from Play.
6. **A ProDeck release.** The booth only accepts Android tokens from the
   version with this change (push.rs, crewApp.ts). Churches on older booths
   get no Android pages until they update; everything else in the app works.

## Checked on the emulator (2026-11-09, Pixel 8 image, Android 15)

- Joined Cornerstone's booth at the Mac's Wi-Fi address (prodeckcrew:// link and
  a crew code link), landing on its secure address like the iPhone.
- The booth's Turn on notifications asked for Android's permission and came
  back to the church.
- A page with the app open showed and rang; a repeat rang again as its own
  notification; Got it posted the confirm link and cleared both; Got it
  against the booth with a made up key said "Not confirmed yet"; opening the
  app cleared pages; a link arriving while the church page showed reached the
  app.
- The relay against a local stand-in for Google: the signed key exchange
  verified, a page and a chat sent with the right shape, a gone phone came
  back as dead, one Google sign in for many phones.

- A real page through Google (2026-11-09): the relay run locally with the
  real service account sent a page to the emulator's Firebase token; it
  arrived on the Pages channel with Got it, and Got it confirmed and cleared.

Not checked: App Link verification (needs step 5), the lock screen with a PIN
set, and a physical phone.
