const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const events = [];
  page.on('console', m => { if (m.type() === 'error') events.push('[console] ' + m.text()); });
  page.on('pageerror', e => events.push('[pageerror] ' + e.message));
  page.on('response', r => { if (r.url().includes('/api/')) events.push(`[net] ${r.request().method()} ${r.url()} ${r.status()}`); });

  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(500);

  const balance = async () => {
    const t = await page.evaluate(() => document.body.innerText);
    const m = t.match(/Current balance: (\d+) credits/);
    return m ? +m[1] : 'NOT FOUND: ' + t.replace(/\n+/g, ' | ').slice(0, 200);
  };
  const snap = () => page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));

  // ---- state on first visit ----
  await page.goto(BASE + '/credits');
  await page.waitForLoadState('networkidle');
  const checked = await page.evaluate(() => Array.from(document.querySelectorAll('input[name=pack]')).map(r => `${r.value}:${r.checked}`).join(', '));
  console.log('radio state initially:', checked);
  console.log('initial balance:', await balance());

  // ---- buy with NO pack selected (if none checked) ----
  const anyChecked = await page.evaluate(() => document.querySelectorAll('input[name=pack]:checked').length > 0);
  if (!anyChecked) {
    events.length = 0;
    await page.getByRole('button', { name: 'Buy credits', exact: true }).click();
    await page.waitForTimeout(800);
    console.log('buy with no pack: ', await snap());
    console.log('events:', events);
  }

  // ---- buy p5 ----
  events.length = 0;
  await page.check('input[value=p5]');
  await page.getByRole('button', { name: 'Buy credits', exact: true }).click();
  await page.waitForTimeout(1000);
  console.log('after p5 buy:', await snap());
  console.log('events:', events);

  // ---- buy p10 ----
  events.length = 0;
  await page.check('input[value=p10]');
  await page.getByRole('button', { name: 'Buy credits', exact: true }).click();
  await page.waitForTimeout(1000);
  console.log('after p10 buy:', await snap());
  console.log('events:', events);

  // ---- rapid double-click on p20 ----
  events.length = 0;
  await page.check('input[value=p20]');
  const btn = page.getByRole('button', { name: 'Buy credits', exact: true });
  await btn.click();
  await btn.click();
  await btn.click();
  await page.waitForTimeout(1500);
  console.log('after triple-click p20:', await snap());
  console.log('events:', events);

  // balance on profile page consistent?
  await page.goto(BASE + '/profile');
  console.log('profile balance:', await snap());

  // back to credits - does balance persist?
  await page.goto(BASE + '/credits');
  await page.waitForLoadState('networkidle');
  console.log('credits balance after reload:', await balance());
  console.log('final events:', events);

  await browser.close();
})();
