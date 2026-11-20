const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);

  // control: screenshot on home
  await page.goto(BASE + '/');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'home.png', timeout: 8000 }).then(() => console.log('home screenshot OK')).catch(e => console.log('home screenshot FAIL:', e.message.split('\n')[0]));

  // profile page diagnostics
  await page.goto(BASE + '/profile');
  await page.waitForTimeout(500);
  const diag = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const input = document.querySelector('input[type=text]');
    const r1 = input.getBoundingClientRect();
    const htmlLen1 = document.documentElement.outerHTML.length;
    const anims = document.getAnimations ? document.getAnimations().map(a => ({
      type: a.constructor.name, dur: (a.effect && a.effect.getTiming) ? a.effect.getTiming().duration : null,
      key: (a.effect && a.effect.getKeyframes) ? a.effect.getKeyframes().length : null
    })) : [];
    await sleep(1500);
    const r2 = input.getBoundingClientRect();
    const htmlLen2 = document.documentElement.outerHTML.length;
    const avatar = Array.from(document.querySelectorAll('div')).find(d => d.textContent.trim() === 'AA');
    const av1 = avatar ? avatar.getBoundingClientRect() : null;
    await sleep(1500);
    const av2 = avatar ? avatar.getBoundingClientRect() : null;
    return {
      inputMoved: JSON.stringify(r1) !== JSON.stringify(r2), r1, r2,
      htmlChanged: htmlLen1 !== htmlLen2, htmlLen1, htmlLen2,
      animations: anims,
      avatar: { first: av1, second: av2, moved: JSON.stringify(av1) !== JSON.stringify(av2) }
    };
  });
  console.log(JSON.stringify(diag, null, 1));

  await page.screenshot({ path: 'profile.png', timeout: 8000 }).then(() => console.log('profile screenshot OK')).catch(e => console.log('profile screenshot FAIL:', e.message.split('\n')[0]));
  await browser.close();
})().catch(e => { console.log('SCRIPT ERR', e.message.split('\n')[0]); process.exit(1); });
