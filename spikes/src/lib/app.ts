import type { BrowserContext } from 'playwright';

export const APP_URL = process.env.APP_URL ?? 'http://localhost:3123';

export const ALICE = { email: 'alice@example.com', password: 'secret123' };
export const BOB = { email: 'bob@example.com', password: 'secret123' };

/** Log a context in via the API so its cookie jar carries the session. */
export async function loginContext(ctx: BrowserContext, creds = ALICE) {
  const r = await ctx.request.post(`${APP_URL}/api/auth/login`, { data: creds });
  if (!r.ok()) throw new Error(`login failed: ${r.status()} ${await r.text()}`);
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}
