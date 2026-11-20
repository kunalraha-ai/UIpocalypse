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

  // 1. Fresh credits page: which radio is selected by default?
  console.log('=== fresh credits page: radio states ===');
  await page.goto('http://localhost:3124/credits', { waitUntil: 'networkidle' });
  console.log(await page.evaluate(() => [...document.querySelectorAll('input[type=radio]')].map(r => `value=${r.value} checked=${r.checked}`).join(' | ')));
  console.log('balance: ' + (await page.evaluate(() => document.body.innerText.match(/Current balance: (\d+)/)?.[1])));

  // 2. Click Buy with NO pack selected
  console.log('\n=== buy with NO selection ===');
  posts.length = 0;
  await page.click('button:has-text("Buy credits")');
  await page.waitForTimeout(1000);
  console.log('POSTs: ' + JSON.stringify(posts));
  console.log('balance now: ' + (await page.evaluate(() => document.body.innerText.match(/Current balance: (\d+)/)?.[1])));
  console.log('radio states after: ' + await page.evaluate(() => [...document.querySelectorAll('input[type=radio]')].map(r => `value=${r.value} checked=${r.checked}`).join(' | ')));

  // 3. Double-click buy rapidly (race: double charge?)
  console.log('\n=== rapid double-click Buy (p5 selected) ===');
  await page.check('input[value="p5"]');
  const balBefore = await page.evaluate(() => document.body.innerText.match(/Current balance: (\d+)/)?.[1]);
  posts.length = 0;
  await page.click('button:has-text("Buy credits")', { clickCount: 2 });
  await page.waitForTimeout(1500);
  console.log('POSTs: ' + JSON.stringify(posts));
  console.log('balance before: ' + balBefore + ' -> after: ' + (await page.evaluate(() => document.body.innerText.match(/Current balance: (\d+)/)?.[1])));
  console.log('messages: ' + (await page.evaluate(() => document.body.innerText.match(/Credits added!|Pick a pack|\$\d+ —/g)?.join(','))));

  // 4. Even faster: 5 clicks
  console.log('\n=== 5 rapid clicks Buy ===');
  posts.length = 0;
  const balB = await page.evaluate(() => document.body.innerText.match(/Current balance: (\d+)/)?.[1]);
  for (let i = 0; i < 5; i++) await page.click('button:has-text("Buy credits")', { noWaitAfter: true }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log('POSTs (' + posts.length + '): ' + JSON.stringify(posts));
  console.log('balance: ' + balB + ' -> ' + (await page.evaluate(() => document.body.innerText.match(/Current balance: (\d+)/)?.[1])));

  // 5. radio UI: does clicking a radio label work? Check a11y quickly
  console.log('\n=== labels associated with radios? ===');
  console.log(await page.evaluate(() => {
    const labels = [...document.querySelectorAll('label')];
    return labels.map(l => `label="${l.innerText}" for=${l.htmlFor} containsInput=${l.contains(document.querySelector('input'))}`).join(' | ');
  }));

  await browser.close();
})();
