const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const all = [];
  page.on('request', r => all.push(`REQ ${r.method()} ${r.url()}`));
  page.on('response', r => all.push(`RES ${r.status()} ${r.url()}`));

  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(500);
  await page.goto(BASE + '/');
  await page.waitForLoadState('networkidle');
  all.length = 0;

  // Does search change the product grid at all? Compare names.
  const names = async () => await page.evaluate(() => Array.from(document.querySelectorAll('.grid .card h3')).map(e => e.textContent));
  console.log('grid before:', await names());
  await page.getByPlaceholder('e.g. lamp').fill('lamp');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.waitForTimeout(800);
  console.log('grid after "lamp":', await names());
  console.log('net during search:', all.join('\n'));
  all.length = 0;

  // Search API raw responses
  for (const q of ['lamp', 'chair', 'zzz', '%', "lamp'", "lamp' OR '1'='1", "x' OR 1=1 --"]) {
    const r = await page.evaluate(async (qq) => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(qq)}`);
      return { status: res.status, body: (await res.text()).slice(0, 300) };
    }, q);
    console.log(`API /api/search?q=${q} =>`, JSON.stringify(r));
  }

  // Promo - full network
  console.log('\n--- promo full net ---');
  all.length = 0;
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: "See today's promo" }).click();
  await page.waitForTimeout(1000);
  console.log(all.join('\n'));
  const promoVisible = await page.evaluate(() => document.body.innerText);
  console.log('promo text on page?', /promo|off|%/i.test(promoVisible) ? promoVisible.match(/.{0,80}(promo|off).{0,80}/i)?.[0] : 'NO PROMO TEXT');

  // Recommendations - full network
  console.log('\n--- recs full net ---');
  all.length = 0;
  await page.goto(BASE + '/');
  await page.getByRole('button', { name: 'Load recommendations' }).click();
  await page.waitForTimeout(2500);
  console.log(all.join('\n'));
  console.log('page contains Thinking…?', await page.evaluate(() => document.body.innerText.includes('Thinking')));

  // Newsletter - full network
  console.log('\n--- newsletter full net ---');
  all.length = 0;
  await page.goto(BASE + '/');
  await page.getByPlaceholder('you@example.com').fill('qa@example.com');
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
  await page.waitForTimeout(1500);
  console.log(all.join('\n'));
  console.log('page text after subscribe:', (await page.evaluate(() => document.body.innerText.replace(/\n+/g,' | '))).slice(0, 500));

  await browser.close();
})();
