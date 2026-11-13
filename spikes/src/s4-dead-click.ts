/**
 * Spike S4 — Dead-click detector: MutationObserver + network wrapping.
 *
 * Question (IMPLEMENTATION_PLAN.md Phase 0): can MutationObserver + network
 * wrapping reliably flag dead clicks with a low false-positive rate?
 *
 * Method: inject the runtime (addInitScript), walk every actionable element of
 * every page, perform() it, and compare against the ground truth in
 * sample-app/README.md. Destructive and session-ending actions are skipped
 * (the swarm must never click them — SAFETY.md G5, BENCHMARK.md bug #12).
 *
 * Gate: false-positive rate < 20%. Bonus metrics: 404 on /api/promo (bug #3),
 * 500 on /api/orders (bug #8), spinner persisting > 10 s (bug #8).
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { APP_URL, ALICE, loginContext } from './lib/app.js';

const RUNTIME = readFileSync(new URL('./runtime/deadclick-runtime.js', import.meta.url), 'utf8');

// The injected runtime (deadclick-runtime.js) exposes window.__uip.
declare global {
  interface Window {
    __uip: {
      getActions(): { id: number; tag: string; role: string; name: string }[];
      perform(id: number): Promise<{
        dead: boolean;
        reasons: string[];
        nav?: boolean;
        error?: string;
        saturated?: boolean;
      }>;
      events(): { mutations: number; requests: { url: string; status: number }[] };
    };
  }
}

const PAGES = ['/', '/credits', '/checkout', '/orders', '/profile', '/settings'];

// Safety skip list: destructive actions (never click) and session-ending ones
// (would invalidate the rest of the sweep).
const SKIP = /delete|sign out|unsubscribe|cancel subscription/i;

// Ground truth (sample-app/README.md): the only truly dead actionable element.
const TRULY_DEAD = ['Save profile'];

type Finding = {
  page: string;
  name: string;
  dead: boolean;
  reasons: string[];
  nav?: boolean;
  skipped?: boolean;
  saturated?: boolean;
};

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript(RUNTIME);
  await loginContext(ctx, ALICE);
  const page = await ctx.newPage();

  const findings: Finding[] = [];
  const clicks: Finding[] = [];

  for (const url of PAGES) {
    await page.goto(`${APP_URL}${url}`, { waitUntil: 'load' });
    await page.waitForTimeout(800); // let hydration settle

    const tested = new Set<string>();
    let guard = 0;
    while (guard++ < 60) {
      const actions = (await page.evaluate(() => window.__uip.getActions())) as {
        id: number;
        tag: string;
        name: string;
      }[];
      // buttons/inputs first, links last (links navigate away)
      const ordered = [...actions].sort((a, b) => (a.tag === 'A' ? 1 : 0) - (b.tag === 'A' ? 1 : 0));
      const next = ordered.find((a) => !tested.has(a.name));
      if (!next) break;
      tested.add(next.name);

      if (SKIP.test(next.name)) {
        findings.push({ page: url, name: next.name, dead: false, reasons: [], skipped: true });
        continue;
      }

      let result: { dead: boolean; reasons: string[]; nav?: boolean; saturated?: boolean };
      try {
        result = await page.evaluate((id) => window.__uip.perform(id), next.id);
      } catch {
        // a full navigation destroyed the document mid-perform → navigation = alive
        result = { dead: false, reasons: ['nav'], nav: true };
        await page.waitForLoadState('load', { timeout: 8000 }).catch(() => {});
      }
      clicks.push({ page: url, name: next.name, dead: result.dead, reasons: result.reasons, saturated: result.saturated });
      if (result.dead) findings.push({ page: url, name: next.name, dead: true, reasons: [] });

      if (result.nav) {
        // come back and continue with the remaining actions
        await page.goto(`${APP_URL}${url}`, { waitUntil: 'load' }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }
  }

  // ---- bonus detector checks
  // network log: /api/promo should have 404'd (bug #3), /api/orders 500'd (bug #8)
  await page.goto(`${APP_URL}/`, { waitUntil: 'load' });
  await page.getByRole('button', { name: "See today's promo" }).click();
  await page.waitForTimeout(800);
  const events = (await page.evaluate(() => window.__uip.events())) as {
    mutations: number;
    requests: { url: string; status: number }[];
  };
  const promo404 = events.requests.find((r) => r.url.includes('/api/promo') && r.status === 404);

  // infinite spinner: orders page — spinner must persist past 10 s (bug #8)
  await page.goto(`${APP_URL}/orders`, { waitUntil: 'load' });
  const spinnerAppeared = await page
    .waitForSelector('[role="progressbar"]', { state: 'visible', timeout: 11000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(10500); // TRD threshold: spinner persists > 10 s
  const spinnerStill = spinnerAppeared
    ? await page
        .locator('[role="progressbar"]')
        .isVisible()
        .catch(() => false)
    : false;
  const ordersEvents = (await page.evaluate(() => window.__uip.events())) as {
    requests: { url: string; status: number }[];
  };
  const orders500 = ordersEvents.requests.find((r) => r.url.includes('/api/orders') && r.status === 500);

  await browser.close();

  // ---- score the dead-click detector
  const flagged = clicks.filter((c) => c.dead);
  const truePositives = flagged.filter((c) => TRULY_DEAD.some((d) => d === c.name));
  const falsePositives = flagged.filter((c) => !TRULY_DEAD.some((d) => d === c.name));
  const missedDead = TRULY_DEAD.filter(
    (d) => !clicks.some((c) => c.name === d && c.dead),
  );
  const fpRate = flagged.length ? falsePositives.length / flagged.length : 0;

  const result = {
    appUrl: APP_URL,
    totalClicks: clicks.length,
    saturatedControls: clicks.filter((c) => c.saturated).map((c) => c.name),
    flaggedDead: flagged,
    truePositives: truePositives.length,
    falsePositives,
    missedDead,
    fpRate,
    gatePass: fpRate < 0.2 && missedDead.length === 0,
    skipped: findings.filter((f) => f.skipped),
    bonus: {
      promo404Detected: !!promo404,
      orders500Detected: !!orders500,
      infiniteSpinnerDetected: spinnerStill,
    },
    allClicks: clicks,
  };

  mkdirSync('spikes/results', { recursive: true });
  writeFileSync('spikes/results/s4-dead-click.json', JSON.stringify(result, null, 2));

  console.log('=== Spike S4: dead-click detector ===');
  console.log(`  actions performed:  ${clicks.length}`);
  console.log(`  saturated controls: ${result.saturatedControls.length ? result.saturatedControls.join(', ') : 'none'}`);
  console.log(`  flagged dead:       ${flagged.length} → TP ${truePositives.length}, FP ${falsePositives.length}`);
  if (flagged.length) console.log(`    ${flagged.map((f) => `${f.name} @ ${f.page}`).join(', ')}`);
  if (missedDead.length) console.log(`  MISSED dead:        ${missedDead.join(', ')}`);
  console.log(`  FP rate:            ${(fpRate * 100).toFixed(1)}% (gate < 20%)`);
  console.log(`  skipped by safety:  ${result.skipped.map((s) => s.name).join(', ')}`);
  console.log(`  bonus detectors:    promo 404: ${result.bonus.promo404Detected}, orders 500: ${result.bonus.orders500Detected}, infinite spinner: ${result.bonus.infiniteSpinnerDetected}`);
  console.log(`\nGATE: ${result.gatePass ? 'PASS' : 'FAIL'}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
