const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const events = [];
  page.on('response', async r => {
    if (r.url().includes('/api/')) {
      let b=''; try { b=(await r.text()).slice(0,120);}catch{}
      events.push(`${r.request().method()} ${r.url().replace(BASE,'')} ${r.status()} ${b}`);
    }
  });

  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);

  // 1. Alice /api/orders still broken?
  events.length = 0;
  await page.goto(BASE + '/orders'); await page.waitForTimeout(800);
  console.log('1. orders page events:', events.join(' ;; '));
  console.log('   orders text:', await page.evaluate(() => document.body.innerText.replace(/\n+/g,' | ')));

  // 2. balance before orders
  await page.goto(BASE + '/profile'); await page.waitForTimeout(500);
  const balBefore = (await page.evaluate(() => document.body.innerText)).match(/Balance: (\d+)/)?.[1];

  // 3. double-click Place order race
  await page.goto(BASE + '/checkout'); await page.waitForTimeout(400);
  events.length = 0;
  await Promise.all([
    page.getByRole('button', { name: 'Place order' }).click(),
    page.getByRole('button', { name: 'Place order' }).click(),
  ]);
  await page.waitForTimeout(1500);
  console.log('\n2. double Place order events:', events.join(' ;; '));
  console.log('   url:', page.url());
  console.log('   page:', await page.evaluate(() => document.body.innerText.replace(/\n+/g,' | ')));

  // 4. balance after orders (did credits get used?)
  await page.goto(BASE + '/profile'); await page.waitForTimeout(500);
  const balAfter = (await page.evaluate(() => document.body.innerText)).match(/Balance: (\d+)/)?.[1];
  console.log(`\n3. balance before=$${balBefore} after=$${balAfter} (orders placed)`);

  // 5. direct URL /checkout/success
  await page.goto(BASE + '/checkout/success'); await page.waitForTimeout(600);
  console.log('\n4. direct /checkout/success:', await page.evaluate(() => document.body.innerText.replace(/\n+/g,' | ')));
  console.log('   http status of the page load: (see events)', events.join(' ;; '));

  // 6. ✦ button click
  await page.goto(BASE + '/checkout'); await page.waitForTimeout(300);
  events.length = 0;
  await page.locator('footer button').click({ timeout: 8000 }).catch(e => console.log('\n5. ✦ click err:', e.message.split('\n')[0]));
  await page.waitForTimeout(600);
  console.log('\n5. after ✦ click: url=', page.url(), 'events=', events.join(' ;; ') || '(none)');

  // 7. credits race on fresh server
  await page.goto(BASE + '/credits'); await page.waitForTimeout(400);
  const balC0 = +(await page.evaluate(() => document.body.innerText)).match(/Current balance: (\d+)/)[1];
  await page.check('input[value=p5]');
  events.length = 0;
  await Promise.all([
    page.getByRole('button', { name: 'Buy credits', exact: true }).click(),
    page.getByRole('button', { name: 'Buy credits', exact: true }).click(),
    page.getByRole('button', { name: 'Buy credits', exact: true }).click(),
  ]);
  await page.waitForTimeout(1800);
  const balC1 = +(await page.evaluate(() => document.body.innerText)).match(/Current balance: (\d+)/)[1];
  console.log(`\n6. credits race: ${balC0} -> ${balC1} (delta ${balC1-balC0}, expected 1500)`);
  console.log('   responses:', events.join(' ;; '));

  // 8. sign out then back button
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.trim()==='Sign out'); b?.click(); });
  await page.waitForTimeout(600);
  console.log('\n7. after sign out url:', page.url());
  await page.goBack(); await page.waitForTimeout(700);
  const backText = await page.evaluate(() => document.body.innerText.replace(/\n+/g,' | '));
  console.log('   after Back:', page.url(), '->', backText.includes('Balance') ? 'STILL SHOWS AUTHED DATA (cached page leak)' : backText.slice(0, 120));

  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
