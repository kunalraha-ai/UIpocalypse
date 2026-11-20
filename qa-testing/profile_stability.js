const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);
  await page.goto(BASE + '/profile');
  await page.waitForTimeout(800);

  const diag = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const q = s => document.querySelector(s);
    const input = q('input[type=text]') || q('input');
    const samples = [];
    for (let i = 0; i < 6; i++) {
      const r = input ? input.getBoundingClientRect() : null;
      const av = Array.from(document.querySelectorAll('div,span')).find(d => d.childElementCount === 0 && d.textContent.trim() === 'AA');
      const avr = av ? av.getBoundingClientRect() : null;
      samples.push({ input: r ? [r.x, r.y, r.width, r.height] : null, avatar: avr ? [avr.x, avr.y, avr.width, avr.height] : null });
      await sleep(300);
    }
    const anims = (document.getAnimations ? document.getAnimations() : []).map(a => {
      let name = '', dur = '', iters = '';
      try { name = a.animationName || (a.effect && a.effect.getKeyframes && a.effect.getKeyframes()[0] && (a.effect.getKeyframes()[0].animationName || '')) || ''; } catch {}
      try { const t = a.effect.getTiming(); dur = t.duration; iters = t.iterations; } catch {}
      return `${a.constructor.name}{name=${name} dur=${dur} iter=${iters}}`;
    });
    const changed = JSON.stringify(samples[0]) !== JSON.stringify(samples[5]);
    return { samples, anims, changed };
  });
  console.log('stability diag:', JSON.stringify(diag, null, 1));

  // attempt fill with short timeout to observe failure mode
  try {
    await page.locator('input[type=text]').fill('Test Name', { timeout: 6000 });
    console.log('fill OK');
  } catch (e) {
    console.log('fill FAILED:', e.message.split('\n')[0]);
  }
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
