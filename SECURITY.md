# Reporting a security problem

ProDeck runs on a church's network and holds real credentials: Planning Center
tokens, sound-console addresses, gateway passwords, crew accounts and PINs. If
you find a way to get at something you shouldn't, I want to know.

## How to report

**Please don't open a public issue for a security problem.** Use GitHub's
private reporting instead:

**[Report a vulnerability](https://github.com/whiteoakmedia/prodeck/security/advisories/new)**

If that isn't available to you, open an issue saying only *"security report,
please get in touch"* — no details — and I'll find a private channel.

Tell me what you can: what you did, what you got, and roughly how hard it was.
A rough description beats no report. You don't need a working exploit.

## What I'll do

I'll acknowledge within a few days and tell you honestly whether I think it's
serious, and when I expect to fix it. Fixes for anything that exposes data go
out as a release with the problem described in the changelog — including what
an affected church should do about it, since a fix nobody installs isn't one.

I'm one person maintaining this alongside a day job, so I can't promise a
timeline. I can promise I won't quietly sit on it.

## What counts

Things I'd consider real:

- Reading data without the right password tier — the plan, crew chat, the
  roster, check-ins, position files, room audio, ProPresenter state.
- Controlling anything (ProPresenter, the console, Planning Center Live,
  TapLink, settings) without admin access.
- Getting a credential out of the app, the web gateway, the diagnostics bundle,
  or the Cloudflare edge.
- Reaching the booth from outside the building in a way that isn't intended.

Things I already know and consider accepted risk, so you needn't report them:

- **The password tiers are shared secrets, not accounts.** Anyone who has the
  member password is a viewer. Anything beyond viewing needs either the admin
  password or a per-person grant on a crew account (page, stage, control, tap,
  manage) — and only the admin password can grant.
- **Crew PINs are four digits.** They identify people, they don't protect
  anything — the tiers do. There's a lockout to blunt guessing.
- **Kiosk mode is a convenience, not a boundary.** The token in a kiosk's
  bookmark is a full member credential and can be read off that machine.
- **The booth mirrors password hashes to the Cloudflare edge** so the offline
  fallback can authenticate. They are unsalted SHA-256 today.

The kiosk and edge items are on the list to improve. Reports that help me prioritise them
are welcome; I just don't want you to think you've found something unknown.

## Scope

This repository, the ProDeck app, its web gateway, and the Cloudflare workers
in `crew-edge/` and `taplink-edge/`. Please don't test against
`prodeck.live` or any other church's live installation — run your own copy.
