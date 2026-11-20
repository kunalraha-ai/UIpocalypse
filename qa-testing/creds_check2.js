const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  page.on('request', r => { if (r.url().includes('/api/auth/login')) console.log('LOGIN REQ:', r.postData()); });
  await page.getByRole('button', { name: 'Sign in as Bob' }).click();
  await page.waitForTimeout(900);
  console.log('Bob login url:', page.url());
  // sign out via JS click (bypass playwright click flakiness)
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.trim() === 'Sign out');
    if (b) b.click(); 
  });
  await page.waitForTimeout(600);
  console.log('after JS signout url:', page.url());
  // try alice creds on the API for the record
  const r1 = await page.evaluate(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({email:'bob@example.com', password:'secret123'}) });
    return `${r.status} ${await r.text()}`;
  });
  console.log('API bob login:', r1);
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
