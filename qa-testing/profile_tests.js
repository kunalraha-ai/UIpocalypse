const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const events = [];
  page.on('console', m => { if (m.type() === 'error') events.push('[console] ' + m.text()); });
  page.on('pageerror', e => events.push('[pageerror] ' + e.message));
  page.on('response', async r => {
    if (r.url().includes('/api/')) {
      let b=''; try { b=(await r.text()).slice(0,150);}catch{}
      events.push(`[net] ${r.request().method()} ${r.url()} ${r.status()} ${b}`);
    }
  });

  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);
  await page.goto(BASE + '/profile');
  await page.waitForLoadState('networkidle');
  const snap = () => page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));
  console.log('initial:', await snap());

  const nameInput = page.locator('input[type=text]');
  const initials = async () => {
    // find the initials element (the "AA" chip)
    return await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('div,span'));
      return els.map(e => e.textContent.trim()).filter(t => /^[A-Z]{1,3}$/.test(t));
    });
  };
  const save = async (label) => {
    events.length = 0;
    await page.getByRole('button', { name: 'Save profile' }).click();
    await page.waitForTimeout(800);
    console.log(`[${label}]`, await snap());
    console.log('   initials:', await initials());
    console.log('   events:', events.join(' ;; '));
  };

  // 1. normal rename
  await nameInput.fill('Alice Smith');
  await save('rename to Alice Smith');

  // 2. empty name
  await nameInput.fill('');
  await save('empty name');

  // 3. whitespace-only name
  await nameInput.fill('   ');
  await save('whitespace name');

  // 4. very long name
  await nameInput.fill('A'.repeat(300));
  await save('300-char name');

  // 5. XSS name
  await nameInput.fill('<img src=x onerror=window.__xssp=1>');
  await save('xss name');
  console.log('   XSS marker:', await page.evaluate(() => window.__xssp));

  // 6. emoji + unicode name
  await nameInput.fill('Zoë 🪑 Ω');
  await save('unicode name');

  // 7. digits/symbols only
  await nameInput.fill('123');
  await save('numeric name');

  // 8. restore
  await nameInput.fill('Alice Anderson');
  await save('restore name');

  await browser.close();
})();
