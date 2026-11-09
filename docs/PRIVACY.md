# ProDeck privacy notice

Effective 2 November 2026 (ProDeck 0.9.116 and ProDeck Crew 1.0). ProDeck is a free app from White Oak Media, contact zach@whiteoakmedia.io.

**The short version:** ProDeck runs on your church's own computer. It has no accounts with us and no tracking. It does send us crash reports when something breaks, and an anonymous count once a day that one copy is in use, with nothing that identifies your church or anyone in it, and you can turn either off. Unless you turn it off, it also keeps a copy of this week's plan, checklists, crew names and team chat with White Oak Media, so your crew can see them from anywhere and while the booth is off (the crew address, below). Everything else it handles stays on that computer and your church network. The few things that leave it are listed below, and most go only to services your church chose and signed in to itself.

## What White Oak Media receives

- **Release notes by email, only if you ask for them.** If you type an email address into "Get release notes by email" (first-run setup or Settings), that address is sent to White Oak Media so we can email you when a new version comes out. We use it for nothing else, never sell or share it, and you can ask us to delete it any time by emailing zach@whiteoakmedia.io or replying to any release email.
- **Crash reports, unless you turn them off.** When something in ProDeck breaks, it sends a report to White Oak Media through Sentry (sentry.io), the service we use to collect them, by way of White Oak's own Cloudflare service so church content filters don't block it: what failed, where in ProDeck's code, the ProDeck version and the computer's operating system. Before it leaves, ProDeck removes the computer's name, your login name, user details and anything in web addresses that could hold a password or token, and it leaves out console log lines. We've asked Sentry not to store IP addresses. Turn reports off any time in **Settings → Help & support → Send crash reports**.
- **An anonymous usage count, unless you turn it off.** About once a day the booth app sends White Oak Media three things: a random ID made on that computer the first time ProDeck runs (not based on the computer, your church or anyone in it), the ProDeck version, and whether it's a Mac or Windows. We use it only to count how many copies are in use and which versions are still out there. We don't store the IP address it comes from. Phones, kiosks and crew browsers never send it. Turn it off any time in **Settings → Help & support → Send an anonymous usage count**.
- **Bug reports and feature requests you send.** When you press "Report a bug" or "Request a feature", what you type goes to White Oak Media by email, along with the name, church and email you give (all optional), ProDeck's version and operating system, and, only if you tick it, a diagnostics bundle and a screenshot. The diagnostics have every password, key and token removed, and you can read them before sending. A copy is kept for 180 days on Cloudflare, which carries the message, and it's emailed through Resend. We use it only to fix and improve ProDeck, never sell or share it, and will delete it if you ask.
- **The crew address, unless you turn it off.** Each booth gets an address of its own, `<name>.crew.prodeck.live`, so its crew can reach it away from the church network and still see the week while the booth computer is off. For that:
  - **What's kept, and where.** Every couple of minutes the booth sends White Oak Media a copy of what its crew screens show: this week's plan (service times, songs, keys and leaders, who's scheduled and their positions, call times and position guides), your checklists and who ticked what, crew names and roles, and team chat (the last 500 messages). It's kept on Cloudflare (Durable Objects), one store per church; each new copy replaces the last. Chat sent while the booth is off and checklist ticks waiting for the booth are kept until the booth collects them, or a day at most for ticks.
  - **What isn't.** Planning Center sign in details, files, recordings, settings and stage or confidence messages never leave the booth. Passwords don't leave as they are: only a scrambled form (PBKDF2) that can check a password but can't be turned back into it. Crew sign ins are sent the same way (SHA-256).
  - **The name.** It's the booth's secure local address name if it has one, else one ProDeck picks from the computer's name the first time (you can change it in **Settings → Crew & screens → Crew address**). Names are public.
  - **While the booth is on,** it keeps one connection open to White Oak Media's Cloudflare service, and what phones ask the booth from outside the building (and the booth's answers, which can include crew names, chat and anything the crew screens show) pass through it on their way. They aren't kept. Cloudflare sees the phone's IP address, as with any web request, and the booth sees it too, to slow down anyone guessing passwords. Comms audio, camera feeds and the overflow audio never go this way.
  - **Turning it off.** **Settings → Crew & screens → Crew address.** The booth asks White Oak Media to delete its copy straight away. We use the copy only to show it to your church's crew, never look at it except to fix a problem you report, and never sell or share it.
- **Nothing else.** ProDeck doesn't send us how it's used, settings, plans, names or recordings except as described above.

## What goes to services your church sets up

These run only when your church turns them on and connects its own account. Each service's own privacy policy applies.

- **Planning Center.** ProDeck signs in to your church's Planning Center account and reads plans, songs and the people scheduled (names, positions, times), so it can show the service and assign mics. It stays on the booth computer.
- **ProPresenter, your sound console, Dante, NDI, Stream Deck and Companion** are reached over your own network only.
- **Ask ProDeck and Auto-Follow (Anthropic).** If you add an Anthropic API key, the questions volunteers type into Ask ProDeck, with the routing map and live status ProDeck uses to answer, are sent to Anthropic's API to write the answer. Auto-Follow may send a lyric line it heard to work out where the song is. This uses your church's own key and account. Without a key, nothing goes to Anthropic.
- **Church Online Platform.** If you add your Church Online address, ProDeck asks Church Online which service is live or next. If you also set up its webhooks, Church Online sends activity (who attended, chatted, asked for prayer or responded to a moment) to your church's private inbox on White Oak Media's relay, which ProDeck reads. The relay drops email addresses, keeps first names and last initials with each activity for three days, and then deletes it. Chat and prayer text are never sent by Church Online. Disconnecting in ProDeck deletes the inbox.
- **Live viewer counts (Google Analytics 4).** If you add your own GA4 service account, ProDeck reads your watch page's viewer count from Google. It sends no data about the people using ProDeck.
- **Phones and kiosks, your own domain and push notifications.** If you turn on browser access, crew phones connect to the booth. If you also set up your own domain, that runs through your own Cloudflare account, which carries crew chat, names and sign-in tokens to phones away from the building. Phones that allow notifications get them through Apple's or Google's push services.
- **Check-in.** When a crew member checks in, their phone may share its location with the booth, which only compares it with the building's location and doesn't keep it. To recognise the building's network, the booth looks up its own public IP address at ipify.org.
- **TapLink.** Tap counts on your church's TapLink service are anonymous: no names, devices or locations.

## What happens in the background

- **Update checks.** A few seconds after launch, ProDeck asks GitHub whether a newer version exists. GitHub sees the computer's IP address, as with any web request.
- **Problem reports.** "Report on GitHub" and "Ask on GitHub" open a **public** GitHub issue in your browser. Diagnostics are copied to your clipboard with passwords and keys removed, and only go in the issue if you paste them. Don't paste anything you wouldn't post publicly.

## Recordings and data on the computer

Multitrack recordings, service reports, settings and crew accounts are stored on the booth computer, or on the drive you choose for recordings. They're never uploaded by ProDeck. Your church decides who can use that computer and how long to keep them.

## The ProDeck Crew phone app

ProDeck Crew (iPhone, iPad and Android) connects a volunteer to their church's own ProDeck booth. It has no account with White Oak Media: no analytics, no tracking, no advertising. Two things reach White Oak Media: page notifications and crash reports, both below.

- **On the phone:** the list of churches you've connected to (each booth's address, name and crew address), and, from the booth's crew app, your crew sign-in on that phone.
- **Away from the church Wi-Fi:** when the booth's own address doesn't answer, the app opens the church's crew address instead. What you do there reaches the booth through White Oak Media's crew address service (above), or waits there until the booth is back on.
- **To your church's booth:** what you do in the crew app goes to the ProDeck computer your church runs, on its own network: your name and PIN when you join, chat messages, check-ins, checklist ticks, and confirmations of pages. Your church's production leaders can see these. White Oak Media can't, except what the crew address keeps (above) while your church has it on.
- **Page notifications:** if you allow notifications, your phone gives the app a push token (a random address for this app on this phone, from Apple). The app hands it to your church's booth. When the booth pages you, it sends the token and the notification's words ("ProDeck · Page", who sent it and the message) to White Oak Media's notification relay, which passes them to Apple to deliver. The relay sends nothing about your church or you, keeps nothing, and isn't used for anything else. Turn notifications off in the app (More) or in your phone's Settings.
- **Crash reports:** when something in the app breaks, or a search of the Wi-Fi finds no booth, the app sends a report to White Oak Media through Sentry: what failed, where in the app's code, the app version and the phone's operating system. Before it leaves the phone, the app removes network addresses, booth names and anything in a web address that could hold a password or token. Reports aren't linked to you. The crew screens your church's booth shows follow that booth's own setting (**Settings → Help & support → Send crash reports**).
- **Camera:** used only to scan your church's crew code. Images never leave the phone.
- **Local network:** used only to find your church's booth on the Wi-Fi and connect to it.
- **Microphone:** used only while you talk on crew comms, if your church turns comms on. Your voice goes straight to the other crew phones on the church network.
- **Deleting your account:** in the app, **More → Delete my account** removes your crew account from your church's booth: your sign-in, PIN and notifications. It doesn't change Planning Center. To remove everything else your church holds, ask your church's production leader.

## Children

ProDeck is a tool for church production teams and isn't meant for children to use.

## Changes

If this notice changes, the new version will be in the ProDeck release notes and at github.com/whiteoakmedia/prodeck/blob/master/docs/PRIVACY.md.
