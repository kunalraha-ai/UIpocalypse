/**
 * Spike S2 (held-out) — validate the state-hash normalization on Messy Mart,
 * a structurally different app (Vite + React Router SPA, divs-as-buttons,
 * emoji labels) that the pipeline was NOT tuned on.
 *
 * Gate (implementation plan, Phase 3): ≥ 90% same-screen collision,
 * ≥ 95% different-screen separation, with zero re-tuning of the pipeline
 * in lib/statehash.ts.
 *
 * Usage: APP_URL=http://localhost:4173 npx tsx src/s2-heldout.ts
 */

import { chromium, type Browser } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { APP_URL } from './lib/app.js';
import { both, scoreMethod, type Capture } from './lib/statehash.js';

const RESULTS_DIR = fileURLToPath(new URL('../results/', import.meta.url));

async function run() {
  const browser: Browser = await chromium.launch();
  const H: Record<string, Capture> = {};
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // ---- home ×2 (reload stability)
  await page.goto(APP_URL);
  H.home1 = await both(ctx, page);
  await page.reload();
  H.home2 = await both(ctx, page);

  // ---- category filter: same screen, different item lists (2 vs 4 cards)
  await page.getByRole('button', { name: '⚡ Gadgets' }).click();
  H.homeGadgets = await both(ctx, page);
  await page.getByRole('button', { name: '🍩 Snacks' }).click();
  H.homeSnacks = await both(ctx, page);

  // ---- "Show more" appends 4 cards (list grows; non-interactive) — same screen
  await page.getByRole('button', { name: 'Show more ➕' }).click();
  H.homeMore = await both(ctx, page);

  // ---- dynamic item detail: same screen, different ids/prices (digits masked)
  await page.goto(`${APP_URL}/item/101`);
  H.itemA = await both(ctx, page);
  await page.goto(`${APP_URL}/item/202`);
  H.itemB = await both(ctx, page);

  // ---- about
  await page.goto(`${APP_URL}/about`);
  H.about = await both(ctx, page);

  // ---- settings: user switcher (same screen, different name), reload loading
  //      state (loading flag), destructive dialog (dialog flag)
  await page.goto(`${APP_URL}/settings`);
  H.settingsAlice = await both(ctx, page);
  await page.getByRole('button', { name: '👤 Bob' }).click();
  H.settingsBob = await both(ctx, page);

  await page.getByRole('button', { name: '🔄 Reload preferences' }).click();
  await page.waitForSelector('[role="progressbar"]');
  H.settingsLoading1 = await both(ctx, page);
  await page.waitForSelector('[role="progressbar"]', { state: 'detached' });
  await page.getByRole('button', { name: '🔄 Reload preferences' }).click();
  await page.waitForSelector('[role="progressbar"]');
  H.settingsLoading2 = await both(ctx, page);
  await page.waitForSelector('[role="progressbar"]', { state: 'detached' });

  // dialog opened via the DOM (do not click the destructive-labelled button)
  await page.evaluate(() => (document.querySelector('dialog') as HTMLDialogElement).showModal());
  H.settingsDialog = await both(ctx, page);
  await page.evaluate(() => (document.querySelector('dialog') as HTMLDialogElement).close());

  await ctx.close();
  await browser.close();

  // ---------------------------------------------------------------- pairs
  const samePairs: [string, string][] = [
    ['home1', 'home2'],
    ['homeGadgets', 'homeSnacks'],
    ['home1', 'homeMore'], // list grew — non-interactive content must not break the hash
    ['itemA', 'itemB'],
    ['settingsAlice', 'settingsBob'],
    ['settingsLoading1', 'settingsLoading2'],
  ];
  const diffPages = ['home1', 'itemA', 'about', 'settingsAlice', 'settingsLoading1', 'settingsDialog'];
  const diffPairs: [string, string][] = [];
  for (let i = 0; i < diffPages.length; i++)
    for (let j = i + 1; j < diffPages.length; j++) diffPairs.push([diffPages[i]!, diffPages[j]!]);

  const result: Record<string, unknown> = {
    app: 'held-out-app (Messy Mart)',
    appUrl: APP_URL,
    captured: Object.fromEntries(Object.entries(H).map(([k, v]) => [k, { aria: v.aria, dom: v.dom }])),
    samePairs,
    diffPairs,
  };
  for (const method of ['aria', 'dom'] as const) {
    result[method] = scoreMethod(H, method, samePairs, diffPairs);
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, 's2-heldout.json'), JSON.stringify(result, null, 2));

  console.log('=== Spike S2 (held-out): state hashing on Messy Mart (Vite SPA, no re-tuning) ===');
  for (const method of ['aria', 'dom'] as const) {
    const r = result[method] as ReturnType<typeof scoreMethod>;
    console.log(`\n[${method}]`);
    console.log(`  same-screen collision rate:  ${(r.sameScreenCollisionRate * 100).toFixed(1)}% (gate ≥ 90%)`);
    console.log(`  diff-screen separation rate: ${(r.diffScreenSeparationRate * 100).toFixed(1)}% (gate ≥ 95%)`);
    if (r.sameScreenCollided.length) console.log(`  same-screen pairs collided: ${r.sameScreenCollided.join(', ')}`);
    if (r.diffScreenCollidedBadly.length) console.log(`  !! different screens that wrongly collided: ${r.diffScreenCollidedBadly.join(', ')}`);
  }
  const aria = result['aria'] as { sameScreenCollisionRate: number; diffScreenSeparationRate: number };
  const pass = aria.sameScreenCollisionRate >= 0.9 && aria.diffScreenSeparationRate >= 0.95;
  console.log(`\nGATE (aria, held-out): collision ${(aria.sameScreenCollisionRate * 100).toFixed(0)}%, separation ${(aria.diffScreenSeparationRate * 100).toFixed(0)}% → ${pass ? 'PASS' : 'FAIL'}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
