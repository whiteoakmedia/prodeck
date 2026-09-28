# ProDeck

Zach's free booth app for church production teams: Tauri 2 (Rust, `src-tauri/`) plus React and
TypeScript (`src/`). Downloads are on whiteoakmedia.io/tools. Harvey (White Oak's assistant) builds
changes here on request branches; Zach merges.

## What a merge to `master` does

- **Windows build** (`.github/workflows/windows.yml`) runs on every pull request and every push to
  `master`: front end checks, the Rust build and the Rust tests. It's the required check before a
  merge, and Harvey's merge button waits for it.
- **GitHub Pages** rebuilds the docs site from `docs/` (whiteoakmedia.github.io/prodeck).
- **Nothing reaches users.** A merge never releases. Installed copies update only from a GitHub
  Release, which Zach publishes with `scripts/release-public.sh` after bumping `version` in
  `src-tauri/tauri.conf.json`. That script signs the update with a key that exists only on Zach's
  Mac.

## Rules for builds

- Never touch `src-tauri/tauri.conf.json`: it holds the version, the updater's public key and the
  release feed, and a wrong edit breaks updates for every booth. Never bump the version, tag, or
  edit `CHANGELOG.md`: releases are Zach's.
- Never touch `.env*`, `.github/**`, `package.json` or `package-lock.json`, or any key file.
- Checks that must pass: `npx tsc --noEmit`, `npx vitest run`, and `npx vite build`. Tests live in
  `src/__tests__/`, so add one for any logic you change.
- The Mac mini doesn't compile Rust, only the Windows build does, after the PR opens. Keep Rust
  changes small and say so in the summary.
- The browser build (`IS_WEB`) serves phones and kiosks on the church network. Desktop-only
  features check `IS_WEB`.
- **prodeck.live is Zach's private instance for his own church.** Never link to it, point code at
  it, or treat it as a product site.
- Anything a user sees: plain words, no dashes, at most one exclamation mark.
