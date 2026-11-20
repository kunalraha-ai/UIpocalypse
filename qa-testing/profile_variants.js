const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);

  const probe = async (label) => {
    const s = await page.evaluate(() => ({
      text: document.body.innerText.replace(/\n+/g, ' | '),
      inputs: Array.from(document.querySelectorAll('input')).map(i => `type=${i.type} name=${i.name} value="${(i.value||'').slice(0,30)}"`),
      buttons: Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean),
    }));
    console.log(`\n### ${label}`);
    console.log('text:', s.text.slice(0, 260));
    console.log('inputs:', s.inputs);
  };

  await page.goto(BASE + '/profile'); await page.waitForTimeout(400); await probe('direct: /profile #1');
  await page.goto(BASE + '/profile'); await page.waitForTimeout(400); await probe('direct: /profile #2 (reload)');
  await page.goto(BASE + '/');      await page.waitForTimeout(400); await probe('home');
  await page.goto(BASE + '/profile'); await page.waitForTimeout(400); await probe('home -> /profile');
  await page.goto(BASE + '/credits'); await page.waitForTimeout(400);
  await page.goto(BASE + '/profile'); await page.waitForTimeout(400); await probe('credits -> /profile');
  // client-side nav via clicking nav links
  await page.getByRole('link', { name: 'Settings' }).click(); await page.waitForTimeout(500); await probe('nav-click: settings');
  await page.getByRole('link', { name: 'Profile' }).click(); await page.waitForTimeout(500); await probe('nav-click: settings -> profile');
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
