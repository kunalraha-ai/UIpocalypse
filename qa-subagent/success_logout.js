const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();

  // ---- Test 1: reload on /checkout/success after real order ----
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sign in as Alice")');
  await page.waitForTimeout(800);
  await page.goto('http://localhost:3124/checkout', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Place order")');
  await page.waitForTimeout(1500);
  console.log('order placed, URL: ' + page.url());
  console.log('success page: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 300));
  console.log('--- reloading success page ---');
  await page.reload({ waitUntil: 'networkidle' });
  console.log('after reload: ' + (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 300));

  // ---- Test 2: session revocation after sign out ----
  console.log('\n=== session revocation ===');
  const cookies = await ctx.cookies();
  const sessionVal = cookies.find(c => c.name === 'session')?.value;
  console.log('cookie before signout: ' + sessionVal);
  await page.click('button:has-text("Sign out")');
  await page.waitForTimeout(1000);
  console.log('after signout, url: ' + page.url() + ' | cookies now: ' + JSON.stringify((await ctx.cookies()).map(c => c.name + '=' + c.value)));
  // manually replay old cookie
  const pageAPI = await ctx.newPage();
  await pageAPI.goto('http://localhost:3124/', { waitUntil: 'domcontentloaded' });
  await ctx.addCookies([{ name: 'session', value: sessionVal, url: 'http://localhost:3124' }]);
  const resp = await pageAPI.goto('http://localhost:3124/api/profile', { waitUntil: 'networkidle' });
  console.log('old cookie replay /api/profile => ' + resp.status() + ': ' + (await pageAPI.evaluate(() => document.body.innerText)).substring(0, 200));

  // ---- Test 3: Back button after sign out ----
  console.log('\n=== back after signout ===');
  await ctx.clearCookies();
  const page3 = await ctx.newPage();
  await page3.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page3.click('button:has-text("Sign in as Bob")');
  await page3.waitForTimeout(600);
  await page3.goto('http://localhost:3124/profile', { waitUntil: 'networkidle' });
  await page3.click('button:has-text("Sign out")');
  await page3.waitForTimeout(800);
  console.log('after signout url: ' + page3.url());
  await page3.goBack();
  await page3.waitForTimeout(1200);
  console.log('after Back url: ' + page3.url());
  console.log('after Back: ' + (await page3.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 250));

  // ---- Test 4: newsletter form behavior ----
  console.log('\n=== newsletter ===');
  const page4 = await ctx.newPage();
  await page4.goto('http://localhost:3124/', { waitUntil: 'networkidle' });
  console.log('form attrs: ' + await page4.evaluate(() => {
    const f = [...document.querySelectorAll('form')].find(f => f.innerText.includes('Subscribe'));
    return `action=${f.action} method=${f.method}`;
  }));
  await page4.fill('input[type=email]', 'xss@example.com');
  await page4.click('button:has-text("Subscribe")');
  await page4.waitForTimeout(1000);
  console.log('after subscribe url: ' + page4.url());
  console.log('after subscribe: ' + (await page4.evaluate(() => document.body.innerText)).replace(/\n+/g, ' | ').substring(0, 500));

  // invalid email (type=email validation)
  await page4.fill('input[type=email]', 'notanemail');
  await page4.click('button:has-text("Subscribe")');
  await page4.waitForTimeout(600);
  console.log('invalid email blocked by browser validation: ' + (page4.url().includes('email=') ? 'NO' : 'YES (no navigation)'));

  await browser.close();
})();
