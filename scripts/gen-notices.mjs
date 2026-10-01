#!/usr/bin/env node
// Writes public/THIRD_PARTY_NOTICES.txt: the licence notices for everything
// ProDeck ships (Rust crates in the app binary, npm packages in the front end,
// the bundled fonts), plus the components with their own terms (LAME, OpenSSL,
// NDI). The app shows it under Settings → About → Licences.
//
//   node scripts/gen-notices.mjs        (run before a release; it's committed)

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "public", "THIRD_PARTY_NOTICES.txt");
const TARGETS = ["aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-pc-windows-msvc"];
const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)([-._].*)?$/i;

// ---------------------------------------------------------------- Rust
function rustPackages() {
  const seen = new Map();
  for (const target of TARGETS) {
    const out = execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--filter-platform", target], {
      cwd: path.join(ROOT, "src-tauri"),
      maxBuffer: 256 * 1024 * 1024,
    });
    const m = JSON.parse(out.toString());
    const byId = new Map(m.packages.map((p) => [p.id, p]));
    const nodes = new Map(m.resolve.nodes.map((n) => [n.id, n]));
    // Only what ends up in the binary: normal (non-dev, non-build) edges.
    const stack = [m.resolve.root];
    const reach = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (reach.has(id)) continue;
      reach.add(id);
      for (const d of nodes.get(id)?.deps ?? []) {
        if (d.dep_kinds.some((k) => k.kind === null)) stack.push(d.pkg);
      }
    }
    for (const id of reach) {
      const p = byId.get(id);
      if (!p || id === m.resolve.root) continue;
      seen.set(`${p.name}@${p.version}`, p);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

// ---------------------------------------------------------------- npm
function npmPackages() {
  const out = execFileSync("npm", ["ls", "--omit=dev", "--all", "--json", "--long"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  const tree = JSON.parse(out.toString());
  const seen = new Map();
  const walk = (deps) => {
    for (const [name, d] of Object.entries(deps ?? {})) {
      if (!d.path || seen.has(`${name}@${d.version}`)) continue;
      seen.set(`${name}@${d.version}`, { name, version: d.version, dir: d.path, license: d.license, repository: d.repository?.url ?? d.repository ?? "" });
      walk(d.dependencies);
    }
  };
  walk(tree.dependencies);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function licenseFiles(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => LICENSE_FILE.test(f))
      .map((f) => path.join(dir, f))
      .filter((f) => fs.statSync(f).isFile());
  } catch {
    return [];
  }
}

const copyrightLines = (text) =>
  [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(copyright|\(c\)|©)/i.test(l) && l.length < 200))].slice(0, 6);

// Full licence texts, each printed once, keyed by content.
const texts = new Map();
function remember(file) {
  const t = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();
  const h = createHash("sha256").update(t).digest("hex").slice(0, 12);
  if (!texts.has(h)) texts.set(h, { text: t, from: path.basename(file) });
  return h;
}

function entry(p, dir, license, repo) {
  const files = licenseFiles(dir);
  const refs = files.map(remember);
  const copy = files.flatMap((f) => copyrightLines(fs.readFileSync(f, "utf8")));
  return { line: `${p.name} ${p.version} — ${license || "see licence text"}${repo ? ` — ${repo}` : ""}`, copy: [...new Set(copy)], refs };
}

const rust = rustPackages().map((p) => entry(p, path.dirname(p.manifest_path), p.license ?? (p.license_file ? `see ${p.license_file}` : ""), p.repository ?? ""));
const npm = npmPackages().map((p) => entry(p, p.dir, typeof p.license === "string" ? p.license : p.license?.type, typeof p.repository === "string" ? p.repository.replace(/^git\+/, "") : ""));

const plexDir = path.join(ROOT, "node_modules", "@fontsource", "ibm-plex-sans");
const ofl = licenseFiles(plexDir).map((f) => fs.readFileSync(f, "utf8").trim())[0] ?? "(SIL Open Font License 1.1 — https://openfontlicense.org)";
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, "src-tauri", "tauri.conf.json"), "utf8")).version;

const rule = "=".repeat(78);
const out = [
  "PRODECK — THIRD-PARTY NOTICES",
  `Generated for ProDeck ${ver} by scripts/gen-notices.mjs. ProDeck itself is MIT licensed (see LICENSE).`,
  "",
  rule,
  "COMPONENTS WITH THEIR OWN TERMS",
  rule,
  "",
  "LAME MP3 encoder 3.100 (via the mp3lame-sys and mp3lame-encoder crates)",
  "  Licence: LAME is GNU LGPL version 2 or later; the mp3lame-sys and",
  "  mp3lame-encoder wrapper crates are GNU LGPL version 3.",
  "  ProDeck links LAME statically to make the Listen audio stream. Under the",
  "  LGPL you may replace it with a modified LAME: the complete source for every",
  `  ProDeck release is at https://github.com/whiteoakmedia/prodeck (tag v${ver} for`,
  "  this one), so you can rebuild ProDeck against your own LAME. LAME's source:",
  "  https://lame.sourceforge.io and https://github.com/DoumanAsh/mp3lame-sys .",
  "  LGPL texts: https://www.gnu.org/licenses/old-licenses/lgpl-2.0.html and",
  "  https://www.gnu.org/licenses/lgpl-3.0.html (with the GPL v3 it builds on,",
  "  https://www.gnu.org/licenses/gpl-3.0.html).",
  "",
  "OpenSSL 3 (vendored through the openssl-src crate)",
  "  This product includes software developed by the OpenSSL Project",
  "  (https://openssl-library.org). Licence: Apache License 2.0 (text below).",
  "",
  "IBM Plex Sans and IBM Plex Mono fonts (bundled through @fontsource)",
  "  Copyright IBM Corp. Licence: SIL Open Font License 1.1, reproduced in full:",
  "",
  ofl.split("\n").map((l) => "    " + l).join("\n"),
  "",
  "NDI",
  "  NDI® is a registered trademark of Vizrt NDI AB. https://ndi.video",
  "  ProDeck does not include the NDI runtime; it uses the one installed on the",
  "  computer by NDI Tools or the NDI SDK, under NDI's own licence.",
  "",
  "Whisper speech recognition (whisper.cpp)",
  "  Not included. Auto-Follow uses a whisper.cpp program and model you install",
  "  yourself (MIT licence, https://github.com/ggml-org/whisper.cpp).",
  "",
  rule,
  "TRADEMARKS",
  rule,
  "",
  "ProDeck is an independent project. It is not affiliated with, sponsored by or",
  "endorsed by any of the companies below; their names appear only to say what",
  "ProDeck works with. ProPresenter is a trademark of Renewed Vision. Planning",
  "Center is a trademark of Ministry Centered Technologies. Dante and Audinate",
  "are registered trademarks of Audinate Pty Ltd. Allen & Heath, Avantis, dLive",
  "and SQ are trademarks of Allen & Heath Ltd. Stream Deck is a trademark of",
  "Corsair Memory, Inc. (Elgato). Bitfocus Companion is a product of Bitfocus AS.",
  "Waves and SoundGrid are trademarks of Waves Audio Ltd. Behringer and X32 are",
  "trademarks of Music Tribe; Midas and M32 likewise. Shure and ULX-D are",
  "trademarks of Shure Incorporated. NDI is a registered trademark of Vizrt NDI",
  "AB. Claude and Anthropic are trademarks of Anthropic, PBC. All other names",
  "belong to their owners. The ProDeck and White Oak Media names and logos are",
  "not covered by ProDeck's MIT licence.",
  "",
  rule,
  `RUST CRATES IN THE APP (${rust.length})`,
  rule,
  "",
  ...rust.flatMap((e) => [e.line, ...e.copy.map((c) => "    " + c), ...(e.refs.length ? ["    licence text: " + e.refs.map((r) => "[" + r + "]").join(" ")] : []), ""]),
  rule,
  `JAVASCRIPT PACKAGES IN THE APP (${npm.length})`,
  rule,
  "",
  ...npm.flatMap((e) => [e.line, ...e.copy.map((c) => "    " + c), ...(e.refs.length ? ["    licence text: " + e.refs.map((r) => "[" + r + "]").join(" ")] : []), ""]),
  rule,
  `LICENCE TEXTS (${texts.size}, each printed once and referenced above)`,
  rule,
  "",
  ...[...texts.entries()].flatMap(([h, t]) => [`[${h}] (${t.from})`, "", t.text, "", "-".repeat(78), ""]),
].join("\n");

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out + "\n");
console.log(`wrote ${path.relative(ROOT, OUT)}: ${rust.length} crates, ${npm.length} npm packages, ${texts.size} licence texts, ${(out.length / 1024).toFixed(0)} KB`);
