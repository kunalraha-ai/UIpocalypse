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
      let b=''; try { b=(await r.text()).slice(0,120);}catch{}
      events.push(`[net] ${r.request().method()} ${r.url()} ${r.status()} ${b}`);
    }
  });

  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Bob' }).click();
  await page.waitForTimeout(600);
  await page.goto(BASE + '/settings'); await page.waitForTimeout(500);

  const dump = () => page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => {
    const r = b.getBoundingClientRect();
    return `"${b.innerText.trim()}" visible=${!!(r.width && r.height)} ariaHidden=${b.getAttribute('aria-hidden')} tabindex=${b.getAttribute('tabindex')}`;
  }));
  console.log('buttons on /settings:');
  (await dump()).forEach(b => console.log('  ', b));
  console.log('text:', await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ')));

  // Shipping FAQ
  events.length = 0;
  await page.getByRole('button', { name: 'Shipping FAQ' }).click();
  await page.waitForTimeout(900);
  console.log('\nafter Shipping FAQ:', await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ')));
  console.log('events:', events.join(' ;; ') || '(none)');

  // Notification preferences
  events.length = 0;
  await page.getByRole('button', { name: 'Notification preferences' }).click();
  await page.waitForTimeout(900);
  console.log('\nafter Notification prefs:', await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ')));
  console.log('events:', events.join(' ;; ') || '(none)');

  // Delete account dialog
  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.waitForTimeout(500);
  console.log('\nafter Delete account click:', await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ')));
  // Cancel
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(400);
  console.log('after Cancel:', await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ')));
  // re-open and DELETE FOREVER
  events.length = 0;
  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Delete forever' }).click();
  await page.waitForTimeout(1200);
  console.log('\nafter Delete forever: url =', page.url());
  console.log('page:', await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ')));
  console.log('events:', events.join(' ;; ') || '(none)');

  // can Bob still sign in?
  await page.goto(BASE + '/login'); await page.waitForTimeout(400);
  const loginText = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));
  console.log('\n/login after Bob deleted:', loginText.slice(0, 200));
  events.length = 0;
  await page.getByRole('button', { name: 'Sign in as Bob' }).click();
  await page.waitForTimeout(1000);
  console.log('Bob quick-login after delete: url =', page.url());
  console.log('events:', events.join(' ;; ') || '(none)');
  if (page.url() === BASE + '/') {
    await page.goto(BASE + '/profile'); await page.waitForTimeout(500);
    console.log('Bob profile after delete+relogin:', await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ')));
  }
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
