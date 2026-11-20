const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('response', async r => {
    const url = r.url();
    if (url.includes('_next/static') || url.includes('?_rsc=')) return;
    let extra = '';
    if (r.request().method() !== 'GET' || r.status() >= 400) {
      try { extra = ' RESP:' + (await r.text()).substring(0, 200); } catch {}
    }
    console.log(`[net ${r.status()}] ${r.request().method()} ${url.replace('http://localhost:3124','')} ${r.request().postData() || ''}${extra}`);
  });
  page.on('dialog', async d => { console.log('[dialog ' + d.type() + '] ' + d.message()); await d.accept(); });

  await page.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sign in as Alice")');
  await page.waitForTimeout(800);

  // Coupon redeem
  await page.goto('http://localhost:3124/checkout', { waitUntil: 'networkidle' });
  await page.locator('input').first().fill('SAVE10');
  await page.click('button:has-text("Redeem coupon")');
  await page.waitForTimeout(1200);
  console.log('AFTER SAVE10: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 500));

  // Place order
  console.log('--- place order ---');
  await page.click('button:has-text("Place order")');
  await page.waitForTimeout(1500);
  console.log('AFTER PLACE: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 500));
  console.log('URL NOW: ' + page.url());

  // Profile save
  console.log('--- profile save ---');
  await page.goto('http://localhost:3124/profile', { waitUntil: 'networkidle' });
  await page.locator('input').first().fill('Alice Test');
  await page.click('button:has-text("Save profile")');
  await page.waitForTimeout(1000);
  console.log('AFTER SAVE: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 500));

  // Settings buttons
  console.log('--- settings: shipping FAQ ---');
  await page.goto('http://localhost:3124/settings', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Shipping FAQ")');
  await page.waitForTimeout(800);
  console.log('AFTER FAQ: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 700));

  console.log('--- settings: notification preferences ---');
  await page.click('button:has-text("Notification preferences")');
  await page.waitForTimeout(800);
  console.log('AFTER NOTIF: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 700));

  // Delete account: click and observe (cancel first)
  console.log('--- settings: delete account (cancel) ---');
  await page.click('button:has-text("Delete account")');
  await page.waitForTimeout(500);
  console.log('AFTER DELETE-CLICK: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 700));

  await browser.close();
})();
