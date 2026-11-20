const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(500);

  // direct API probes (same-origin fetch from the app page)
  const probes = ['%', '_', '[', '(', '\\', '+', '*', '?', '"', "'", '&&', '||', '<', '>', '=', 'a b', 'a%b', 'a_b', 'é', '🪑', '😀', '\u0301', 'lamp%20', 'lamp+chair', ' null', 'undefined', '0', '-1', '1e999', 'NaN'];
  for (const q of probes) {
    const r = await page.evaluate(async (qq) => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(qq)}`);
        return `${res.status} ${(await res.text()).slice(0, 120)}`;
      } catch (e) { return 'FETCH_ERR ' + e.message; }
    }, q);
    console.log(JSON.stringify(q), '=>', r);
  }

  // recommendations endpoint timing
  const t0 = Date.now();
  const recRes = await page.evaluate(async () => {
    try {
      const res = await fetch('/api/recommendations');
      return `${res.status} after ${Date.now()}ms: ${(await res.text()).slice(0, 300)}`;
    } catch (e) { return 'FETCH_ERR ' + e.message; }
  });
  console.log('\n/api/recommendations direct:', recRes, `elapsed ${Date.now() - t0}ms`);

  await browser.close();
})();
