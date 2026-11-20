const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  // try signing up via the form with a new user
  await page.fill('input[type=email]', 'brandnew@example.com');
  await page.fill('input[type=password]', 'pw123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForTimeout(1200);
  console.log('after form sign-in with new creds: url =', page.url());
  console.log('body:', await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ')));
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
