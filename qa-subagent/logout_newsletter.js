const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // ---- Session revocation after sign out ----
  console.log('=== session revocation ===');
  await page.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sign in as Alice")');
  await page.waitForTimeout(800);
  const cookies = await ctx.cookies();
  const sessionVal = cookies.find(c => c.name === 'session')?.value;
  console.log('cookie before signout: ' + sessionVal);
  await page.goto('http://localhost:3124/settings', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sign out")');
  await page.waitForTimeout(1000);
  console.log('after signout, url: ' + page.url() + ' | cookies: ' + JSON.stringify((await ctx.cookies()).map(c => c.name)));
  // replay old cookie value manually
  await ctx.addCookies([{ name: 'session', value: sessionVal, url: 'http://localhost:3124' }]);
  const resp = await page.goto('http://localhost:3124/api/profile', { waitUntil: 'domcontentloaded' });
  console.log('REPLAYED OLD COOKIE /api/profile => HTTP ' + resp.status());
  console.log('body: ' + (await page.evaluate(() => document.body.innerText)).substring(0, 250));
  await ctx.clearCookies();

  // ---- Back button after sign out ----
  console.log('\n=== back after signout ===');
  const p2 = await ctx.newPage();
  await p2.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await p2.click('button:has-text("Sign in as Bob")');
  await p2.waitForTimeout(600);
  await p2.goto('http://localhost:3124/profile', { waitUntil: 'networkidle' });
  await p2.click('button:has-text("Sign out")');
  await p2.waitForTimeout(800);
  console.log('after signout url: ' + p2.url());
  await p2.goBack();
  await p2.waitForTimeout(1200);
  console.log('after Back url: ' + p2.url());
  console.log('after Back body: ' + (await p2.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 300));

  // ---- Newsletter form ----
  console.log('\n=== newsletter ===');
  const p3 = await ctx.newPage();
  await p3.goto('http://localhost:3124/', { waitUntil: 'networkidle' });
  console.log('form attrs: ' + await p3.evaluate(() => {
    const f = [...document.querySelectorAll('form')].find(f => f.innerText.includes('Subscribe'));
    return `action=${f.action} method=${f.method}`;
  }));
  await p3.fill('input[type=email]', 'xss@example.com');
  await p3.click('button:has-text("Subscribe")');
  await p3.waitForTimeout(1000);
  console.log('after subscribe url: ' + p3.url());
  console.log('after subscribe body: ' + (await p3.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 400));
  await p3.fill('input[type=email]', 'notanemail');
  await p3.click('button:has-text("Subscribe")');
  await p3.waitForTimeout(600);
  console.log('invalid email: browser blocked? ' + !(p3.url().includes('email=')));

  await browser.close();
})();
