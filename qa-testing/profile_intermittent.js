const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);

  const hasForm = async () => (await page.evaluate(() => !!document.querySelector('input[type=text]'))) ? 'Y' : 'N';
  const batch = async (label, n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      await page.goto(BASE + '/profile');
      await page.waitForTimeout(350);
      out.push(await hasForm());
    }
    console.log(label, out.join(''));
    return out;
  };
  await batch('direct loads:      ', 10);
  await page.goto(BASE + '/orders'); await page.waitForTimeout(800);
  await batch('after /orders:     ', 10);
  // reload only (no nav change)
  const out2 = [];
  for (let i = 0; i < 10; i++) { await page.reload(); await page.waitForTimeout(350); out2.push(await hasForm()); }
  console.log('reloads in a row:  ', out2.join(''));
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
