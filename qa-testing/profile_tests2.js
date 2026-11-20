const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const events = [];
  page.on('console', m => { if (m.type() === 'error') events.push('[console] ' + m.text()); });
  page.on('pageerror', e => events.push('[pageerror] ' + e.message.split('\n')[0]));
  page.on('response', async r => {
    if (r.url().includes('/api/')) {
      let b=''; try { b=(await r.text()).slice(0,150);}catch{}
      events.push(`[net] ${r.request().method()} ${r.url()} ${r.status()} ${b}`);
    }
  });
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);
  await page.goto(BASE + '/profile'); await page.waitForTimeout(500);

  const nameInput = page.locator('main input'); // the profile name input
  const initials = () => page.evaluate(() => document.querySelector('.nametag')?.textContent);
  const snap = () => page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));
  const save = async (label) => {
    events.length = 0;
    await page.getByRole('button', { name: 'Save profile' }).click();
    await page.waitForTimeout(900);
    console.log(`[${label}] initials=${JSON.stringify(await initials())} input=${JSON.stringify(await nameInput.inputValue())}`);
    console.log('   events:', events.join(' ;; ') || '(none)');
  };

  console.log('baseline initials:', await initials(), '| input value:', await nameInput.inputValue());

  await nameInput.fill('Alice Smith'); await save('rename');
  await nameInput.fill(''); await save('empty name');
  await nameInput.fill('   '); await save('whitespace name');
  await nameInput.fill('A'.repeat(500)); await save('500-char name');
  await nameInput.fill('<img src=x onerror=window.__xssp=1>'); await save('xss name');
  console.log('   XSS marker:', await page.evaluate(() => window.__xssp));
  console.log('   nametag title attr:', await page.evaluate(() => document.querySelector('.nametag')?.getAttribute('title')));
  await nameInput.fill('Zoë Ω 🪑'); await save('unicode name');
  await nameInput.fill('123 456'); await save('numeric name');
  await nameInput.fill("Robert'); DROP TABLE users;--"); await save('sqli name');
  // double-click save race
  await nameInput.fill('Race Name');
  events.length = 0;
  await Promise.all([
    page.getByRole('button', { name: 'Save profile' }).click(),
    page.getByRole('button', { name: 'Save profile' }).click(),
  ]);
  await page.waitForTimeout(1000);
  console.log('[double save] input=', JSON.stringify(await nameInput.inputValue()));
  console.log('   events:', events.join(' ;; '));
  // restore
  await nameInput.fill('Alice Anderson'); await save('restore');
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
