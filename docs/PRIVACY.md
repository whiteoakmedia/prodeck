# ProDeck privacy notice

Effective 7 October 2026. ProDeck is a free app from White Oak Media (Zach Green), contact zach@whiteoakmedia.io.

**The short version:** ProDeck runs on your church's own computer. It has no accounts with us, no analytics and no tracking. It does send us crash reports when something breaks, with nothing that identifies your church or anyone in it, and you can turn that off. Almost everything it handles stays on that computer and your church network. The few things that leave it are listed below, and most go only to services your church chose and signed in to itself.

## What White Oak Media receives

- **Release notes by email, only if you ask for them.** If you type an email address into "Get release notes by email" (first-run setup or Settings), that address is sent to White Oak Media so we can email you when a new version comes out. We use it for nothing else, never sell or share it, and you can ask us to delete it any time by emailing zach@whiteoakmedia.io or replying to any release email.
- **Crash reports, unless you turn them off.** When something in ProDeck breaks, it sends a report to White Oak Media through Sentry (sentry.io), the service we use to collect them, by way of White Oak's own Cloudflare service so church content filters don't block it: what failed, where in ProDeck's code, the ProDeck version and the computer's operating system. Before it leaves, ProDeck removes the computer's name, your login name, user details and anything in web addresses that could hold a password or token, and it leaves out console log lines. We've asked Sentry not to store IP addresses. Turn reports off any time in **Settings → Help & support → Send crash reports**.
- **Bug reports and feature requests you send.** When you press "Report a bug" or "Request a feature", what you type goes to White Oak Media by email, along with the name, church and email you give (all optional), ProDeck's version and operating system, and, only if you tick it, a diagnostics bundle and a screenshot. The diagnostics have every password, key and token removed, and you can read them before sending. A copy is kept for 180 days on Cloudflare, which carries the message, and it's emailed through Resend. We use it only to fix and improve ProDeck, never sell or share it, and will delete it if you ask.
- **Nothing else.** ProDeck doesn't send us usage data, settings, plans, names or recordings except as described above.

## What goes to services your church sets up

These run only when your church turns them on and connects its own account. Each service's own privacy policy applies.

- **Planning Center.** ProDeck signs in to your church's Planning Center account and reads plans, songs and the people scheduled (names, positions, times), so it can show the service and assign mics. It stays on the booth computer.
- **ProPresenter, your sound console, Dante, NDI, Stream Deck and Companion** are reached over your own network only.
- **Ask ProDeck and Auto-Follow (Anthropic).** If you add an Anthropic API key, the questions volunteers type into Ask ProDeck, with the routing map and live status ProDeck uses to answer, are sent to Anthropic's API to write the answer. Auto-Follow may send a lyric line it heard to work out where the song is. This uses your church's own key and account. Without a key, nothing goes to Anthropic.
- **Live viewer counts (Google Analytics 4).** If you add your own GA4 service account, ProDeck reads your watch page's viewer count from Google. It sends no data about the people using ProDeck.
- **Phones and kiosks, your own domain and push notifications.** If you turn on browser access, crew phones connect to the booth. If you also set up your own domain, that runs through your own Cloudflare account, which carries crew chat, names and sign-in tokens to phones away from the building. Phones that allow notifications get them through Apple's or Google's push services.
- **Check-in.** When a crew member checks in, their phone may share its location with the booth, which only compares it with the building's location and doesn't keep it. To recognise the building's network, the booth looks up its own public IP address at ipify.org.
- **TapLink.** Tap counts on your church's TapLink service are anonymous: no names, devices or locations.

## What happens in the background

- **Update checks.** A few seconds after launch, ProDeck asks GitHub whether a newer version exists. GitHub sees the computer's IP address, as with any web request.
- **Problem reports.** "Report on GitHub" and "Ask on GitHub" open a **public** GitHub issue in your browser. Diagnostics are copied to your clipboard with passwords and keys removed, and only go in the issue if you paste them. Don't paste anything you wouldn't post publicly.

## Recordings and data on the computer

Multitrack recordings, service reports, settings and crew accounts are stored on the booth computer, or on the drive you choose for recordings. They're never uploaded by ProDeck. Your church decides who can use that computer and how long to keep them.

## Children

ProDeck is a tool for church production teams and isn't meant for children to use.

## Changes

If this notice changes, the new version will be in the ProDeck release notes and at github.com/whiteoakmedia/prodeck/blob/master/docs/PRIVACY.md.
