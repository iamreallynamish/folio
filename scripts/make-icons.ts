/**
 * Generates the home-screen icons and web app manifests for every accent (public/icons, public/manifests).
 * iPhone's "Add to Home Screen" needs a PNG apple-touch-icon and Android installs read the manifest's PNGs,
 * so each accent gets real image files. Run after changing shared/accents.ts:  npx tsx scripts/make-icons.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { ACCENTS, iconSvg, manifestFor } from "../shared/accents.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

mkdirSync("public/icons", { recursive: true });
mkdirSync("public/manifests", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const a of ACCENTS) {
  writeFileSync(`public/icons/${a.key}.svg`, iconSvg(a));
  writeFileSync(`public/manifests/${a.key}.webmanifest`, JSON.stringify(manifestFor(a), null, 2) + "\n");
  // Square, full-bleed tiles: iOS and Android launchers round the corners themselves.
  for (const [name, size] of [["180", 180], ["192", 192], ["512", 512], ["maskable-512", 512]] as const) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:#000">${iconSvg(a, false).replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: `public/icons/${a.key}-${name}.png`, omitBackground: false });
  }
  console.log("icons:", a.key);
}
await browser.close();
