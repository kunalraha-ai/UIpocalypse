const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();
  const tryCookie = async (label, value) => {
    const c2 = await browser.newContext();
    await c2.addCookies([{ name: 'session', value, url: BASE }]);
    const p2 = await c2.newPage();
    await p2.goto(BASE + '/profile'); await p2.waitForTimeout(400);
    const t = await p2.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));
    let api = '';
    try { const r = await p2.evaluate(async () => { const x = await fetch('/api/orders'); return `${x.status} ${(await x.text()).slice(0,40)}`; }); api = r; } catch(e) { api = e.message.split('\n')[0]; }
    const verdict = t.includes('Balance') ? `AUTHED(${t.match(/\b[A-Z]{2}\b/)?.[0] || '?'})` : 'rejected';
    console.log(`${label}: page=${verdict} api=${api}`);
    await c2.close();
  };
  const uid = '00000000-0000-0000-0000-000000000001';
  const sig = '7c521eea3d279da4';
  await tryCookie('original           ', `${uid}.${sig}`);
  await tryCookie('bad sig            ', `${uid}.deadbeefdeadbeef`);
  await tryCookie('no sig             ', uid);
  await tryCookie('uid2 + alice sig    ', `00000000-0000-0000-0000-000000000002.${sig}`);
  await tryCookie('uid3 + alice sig    ', `00000000-0000-0000-0000-000000000003.${sig}`);
  await tryCookie('plain "1"          ', '1');
  await tryCookie('"1." + alice sig    ', `1.${sig}`);
  await tryCookie('alice sig alone     ', sig);
  await tryCookie('empty               ', '');
  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
