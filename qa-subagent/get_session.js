const { chromium } = require('playwright');

(async () => {
  // Get a session cookie via Playwright (login is a POST with JSON)
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sign in as Alice")');
  await page.waitForTimeout(800);
  const cookies = await ctx.cookies();
  const session = cookies.find(c => c.name === 'session').value;
  console.log('ALICE SESSION: ' + session);
  await browser.close();
})();
