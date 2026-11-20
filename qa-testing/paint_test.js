const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);

  for (const p of ['/', '/credits', '/checkout', '/orders', '/settings', '/profile']) {
    await page.goto(BASE + p);
    await page.waitForTimeout(400);
    const rafFired = await Promise.race([
      page.evaluate(() => new Promise(res => { let n = 0; const cb = () => { n++; if (n >= 2) res('raf ok'); else requestAnimationFrame(cb); }; requestAnimationFrame(cb); })),
      new Promise(res => setTimeout(() => res('RAF NEVER FIRED'), 4000)),
    ]);
    let shot = 'ok';
    try { await page.screenshot({ timeout: 4000 }); } catch { shot = 'SCREENSHOT HANGS'; }
    console.log(`${p}: raf=${rafFired}, screenshot=${shot}`);
  }

  // On profile: can we interact via keyboard events (no RAF needed)?
  await page.goto(BASE + '/profile');
  await page.waitForTimeout(500);
  await page.evaluate(() => { const i = document.querySelector('input[type=text]'); i.focus(); i.select(); });
  try {
    await page.keyboard.type('X', { timeout: 4000 });
    const v = await page.evaluate(() => document.querySelector('input[type=text]').value);
    console.log('keyboard.type worked, value starts with:', JSON.stringify(v.slice(0, 20)));
  } catch (e) { console.log('keyboard.type failed:', e.message.split('\n')[0]); }

  // and on profile, does click work?
  try {
    await page.getByRole('button', { name: 'Save profile' }).click({ timeout: 4000 });
    console.log('click Save profile: OK');
  } catch (e) { console.log('click Save profile FAILED:', e.message.split('\n')[0]); }

  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
