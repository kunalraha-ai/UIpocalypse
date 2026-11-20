const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);
  for (const p of ['/credits', '/profile', '/orders']) {
    await page.goto(BASE + p);
    await page.waitForTimeout(400);
    const t = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));
    console.log(p, '=>', t.slice(0, 200));
  }
  // coupon state
  await page.goto(BASE + '/checkout');
  await page.getByPlaceholder('WELCOME10').fill('WELCOME10');
  await page.getByRole('button', { name: 'Redeem coupon' }).click();
  await page.waitForTimeout(800);
  console.log('coupon after restart:', await page.evaluate(() => document.body.innerText.match(/Order total: \$\d+/)?.[0]));
  await browser.close();
})();
