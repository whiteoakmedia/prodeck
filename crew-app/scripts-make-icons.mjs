// Renders the ProDeck mark into the source images @capacitor/assets turns
// into every icon and launch screen size: node scripts-make-icons.mjs, then
// npx capacitor-assets generate.
import sharp from "sharp";
import { readFileSync } from "node:fs";

const mark = readFileSync(new URL("./src/mark.svg", import.meta.url));
const BG = "#0e131b";
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

const markPng = (size) => sharp(mark, { density: 1200 }).resize(size, size, { fit: "contain", background: CLEAR }).png().toBuffer();
const canvas = (size, background) => sharp({ create: { width: size, height: size, channels: 4, background } });

async function onDark(size, markSize, file) {
  await canvas(size, BG).composite([{ input: await markPng(markSize), gravity: "center" }]).png().toFile(file);
}

await onDark(1024, 600, "assets/icon-only.png");
await canvas(1024, CLEAR).composite([{ input: await markPng(560), gravity: "center" }]).png().toFile("assets/icon-foreground.png");
await canvas(1024, BG).png().toFile("assets/icon-background.png");
// Launch screens are plain ProDeck dark: the app's intro (src/Intro.tsx)
// brings the mark in, and a finished mark here would flash before it.
await canvas(2732, BG).png().toFile("assets/splash.png");
await canvas(2732, BG).png().toFile("assets/splash-dark.png");
console.log("icon sources written to assets/");

// Android's adaptive icon, drawn straight into res/: a full bleed ProDeck dark
// layer, and the mark at the same size it has on the iPhone icon (600 of 1024
// across), measured against the 72 of 108 the launcher shows. Android 13 and
// later tint the monochrome layer (res/drawable/ic_launcher_monochrome.xml).
const RES = "android/app/src/main/res";
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const MARK_OF_ICON = 600 / 1024;
for (const [d, k] of Object.entries(DENSITIES)) {
  const layer = Math.round(108 * k);
  const mark = Math.round(72 * k * MARK_OF_ICON);
  await canvas(layer, CLEAR).composite([{ input: await markPng(mark), gravity: "center" }]).png().toFile(`${RES}/mipmap-${d}/ic_launcher_foreground.png`);
  await canvas(layer, BG).png().toFile(`${RES}/mipmap-${d}/ic_launcher_background.png`);
  // Before Android 8 (and some launchers' fallbacks): the plain icon.
  const legacy = Math.round(48 * k);
  await onDark(legacy, Math.round(legacy * MARK_OF_ICON), `${RES}/mipmap-${d}/ic_launcher.png`);
  const round = await sharp(Buffer.from(`<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}" fill="#fff"/></svg>`)).png().toBuffer();
  await canvas(legacy, BG)
    .composite([{ input: await markPng(Math.round(legacy * MARK_OF_ICON * 0.92)), gravity: "center" }, { input: round, blend: "dest-in" }])
    .png()
    .toFile(`${RES}/mipmap-${d}/ic_launcher_round.png`);
}
// Google Play's listing icon: 512 square, full bleed (Play rounds it).
await onDark(512, Math.round(512 * MARK_OF_ICON), "../design/play/icon-512.png");
console.log("Android icons written to android/app/src/main/res and design/play/");
