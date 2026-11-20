const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const posts = [];
  page.on('request', r => {
    if (r.method() !== 'GET') posts.push(r.method() + ' ' + r.url().replace('http://localhost:3124', '') + ' ' + (r.postData() || ''));
  });
  page.on('response', r => {
    const u = r.url();
    if (!u.includes('_next/static') && !u.includes('?_rsc=') && (r.request().method() !== 'GET' || r.status() >= 400))
      console.log(`[net ${r.status()}] ${r.request().method()} ${u.replace('http://localhost:3124','')}`);
  });

  console.log('=== sign in as Bob, capture cookie ===');
  await page.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sign in as Bob")');
  await page.waitForTimeout(800);
  const bobCookie = (await ctx.cookies()).find(c => c.name === 'session')?.value;
  console.log('bob cookie: ' + bobCookie);

  console.log('\n=== open settings, delete account ===');
  await page.goto('http://localhost:3124/settings', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Delete account")');
  await page.waitForTimeout(400);
  console.log('confirm dialog shown: ' + (await page.evaluate(() => document.body.innerText.includes('Delete your account?'))));
  posts.length = 0;
  await page.click('button:has-text("Delete forever")');
  await page.waitForTimeout(2000);
  console.log('POSTs during delete: ' + JSON.stringify(posts));
  console.log('url after delete: ' + page.url());
  console.log('body after delete: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 350));
  console.log('cookies after delete: ' + JSON.stringify((await ctx.cookies()).map(c => c.name)));

  console.log('\n=== bob cookie still valid server-side? ===');
  const r1 = await page.evaluate(async (c) => {
    const res = await fetch('/api/profile', { headers: { Cookie: 'session=' + c } });
    return res.status + ' ' + (await res.text());
  }, bobCookie);
  console.log('/api/profile with old bob cookie => ' + r1);

  console.log('\n=== can Bob sign in again? ===');
  await page.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sign in as Bob")');
  await page.waitForTimeout(1500);
  console.log('url: ' + page.url());
  console.log('body: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));

  await browser.close();
})();
