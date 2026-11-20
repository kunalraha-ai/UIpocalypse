const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('response', r => {
    const url = r.url();
    if (url.includes('_next/static') || url.includes('?_rsc=')) return;
    if (r.request().method() !== 'GET' || r.status() >= 400) console.log(`[net ${r.status()}] ${r.request().method()} ${url.replace('http://localhost:3124','')}`);
  });
  page.on('pageerror', e => console.log('[pageerror] ' + e.message.split('\n')[0]));

  await page.goto('http://localhost:3124/', { waitUntil: 'networkidle' });

  // 1. Failing search — what does the user see?
  console.log('=== search "100%" (server 500) ===');
  await page.fill('input[type=text], input', '100%');
  await page.click('button:has-text("Search")');
  await page.waitForTimeout(1000);
  console.log('UI after failing search: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 600));
  await page.screenshot({ path: 'search_fail.png', fullPage: true });

  // 2. Clear the failing state: search lamp
  console.log('\n=== search "lamp" (works) ===');
  await page.fill('input[type=text], input', 'lamp');
  await page.click('button:has-text("Search")');
  await page.waitForTimeout(800);
  console.log('UI: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 500));

  // 3. RACE: load recommendations, then immediately search — do recs overwrite search results or vice versa?
  console.log('\n=== RACE: recommendations then quick search ===');
  await page.click('button:has-text("Load recommendations")');
  await page.fill('input[type=text], input', 'chair');
  await page.click('button:has-text("Search")');
  await page.waitForTimeout(5000);
  console.log('UI after race: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 700));

  // 4. RACE: search then quickly load recommendations
  console.log('\n=== RACE: search then recommendations ===');
  await page.goto('http://localhost:3124/', { waitUntil: 'networkidle' });
  await page.fill('input[type=text], input', 'chair');
  await page.click('button:has-text("Search")');
  await page.click('button:has-text("Load recommendations")');
  await page.waitForTimeout(5000);
  console.log('UI after race2: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 700));

  // 5. Double-click recommendations
  console.log('\n=== double-click recommendations ===');
  await page.goto('http://localhost:3124/', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Load recommendations")');
  await page.click('button:has-text("Load recommendations")');
  await page.waitForTimeout(5000);
  console.log('UI after dbl recs: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 700));

  await browser.close();
})();
