const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const net = [];
  page.on('request', r => { if (!r.url().includes('_next/static')) net.push(`REQ ${r.method()} ${r.url()}`); });
  page.on('response', r => { if (!r.url().includes('_next/static')) net.push(`RES ${r.status()} ${r.url()}`); });
  page.on('pageerror', e => net.push('PAGEERROR ' + e.message.split('\n')[0]));

  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);
  await page.goto(BASE + '/profile'); await page.waitForTimeout(500);

  const nameInput = page.locator('main input');
  await nameInput.fill('Alice Smith');
  net.length = 0;
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.waitForTimeout(1000);
  console.log('network during first save:', JSON.stringify(net, null, 1));

  const state = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Save profile'));
    const r = btn.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const at = document.elementFromPoint(cx, cy);
    return { btnRect: [r.x, r.y, r.width, r.height], elementAtPoint: at ? at.outerHTML.slice(0, 120) : null,
             btnEnabled: !btn.disabled, html: document.querySelector('main').innerHTML };
  });
  console.log('state after save:', JSON.stringify(state, null, 1));

  // try clicking again with evaluate (bypass hit-testing)
  const clickedViaJS = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Save profile'));
    btn.click();
    return 'clicked';
  });
  await page.waitForTimeout(800);
  console.log(clickedViaJS, '— value after JS click:', await nameInput.inputValue());
  console.log('net after JS click:', JSON.stringify(net));

  // persistence check: reload
  await page.reload(); await page.waitForTimeout(700);
  console.log('after reload, name value:', await page.evaluate(() => document.querySelector('main input')?.value));
  console.log('initials:', await page.evaluate(() => document.querySelector('.nametag')?.textContent));
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
