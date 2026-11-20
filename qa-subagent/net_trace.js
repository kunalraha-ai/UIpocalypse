const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const reqs = [];
  page.on('response', r => {
    const url = r.url();
    if (!url.includes('_next/static')) reqs.push(r.status() + ' ' + r.request().method() + ' ' + url.replace('http://localhost:3124', '') + ' <= ' + (r.request().postData() || ''));
  });
  page.on('console', m => { const t = m.text(); if (!t.includes('_next')) console.log('[console] ' + t); });
  page.on('pageerror', e => console.log('[pageerror] ' + e.message));

  await page.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sign in as Alice")');
  await page.waitForTimeout(1000);

  // Store page interactions
  await page.goto('http://localhost:3124/', { waitUntil: 'networkidle' });
  console.log('--- search lamp ---');
  await page.fill('input', 'lamp');
  await page.click('button:has-text("Search")');
  await page.waitForTimeout(800);
  console.log(await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').substring(0, 600)));

  console.log('--- promo ---');
  await page.click('button:has-text("promo")');
  await page.waitForTimeout(800);
  console.log(await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').substring(0, 600)));

  console.log('--- recommendations ---');
  await page.click('button:has-text("Load recommendations")');
  await page.waitForTimeout(1500);
  console.log(await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').substring(0, 800)));

  console.log('--- newsletter subscribe ---');
  await page.fill('input[type=email]', 'test@example.com');
  await page.click('button:has-text("Subscribe")');
  await page.waitForTimeout(800);
  console.log(await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').substring(0, 900)));

  console.log('\n=== NETWORK LOG ===');
  reqs.forEach(r => console.log(r));
  await browser.close();
})();
