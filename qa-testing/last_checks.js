const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const events = [];
  page.on('response', async r => {
    if (r.url().includes('/api/')) { let b=''; try { b=(await r.text()).slice(0,100);}catch{} events.push(`${r.request().method()} ${r.url().replace(BASE,'')} ${r.status()} ${b}`); }
  });

  // 1. Place an order then refresh the success page
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);
  await page.goto(BASE + '/checkout'); await page.waitForTimeout(400);
  events.length = 0;
  await page.getByRole('button', { name: 'Place order' }).click();
  await page.waitForTimeout(1000);
  console.log('success page after order:', await page.evaluate(() => document.body.innerText.replace(/\n+/g,' | ')));
  await page.reload(); await page.waitForTimeout(900);
  const afterReload = await page.evaluate(() => document.body.innerText.replace(/\n+/g,' | '));
  console.log('after F5 on success page:', afterReload);
  console.log('url still:', page.url());

  // 2. /?q=lamp SSR
  await page.goto(BASE + '/?q=lamp'); await page.waitForTimeout(600);
  const names = await page.evaluate(() => Array.from(document.querySelectorAll('.grid .card h3')).map(e => e.textContent));
  console.log('\n/?q=lamp product grid SSR:', names);

  // 3. login with empty password (valid email)
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.trim()==='Sign out'); b?.click(); });
  await page.waitForTimeout(500);
  await page.goto(BASE + '/login'); await page.waitForTimeout(300);
  await page.fill('input[type=email]', 'alice@example.com');
  await page.fill('input[type=password]', '');
  events.length = 0;
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForTimeout(800);
  console.log('\nempty password login:', events.join(' ;; ') || '(no request)', '| url:', page.url());

  // 4. correct creds via form (alice + secret123)
  await page.fill('input[type=password]', 'secret123');
  events.length = 0;
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForTimeout(800);
  console.log('correct form login:', events.join(' ;; '), '| url:', page.url());

  // 5. Any XSS reflection in error messages? try weird email
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.trim()==='Sign out'); b?.click(); });
  await page.waitForTimeout(400);
  await page.goto(BASE + '/login'); await page.waitForTimeout(300);
  await page.fill('input[type=email]', '<script>alert(1)</script>@x.com');
  await page.fill('input[type=password]', '<b>bold</b>');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForTimeout(800);
  const bodyHasBold = await page.evaluate(() => !!document.querySelector('b') && document.body.innerHTML.includes('<b>bold</b>'));
  console.log('\nerror message renders raw HTML?', bodyHasBold, '|', await page.evaluate(() => document.body.innerText.replace(/\n+/g,' | ')));

  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
