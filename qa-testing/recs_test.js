const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });

  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(500);
  await page.goto(BASE + '/');
  await page.waitForLoadState('networkidle');

  console.log('t+0 clicking...');
  await page.getByRole('button', { name: 'Load recommendations' }).click();
  for (const ms of [1000, 3000, 5000, 7000]) {
    await page.waitForTimeout(ms === 1000 ? 1000 : 2000);
    const txt = await page.evaluate(() => document.body.innerText);
    console.log(`~${ms}ms: thinking=${txt.includes('Thinking')} recs_rendered=${txt.includes('fans also bought')}`);
    console.log('   recs section:', txt.split('\n').filter(l => /fans also|Thinking/i.test(l)).join(' // '));
  }
  console.log('errors:', errors);

  // double click behavior
  errors.length = 0;
  await page.goto(BASE + '/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Load recommendations' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Load recommendations' }).click();
  await page.waitForTimeout(6000);
  const lines = await page.evaluate(() => document.body.innerText.split('\n').filter(l => /fans also|Thinking/i.test(l)));
  console.log('double-click result lines:', lines);
  console.log('errors after double-click:', errors);

  await browser.close();
})();
