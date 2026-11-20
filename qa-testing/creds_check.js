const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  // intercept the quick-login request bodies
  page.on('request', r => {
    if (r.url().includes('/api/auth/login')) console.log('LOGIN REQ:', r.postData());
  });
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Sign in as Bob' }).click();
  await page.waitForTimeout(700);
  console.log('Bob login result url:', page.url());
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
