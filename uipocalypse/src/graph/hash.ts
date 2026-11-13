import { createHash } from 'node:crypto';

/**
 * State hashing — the pipeline validated in Phase 0 (S2) and re-validated on the
 * held-out app in Phase 2 (100%/100%, no re-tuning). Extraction method:
 * Playwright ariaSnapshot (TRD §4, decided in Phase 0).
 *
 * NOTE: keep in sync with spikes/src/lib/statehash.ts — the spike is the
 * benchmark reference; this is the production copy.
 */

export type Entry = { role: string; name: string };
export type Flags = { dialog: boolean; loading: boolean; auth: boolean };

const INTERACTIVE = new Set([
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

export function hashEntries(entries: Entry[], flags: Flags): string {
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

/** Parse an ariaSnapshot YAML into entries + flags, then hash it. */
export function hashAriaSnapshot(snap: string): { hash: string; flags: Flags } {
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
  const auth = entries.some((e) => e.role === 'button' && /sign out|log out/i.test(e.name))
    ? true
    : entries.some((e) => e.role === 'link' && /sign in|log in/i.test(e.name));
  const flags: Flags = { dialog, loading, auth };
  return { hash: hashEntries(entries, flags), flags };
}

/** Mask dynamic segments of a URL using the app map's known routes (TRD §4 step 1). */
export function normalizeRoute(url: string, routes: string[]): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const path = u.pathname;
  const exact = routes.find((r) => r === path);
  if (exact) return exact;
  const segments = path.split('/').filter(Boolean);
  for (const route of routes) {
    const rSegs = route.split('/').filter(Boolean);
    if (rSegs.length !== segments.length) continue;
    const match = rSegs.every((r, i) => r.startsWith(':') || r.toLowerCase() === segments[i]!.toLowerCase());
    if (match) return route;
  }
  return path;
}
