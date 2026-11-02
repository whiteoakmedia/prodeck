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
