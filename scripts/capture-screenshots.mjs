/**
 * Captures real screenshots of the running portals for documentation.
 *   node scripts/capture-screenshots.mjs
 * Requires the API (:4000) and web (:5173) dev servers to be running.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5173';
const OUT = 'screenshots';

const SHOTS = [
  { name: '01-landing-desktop', path: '/', viewport: { width: 1440, height: 900 }, fullPage: true },
  { name: '02-landing-mobile', path: '/', viewport: { width: 390, height: 844 }, fullPage: false },
  { name: '03-styleguide-desktop', path: '/styleguide', viewport: { width: 1440, height: 1000 }, fullPage: true },
  { name: '04-customer-portal-placeholder', path: '/app', viewport: { width: 1440, height: 900 }, fullPage: false },
  { name: '05-rider-portal-placeholder', path: '/rider', viewport: { width: 390, height: 844 }, fullPage: false },
];

const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });

for (const shot of SHOTS) {
  const page = await browser.newPage({ viewport: shot.viewport, deviceScaleFactor: 2 });
  await page.goto(`${WEB}${shot.path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${shot.name}.png`, fullPage: shot.fullPage });
  console.log(`✓ ${shot.name}.png`);
  await page.close();
}

// Modal + toast interaction proof
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`${WEB}/styleguide`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Open modal' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/06-modal-open.png` });
console.log('✓ 06-modal-open.png');
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Show success toast' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/07-toast.png` });
console.log('✓ 07-toast.png');
await page.close();

await browser.close();
console.log('\nAll screenshots written to ./screenshots');
