const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const reqs = [];
  page.on('request', r => {
    const url = r.url();
    if (!url.includes('_next/static') && !url.includes('?_rsc=')) reqs.push(r.method() + ' ' + url.replace('http://localhost:3124','') + ' ' + (r.postData() || ''));
  });
  page.on('response', r => {
    const url = r.url();
    if (!url.includes('_next/static') && !url.includes('?_rsc=') && (r.request().method() !== 'GET' || r.status() >= 400))
      console.log(`[net ${r.status()}] ${r.request().method()} ${url.replace('http://localhost:3124','')}`);
  });

  await page.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sign in as Alice")');
  await page.waitForTimeout(800);

  // ---- PROFILE SAVE TEST ----
  console.log('=== PROFILE SAVE TEST ===');
  await page.goto('http://localhost:3124/profile', { waitUntil: 'networkidle' });
  const before = await page.locator('input').first().inputValue();
  console.log('name before: ' + before);
  await page.locator('input').first().fill('Zed Zephyr');
  await page.click('button:has-text("Save profile")');
  await page.waitForTimeout(1500);
  console.log('URL after save click: ' + page.url());
  const afterSubmit = await page.locator('input').first().inputValue();
  console.log('name right after submit: ' + afterSubmit);
  await page.reload({ waitUntil: 'networkidle' });
  const afterReload = await page.locator('input').first().inputValue();
  console.log('name after reload: ' + afterReload);
  console.log('REQUESTS during save: ' + JSON.stringify(reqs.slice(-3)));
  console.log(afterReload === 'Zed Zephyr' ? '>>> SAVED OK' : '>>> BUG? name not persisted');

  // ---- COUPON FLOW ----
  console.log('\n=== COUPON WELCOME10 ===');
  await page.goto('http://localhost:3124/checkout', { waitUntil: 'networkidle' });
  console.log('total before: ' + (await page.evaluate(() => document.body.innerText.match(/Order total: \$\d+/)?.[0])));
  await page.locator('input').first().fill('WELCOME10');
  await page.click('button:has-text("Redeem coupon")');
  await page.waitForTimeout(1200);
  console.log('after WELCOME10: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));

  // STACK: redeem again
  console.log('--- redeem WELCOME10 again (stacking) ---');
  await page.locator('input').first().fill('WELCOME10');
  await page.click('button:has-text("Redeem coupon")');
  await page.waitForTimeout(1200);
  console.log('after 2nd WELCOME10: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));

  // lowercase
  console.log('--- redeem welcome10 lowercase ---');
  await page.locator('input').first().fill('welcome10');
  await page.click('button:has-text("Redeem coupon")');
  await page.waitForTimeout(1200);
  console.log('after lowercase: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));

  // XSS coupon
  console.log('--- XSS coupon ---');
  reqs.length = 0;
  await page.locator('input').first().fill('<img src=x onerror=alert(1)>');
  await page.click('button:has-text("Redeem coupon")');
  await page.waitForTimeout(1200);
  console.log('after XSS coupon: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));
  console.log('html contains img tag: ' + await page.evaluate(() => document.body.innerHTML.includes('<img src=x')));

  // place order with coupon applied
  console.log('\n--- place order (coupon state) ---');
  reqs.length = 0;
  await page.locator('input').first().fill('WELCOME10');
  await page.click('button:has-text("Redeem coupon")');
  await page.waitForTimeout(1000);
  await page.click('button:has-text("Place order")');
  await page.waitForTimeout(1500);
  console.log('checkout reqs: ' + JSON.stringify(reqs));
  console.log('SUCCESS PAGE: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));

  await browser.close();
})();
