const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);
  await page.goto(BASE + '/profile'); await page.waitForTimeout(600);
  const info = await page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      innerText: document.body.innerText.replace(/\n+/g, ' | '),
      mainHTML: main ? main.innerHTML : null,
      inputCount: document.querySelectorAll('input').length,
      buttonCount: document.querySelectorAll('button').length,
    };
  });
  console.log('inputs:', info.inputCount, 'buttons:', info.buttonCount);
  console.log('text:', info.innerText);
  console.log('main HTML:', info.mainHTML);
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
