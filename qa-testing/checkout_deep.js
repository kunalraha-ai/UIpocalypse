const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const events = [];
  page.on('console', m => { if (m.type() === 'error') events.push('[console] ' + m.text()); });
  page.on('pageerror', e => events.push('[pageerror] ' + e.message));
  page.on('response', async r => {
    if (r.url().includes('/api/')) {
      let body = ''; try { body = (await r.text()).slice(0, 200); } catch {}
      events.push(`[net] ${r.request().method()} ${r.url()} ${r.status()} ${body}`);
    }
  });

  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(500);
  const snap = () => page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));

  // balance before
  await page.goto(BASE + '/profile');
  let b0 = (await snap()).match(/Balance: (\d+) credits/)?.[1];
  console.log('balance before orders:', b0);

  // ---- double-click place order (race) ----
  await page.goto(BASE + '/checkout');
  await page.waitForLoadState('networkidle');
  events.length = 0;
  await Promise.all([
    page.getByRole('button', { name: 'Place order' }).click(),
    page.getByRole('button', { name: 'Place order' }).click(),
  ]);
  await page.waitForTimeout(2000);
  console.log('double place order events:', events.join(' ;; '));
  console.log('page:', await snap());

  // ---- balance after order ----
  await page.goto(BASE + '/profile');
  const b1 = (await snap()).match(/Balance: (\d+) credits/)?.[1];
  console.log(`balance after orders: ${b1} (was ${b0})`);

  // ---- coupon reuse after consumption ----
  await page.goto(BASE + '/checkout');
  await page.getByPlaceholder('WELCOME10').fill('WELCOME10');
  events.length = 0;
  await page.getByRole('button', { name: 'Redeem coupon' }).click();
  await page.waitForTimeout(800);
  console.log('WELCOME10 after prior redemption:', events.join(' ;; '));
  console.log('total now:', (await snap()).match(/Order total: \$\d+/)?.[0]);

  // ---- direct access to /checkout/success ----
  events.length = 0;
  await page.goto(BASE + '/checkout/success');
  await page.waitForLoadState('networkidle');
  console.log('\ndirect /checkout/success:', await snap());
  console.log('url:', page.url());
  console.log('events:', events.join(' ;; '));

  // ---- orders API raw ----
  const ordersRes = await page.evaluate(async () => {
    const r = await fetch('/api/orders');
    return { status: r.status, body: await r.text() };
  });
  console.log('\n/api/orders raw:', JSON.stringify(ordersRes));

  // ---- also as Bob: orders API ----
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Bob' }).click();
  await page.waitForTimeout(500);
  const bobOrders = await page.evaluate(async () => {
    const r = await fetch('/api/orders');
    return { status: r.status, body: (await r.text()).slice(0, 300) };
  });
  console.log('/api/orders as Bob:', JSON.stringify(bobOrders));
  await page.goto(BASE + '/orders');
  console.log('orders page as Bob:', await snap());

  await browser.close();
})();
