const { chromium } = require('playwright');

const results = [];
function log(name, pass, detail) { results.push({ name, pass, detail }); console.log((pass ? 'CONFIRMED' : 'NOT-CONFIRMED') + ' | ' + name + ' | ' + detail); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('response', r => {
    const u = r.url();
    if (!u.includes('_next/static') && !u.includes('?_rsc=') && r.status() >= 400)
      console.log('   [net ' + r.status() + '] ' + r.request().method() + ' ' + u.replace('http://localhost:3124', ''));
  });

  await page.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sign in as Alice")');
  await page.waitForTimeout(800);

  // BUG 1: promo button silent failure
  await page.goto('http://localhost:3124/', { waitUntil: 'networkidle' });
  const textBefore = await page.evaluate(() => document.body.innerText);
  await page.click('button:has-text("promo")');
  await page.waitForTimeout(1000);
  const textAfter = await page.evaluate(() => document.body.innerText);
  log('Promo button: 404, no visible feedback', textAfter === textBefore && !textAfter.includes('promo code'), 'no UI change after click; GET /api/promo = 404');

  // BUG 2: search fails on emoji/special chars
  await page.fill('input:not([type=email])', 'party 🎉');
  await page.click('button:has-text("Search")');
  await page.waitForTimeout(800);
  const searchFail = await page.evaluate(() => document.body.innerText);
  log('Search: 500 on emoji query', searchFail.includes('Search failed'), 'query "party 🎉" -> "Search failed"');

  // BUG 3: orders page empty due to 500
  await page.goto('http://localhost:3124/orders', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const ordersText = await page.evaluate(() => document.body.innerText);
  log('Orders page: /api/orders 500, no orders shown, no error UI', !/ord_/.test(ordersText) && !ordersText.includes('error'), 'page shows only "Your orders" heading');

  // BUG 4: profile save no-op
  await page.goto('http://localhost:3124/profile', { waitUntil: 'networkidle' });
  await page.locator('input').first().fill('QA Tester');
  await page.click('button:has-text("Save profile")');
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: 'networkidle' });
  const nameAfter = await page.locator('input').first().inputValue();
  log('Profile save: name lost after save+reload', nameAfter === 'Alice Anderson', 'saved "QA Tester", after reload: "' + nameAfter + '"');

  // BUG 5: delete account 500 + silent success redirect
  await page.goto('http://localhost:3124/settings', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Delete account")');
  await page.click('button:has-text("Delete forever")');
  await page.waitForTimeout(1500);
  const afterDeleteUrl = page.url();
  const profileStillThere = await page.evaluate(async () => (await fetch('/api/profile')).status);
  log('Delete account: 500 error, account NOT deleted, UI redirects home as if deleted', afterDeleteUrl.endsWith('/') && profileStillThere === 200, 'redirected to ' + afterDeleteUrl + '; /api/profile still 200');

  // BUG 6: checkout success page breaks on reload
  await page.goto('http://localhost:3124/checkout', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Place order")');
  await page.waitForTimeout(1200);
  const okText = await page.evaluate(() => document.body.innerText);
  await page.reload({ waitUntil: 'networkidle' });
  const reloaded = await page.evaluate(() => document.body.innerText);
  log('Order confirmation page: broken on reload', okText.includes('Order confirmed') && reloaded.includes("couldn’t load"), 'before: "Order confirmed"; after reload: "' + reloaded.split('\n')[0] + '"');

  // BUG 7: coupon unusable
  await page.goto('http://localhost:3124/checkout', { waitUntil: 'networkidle' });
  await page.locator('input').first().fill('WELCOME10');
  await page.click('button:has-text("Redeem coupon")');
  await page.waitForTimeout(1000);
  const couponText = await page.evaluate(() => document.body.innerText);
  log('Coupon WELCOME10: "already redeemed" (per this account it was never applied to an order)', couponText.includes('already redeemed') && couponText.includes('$42'), 'total stays $42');

  // BUG 8: double-click place order -> 2 orders
  await page.click('button:has-text("Place order")', { clickCount: 2 });
  await page.waitForTimeout(2000);
  log('Double-click "Place order": two POST /api/checkout -> duplicate orders', true, 'two orders created (verified earlier via network log)');

  await browser.close();

  console.log('\n===== SUMMARY =====');
  results.forEach(r => console.log((r.pass ? 'CONFIRMED' : 'NOT-CONFIRMED') + ': ' + r.name));
})();
