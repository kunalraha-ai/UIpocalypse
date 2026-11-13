/**
 * Verify the client-side planted bugs that the API smoke test can't reach:
 *  - bug #6: 10k-char garbage in the name input crashes the profile page
 *  - bug #11: revisiting /checkout/success crashes (broken back/refresh state)
 *  - decoy #1: the aria-hidden footer button is absent from ariaSnapshot
 *  - bug #12: "Delete account" is present and reachable but must be skippable
 */

import { chromium } from 'playwright';
import { APP_URL, ALICE, loginContext } from './lib/app.js';

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await loginContext(ctx, ALICE);
  const page = await ctx.newPage();

  const results: Record<string, unknown> = {};

  // ---- bug #6: garbage name crashes the page
  await page.goto(`${APP_URL}/profile`);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.getByLabel('Name', { exact: true }).fill('x'.repeat(10000));
  await page.waitForTimeout(500);
  const bodyText6 = await page.evaluate(() => document.body.innerText).catch(() => '');
  const broken6 = bodyText6.trim().length === 0 || /application error|couldn.t load/i.test(bodyText6);
  results.bug6_garbageNameCrash = {
    pageErrors: errors,
    renderedSnippet: bodyText6.slice(0, 120),
    pageBroke: broken6,
    pass: errors.length > 0 && broken6,
  };

  // ---- bug #11: success page works the first time, crashes on revisit
  const ctx2 = await browser.newContext();
  await loginContext(ctx2, ALICE);
  const page2 = await ctx2.newPage();
  const errors2: string[] = [];
  page2.on('pageerror', (e) => errors2.push(String(e)));
  await page2.goto(`${APP_URL}/checkout`);
  await page2.getByRole('button', { name: 'Place order' }).click();
  await page2.waitForURL('**/checkout/success');
  await page2.waitForSelector('text=/Order #/');
  const firstView = await page2.evaluate(() => document.body.innerText);
  await page2.reload(); // revisit — "one-time read" of sessionStorage is gone
  await page2.waitForTimeout(500);
  const afterReload = await page2.evaluate(() => document.body.innerText).catch(() => '');
  const broken11 = afterReload.trim().length === 0 || /application error|couldn.t load/i.test(afterReload);
  results.bug11_successRevisitCrash = {
    firstViewOk: /Order #/.test(firstView),
    pageErrorsAfterReload: errors2,
    renderedSnippet: afterReload.slice(0, 120),
    pageBroke: broken11,
    pass: /Order #/.test(firstView) && errors2.length > 0 && broken11,
  };

  // ---- decoy #1 + bug #12 visibility via ariaSnapshot
  await page2.goto(`${APP_URL}/settings`);
  const snap = await page2.locator('body').ariaSnapshot();
  results.decoy1_ariaHiddenAbsent = { pass: !snap.includes('✦') };
  results.bug12_deleteAccountPresent = { pass: snap.includes('Delete account') };
  const dialogInSnapshotWhenClosed = snap.includes('Delete forever');
  await page2.evaluate(() => (document.querySelector('dialog') as HTMLDialogElement).showModal());
  const snapOpen = await page2.locator('body').ariaSnapshot();
  results.bug12_dialogHiddenWhenClosed = {
    pass: !dialogInSnapshotWhenClosed && snapOpen.includes('Delete forever'),
  };

  await browser.close();

  console.log('=== Client-side bug verification ===');
  for (const [k, v] of Object.entries(results)) {
    console.log(`  ${k}: ${JSON.stringify(v)}`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
