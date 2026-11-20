const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('response', r => {
    const url = r.url();
    if (url.includes('_next/static')) return;
    console.log(`[net ${r.status()}] ${r.request().method()} ${url.replace('http://localhost:3124', '')}`);
  });
  page.on('pageerror', e => console.log('[pageerror] ' + e.message));

  await page.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sign in as Bob")');
  await page.waitForTimeout(1200);
  console.log('logged in as Bob, cookie: ' + JSON.stringify((await ctx.cookies()).map(c => c.value)));

  for (const r of ['/credits', '/checkout', '/orders', '/profile', '/settings']) {
    console.log('--- goto ' + r);
    const resp = await page.goto('http://localhost:3124' + r, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    console.log('BODY: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 700));
  }

  // recommendations on store, long wait, watch DOM
  console.log('\n--- store: recommendations long wait ---');
  await page.goto('http://localhost:3124/', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Load recommendations")');
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(1000);
    const t = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));
    const m = t.match(/Thinking…|Recommended:|recommended/gi);
    console.log(`t+${(i + 1)}s: ${m ? m.join(',') : 'no marker'} | has-Thinking: ${t.includes('Thinking')}`);
    if (!t.includes('Thinking')) break;
  }
  const t = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));
  console.log('FINAL: ' + t.substring(0, 900));
  await browser.close();
})();
