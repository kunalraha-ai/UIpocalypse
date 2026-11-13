/**
 * Spike S2 — State hashing: ariaSnapshot vs CDP DOMSnapshot, on the CreditCraft
 * sample app. Pipeline shared with the held-out validation in s2-heldout.ts
 * (lib/statehash.ts).
 *
 * Acceptance (TRD §4): ≥ 90% of "same screen" pairs collide, ≥ 95% of
 * "different screen" pairs don't.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { APP_URL, ALICE, BOB, loginContext } from './lib/app.js';
import { both, scoreMethod, type Capture } from './lib/statehash.js';

const RESULTS_DIR = fileURLToPath(new URL('../results/', import.meta.url));

async function run() {
  const browser: Browser = await chromium.launch();
  const H: Record<string, Capture> = {};

  // ---- anon home ×3 (reload stability)
  const anonCtx = await browser.newContext();
  const anonPage = await anonCtx.newPage();
  await anonPage.goto(APP_URL);
  H.home1 = await both(anonCtx, anonPage);
  await anonPage.reload();
  H.home2 = await both(anonCtx, anonPage);
  await anonPage.reload();
  H.home3 = await both(anonCtx, anonPage);

  // ---- search results, same screen different content
  await anonPage.goto(APP_URL);
  await anonPage.getByLabel('Search the store').fill('lamp');
  await anonPage.getByRole('button', { name: 'Search' }).click();
  await anonPage.waitForSelector('[aria-label="Search results"]');
  H.searchLamp = await both(anonCtx, anonPage);
  await anonPage.getByLabel('Search the store').fill('chair');
  await anonPage.getByRole('button', { name: 'Search' }).click();
  await anonPage.waitForTimeout(400);
  H.searchChair = await both(anonCtx, anonPage);

  // ---- home after loading recommendations (decoy D2: list added, same screen)
  await anonPage.goto(APP_URL);
  H.homeFresh = await both(anonCtx, anonPage);
  await anonPage.getByRole('button', { name: 'Load recommendations' }).click();
  await anonPage.waitForSelector('[aria-label="Recommendations"]');
  H.homeAfterRecs = await both(anonCtx, anonPage);

  // ---- login page (anon)
  await anonPage.goto(`${APP_URL}/login`);
  H.login = await both(anonCtx, anonPage);
  await anonCtx.close();

  // ---- alice pages
  const aliceCtx = await browser.newContext();
  await loginContext(aliceCtx, ALICE);
  const alicePage = await aliceCtx.newPage();

  await alicePage.goto(`${APP_URL}/profile`);
  H.profileAlice = await both(aliceCtx, alicePage);

  await alicePage.goto(`${APP_URL}/credits`);
  H.creditsAlice = await both(aliceCtx, alicePage);

  await alicePage.goto(`${APP_URL}/checkout`);
  H.checkoutPre = await both(aliceCtx, alicePage);

  // coupon applied — same screen, different visible numbers/message
  await alicePage.getByLabel('Coupon code').fill('WELCOME10');
  await alicePage.getByRole('button', { name: 'Redeem coupon' }).click();
  await alicePage.waitForSelector('text=Coupon applied');
  H.checkoutPost = await both(aliceCtx, alicePage);

  await alicePage.goto(`${APP_URL}/orders`);
  await alicePage.waitForSelector('[role="progressbar"]');
  H.orders1 = await both(aliceCtx, alicePage);
  await alicePage.reload();
  await alicePage.waitForSelector('[role="progressbar"]');
  H.orders2 = await both(aliceCtx, alicePage);

  await alicePage.goto(`${APP_URL}/settings`);
  H.settingsClosed = await both(aliceCtx, alicePage);
  // open dialog without clicking the destructive-labelled button (safety rule)
  await alicePage.evaluate(() => (document.querySelector('dialog') as HTMLDialogElement).showModal());
  H.settingsDialog = await both(aliceCtx, alicePage);
  await alicePage.evaluate(() => (document.querySelector('dialog') as HTMLDialogElement).close());

  // ---- bob pages (same screens, different user)
  const bobCtx = await browser.newContext();
  await loginContext(bobCtx, BOB);
  const bobPage = await bobCtx.newPage();
  await bobPage.goto(`${APP_URL}/profile`);
  H.profileBob = await both(bobCtx, bobPage);
  await bobPage.goto(`${APP_URL}/credits`);
  H.creditsBob = await both(bobCtx, bobPage);
  await bobCtx.close();

  // ---- checkout success, two different orders (same screen)
  for (const key of ['successA', 'successB'] as const) {
    const ctx = await browser.newContext();
    await loginContext(ctx, ALICE);
    const page = await ctx.newPage();
    await page.goto(`${APP_URL}/checkout`);
    await page.getByRole('button', { name: 'Place order' }).click();
    await page.waitForURL('**/checkout/success');
    await page.waitForSelector('text=/Order #/');
    H[key] = await both(ctx, page);
    await ctx.close();
  }

  await browser.close();

  // ---------------------------------------------------------------- metrics
  const samePairs: [string, string][] = [
    ['home1', 'home2'], ['home1', 'home3'], ['home2', 'home3'],
    ['profileAlice', 'profileBob'],
    ['creditsAlice', 'creditsBob'],
    ['checkoutPre', 'checkoutPost'],
    ['orders1', 'orders2'],
    ['searchLamp', 'searchChair'],
    ['homeFresh', 'homeAfterRecs'],
    ['successA', 'successB'],
  ];
  const diffPages = ['home1', 'login', 'profileAlice', 'creditsAlice', 'checkoutPre', 'orders1', 'settingsClosed', 'settingsDialog', 'successA'];
  const diffPairs: [string, string][] = [];
  for (let i = 0; i < diffPages.length; i++)
    for (let j = i + 1; j < diffPages.length; j++) diffPairs.push([diffPages[i]!, diffPages[j]!]);

  const result: Record<string, unknown> = {
    app: 'sample-app (CreditCraft)',
    appUrl: APP_URL,
    captured: Object.fromEntries(Object.entries(H).map(([k, v]) => [k, { aria: v.aria, dom: v.dom }])),
    samePairs,
    diffPairs,
  };
  for (const method of ['aria', 'dom'] as const) {
    result[method] = scoreMethod(H, method, samePairs, diffPairs);
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, 's2-state-hash.json'), JSON.stringify(result, null, 2));

  console.log('=== Spike S2: state hashing (sample app) ===');
  report(result);
  const aria = result['aria'] as { sameScreenCollisionRate: number; diffScreenSeparationRate: number };
  const pass = aria.sameScreenCollisionRate >= 0.9 && aria.diffScreenSeparationRate >= 0.95;
  console.log(`\nGATE (aria): collision ${(aria.sameScreenCollisionRate * 100).toFixed(0)}% (≥90%), separation ${(aria.diffScreenSeparationRate * 100).toFixed(0)}% (≥95%) → ${pass ? 'PASS' : 'FAIL'}`);
}

export function report(result: Record<string, unknown>): void {
  for (const method of ['aria', 'dom'] as const) {
    const r = result[method] as ReturnType<typeof scoreMethod>;
    console.log(`\n[${method}]`);
    console.log(`  same-screen collision rate:  ${(r.sameScreenCollisionRate * 100).toFixed(1)}%`);
    console.log(`  diff-screen separation rate: ${(r.diffScreenSeparationRate * 100).toFixed(1)}%`);
    console.log(`  capture time avg: ${r.captureMsAvg.toFixed(1)} ms, payload avg: ${(r.captureBytesAvg / 1024).toFixed(1)} KB`);
    if (r.diffScreenCollidedBadly.length) console.log(`  !! different screens that wrongly collided: ${r.diffScreenCollidedBadly.join(', ')}`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
