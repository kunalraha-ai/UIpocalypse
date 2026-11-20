const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3124');
  console.log('TITLE:', await page.title());
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
