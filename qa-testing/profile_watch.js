const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const responses = [];
  page.on('response', r => responses.push(`${r.request().method()} ${r.url()} ${r.status()}`));
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);
  responses.length = 0;
  await page.goto(BASE + '/profile');
  for (const t of [0, 500, 1500, 3000]) {
    if (t) await page.waitForTimeout(t === 0 ? 0 : (t === 500 ? 500 : t === 1500 ? 1000 : 1500));
    const state = await page.evaluate(() => ({
      inputCount: document.querySelectorAll('input').length,
      saveBtn: !!Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Save profile')),
      text: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 220)
    }));
    console.log(`t=${t}ms:`, JSON.stringify(state));
  }
  console.log('responses:', responses.join(' ;; '));
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
