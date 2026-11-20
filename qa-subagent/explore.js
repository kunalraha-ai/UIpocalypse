const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const routes = ['/', '/credits', '/checkout', '/orders', '/profile', '/settings', '/login', '/nonexistent-page'];

  for (const r of routes) {
    try {
      const resp = await page.goto('http://localhost:3124' + r, { waitUntil: 'networkidle', timeout: 15000 });
      console.log('=== ROUTE ' + r + ' => HTTP ' + (resp ? resp.status() : 'null') + ' ===');
      console.log('TITLE: ' + (await page.title()));
      const text = await page.evaluate(() => document.body.innerText);
      console.log(text.substring(0, 1500));
      console.log('--- interactive elements ---');
      const els = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('button, input, select, textarea, a, form').forEach(e => {
          out.push(`<${e.tagName.toLowerCase()} type=${e.type || ''} name=${e.name || ''} placeholder="${e.placeholder || ''}" id=${e.id || ''} text="${(e.innerText || e.value || '').substring(0, 40).replace(/\n/g, ' ')}">`);
        });
        return out.join('\n');
      });
      console.log(els);
    } catch (e) {
      console.log('=== ROUTE ' + r + ' => ERROR: ' + e.message.substring(0, 300));
    }
  }
  await browser.close();
})();
