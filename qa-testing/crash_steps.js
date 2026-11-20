const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
const step = process.argv[2];
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(700);
  if (step === 'place1') {
    await page.goto(BASE + '/checkout'); await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Place order' }).click();
    await page.waitForTimeout(1500);
    console.log('placed 1 order:', await page.evaluate(() => document.body.innerText.includes('Order confirmed')));
  } else if (step === 'orderspage') {
    await page.goto(BASE + '/orders'); await page.waitForTimeout(1500);
    console.log('orders page loaded');
  } else if (step === 'place2') {
    await page.goto(BASE + '/checkout'); await page.waitForTimeout(400);
    await Promise.all([
      page.getByRole('button', { name: 'Place order' }).click(),
      page.getByRole('button', { name: 'Place order' }).click(),
    ]);
    await page.waitForTimeout(2000);
    console.log('placed 2 orders rapid');
  } else if (step === 'creditsrace') {
    await page.goto(BASE + '/credits'); await page.waitForTimeout(400);
    await page.check('input[value=p5]');
    await Promise.all([0,1,2].map(() => page.getByRole('button', { name: 'Buy credits', exact: true }).click()));
    await page.waitForTimeout(2000);
    console.log('credits race done');
  }
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
