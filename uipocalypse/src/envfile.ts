import { existsSync, readFileSync } from 'node:fs';

/** Minimal .env loader (KEY=VALUE lines, no interpolation) — no dependency needed. */
export function loadDotEnv(paths: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of paths) {
    if (!p || !existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !m[1]!.startsWith('#')) out[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
    }
  }
  return out;
}
