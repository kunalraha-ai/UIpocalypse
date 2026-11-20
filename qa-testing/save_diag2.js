const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);
  await page.goto(BASE + '/profile'); await page.waitForTimeout(400);
  const nameInput = page.locator('main input');
  await nameInput.fill('Alice Smith');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.waitForTimeout(400);
  const store = await page.evaluate(() => JSON.stringify({ l: {...localStorage}, s: {...sessionStorage} }));
  console.log('storage after save:', store);
  const cookies = await ctx.cookies();
  console.log('cookies after save:', cookies.map(c => `${c.name}=${c.value}`).join('; '));

  // second Playwright click — try to repro the hang
  try {
    await page.getByRole('button', { name: 'Save profile' }).click({ timeout: 8000 });
    console.log('second click: OK');
  } catch (e) {
    console.log('second click FAILED:', e.message.split('\n').slice(0,3).join(' / '));
    await page.screenshot({ path: 'hang_state.png', timeout: 5000 }).catch(() => console.log('(screenshot also hangs)'));
  }
  // third
  try { await page.getByRole('button', { name: 'Save profile' }).click({ timeout: 8000 }); console.log('third click: OK'); }
  catch (e) { console.log('third click FAILED:', e.message.split('\n')[0]); }
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
