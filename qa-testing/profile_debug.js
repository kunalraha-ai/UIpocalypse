const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);
  const resp = await page.goto(BASE + '/profile');
  console.log('goto /profile status:', resp.status());
  await page.waitForLoadState('networkidle');
  const inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input,button')).map(e => `${e.tagName} type=${e.type||''} value="${(e.value||'').slice(0,40)}" text="${(e.innerText||'').slice(0,30)}"`));
  console.log('inputs/buttons:', inputs);
  const html = await page.evaluate(() => document.body.innerHTML);
  console.log('has form?', html.includes('<form'));
  await page.screenshot({ path: 'profile_debug.png' });
  // try getByRole
  const byRole = await page.getByRole('textbox').count();
  console.log('textbox count:', byRole);
})();
