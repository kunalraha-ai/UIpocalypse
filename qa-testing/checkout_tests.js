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
      let body = ''; try { body = (await r.text()).slice(0, 150); } catch {}
      events.push(`[net] ${r.request().method()} ${r.url()} ${r.status()} ${body}`);
    }
  });

  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(500);

  const snap = () => page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));

  await page.goto(BASE + '/checkout');
  await page.waitForLoadState('networkidle');
  console.log('checkout page:', await snap());

  // ---- coupon tests ----
  const coupon = page.getByPlaceholder('WELCOME10');
  const tryCoupon = async (code, label) => {
    events.length = 0;
    await coupon.fill(code);
    await page.getByRole('button', { name: 'Redeem coupon' }).click();
    await page.waitForTimeout(800);
    const s = await snap();
    const total = s.match(/Order total: ?\S*\$?([\d.,]+)/)?.[0] || s.match(/Order total: [^|]*/)?.[0];
    console.log(`[${label}] code="${code}" => ${total || s.slice(0,150)}`);
    console.log('   events:', events.join(' ;; '));
  };
  await tryCoupon('WELCOME10', 'valid');
  await tryCoupon('WELCOME10', 'repeat');
  await tryCoupon('welcome10', 'lowercase');
  await tryCoupon('  WELCOME10  ', 'spaces');
  await tryCoupon('NOPE', 'invalid');
  await tryCoupon('', 'empty');
  await tryCoupon('X'.repeat(100), 'long');
  await tryCoupon(`<img src=x onerror=window.__xssc=1>`, 'xss');
  console.log('   XSS marker:', await page.evaluate(() => window.__xssc));
  await tryCoupon("WELCOME10' OR '1'='1", 'sqli');

  // ---- place order (with whatever coupon state) ----
  console.log('\n--- place order ---');
  await coupon.fill('WELCOME10');
  await page.getByRole('button', { name: 'Redeem coupon' }).click();
  await page.waitForTimeout(800);
  events.length = 0;
  await page.getByRole('button', { name: 'Place order' }).click();
  await page.waitForTimeout(1500);
  console.log('after place order 1: url =', page.url());
  console.log(await snap());
  console.log('events:', events.join(' ;; '));

  // ---- place order again ----
  events.length = 0;
  await page.goto(BASE + '/checkout');
  await page.waitForLoadState('networkidle');
  console.log('\ncheckout after order:', await snap());
  await page.getByRole('button', { name: 'Place order' }).click();
  await page.waitForTimeout(1500);
  console.log('after place order 2: url =', page.url());
  console.log(await snap());
  console.log('events:', events.join(' ;; '));

  // ---- orders page now ----
  await page.goto(BASE + '/orders');
  await page.waitForLoadState('networkidle');
  console.log('\nORDERS PAGE:', await snap());
  console.log('events:', events.join(' ;; '));

  await browser.close();
})();
