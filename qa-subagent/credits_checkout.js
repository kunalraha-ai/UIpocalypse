const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('response', async r => {
    const url = r.url();
    if (url.includes('_next/static') || url.includes('?_rsc=')) return;
    let body = '';
    if (r.status() >= 400 && !url.includes('/api/promo')) {
      try { body = (await r.text()).substring(0, 300); } catch {}
    }
    console.log(`[net ${r.status()}] ${r.request().method()} ${url.replace('http://localhost:3124', '')} ${r.request().postData() || ''} ${body ? 'BODY:' + body : ''}`);
  });

  await page.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sign in as Alice")');
  await page.waitForTimeout(800);

  // Buy $10 pack
  await page.goto('http://localhost:3124/credits', { waitUntil: 'networkidle' });
  console.log('\n--- select $10 pack, buy ---');
  await page.check('input[value="p10"]');
  await page.click('button:has-text("Buy credits")');
  await page.waitForTimeout(1000);
  console.log('AFTER BUY: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));

  // Buy with NO pack selected
  console.log('\n--- buy with no selection ---');
  await page.click('button:has-text("Buy credits")');
  await page.waitForTimeout(1000);
  console.log('AFTER NO-SEL BUY: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));

  // Checkout page - coupon tests
  console.log('\n--- checkout: coupon SAVE10 ---');
  await page.goto('http://localhost:3124/checkout', { waitUntil: 'networkidle' });
  console.log('CHECKOUT BODY: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));
  await page.fill('input[type=text]', 'SAVE10');
  await page.click('button:has-text("Redeem coupon")');
  await page.waitForTimeout(1000);
  console.log('AFTER SAVE10: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));

  // Try invalid coupon
  console.log('\n--- coupon INVALID123 ---');
  await page.fill('input[type=text]', 'INVALID123');
  await page.click('button:has-text("Redeem coupon")');
  await page.waitForTimeout(1000);
  console.log('AFTER INVALID: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));

  await browser.close();
})();
