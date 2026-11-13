/**
 * Spike S2 — State hashing: ariaSnapshot vs CDP DOMSnapshot.
 *
 * Question (IMPLEMENTATION_PLAN.md Phase 0):
 *   Does a normalized accessibility signature give stable hashes for the same
 *   screen and distinct ones for different screens — and which capture method
 *   is better?
 *
 * Acceptance (TRD §4): ≥ 90% of manually labelled "same screen" pairs collide,
 * ≥ 95% of "different screen" pairs don't.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { APP_URL, ALICE, BOB, loginContext } from './lib/app.js';

const RESULTS_DIR = fileURLToPath(new URL('../results/', import.meta.url));

type Entry = { role: string; name: string };
type Flags = { dialog: boolean; loading: boolean; auth: boolean };
type Capture = { aria: string; dom: string; ariaMs: number; domMs: number; ariaBytes: number; domBytes: number };

const INTERACTIVE = new Set([
  'button', 'link', 'textbox', 'searchbox', 'spinbutton', 'checkbox', 'radio', 'switch',
  'combobox', 'listbox', 'option', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'slider',
]);

// ---------------------------------------------------------------- normalization

function mask(name: string): string {
  return name
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
    .replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?/g, '<date>')
    .replace(/\d+/g, '#')
    .trim();
}

function bucket(n: number): string {
  if (n <= 1) return String(n);
  if (n <= 5) return '2-5';
  return '6+';
}

function hashFrom(entries: Entry[], flags: Flags): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const sig = `${e.role}|${mask(e.name)}`;
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }
  const collapsed = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sig, n]) => `${sig} x${bucket(n)}`);
  const flagStr = `flags:dialog=${flags.dialog ? 1 : 0},loading=${flags.loading ? 1 : 0},auth=${flags.auth ? 1 : 0}`;
  const joined = [...collapsed, flagStr].join('\n');
  return createHash('sha1').update(joined).digest('hex').slice(0, 16);
}

function flagsFrom(entries: Entry[], dialog: boolean, loading: boolean): Flags {
  const auth = entries.some((e) => e.role === 'button' && /sign out/i.test(e.name))
    ? true
    : entries.some((e) => e.role === 'link' && /sign in/i.test(e.name))
      ? false
      : false;
  return { dialog, loading, auth };
}

// ---------------------------------------------------------------- extractors

/** Extractor A: Playwright ariaSnapshot (computed accessibility tree, YAML). */
async function ariaCapture(page: Page): Promise<{ entries: Entry[]; flags: Flags; ms: number; bytes: number }> {
  const t0 = performance.now();
  const snap = await page.locator('body').ariaSnapshot();
  const ms = performance.now() - t0;
  const entries: Entry[] = [];
  let dialog = false;
  let loading = false;
  for (const line of snap.split('\n')) {
    const m = line.match(/^\s*- ([a-z][a-z0-9]*)(?: "((?:[^"\\]|\\.)*)")?/);
    if (!m) continue;
    const role = m[1]!;
    const name = m[2] ? m[2].replace(/\\"/g, '"') : '';
    if (role === 'dialog') dialog = true;
    if (role === 'progressbar') loading = true;
    if (INTERACTIVE.has(role)) entries.push({ role, name });
  }
  return { entries, flags: flagsFrom(entries, dialog, loading), ms, bytes: snap.length };
}

/**
 * Extractor B: CDP DOMSnapshot.captureSnapshot, walked into a pseudo-a11y
 * signature (role from explicit attribute or tag mapping, name from
 * aria-label/alt/title/placeholder/element text).
 */
async function domCapture(
  ctx: BrowserContext,
  page: Page,
): Promise<{ entries: Entry[]; flags: Flags; ms: number; bytes: number }> {
  const t0 = performance.now();
  const cdp = await ctx.newCDPSession(page);
  const snap = (await cdp.send('DOMSnapshot.captureSnapshot', {
    computedStyles: [],
  })) as unknown as {
    strings: string[];
    documents: {
      nodes: {
        nodeType: number[];
        nodeName: number[];
        nodeValue?: number[];
        attributes?: number[][];
        parentIndex?: number[];
      };
    }[];
  };
  const ms = performance.now() - t0;
  const bytes = JSON.stringify(snap).length;
  const strings = snap.strings ?? [];
  const nodes = snap.documents[0]?.nodes;
  const entries: Entry[] = [];
  let dialog = false;
  let loading = false;

  if (nodes) {
    const count = nodes.nodeType.length;
    const attrsArr = nodes.attributes ?? [];
    const nodeValue = nodes.nodeValue ?? [];
    const parentIndex = nodes.parentIndex ?? [];

    // Aggregate child text-node content into the parent element's text.
    const textOf = new Map<number, string>();
    for (let i = 0; i < count; i++) {
      if (nodes.nodeType[i] === 3) {
        const vi = nodeValue[i];
        const text = vi !== undefined && vi >= 0 ? strings[vi] ?? '' : '';
        const p = parentIndex[i] ?? -1;
        if (p >= 0 && text) textOf.set(p, (textOf.get(p) ?? '') + text);
      }
    }

    // Per-node attribute map: attributes[i] = [nameIdx, valueIdx, ...] (-1 = valueless).
    const nodeAttrs: Record<string, string>[] = [];
    for (let i = 0; i < count; i++) {
      const map: Record<string, string> = {};
      const flat = attrsArr[i] ?? [];
      for (let k = 0; k + 1 < flat.length; k += 2) {
        const nameIdx = flat[k]!;
        const valIdx = flat[k + 1]!;
        map[strings[nameIdx] ?? ''] = valIdx >= 0 ? strings[valIdx] ?? '' : '';
      }
      nodeAttrs.push(map);
    }

    for (let i = 0; i < count; i++) {
      if (nodes.nodeType[i] !== 1) continue;
      const tag = (strings[nodes.nodeName[i] ?? -1] ?? '').toLowerCase();
      const a = nodeAttrs[i] ?? {};
      if (a['aria-hidden'] === 'true') continue;
      if (a['hidden'] !== undefined) continue;

      const role =
        a['role'] ??
        (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'select' ? 'combobox' : tag === 'textarea' ? 'textbox' : tag === 'input' ? inputRole(a['type'] ?? '') : undefined);
      const name = a['aria-label'] ?? a['alt'] ?? a['title'] ?? a['placeholder'] ?? textOf.get(i)?.trim() ?? '';
      const visibleText = textOf.get(i)?.trim() ?? '';
      const finalName = name || visibleText;

      if (role === 'dialog' || tag === 'dialog') dialog = true;
      if (role === 'progressbar' || a['aria-busy'] === 'true') loading = true;

      if (role && INTERACTIVE.has(role) && finalName) {
        entries.push({ role, name: finalName });
      } else if (role === 'link' && !finalName && a['href']) {
        entries.push({ role, name: '' });
      }
    }
  }

  await cdp.detach();
  return { entries, flags: flagsFrom(entries, dialog, loading), ms, bytes };
}

function inputRole(type: string): string {
  switch (type) {
    case 'checkbox': return 'checkbox';
    case 'radio': return 'radio';
    case 'submit':
    case 'button':
    case 'reset': return 'button';
    case 'search': return 'searchbox';
    case 'email':
    case 'password':
    case 'text':
    case 'number': return 'textbox';
    default: return 'textbox';
  }
}

// ---------------------------------------------------------------- capture flows

async function both(ctx: BrowserContext, page: Page): Promise<Capture> {
  const a = await ariaCapture(page);
  const d = await domCapture(ctx, page);
  return {
    aria: hashFrom(a.entries, a.flags),
    dom: hashFrom(d.entries, d.flags),
    ariaMs: a.ms,
    domMs: d.ms,
    ariaBytes: a.bytes,
    domBytes: d.bytes,
  };
}

async function run() {
  const browser: Browser = await chromium.launch();
  const H: Record<string, Capture> = {};

  // ---- anon home ×3 (reload stability)
  const anonCtx = await browser.newContext();
  const anonPage = await anonCtx.newPage();
  await anonPage.goto(APP_URL);
  H.home1 = await both(anonCtx, anonPage);
  await anonPage.reload();
  H.home2 = await both(anonCtx, anonPage);
  await anonPage.reload();
  H.home3 = await both(anonCtx, anonPage);

  // ---- search results, same screen different content
  await anonPage.goto(APP_URL);
  await anonPage.getByLabel('Search the store').fill('lamp');
  await anonPage.getByRole('button', { name: 'Search' }).click();
  await anonPage.waitForSelector('[aria-label="Search results"]');
  H.searchLamp = await both(anonCtx, anonPage);
  await anonPage.getByLabel('Search the store').fill('chair');
  await anonPage.getByRole('button', { name: 'Search' }).click();
  await anonPage.waitForTimeout(400);
  H.searchChair = await both(anonCtx, anonPage);

  // ---- home after loading recommendations (decoy D2: list added, same screen)
  await anonPage.goto(APP_URL);
  H.homeFresh = await both(anonCtx, anonPage);
  await anonPage.getByRole('button', { name: 'Load recommendations' }).click();
  await anonPage.waitForSelector('[aria-label="Recommendations"]');
  H.homeAfterRecs = await both(anonCtx, anonPage);

  // ---- login page (anon)
  await anonPage.goto(`${APP_URL}/login`);
  H.login = await both(anonCtx, anonPage);
  await anonCtx.close();

  // ---- alice pages
  const aliceCtx = await browser.newContext();
  await loginContext(aliceCtx, ALICE);
  const alicePage = await aliceCtx.newPage();

  await alicePage.goto(`${APP_URL}/profile`);
  H.profileAlice = await both(aliceCtx, alicePage);

  await alicePage.goto(`${APP_URL}/credits`);
  H.creditsAlice = await both(aliceCtx, alicePage);

  await alicePage.goto(`${APP_URL}/checkout`);
  H.checkoutPre = await both(aliceCtx, alicePage);

  // coupon applied — same screen, different visible numbers/message
  await alicePage.getByLabel('Coupon code').fill('WELCOME10');
  await alicePage.getByRole('button', { name: 'Redeem coupon' }).click();
  await alicePage.waitForSelector('text=Coupon applied');
  H.checkoutPost = await both(aliceCtx, alicePage);

  await alicePage.goto(`${APP_URL}/orders`);
  await alicePage.waitForSelector('[role="progressbar"]');
  H.orders1 = await both(aliceCtx, alicePage);
  await alicePage.reload();
  await alicePage.waitForSelector('[role="progressbar"]');
  H.orders2 = await both(aliceCtx, alicePage);

  await alicePage.goto(`${APP_URL}/settings`);
  H.settingsClosed = await both(aliceCtx, alicePage);
  // open dialog without clicking the destructive-labelled button (safety rule)
  await alicePage.evaluate(() => (document.querySelector('dialog') as HTMLDialogElement).showModal());
  H.settingsDialog = await both(aliceCtx, alicePage);
  await alicePage.evaluate(() => (document.querySelector('dialog') as HTMLDialogElement).close());

  // ---- bob pages (same screens, different user)
  const bobCtx = await browser.newContext();
  await loginContext(bobCtx, BOB);
  const bobPage = await bobCtx.newPage();
  await bobPage.goto(`${APP_URL}/profile`);
  H.profileBob = await both(bobCtx, bobPage);
  await bobPage.goto(`${APP_URL}/credits`);
  H.creditsBob = await both(bobCtx, bobPage);
  await bobCtx.close();

  // ---- checkout success, two different orders (same screen)
  for (const key of ['successA', 'successB'] as const) {
    const ctx = await browser.newContext();
    await loginContext(ctx, ALICE);
    const page = await ctx.newPage();
    await page.goto(`${APP_URL}/checkout`);
    await page.getByRole('button', { name: 'Place order' }).click();
    await page.waitForURL('**/checkout/success');
    await page.waitForSelector('text=/Order #/');
    H[key] = await both(ctx, page);
    await ctx.close();
  }

  // ---- alice coupon-redemption side effect check (raciness excluded here)
  await aliceCtx.close();
  await browser.close();

  // ---------------------------------------------------------------- metrics
  const samePairs: [string, string][] = [
    ['home1', 'home2'], ['home1', 'home3'], ['home2', 'home3'],
    ['profileAlice', 'profileBob'],
    ['creditsAlice', 'creditsBob'],
    ['checkoutPre', 'checkoutPost'],
    ['orders1', 'orders2'],
    ['searchLamp', 'searchChair'],
    ['homeFresh', 'homeAfterRecs'],
    ['successA', 'successB'],
  ];
  const diffPages = ['home1', 'login', 'profileAlice', 'creditsAlice', 'checkoutPre', 'orders1', 'settingsClosed', 'settingsDialog', 'successA'];
  const diffPairs: [string, string][] = [];
  for (let i = 0; i < diffPages.length; i++)
    for (let j = i + 1; j < diffPages.length; j++) diffPairs.push([diffPages[i]!, diffPages[j]!]);

  const methods = ['aria', 'dom'] as const;
  const result: Record<string, unknown> = {
    appUrl: APP_URL,
    captured: Object.fromEntries(Object.entries(H).map(([k, v]) => [k, { aria: v.aria, dom: v.dom }])),
    samePairs: samePairs,
    diffPairs: diffPages,
  };

  for (const method of methods) {
    const sameOk = samePairs.filter(([a, b]) => H[a]![method] === H[b]![method]).length;
    const diffOk = diffPairs.filter(([a, b]) => H[a]![method] !== H[b]![method]).length;
    const collided = samePairs.filter(([a, b]) => H[a]![method] === H[b]![method]);
    const collidedDiff = diffPairs.filter(([a, b]) => H[a]![method] === H[b]![method]);
    const timings = Object.values(H).map((c) => c[`${method}Ms` as const]);
    const bytes = Object.values(H).map((c) => c[`${method}Bytes` as const]);
    result[method] = {
      sameScreenCollisionRate: sameOk / samePairs.length,
      diffScreenSeparationRate: diffOk / diffPairs.length,
      sameScreenCollided: collided.map(([a, b]) => `${a}==${b}`),
      diffScreenCollidedBadly: collidedDiff.map(([a, b]) => `${a}==${b}`),
      captureMsAvg: timings.reduce((s, v) => s + v, 0) / timings.length,
      captureBytesAvg: bytes.reduce((s, v) => s + v, 0) / bytes.length,
    };
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, 's2-state-hash.json'), JSON.stringify(result, null, 2));

  console.log('=== Spike S2: state hashing ===');
  for (const method of methods) {
    const r = result[method] as {
      sameScreenCollisionRate: number; diffScreenSeparationRate: number;
      captureMsAvg: number; captureBytesAvg: number;
      sameScreenCollided: string[]; diffScreenCollidedBadly: string[];
    };
    console.log(`\n[${method}]`);
    console.log(`  same-screen collision rate:  ${(r.sameScreenCollisionRate * 100).toFixed(1)}% (gate ≥ 90%)`);
    console.log(`  diff-screen separation rate: ${(r.diffScreenSeparationRate * 100).toFixed(1)}% (gate ≥ 95%)`);
    console.log(`  capture time avg: ${r.captureMsAvg.toFixed(1)} ms, payload avg: ${(r.captureBytesAvg / 1024).toFixed(1)} KB`);
    if (r.sameScreenCollided.length) console.log(`  same-screen pairs that collided: ${r.sameScreenCollided.join(', ')}`);
    if (r.diffScreenCollidedBadly.length) console.log(`  !! different screens that wrongly collided: ${r.diffScreenCollidedBadly.join(', ')}`);
  }
  const gateSame = Math.min(...methods.map((m) => (result[m] as { sameScreenCollisionRate: number }).sameScreenCollisionRate));
  const gateDiff = Math.min(...methods.map((m) => (result[m] as { diffScreenSeparationRate: number }).diffScreenSeparationRate));
  console.log(`\nGATE: collision ${(gateSame * 100).toFixed(0)}% (≥90%), separation ${(gateDiff * 100).toFixed(0)}% (≥95%) → ${gateSame >= 0.9 && gateDiff >= 0.95 ? 'PASS' : 'FAIL'}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
