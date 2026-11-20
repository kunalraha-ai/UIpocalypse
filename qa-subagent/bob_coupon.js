const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const reqs = [];
  page.on('request', r => {
    const url = r.url();
    if (!url.includes('_next/static') && !url.includes('?_rsc=') && (r.method() !== 'GET' || true)) reqs.push(r.method() + ' ' + url.replace('http://localhost:3124','') + ' ' + (r.postData() || ''));
  });
  page.on('response', r => {
    const url = r.url();
    if (url.includes('_next/static') || url.includes('?_rsc=')) return;
    if (r.request().method() !== 'GET' || r.status() >= 400) console.log(`[net ${r.status()}] ${r.request().method()} ${url.replace('http://localhost:3124','')}`);
  });

  await page.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sign in as Bob")');
  await page.waitForTimeout(800);

  console.log('=== BOB COUPON FLOW ===');
  await page.goto('http://localhost:3124/checkout', { waitUntil: 'networkidle' });
  await page.locator('input').first().fill('WELCOME10');
  await page.click('button:has-text("Redeem coupon")');
  await page.waitForTimeout(1200);
  console.log('after WELCOME10: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));

  console.log('\n--- place order with coupon ---');
  reqs.length = 0;
  await page.click('button:has-text("Place order")');
  await page.waitForTimeout(1500);
  console.log('reqs: ' + JSON.stringify(reqs));
  console.log('SUCCESS: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 350));

  // Back to checkout: is coupon state reset? new cart?
  console.log('\n--- checkout again after order ---');
  await page.goto('http://localhost:3124/checkout', { waitUntil: 'networkidle' });
  console.log('checkout after order: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));

  await browser.close();
})();
