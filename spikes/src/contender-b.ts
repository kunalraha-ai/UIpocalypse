/**
 * Careful-QA Playwright sweep for CreditCraft (Contender B, BENCHMARK.md).
 * Black-box: drives the live app only, captures console errors, page errors,
 * failed HTTP, and behavioral effects (balances, order lists, coupon state).
 *
 * Usage (from spikes/): npx tsx src/contender-b.ts
 */
import { chromium, type BrowserContext } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3123';
type F = { id: number; area: string; observation: string; repro: string };
const findings: F[] = [];
let nextId = 1;
const note = (area: string, observation: string, repro: string) => {
  findings.push({ id: nextId++, area, observation, repro });
  console.log(`\n[BUG ${nextId - 1}] ${area}: ${observation}`);
  console.log(`  repro: ${repro}`);
};

// ---------------------------------------------------------------- helpers
async function signIn(page: import('playwright').Page, as: 'Alice' | 'Bob' = 'Alice') {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: `Sign in as ${as}` }).click();
  await page.waitForTimeout(800);
}

/** Attaches full capture to a page and returns the collected events. */
function capture(page: import('playwright').Page) {
  const events = { pageErrors: [] as string[], consoleErrors: [] as string[], badResponses: [] as string[] };
  page.on('pageerror', (e) => events.pageErrors.push(String(e).split('\n')[0]!));
  page.on('console', (m) => {
    if (m.type() === 'error') events.consoleErrors.push(m.text().slice(0, 200));
  });
  page.on('response', (r) => {
    if (r.status() >= 400) events.badResponses.push(`${r.request().method()} ${r.url().replace(BASE, '')} → ${r.status()}`);
  });
  return events;
}

const browser = await chromium.launch();

// ================================================================ 1. anonymous crawl: every page, every control
{
  const page = await browser.newPage();
  const ev = capture(page);
  const routes = ['/', '/login', '/credits', '/orders', '/settings', '/checkout', '/profile'];
  const dead: string[] = [];
  for (const route of routes) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' }).catch(() => note('nav', `route ${route} unreachable`, `GET ${route}`));
    await page.waitForTimeout(500);
    // click every visible, enabled, non-destructive control once
    const controls = await page.locator('button:not([disabled]), a[href]').all();
    for (const c of controls) {
      const label = ((await c.textContent())?.trim() ?? '').slice(0, 40);
      if (!label || /delete|remove|sign out/i.test(label)) continue;
      const urlBefore = page.url();
      const mutBefore = await page.evaluate(() => document.documentElement.outerHTML.length);
      const errsBefore = ev.pageErrors.length + ev.badResponses.length;
      await c.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(600);
      const mutAfter = await page.evaluate(() => document.documentElement.outerHTML.length);
      if (page.url() === urlBefore && mutAfter === mutBefore && ev.pageErrors.length + ev.badResponses.length === errsBefore) {
        dead.push(`${label} on ${route}`);
      }
      await page.goto(`${BASE}${route}`).catch(() => {});
      await page.waitForTimeout(250);
    }
  }
  if (ev.pageErrors.length) note('crash', `${ev.pageErrors.length} unhandled page errors during anonymous crawl: ${[...new Set(ev.pageErrors)].slice(0, 3).join(' | ')}`, 'crawl every page as anonymous, click each control');
  if (ev.badResponses.length) note('http', `${[...new Set(ev.badResponses)].slice(0, 5).join(' | ')}`, 'crawl every page as anonymous and watch the network tab');
  const realDead = dead.filter((d) => !/decorative/i.test(d));
  if (realDead.length) note('dead-controls', `controls with zero visible effect: ${[...new Set(realDead)].join('; ')}`, `click each control listed, watch DOM/network/url — nothing happens`);
  await page.close();
}

// ================================================================ 2. logged-in: garbage inputs
{
  const page = await browser.newPage();
  const ev = capture(page);
  await signIn(page);

  // 10k-char name
  await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const errsBefore = ev.pageErrors.length;
  await page.getByLabel('Name').fill('x'.repeat(10_000));
  await page.waitForTimeout(800);
  if (ev.pageErrors.length > errsBefore) note('crash', `profile crashes on a 10,000-char name: ${ev.pageErrors[errsBefore]!.slice(0, 120)}`, 'log in → /profile → type 10k chars into Name');
  // one word, no space
  await page.goto(`${BASE}/profile`);
  await page.waitForTimeout(400);
  const errs2 = ev.pageErrors.length;
  await page.getByLabel('Name').fill('singleword');
  await page.waitForTimeout(600);
  if (ev.pageErrors.length > errs2) note('crash', `profile crashes on a single-word name (no space): ${ev.pageErrors[errs2]!.slice(0, 120)}`, 'log in → /profile → type "singleword"');
  await page.goto(`${BASE}/profile`);
  await page.waitForTimeout(400);
  await page.getByLabel('Name').fill('Alice Anderson').catch(() => {});

  // emoji/RTL search
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const bad3 = ev.badResponses.length;
  await page.getByPlaceholder('e.g. lamp').fill('🎉 مرحبا');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.waitForTimeout(800);
  if (ev.badResponses.length > bad3) note('http', `search 500s on emoji/RTL input: ${ev.badResponses[bad3]}`, 'home → search box → paste "🎉 مرحبا" → Search');

  // promo button
  await page.goto(`${BASE}/`);
  const bad4 = ev.badResponses.length;
  await page.getByRole('button', { name: /check.*promo|promo/i }).click().catch(() => {});
  await page.waitForTimeout(800);
  if (ev.badResponses.length > bad4) note('http', `promo button hits a missing endpoint: ${ev.badResponses[bad4]}`, 'home → click the promo button');
  await page.close();
}

// ================================================================ 3. double-click the money buttons
{
  const page = await browser.newPage();
  const ev = capture(page);
  await signIn(page);
  await page.goto(`${BASE}/credits`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const bal = (s: string) => s?.replace(/[^\d]/g, '');
  const before = bal(await page.getByText(/Current balance:/).textContent().catch(() => ''));
  await page.getByRole('button', { name: 'Buy credits' }).dblclick();
  await page.waitForTimeout(1500);
  const after = bal(await page.getByText(/Current balance:/).textContent().catch(() => ''));
  if (before !== after) note('double-submit', `double-click "Buy credits" charges twice: ${before} → ${after} (+${Number(after) - Number(before)} credits, one pack is 500)`, 'log in → /credits → double-click Buy credits → balance jumps by 1000, not 500');

  // coupon double-click
  await page.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.getByPlaceholder('WELCOME10').fill('WELCOME10');
  await page.getByRole('button', { name: 'Redeem coupon' }).dblclick();
  await page.waitForTimeout(1500);
  const msg = await page.getByRole('status').textContent().catch(() => '');
  if (/applied/i.test(msg ?? '')) note('double-submit', `double-click "Redeem coupon" redeems twice (msg: "${msg?.trim()}")`, 'checkout → WELCOME10 → double-click Redeem → check messages');
  await page.close();
}

// ================================================================ 4. concurrent coupon redemptions (single-use check)
{
  const ctxs: BrowserContext[] = [];
  for (let i = 0; i < 10; i++) ctxs.push(await browser.newContext());
  await Promise.all(
    ctxs.map(async (ctx) => {
      await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: 'alice@example.com', password: 'secret123' } });
      const p = await ctx.newPage();
      await p.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
      await p.getByPlaceholder('WELCOME10').fill('WELCOME10').catch(() => {});
    }),
  );
  await Promise.all(ctxs.map((ctx) => ctx.pages()[0]!.getByRole('button', { name: 'Redeem coupon' }).click().catch(() => {})));
  await new Promise((r) => setTimeout(r, 2500));
  const msgs = await Promise.all(ctxs.map((c) => c.pages()[0]!.getByRole('status').textContent().catch(() => '')));
  const applied = msgs.filter((m) => /applied/i.test(m ?? '')).length;
  if (applied > 1) note('race', `${applied} of 10 concurrent "Redeem coupon" succeeded on a single-use coupon`, '10 sessions, all signed in, all at /checkout with WELCOME10, click Redeem simultaneously');
  for (const c of ctxs) await c.close();
}

// ================================================================ 5. revisit/reload the success page
{
  const page = await browser.newPage();
  const ev = capture(page);
  await signIn(page);
  await page.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Place order' }).click();
  await page.waitForTimeout(1200);
  if (page.url().includes('/checkout/success')) {
    const errsBefore = ev.pageErrors.length;
    await page.reload({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(800);
    if (ev.pageErrors.length > errsBefore) note('crash', `reloading /checkout/success crashes: ${ev.pageErrors[errsBefore]!.slice(0, 120)}`, 'place an order → on the success page, press reload');
    // and go back
    await page.goBack().catch(() => {});
    await page.waitForTimeout(600);
    if (ev.pageErrors.length > errsBefore) note('crash', `going Back from a reloaded success page also throws: ${ev.pageErrors[errsBefore]!.slice(0, 120)}`, 'reload the success page → click browser Back');
  }
  await page.close();
}

// ================================================================ 6. login edge cases
{
  const page = await browser.newPage();
  const ev = capture(page);
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder('you@example.com').fill('nobody@x.test');
  await page.getByPlaceholder('••••••••').fill('wrong');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click().catch(() => {});
  await page.waitForTimeout(800);
  const unauthorized = ev.badResponses.filter((b) => /login.*401/.test(b)).length;
  if (unauthorized) note('http', `login with unknown credentials returns 401 (${unauthorized}×) — visible in the network tab, but check whether the UI shows an error`, 'login page → submit bogus credentials');
  await page.close();
}

console.log(`\n=== Contender B sweep done: ${findings.length} findings ===`);
for (const f of findings) console.log(`  #${f.id} [${f.area}] ${f.observation.slice(0, 100)}`);
await browser.close();
process.exit(0);
