const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push('[console.' + m.type() + '] ' + m.text()));
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  page.on('dialog', async d => { logs.push('[dialog] ' + d.type() + ': ' + d.message()); await d.dismiss(); });

  await page.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sign in as Alice")');
  await page.waitForTimeout(1500);
  console.log('AFTER ALICE LOGIN, URL: ' + page.url());
  console.log('COOKIES: ' + JSON.stringify(await ctx.cookies()));
  console.log('LOCALSTORAGE: ' + await page.evaluate(() => JSON.stringify(localStorage)));
  console.log('SESSIONSTORAGE: ' + await page.evaluate(() => JSON.stringify(sessionStorage)));
  console.log('BODY:\n' + (await page.evaluate(() => document.body.innerText)).substring(0, 800));

  for (const r of ['/credits', '/checkout', '/orders', '/profile', '/settings']) {
    await page.goto('http://localhost:3124' + r, { waitUntil: 'networkidle' });
    console.log('\n=== AUTH ROUTE ' + r + ' => ' + page.url() + ' ===');
    console.log((await page.evaluate(() => document.body.innerText)).substring(0, 1200));
    console.log('--- elements ---');
    console.log(await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button, input, select, textarea, a, form, h1, h2, h3').forEach(e => {
        out.push(`<${e.tagName.toLowerCase()} type=${e.type || ''} name=${e.name || ''} value="${(e.value||'').substring(0,50)}" text="${(e.innerText || '').substring(0, 60).replace(/\n/g, ' ')}">`);
      });
      return out.join('\n');
    }));
  }
  console.log('\n=== CONSOLE/PAGE ERRORS ===');
  logs.forEach(l => console.log(l));
  await browser.close();
})();
