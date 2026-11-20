const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const posts = [];
  page.on('request', r => {
    const url = r.url();
    if (r.method() === 'POST' && !url.includes('_next')) posts.push(url.replace('http://localhost:3124', '') + ' ' + (r.postData() || ''));
  });

  await page.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sign in as Alice")');
  await page.waitForTimeout(800);

  // 1. Label association check
  console.log('=== radio ids ===');
  await page.goto('http://localhost:3124/credits', { waitUntil: 'networkidle' });
  console.log(await page.evaluate(() => [...document.querySelectorAll('input[type=radio]')].map(r => `value=${r.value} id="${r.id}"`).join(' | ')));
  console.log('--- click label text "$10 — 1100 credits" ---');
  await page.click('label:has-text("1100")');
  console.log('p10 checked after label click: ' + await page.isChecked('input[value="p10"]'));

  // 2. Place order double-click race
  console.log('\n=== place order double-click ===');
  await page.goto('http://localhost:3124/checkout', { waitUntil: 'networkidle' });
  posts.length = 0;
  await page.click('button:has-text("Place order")', { clickCount: 2 });
  await page.waitForTimeout(2500);
  console.log('POSTs: ' + JSON.stringify(posts));
  console.log('URL: ' + page.url());
  console.log('page: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));

  // 3. /checkout/success direct visit (no order placed)
  console.log('\n=== direct visit /checkout/success ===');
  const resp = await page.goto('http://localhost:3124/checkout/success', { waitUntil: 'networkidle' });
  console.log('status: ' + resp.status());
  console.log('page: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));

  // 4. /checkout/success signed OUT
  console.log('\n=== /checkout/success signed out ===');
  const page2 = await ctx.newPage();
  await page2.goto('http://localhost:3124/logout-does-not-exist', { waitUntil: 'networkidle' }).catch(() => {});

  await browser.close();

  // fresh context signed out
  const ctx2 = await browser.newContext();
  const page3 = await ctx2.newPage();
  const r3 = await page3.goto('http://localhost:3124/checkout/success', { waitUntil: 'networkidle' });
  console.log('signed-out status: ' + r3.status());
  console.log('signed-out page: ' + (await page3.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));

  // 5. Sign out then Back button (bfcache leak check)
  console.log('\n=== sign out + Back ===');
  const ctx3 = await browser.newContext();
  const page4 = await ctx3.newPage();
  await page4.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page4.click('button:has-text("Sign in as Alice")');
  await page4.waitForTimeout(600);
  await page4.goto('http://localhost:3124/profile', { waitUntil: 'networkidle' });
  console.log('profile page before signout: ' + (await page4.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 200));
  await page4.click('button:has-text("Sign out")');
  await page4.waitForTimeout(1000);
  console.log('after signout URL: ' + page4.url());
  console.log('after signout nav shows: ' + (await page4.evaluate(() => document.querySelector('header')?.innerText || '')).replace(/\n+/g, ' | '));
  await page4.goBack();
  await page4.waitForTimeout(1000);
  console.log('after Back URL: ' + page4.url());
  console.log('after Back page: ' + (await page4.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 250));
  await browser.close();
})();
