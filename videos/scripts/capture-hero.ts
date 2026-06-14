import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Captures the website landing's Three.js particle-alpona field (text hidden)
// so the cover card can sit on the same hero background as the website.
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', '.cache', 'out');
const url = process.env.WEBSITE_URL ?? 'http://localhost:4321/';

async function main() {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3200); // let the alpona point cloud settle
  // Strip every overlay so only night-floor + particles remain.
  await page.addStyleTag({
    content: `.beat,#cue,.scrollcue,header,.topbar,nav,.lp,.site-header,a[href]{opacity:0!important}`,
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(out, 'cover-bg.png') });
  await browser.close();
  console.log('✓ hero background → .cache/out/cover-bg.png');
}

void main();
