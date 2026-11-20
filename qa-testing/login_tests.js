const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
const results = [];
function log(name, pass, detail) { results.push({name, pass, detail}); console.log(`${pass ? 'OK ' : 'BUG'} | ${name}\n     ${detail}\n`); }

(async () => {
  const browser = await chromium.launch();

  // ---- Test 1: empty form submit ----
  let ctx = await browser.newContext();
  let page = await ctx.newPage();
  const netlog = [];
  page.on('response', r => { if (r.url().includes('/api/')) netlog.push(`${r.request().method()} ${r.url()} ${r.status()}`); });
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForTimeout(800);
  console.log('T1 empty form: url=', page.url(), 'netlog=', netlog);
  netlog.length = 0;

  // ---- Test 2: wrong password ----
  await page.fill('input[type=email]', 'alice@creditcraft.dev');
  await page.fill('input[type=password]', 'wrongpass');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForTimeout(1000);
  console.log('T2 wrong pass: url=', page.url(), 'netlog=', netlog);
  const t2body = await page.evaluate(() => document.body.innerText);
  console.log('T2 body contains error msg?', /error|invalid|wrong|incorrect/i.test(t2body));
  console.log('T2 body snippet:', t2body.replace(/\n+/g,' | ').slice(0, 300));
  netlog.length = 0;

  // ---- Test 3: try common credentials for alice ----
  for (const [em, pw] of [['alice@creditcraft.dev','password123'],['alice@creditcraft.dev','alice123'],['alice@creditcraft.dev','password'],['alice@example.com','password123'],['bob@creditcraft.dev','password123']]) {
    await page.fill('input[type=email]', em);
    await page.fill('input[type=password]', pw);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForTimeout(800);
    const resp = netlog[netlog.length-1];
    console.log(`T3 creds ${em}/${pw}: url=${page.url()} net=${netlog}`);
    if (page.url() !== BASE + '/login') break;
  }
  netlog.length = 0;

  // ---- Test 4: malformed email / weird inputs ----
  await page.goto(BASE + '/login');
  await page.fill('input[type=email]', 'not-an-email');
  await page.fill('input[type=password]', 'x');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForTimeout(800);
  console.log('T4 malformed: url=', page.url(), 'netlog=', netlog);
  netlog.length = 0;

  // ---- Test 5: XSS attempt in login fields ----
  await page.fill('input[type=email]', `"><img src=x onerror=window.__xss=1>@a.com`);
  await page.fill('input[type=password]', `<script>window.__xss=2</script>`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForTimeout(800);
  const xssHit = await page.evaluate(() => window.__xss);
  console.log('T5 xss: window.__xss =', xssHit, 'url=', page.url(), 'netlog=', netlog);

  // ---- Test 6: quick login Alice, inspect cookies/storage ----
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(800);
  const cookies = await ctx.cookies();
  console.log('T6 cookies:', JSON.stringify(cookies, null, 1));
  const storage = await page.evaluate(() => ({ local: {...localStorage}, session: {...sessionStorage} }));
  console.log('T6 storage:', JSON.stringify(storage));

  // ---- Test 7: back button after login ----
  await page.goBack();
  await page.waitForTimeout(600);
  console.log('T7 after back: url=', page.url());
  const b = await page.evaluate(() => document.body.innerText.slice(0, 200).replace(/\n+/g,' | '));
  console.log('T7 body:', b);

  // ---- Test 8: login while logged in ----
  await page.goto(BASE + '/login');
  const t8 = await page.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n+/g,' | '));
  console.log('T8 visiting /login when authed:', t8);
  console.log('T8 url:', page.url());

  // ---- Test 9: Sign in as Bob after being logged in as Alice ----
  const bobBtn = page.getByRole('button', { name: 'Sign in as Bob' });
  if (await bobBtn.count()) {
    await bobBtn.click();
    await page.waitForTimeout(800);
    console.log('T9 after Bob click: url=', page.url());
    await page.goto(BASE + '/profile');
    const t9 = await page.evaluate(() => document.body.innerText.replace(/\n+/g,' | '));
    console.log('T9 profile as Bob:', t9.slice(0,300));
  } else console.log('T9: no Bob button on /login when authed');

  await browser.close();
})();
