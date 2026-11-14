import type { Browser, BrowserContext, Page } from 'playwright';
import type { UiConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { FindingCandidate } from './detectors.js';
import { RUNTIME_SOURCE } from '../runtime/runtime-source.js';

/**
 * Race mode (TRD FR-W4): M contexts synchronize on a barrier and fire the
 * same write action at the same instant (scheduled inside each page), then
 * invariant SQL from the config is checked. Gated by the Safety Guard's DB
 * check (G4) — the caller must have passed checkModes(['race']).
 *
 * Invariants run against Postgres (Supabase local: postgres://...:54322) via
 * `pg`; the connection URL comes from SUPABASE_DB_URL / DATABASE_URL.
 */

export type InvariantSpec = { name: string; sql: string; expect: number };

export type InvariantResult = {
  name: string;
  sql: string;
  expect: number;
  actual: number;
  pass: boolean;
};

export type InvariantRunner = (invariant: InvariantSpec) => Promise<InvariantResult>;

export type RaceOptions = {
  url: string;
  actionLabel: string;
  /** value to fill text inputs with before firing (e.g. the coupon code) */
  input?: string;
  contexts?: number; // default 20
  config: UiConfig;
  logger: Logger;
  abort?: AbortSignal;
  /** per-context setup (e.g. log in) before navigating to the race URL */
  setup?: (ctx: BrowserContext) => Promise<void>;
};

export type RaceResult = {
  fired: number;
  invariants: InvariantResult[];
  violations: FindingCandidate[];
};

export async function runRace(
  browser: Browser,
  opts: RaceOptions,
  deps: { runInvariants: InvariantRunner },
): Promise<RaceResult> {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const m = Math.min(opts.contexts ?? 20, 50);
  const log = opts.logger.child({ phase: 'race' });
  log.info('race preparing', { m, url: opts.url, action: opts.actionLabel });

  try {
    // pass 1: prepare every context — navigate, enumerate, fill inputs
    const ready: Array<{ page: Page; id: number }> = [];
    for (let i = 0; i < m; i++) {
      const ctx = await browser.newContext();
      await ctx.addInitScript(RUNTIME_SOURCE);
      contexts.push(ctx);
      if (opts.setup) {
        await opts.setup(ctx).catch((e) => log.warn('race setup failed', { i, error: String(e).slice(0, 120) }));
      }
      const page = await ctx.newPage();
      pages.push(page);
      await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(300);
      const actions = await page.evaluate(() => window.__uip.getActions());
      const target = actions.find(
        (a: { name: string }) => a.name.toLowerCase() === opts.actionLabel.toLowerCase(),
      );
      if (!target) {
        log.warn('race context cannot find target', { i, action: opts.actionLabel });
        continue;
      }
      if (opts.input) {
        for (const a of actions) {
          if (a.textLike) {
            await page
              .evaluate(
                ({ id, value }: { id: number; value: string }) =>
                  window.__uip.perform(id, { input: value, waitMs: 10 }),
                { id: a.id, value: opts.input },
              )
              .catch(() => {});
          }
        }
      }
      ready.push({ page, id: target.id });
    }

    // pass 2: barrier — arm every ready context against one wall-clock target
    const barrierAt = Date.now() + 500;
    await Promise.all(
      ready.map(({ page, id }) =>
        page
          .evaluate(
            ({ id, delta }: { id: number; delta: number }) => window.__uip.raceFire(id, delta),
            { id, delta: Math.max(0, barrierAt - Date.now()) },
          )
          .catch(() => {}),
      ),
    );
    const fired = ready.length;
    await new Promise((r) => setTimeout(r, 4000)); // let the volley land

    // invariants are only meaningful if the volley actually happened —
    // a race that never fired must not be misread as a violation
    if (fired < 2) {
      log.warn('race did not fire — skipping invariant checks', { fired });
      return { fired, invariants: [], violations: [] };
    }

    // invariant checks
    const invariants: InvariantResult[] = [];
    for (const invariant of opts.config.invariants) {
      try {
        const result = await deps.runInvariants(invariant);
        invariants.push(result);
      } catch (e) {
        opts.logger.warn('invariant check failed to run', { name: invariant.name, error: String(e).slice(0, 150) });
      }
    }

    const violations: FindingCandidate[] = invariants
      .filter((i) => !i.pass)
      .map((i) => ({
        type: 'race_violation' as const,
        severity: 'high' as const,
        confidence: 'high' as const,
        evidence: {
          invariant: i.name,
          sql: i.sql,
          expected: i.expect,
          actual: i.actual,
          firedAt: `${fired} concurrent "${opts.actionLabel}" against ${opts.url}`,
        },
        steps: [],
        url: opts.url,
      }));

    log.info('race complete', { fired, violations: violations.length });
    return { fired, invariants, violations };
  } finally {
    await Promise.allSettled(contexts.map((c) => c.close()));
  }
}

/** Postgres-backed invariant runner (Supabase local default). */
export function pgInvariantRunner(dbUrl: string): InvariantRunner {
  return async (invariant) => {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      const res = await client.query(invariant.sql);
      const row = res.rows[0] ?? {};
      const actual = Number(Object.values(row)[0] ?? 0);
      return { ...invariant, actual, pass: actual === invariant.expect };
    } finally {
      await client.end();
    }
  };
}

export function dbUrlFromEnv(env: Record<string, string | undefined> = process.env): string | null {
  return env.SUPABASE_DB_URL ?? env.DATABASE_URL ?? null;
}

export function dbHostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
