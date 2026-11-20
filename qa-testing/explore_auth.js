const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const events = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') events.push(`[console.${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => events.push(`[pageerror] ${e.message}`));
  page.on('response', r => {
    if (r.url().includes('/api/') || r.request().method() !== 'GET')
      events.push(`[net] ${r.request().method()} ${r.url()} -> ${r.status()}`);
  });

  await page.goto('http://localhost:3124/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForLoadState('networkidle');
  console.log('AFTER ALICE LOGIN URL:', page.url());
  console.log('--- events ---'); events.forEach(e => console.log(e));

  for (const p of ['/credits', '/checkout', '/orders', '/profile', '/settings', '/']) {
    events.length = 0;
    await page.goto('http://localhost:3124' + p, { waitUntil: 'networkidle' });
    console.log(`\n================ PAGE ${p} ================`);
    const body = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').trim());
    console.log(body);
    const els = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button, a[href], input, select, textarea').forEach(e => {
        out.push(`${e.tagName.toLowerCase()} | text="${(e.innerText || '').slice(0,50).trim()}" | ph="${e.placeholder || ''}" | name=${e.name || ''} | type=${e.type || ''} | value="${(e.value||'').slice(0,30)}" | disabled=${e.disabled}`);
      });
      return out;
    });
    els.forEach(e => console.log(e));
    if (events.length) { console.log('--- events ---'); events.forEach(e => console.log(e)); }
  }
  await browser.close();
})();
