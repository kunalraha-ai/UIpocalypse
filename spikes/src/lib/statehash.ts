/**
 * Shared state-hashing pipeline (Phase 0 spike S2, reused for held-out
 * validation): normalization per TRD §4, ariaSnapshot vs CDP DOMSnapshot
 * extractors, SHA-1 state hashes.
 */

import type { BrowserContext, Page } from 'playwright';
import { createHash } from 'node:crypto';

export type Entry = { role: string; name: string };
export type Flags = { dialog: boolean; loading: boolean; auth: boolean };
export type Capture = { aria: string; dom: string; ariaMs: number; domMs: number; ariaBytes: number; domBytes: number };

export const INTERACTIVE = new Set([
  'button', 'link', 'textbox', 'searchbox', 'spinbutton', 'checkbox', 'radio', 'switch',
  'combobox', 'listbox', 'option', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'slider',
]);

export function mask(name: string): string {
  return name
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
    .replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?/g, '<date>')
    .replace(/\d+/g, '#')
    .trim();
}

export function bucket(n: number): string {
  if (n <= 1) return String(n);
  if (n <= 5) return '2-5';
  return '6+';
}

export function hashFrom(entries: Entry[], flags: Flags): string {
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

export function flagsFrom(entries: Entry[], dialog: boolean, loading: boolean): Flags {
  const auth = entries.some((e) => e.role === 'button' && /sign out|log out/i.test(e.name))
    ? true
    : entries.some((e) => e.role === 'link' && /sign in|log in/i.test(e.name))
      ? false
      : false;
  return { dialog, loading, auth };
}

export async function ariaCapture(page: Page): Promise<{ entries: Entry[]; flags: Flags; ms: number; bytes: number }> {
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

function inputRole(type: string): string {
  switch (type) {
    case 'checkbox': return 'checkbox';
    case 'radio': return 'radio';
    case 'submit':
    case 'button':
    case 'reset': return 'button';
    case 'search': return 'searchbox';
    default: return 'textbox';
  }
}

export async function domCapture(
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

    const textOf = new Map<number, string>();
    for (let i = 0; i < count; i++) {
      if (nodes.nodeType[i] === 3) {
        const vi = nodeValue[i];
        const text = vi !== undefined && vi >= 0 ? strings[vi] ?? '' : '';
        const p = parentIndex[i] ?? -1;
        if (p >= 0 && text) textOf.set(p, (textOf.get(p) ?? '') + text);
      }
    }

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

      if (role === 'dialog' || (tag === 'dialog' && a['open'] !== undefined)) dialog = true;
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

export async function both(ctx: BrowserContext, page: Page): Promise<Capture> {
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

export type PairScore = {
  sameScreenCollisionRate: number;
  diffScreenSeparationRate: number;
  sameScreenCollided: string[];
  diffScreenCollidedBadly: string[];
  captureMsAvg: number;
  captureBytesAvg: number;
};

export function scoreMethod(
  hashes: Record<string, Capture>,
  method: 'aria' | 'dom',
  samePairs: Array<[string, string]>,
  diffPairs: Array<[string, string]>,
): PairScore {
  const sameOk = samePairs.filter(([a, b]) => hashes[a]![method] === hashes[b]![method]);
  const diffOk = diffPairs.filter(([a, b]) => hashes[a]![method] !== hashes[b]![method]);
  const collidedDiff = diffPairs.filter(([a, b]) => hashes[a]![method] === hashes[b]![method]);
  const timings = Object.values(hashes).map((c) => c[`${method}Ms` as const]);
  const bytes = Object.values(hashes).map((c) => c[`${method}Bytes` as const]);
  return {
    sameScreenCollisionRate: sameOk.length / samePairs.length,
    diffScreenSeparationRate: diffOk.length / diffPairs.length,
    sameScreenCollided: sameOk.map(([a, b]) => `${a}==${b}`),
    diffScreenCollidedBadly: collidedDiff.map(([a, b]) => `${a}==${b}`),
    captureMsAvg: timings.reduce((s, v) => s + v, 0) / timings.length,
    captureBytesAvg: bytes.reduce((s, v) => s + v, 0) / bytes.length,
  };
}
