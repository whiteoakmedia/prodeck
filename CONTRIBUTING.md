# Contributing

ProDeck was built for one church's booth and then opened up. If it's useful to
yours, that's the whole point — and if you fix something, I'd like the fix.

## Before you start

Open an issue first for anything substantial. Not to gatekeep: it's so I can
tell you what I know about that corner of the code, which is often more than
the code shows.

## Running it

```bash
npm install
npm run tauri dev
```

You need Rust and Node 18+. No church hardware required to develop — start the
app and turn on **Demo mode** from the welcome screen or Settings → Help, which
fills every dashboard with a sample Sunday and writes nothing.

## Tests

```bash
cd src-tauri && cargo test
npx tsc --noEmit
```

Please add a test for anything with a protocol, a conversion, or a rule in it.
The console maps, the fader curves, the Planning Center error handling and the
web gateway's permission checks all have tests, and they have caught real
mistakes — including one where an audit's suggested "fix" would have broken
working code, and the test proved it.

## What good looks like here

- **Say why in the comment, not what.** Most comments in this codebase explain
  a decision or a piece of hard-won knowledge about ProPresenter, Planning
  Center or a console. `// increment i` helps nobody.
- **A control must never claim it worked when it didn't.** A surprising number
  of bugs here have been exactly that. If a call can fail, the person pressing
  the button needs to find out.
- **Nothing may silently lose a user's work.** Loading a file that exists but
  can't be read is not the same as loading a file that isn't there. Never let
  the second path write over the first.
- **Remember who's on the other end.** Most people using this are volunteers,
  at 8am, with the service about to start. Error messages should say what to do.

## Hardware

If you have a console, camera or switcher ProDeck claims to support, running it
and telling me what happened is genuinely one of the most useful things you can
do. Only the Allen & Heath Avantis has ever been tested against real hardware —
everything else is built from published protocols. Reports either way help.
