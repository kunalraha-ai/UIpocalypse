const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const events = [];
  page.on('console', m => { if (m.type() === 'error') events.push(`[console.error] ${m.text()}`); });
  page.on('pageerror', e => events.push(`[pageerror] ${e.message}`));
  page.on('response', r => { if (r.url().includes('/api/')) events.push(`[net] ${r.request().method()} ${r.url()} ${r.status()}`); });

  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(500);
  await page.goto(BASE + '/');
  await page.waitForLoadState('networkidle');

  const prodCount = async () => await page.locator('.card h3').count();

  console.log('Initial product cards:', await prodCount());

  // ---- Search tests ----
  const search = page.getByPlaceholder('e.g. lamp');
  const doSearch = async (q) => {
    await search.fill(q);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForTimeout(700);
    return await prodCount();
  };
  console.log('search "lamp":', await doSearch('lamp'));
  console.log('search "LAMP":', await doSearch('LAMP'));
  console.log('search "chair":', await doSearch('chair'));
  console.log('search "zzz-no-match":', await doSearch('zzz-no-match'), '— any "no results" msg?', await page.evaluate(() => document.body.innerText.includes('No') || document.body.innerText.includes('no ')));
  console.log('search "" (empty):', await doSearch(''));
  console.log('search "  " (spaces):', await doSearch('   '));
  console.log('search "lamp; DROP TABLE":', await doSearch('lamp\'; DROP TABLE products;--'));
  console.log('search "<img src=x onerror=window.__xsssearch=1>":', await doSearch('<img src=x onerror=window.__xsssearch=1>'));
  console.log('  XSS marker set?', await page.evaluate(() => window.__xsssearch));
  console.log('search 5000 chars:', await doSearch('a'.repeat(5000)));
  console.log('search "%":', await doSearch('%'));
  console.log('search emoji 🪑:', await doSearch('🪑'));

  // products after search reset?
  await search.fill('');
  console.log('After clearing search field (no submit), count:', await prodCount());

  // ---- Promo test ----
  console.log('\n--- PROMO ---');
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: "See today's promo" }).click();
  await page.waitForTimeout(700);
  console.log('after promo click:', (await page.evaluate(() => document.body.innerText.replace(/\n+/g,' | '))).slice(0, 600));
  console.log('events so far:', events); events.length = 0;

  // click promo twice
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: "See today's promo" }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: "See today's promo" }).click();
  await page.waitForTimeout(700);
  console.log('promo double-click:', (await page.evaluate(() => document.body.innerText.replace(/\n+/g,' | '))).slice(0, 400));
  console.log('events:', events); events.length = 0;

  // ---- Recommendations test ----
  console.log('\n--- RECOMMENDATIONS ---');
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: 'Load recommendations' }).click();
  await page.waitForTimeout(1200);
  console.log('after recs:', (await page.evaluate(() => document.body.innerText.replace(/\n+/g,' | '))).slice(0, 700));
  console.log('events:', events); events.length = 0;

  // double-click recommendations rapidly
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: 'Load recommendations' }).click();
  await page.getByRole('button', { name: 'Load recommendations' }).click();
  await page.waitForTimeout(1500);
  console.log('recs double-click:', (await page.evaluate(() => document.body.innerText.replace(/\n+/g,' | '))).slice(0, 700));
  console.log('events:', events); events.length = 0;

  // ---- Newsletter tests ----
  console.log('\n--- NEWSLETTER ---');
  await page.goto(BASE + '/');
  const emailInput = page.getByPlaceholder('you@example.com');
  const sub = async (v) => {
    await emailInput.fill(v);
    await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
    await page.waitForTimeout(700);
    return (await page.evaluate(() => document.body.innerText.replace(/\n+/g,' | '))).match(/.*/)
      ? (await page.evaluate(() => Array.from(document.querySelectorAll('p,div')).map(e=>e.innerText).filter(t=>/subscrib|thank|success|error|already/i.test(t)).join(' /// ')))
      : '';
  };
  console.log('subscribe valid:', await sub('test@example.com'));
  console.log('subscribe valid again (dup):', await sub('test@example.com'));
  console.log('subscribe weird "a@b":', await sub('a@b'));
  console.log('subscribe long:', await sub('x'.repeat(200) + '@example.com'));
  console.log('subscribe XSS:', await sub('<img src=x onerror=window.__xssnews=1>@e.com'));
  console.log('  XSS marker?', await page.evaluate(() => window.__xssnews));
  // empty subscribe - browser validation blocks; check
  await emailInput.fill('');
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
  await page.waitForTimeout(500);
  console.log('empty subscribe events:', events);
  events.length = 0;

  await browser.close();
})();
