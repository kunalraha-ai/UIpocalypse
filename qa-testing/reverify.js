const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const net = [];
  page.on('response', r => { if (r.url().includes('/api/')) net.push(`${r.request().method()} ${r.url().replace(BASE,'')} ${r.status()}`); });
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);
  await page.goto(BASE + '/'); await page.waitForLoadState('networkidle');

  // search UI ignores API results
  net.length = 0;
  await page.getByPlaceholder('e.g. lamp').fill('chair');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.waitForTimeout(900);
  const names = await page.evaluate(() => Array.from(document.querySelectorAll('.grid .card h3')).map(e => e.textContent));
  console.log('search "chair": api=', net.join(' '), 'grid=', names.length, 'products (API returns 2: Office/Dining Chair)');

  // promo
  net.length = 0;
  await page.getByRole('button', { name: "See today's promo" }).click();
  await page.waitForTimeout(900);
  const promoText = await page.evaluate(() => document.body.innerText);
  console.log('promo: api=', net.join(' '), '| any promo visible on page?', /off|promo|discount/i.test(promoText.replace(/See today's promo/, '')) ? 'MAYBE' : 'NO');

  // newsletter
  net.length = 0;
  await page.getByPlaceholder('you@example.com').fill('verify@example.com');
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
  await page.waitForTimeout(1200);
  console.log('newsletter: url=', page.url(), 'requests=', net.length ? net.join(' ') : 'NONE', '| confirmation msg?', /thank|subscrib|success/i.test(await page.evaluate(() => document.body.innerText.replace(/Subscribe|Newsletter/g,''))) ? 'YES' : 'NO');

  // login page while authed
  await page.goto(BASE + '/login'); await page.waitForTimeout(500);
  console.log('\n/login while authed shows quick-switch?', await page.evaluate(() => !!Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Sign in as Bob'))));
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
