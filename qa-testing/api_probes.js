const { chromium } = require('playwright');
const BASE = 'http://localhost:3124';
(async () => {
  const browser = await chromium.launch();

  // ---------- Unauthenticated API access ----------
  let ctx = await browser.newContext();
  let page = await ctx.newPage();
  await page.goto(BASE + '/login');
  const unauth = await page.evaluate(async () => {
    const tries = [
      ['GET', '/api/orders'], ['GET', '/api/search?q=lamp'], ['GET', '/api/recommendations'],
      ['GET', '/api/promo'], ['GET', '/api/profile'], ['GET', '/api/credits'],
      ['POST', '/api/credits/buy', {pack: 'p5'}],
      ['POST', '/api/checkout', {}],
      ['POST', '/api/coupon/redeem', {code: 'WELCOME10'}],
      ['POST', '/api/account/delete', {}],
      ['POST', '/api/auth/logout', {}],
    ];
    const out = [];
    for (const [m, u, body] of tries) {
      const r = await fetch(u, { method: m, headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined });
      out.push(`${m} ${u} -> ${r.status} ${(await r.text()).slice(0, 80)}`);
    }
    return out;
  });
  console.log('=== UNAUTHENTICATED API ==='); unauth.forEach(l => console.log(l));

  // ---------- Cookie tampering ----------
  const alice = await ctx.newPage();
  // login as alice in a page to get a valid cookie, then read it
  await alice.goto(BASE + '/login');
  await alice.getByRole('button', { name: 'Sign in as Alice' }).click();
  await alice.waitForTimeout(700);
  const cookies = await ctx.cookies();
  const session = cookies.find(c => c.name === 'session');
  console.log('\nvalid alice session cookie:', session.value);

  // tampered contexts
  const tryCookie = async (label, value) => {
    const c2 = await browser.newContext();
    await c2.addCookies([{ name: 'session', value, url: BASE }]);
    const p2 = await c2.newPage();
    const res = await p2.evaluate(async () => {
      const r = await fetch('/api/orders');
      return `${r.status} ${(await r.text()).slice(0, 60)}`;
    });
    // also check profile page render
    await p2.goto(BASE + '/profile');
    const who = await p2.evaluate(() => {
      const t = document.body.innerText;
      if (t.includes('Balance')) return t.match(/Initials|\b[A-Z]{2}\b/)?.[0] || 'authed';
      return 'LOGIN PAGE (rejected)';
    });
    console.log(`${label}: api=${res} page=${who}`);
    await c2.close();
  };
  const [uid, sig] = session.value.split('.');
  await tryCookie('original cookie          ', session.value);
  await tryCookie('bad signature           ', uid + '.deadbeefdeadbeef');
  await tryCookie('missing signature       ', uid);
  await tryCookie('swap uid -> 2 (Bob id)  ', '00000000-0000-0000-0000-000000000002.' + sig);
  await tryCookie('swap uid -> 3           ', '00000000-0000-0000-0000-000000000003.' + sig);
  await tryCookie('empty value             ', '');
  await tryCookie('garbage                 ', 'admin');
  await tryCookie('uid 1 + empty sig       ', uid + '.');

  await browser.close();
})().catch(e => { console.log('ERR', e.message.split('\n')[0]); process.exit(1); });
