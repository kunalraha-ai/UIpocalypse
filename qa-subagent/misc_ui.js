const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // precise invalid-email newsletter check
  await page.goto('http://localhost:3124/', { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', 'notanemail');
  await page.click('button:has-text("Subscribe")');
  await page.waitForTimeout(800);
  console.log('url after invalid email submit: ' + page.url());
  console.log('validation message: ' + await page.evaluate(() => {
    const i = document.querySelector('input[type=email]');
    return i ? i.validationMessage : 'no input';
  }));

  // Search submit with Enter key
  await page.fill('input:not([type=email])', 'desk');
  await page.press('input:not([type=email])', 'Enter');
  await page.waitForTimeout(800);
  console.log('enter-search results: ' + (await page.evaluate(() => document.body.innerText)).match(/Desk Lamp|Standing Desk/g)?.join(','));

  // Search with empty input
  await page.fill('input:not([type=email])', '');
  await page.click('button:has-text("Search")');
  await page.waitForTimeout(800);
  console.log('empty search url: ' + page.url());
  const txt = (await page.evaluate(() => document.body.innerText));
  console.log('empty search shows all products: ' + (txt.includes('Standing Desk') && txt.includes('Desk Lamp')));

  // Spaces only
  await page.fill('input:not([type=email])', '   ');
  await page.click('button:has-text("Search")');
  await page.waitForTimeout(800);
  console.log('spaces-only search: ' + (await page.evaluate(() => document.body.innerText.match(/Search failed|Desk Lamp/g)?.join(','))));

  // Mobile viewport check
  console.log('\n=== mobile viewport ===');
  const mob = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const mp = await mob.newPage();
  await mp.goto('http://localhost:3124/', { waitUntil: 'networkidle' });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('horizontal overflow px: ' + overflow);
  await mp.screenshot({ path: 'mobile.png', fullPage: true });
  const navLinks = await mp.evaluate(() => {
    const nav = document.querySelector('nav');
    return nav ? `nav width=${nav.scrollWidth} clientWidth=${nav.clientWidth} overflow=${nav.scrollWidth > nav.clientWidth}` : 'none';
  });
  console.log('mobile nav: ' + navLinks);

  // Desktop overflow check
  const dp = await page;
  await dp.setViewportSize({ width: 1280, height: 800 });
  await dp.goto('http://localhost:3124/', { waitUntil: 'networkidle' });
  console.log('desktop overflow px: ' + await dp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));

  await browser.close();
})();
