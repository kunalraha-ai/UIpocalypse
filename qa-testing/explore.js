const { chromium } = require('playwright');

const PAGES = ['/', '/credits', '/checkout', '/orders', '/profile', '/settings', '/login', '/nonexistent-page-xyz'];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleMsgs = [];
  const pageErrors = [];
  const failedReqs = [];
  page.on('console', m => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('requestfailed', r => failedReqs.push(`${r.method()} ${r.url()} -> ${r.failure()?.errorText}`));
  page.on('response', r => { if (r.status() >= 400) failedReqs.push(`HTTP ${r.status()} ${r.url()}`); });

  for (const p of PAGES) {
    consoleMsgs.length = 0; pageErrors.length = 0; failedReqs.length = 0;
    try {
      await page.goto('http://localhost:3124' + p, { waitUntil: 'networkidle', timeout: 15000 });
    } catch (e) { console.log(`\n=== ${p} GOTO ERROR: ${e.message.split('\n')[0]}`); continue; }
    console.log(`\n================ PAGE ${p} ================`);
    const body = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').trim());
    console.log('--- TEXT ---');
    console.log(body);
    const els = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button, a[href], input, select, textarea, [role=button]').forEach(e => {
        out.push(`${e.tagName.toLowerCase()} | text=${(e.innerText || e.value || e.placeholder || '').slice(0,40).trim()} | name=${e.name || ''} | type=${e.type || ''} | disabled=${e.disabled} | id=${e.id || ''}`);
      });
      return out;
    });
    console.log('--- INTERACTIVE ---');
    els.forEach(e => console.log(e));
    if (consoleMsgs.length) { console.log('--- CONSOLE ---'); consoleMsgs.forEach(m => console.log(m)); }
    if (pageErrors.length) { console.log('--- PAGEERRORS ---'); pageErrors.forEach(m => console.log(m)); }
    if (failedReqs.length) { console.log('--- FAILED REQS ---'); failedReqs.forEach(m => console.log(m)); }
  }
  await browser.close();
})();
