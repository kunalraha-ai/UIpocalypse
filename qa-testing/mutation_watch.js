const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + '/login');
  await page.getByRole('button', { name: 'Sign in as Alice' }).click();
  await page.waitForTimeout(600);
  await page.goto(BASE + '/profile');
  await page.waitForTimeout(500);

  const report = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let added = 0, removed = 0, domMutations = 0;
    const inputPresent = [];
    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        domMutations++;
        m.addedNodes.forEach(n => { if (n.nodeName === 'INPUT' || (n.querySelectorAll && n.querySelectorAll('input').length)) added++; });
        m.removedNodes.forEach(n => { if (n.nodeName === 'INPUT' || (n.querySelectorAll && n.querySelectorAll('input').length)) removed++; });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    for (let i = 0; i < 20; i++) { inputPresent.push(!!document.querySelector('input[type=text]')); await sleep(100); }
    mo.disconnect();
    return { added, removed, domMutations, presentPattern: inputPresent.map(x => x ? 1 : 0).join('') };
  });
  console.log('2 seconds on /profile:', JSON.stringify(report, null, 1));

  // same watch on /credits for comparison
  await page.goto(BASE + '/credits');
  await page.waitForTimeout(500);
  const report2 = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let domMutations = 0;
    const mo = new MutationObserver(muts => { domMutations += muts.length; });
    mo.observe(document.body, { childList: true, subtree: true });
    await sleep(2000);
    mo.disconnect();
    return { domMutations };
  });
  console.log('2 seconds on /credits:', JSON.stringify(report2));

  // user impact: focus + type + check focus retention
  await page.goto(BASE + '/profile');
  await page.waitForTimeout(500);
  const impact = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const input = document.querySelector('input[type=text]');
    if (!input) return 'input missing at start';
    input.focus();
    const before = document.activeElement === input;
    let stillFocused = true;
    for (let i = 0; i < 10; i++) {
      await sleep(200);
      if (document.activeElement !== input) { stillFocused = false; break; }
    }
    return { hadFocus: before, keptFocus2s: stillFocused };
  });
  console.log('focus retention:', JSON.stringify(impact));
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
