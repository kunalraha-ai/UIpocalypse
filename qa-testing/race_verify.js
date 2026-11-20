const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(500);
  await page.goto(BASE + '/credits');
  await page.waitForLoadState('networkidle');

  const respBodies = [];
  page.on('response', async r => {
    if (r.url().includes('/api/credits/buy')) {
      try { respBodies.push(await r.text()); } catch {}
    }
  });
  const bal = async () => {
    const t = await page.evaluate(() => document.body.innerText);
    return +(t.match(/Current balance: (\d+) credits/) || [0, '?'])[1];
  };

  console.log('B0 =', await bal());
  await page.check('input[value=p5]');
  await page.getByRole('button', { name: 'Buy credits', exact: true }).click();
  await page.waitForTimeout(1000);
  const b1 = await bal();
  console.log('after single buy B1 =', b1, '(expect B0+500 =', (await bal(), ''), ')');

  respBodies.length = 0;
  const b2 = await bal();
  // 3 rapid clicks
  await Promise.all([
    page.getByRole('button', { name: 'Buy credits', exact: true }).click(),
    page.getByRole('button', { name: 'Buy credits', exact: true }).click(),
    page.getByRole('button', { name: 'Buy credits', exact: true }).click(),
  ]);
  await page.waitForTimeout(2000);
  const b3 = await bal();
  console.log(`before rapid x3: ${b2}, after: ${b3}, delta=${b3 - b2} (expected 1500)`);
  console.log('responses:', respBodies);
  console.log('VERDICT:', b3 - b2 === 1500 ? 'no race' : 'LOST UPDATE — race condition confirmed');

  await browser.close();
})();
