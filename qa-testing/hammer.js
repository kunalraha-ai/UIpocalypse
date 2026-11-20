const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(700);
  for (let i = 1; i <= 6; i++) {
    // orders page load (triggers /api/orders 500)
    await page.goto(BASE + '/orders'); await page.waitForTimeout(600);
    // a failing search (500)
    await page.evaluate(async () => { try { await fetch('/api/search?q=%'); } catch {} });
    // place an order
    await page.goto(BASE + '/checkout'); await page.waitForTimeout(300);
    await page.evaluate(async () => { try { await fetch('/api/checkout', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'}); } catch {} });
    await page.waitForTimeout(400);
    const h = await page.evaluate(async () => (await fetch('/')).status);
    console.log(`round ${i}: server still ${h === 200 ? 'alive' : 'DEAD ' + h}`);
    if (h !== 200) break;
  }
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
