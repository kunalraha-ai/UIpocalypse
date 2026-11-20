const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto('http://localhost:3124/login', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Sign in as Alice")');
  await page.waitForTimeout(800);
  await page.goto('http://localhost:3124/checkout', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  console.log('--- checkout DOM detail ---');
  console.log(await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('main input, main button, main form, main label').forEach(e => {
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      out.push(`<${e.tagName.toLowerCase()} type=${e.type} name=${e.name} text="${(e.innerText||'').substring(0,30)}" visible=${cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0} display=${cs.display} opacity=${cs.opacity} rect=${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)} disabled=${e.disabled}>`);
    });
    return out.join('\n');
  }));
  await page.screenshot({ path: 'checkout.png', fullPage: true });

  // try typing into coupon with force and by locator text
  const inp = page.locator('main form input, main input').first();
  console.log('input count: ' + await page.locator('main input').count());
  try {
    await page.locator('input').first().fill('SAVE10', { timeout: 3000 });
    console.log('fill OK on first input');
  } catch (e) { console.log('fill fail: ' + e.message.split('\n')[0]); }
  try {
    await page.locator('input[type="text"]').first().fill('SAVE10', { timeout: 3000 });
    console.log('fill OK on input[type=text]');
  } catch (e) { console.log('fill fail: ' + e.message.split('\n')[0]); }

  // What about the coupon input hidden behind animation? wait longer
  await page.waitForTimeout(5000);
  console.log('after 5s+: ' + (await page.evaluate(() => {
    const els = [...document.querySelectorAll('main input, main button')];
    return els.map(e => `<${e.tagName} type=${e.type} text="${(e.innerText||e.value||'').substring(0,30)}" hidden=${e.offsetParent === null}>`).join(' | ');
  })));
  await browser.close();
})();
