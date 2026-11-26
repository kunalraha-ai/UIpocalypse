import type { Browser, BrowserContext, Page, Route } from 'playwright';
import type { UiConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { createGuard } from '../guard/index.js';
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

export type InvariantSpec = {
  name: string;
  sql: string;
  /** exact end-state check — post-run only, never evaluated mid-run */
  expect?: number;
  /** point-in-time damage predicate — evaluated by race mode and the duplicate_effect sweep */
  atMost?: number;
};

/** Violation rule: atMost is a point-in-time predicate (actual > atMost = damage);
 * expect is an exact end-state check. `expect` invariants are NOT evaluated
 * mid-run — an end-state expectation like "coupon redeemed exactly once" reads
 * 0 before the run redeems it, which is "not yet", not damage. */
export function invariantViolated(inv: { expect?: number; atMost?: number }, actual: number): boolean {
  return inv.atMost !== undefined ? actual > inv.atMost : actual !== (inv.expect ?? 0);
}

/** Only point-in-time (atMost) invariants are valid mid-run. */
const pointInTime = (inv: InvariantSpec) => inv.atMost !== undefined;

export type InvariantResult = {
  name: string;
  sql: string;
  expect?: number;
  atMost?: number;
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
  /**
   * Network barrier (deterministic race reproducer): besides synchronizing
   * the clicks, hold every matching write at the browser's network boundary
   * until all contexts' requests have arrived, then release them in one
   * tick. Matching = non-GET requests on the target origin, narrowed by an
   * optional path substring. Honest limit: arrival simultaneity at the HTTP
   * boundary — transaction interleaving still jitters inside the database.
   */
  barrier?: { pattern?: string; timeoutMs?: number };
};

export type RequestBarrier = {
  intercept: (route: Route, info: { appOrigin: string; pattern?: string }) => void;
  stats: { held: number; released: boolean };
};

/**
 * The network barrier: holds matching requests until `expected` of them have
 * arrived, then releases them together. A timeout releases whatever arrived —
 * a straggler (dead context, failed login) can never deadlock the volley.
 * Pure coordination, no network I/O of its own — unit-testable with fakes.
 */
export function createRequestBarrier(expected: number, timeoutMs: number): RequestBarrier {
  const held: Array<() => void> = [];
  let arrived = 0;
  let released = false;
  const stats = { held: 0, released: false };
  const release = () => {
    if (released) return;
    released = true;
    stats.released = true;
    if (timer) clearTimeout(timer);
    for (const resume of held.splice(0)) resume();
  };
  const timer =
    expected > 0
      ? (() => {
          const t = setTimeout(release, timeoutMs);
          t.unref?.();
          return t;
        })()
      : undefined;
  return {
    stats,
    intercept(route, info) {
      const req = route.request();
      const method = req.method();
      const pass = () => void route.continue().catch(() => {});
      if (released) return pass();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return pass();
      let url: URL;
      try {
        url = new URL(req.url());
      } catch {
        return pass();
      }
      if (url.origin !== info.appOrigin) return pass();
      if (info.pattern && !url.pathname.includes(info.pattern)) return pass();
      if (expected <= 0) return pass();
      held.push(pass);
      stats.held++;
      arrived++;
      if (arrived >= expected) release();
    },
  };
}

export type RaceResult = {
  fired: number;
  /** post-volley invariant results (for logging/telemetry) */
  invariants: InvariantResult[];
  /** invariants that flipped pass → fail across the volley (race-caused) */
  violations: FindingCandidate[];
  /** invariants already failing pre-volley — owned by the duplicate_effect
   * sweep or unrelated to the race; never reported as race_violation */
  preExistingFailures: InvariantResult[];
  /** network barrier stats, when the deterministic reproducer was used */
  barrier?: { held: number };
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

    // pre-volley baseline: an invariant already failing here is swarm damage,
    // not race damage — only pass→fail transitions across the volley count.
    // Only point-in-time (atMost) invariants are valid mid-run.
    const raceInvariants = opts.config.invariants.filter(pointInTime);
    const skippedEndState = opts.config.invariants.length - raceInvariants.length;
    if (skippedEndState > 0) {
      log.info('race skips end-state invariants (post-run only)', { skipped: skippedEndState });
    }
    const baseline = new Map<string, InvariantResult>();
    for (const invariant of raceInvariants) {
      try {
        const result = await deps.runInvariants(invariant);
        baseline.set(result.name, result);
      } catch {
        // unmeasurable baseline → treated as absent; a post-volley failure then
        // lands in preExistingFailures instead of being misattributed
      }
    }

    // pass 2: barrier — arm every ready context against one wall-clock target.
    // With opts.barrier, a SECOND barrier sits at the network boundary: every
    // matching write is held until all contexts' requests have arrived, then
    // released in one tick — the volley hits the server as close to
    // simultaneously as HTTP allows, turning "sometimes it double-fires" into
    // something repeatable enough to measure.
    let requestBarrier: RequestBarrier | undefined;
    if (opts.barrier) {
      let appOrigin = opts.url;
      try {
        appOrigin = new URL(opts.url).origin;
      } catch {
        /* keep the raw url — matching falls through */
      }
      requestBarrier = createRequestBarrier(ready.length, opts.barrier.timeoutMs ?? 5000);
      await Promise.all(
        contexts.map((c) =>
          c.route('**/*', (route) => requestBarrier!.intercept(route, { appOrigin, pattern: opts.barrier?.pattern })),
        ),
      );
      log.info('network barrier armed', {
        expected: ready.length,
        matching: opts.barrier.pattern ?? 'all same-origin writes',
        timeoutMs: opts.barrier.timeoutMs ?? 5000,
      });
    }

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
      return { fired, invariants: [], violations: [], preExistingFailures: [] };
    }

    // baseline was measured BEFORE the volley (below); measure post-volley state.
    // Only pass→fail transitions are race violations — an invariant that was
    // already failing before the volley is swarm damage owned by the
    // duplicate_effect sweep, and must not be attributed to the race.
    const invariants: InvariantResult[] = [];
    const violations: FindingCandidate[] = [];
    const preExistingFailures: InvariantResult[] = [];
    for (const invariant of raceInvariants) {
      try {
        const result = await deps.runInvariants(invariant);
        invariants.push(result);
        if (result.pass) continue;
        if (baseline.get(result.name)?.pass) {
          violations.push({
            type: 'race_violation' as const,
            severity: 'high' as const,
            confidence: 'high' as const,
            evidence: {
              invariant: result.name,
              sql: result.sql,
              expected: result.atMost ?? result.expect,
              actual: result.actual,
              firedAt: `${fired} concurrent "${opts.actionLabel}" against ${opts.url}${requestBarrier ? ` (network barrier: ${requestBarrier.stats.held} request${requestBarrier.stats.held === 1 ? '' : 's'} held and released together)` : ''}`,
            },
            steps: [],
            url: opts.url,
          });
        } else {
          preExistingFailures.push(result);
        }
      } catch (e) {
        opts.logger.warn('invariant check failed to run', { name: invariant.name, error: String(e).slice(0, 150) });
      }
    }

    log.info('race complete', {
      fired,
      violations: violations.length,
      preExistingFailures: preExistingFailures.length,
      barrier: requestBarrier?.stats,
    });
    return { fired, invariants, violations, preExistingFailures, barrier: requestBarrier ? { held: requestBarrier.stats.held } : undefined };
  } finally {
    await Promise.allSettled(contexts.map((c) => c.close()));
  }
}

/**
 * FR-P1: planner-drafted `atMost` invariants join the config's own, after a
 * preflight on the DB (a drafted invariant that already fails on a clean DB
 * is dropped, not reported). Without a reachable allow-listed DB, the drafted
 * invariants are skipped — `duplicate_request` stays the standalone signal.
 */
export async function mergeDraftedInvariants(
  config: UiConfig,
  plan: { invariants: InvariantSpec[] },
  guard: ReturnType<typeof createGuard>,
  logger: Logger,
): Promise<{ config: UiConfig; drafted: number; used: number; dropped: number }> {
  const drafted = plan.invariants.length;
  if (!drafted) return { config, drafted: 0, used: 0, dropped: 0 };
  const dbUrl = dbUrlFromEnv();
  const dbHost = dbUrl ? dbHostFromUrl(dbUrl) : null;
  if (!dbUrl || !dbHost || !guard.checkModes({ dbHost, modes: ['race'] }).allowed) {
    logger.warn('planner-drafted invariants skipped (no reachable allow-listed DB)');
    return { config, drafted, used: 0, dropped: drafted };
  }
  const pre = await preflightInvariants(plan.invariants, pgInvariantRunner(dbUrl));
  for (const d of pre.dropped) {
    logger.warn('planner-drafted invariant dropped (violated before the run)', d);
  }
  const own = new Set(config.invariants.map((i) => i.name));
  const merged = [...config.invariants, ...pre.usable.filter((i) => !own.has(i.name))];
  return { config: { ...config, invariants: merged }, drafted, used: pre.usable.length, dropped: pre.dropped.length };
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
      return { ...invariant, actual, pass: !invariantViolated(invariant, actual) };
    } finally {
      await client.end();
    }
  };
}

/**
 * duplicate_effect attribution (TRD §3.6): a duplicate_request proves a
 * missing submit guard; a FAILING config invariant after the swarm proves the
 * damage actually landed. Only runs when duplicate_request observations exist —
 * an invariant failure with no duplicate writes is not a duplicate effect.
 * Runs BEFORE race mode, so race-volley damage can never be attributed to
 * swarm double-clicks; race mode baselines its own window. Only point-in-time
 * (atMost) invariants are evaluated — an end-state `expect` like "redeemed
 * exactly once" reads "not yet" mid-run, which is not damage.
 */
export async function attributeDuplicateEffects(opts: {
  invariants: InvariantSpec[];
  duplicateRequestCount: number;
  run: InvariantRunner;
}): Promise<InvariantResult[]> {
  if (opts.duplicateRequestCount <= 0) return [];
  const failed: InvariantResult[] = [];
  for (const invariant of opts.invariants.filter(pointInTime)) {
    const result = await opts.run(invariant);
    if (!result.pass) failed.push(result);
  }
  return failed;
}

/**
 * FR-P1 preflight: a planner-drafted `atMost` invariant is only usable if it
 * HOLDS on the database before the run — one that is already violated on a
 * clean DB is a bad invariant, not a finding (review directive). Returns the
 * usable subset plus the dropped ones with their offending values.
 */
export async function preflightInvariants(
  invariants: InvariantSpec[],
  run: InvariantRunner,
): Promise<{ usable: InvariantSpec[]; dropped: Array<{ name: string; actual: number; atMost?: number; error?: string }> }> {
  const usable: InvariantSpec[] = [];
  const dropped: Array<{ name: string; actual: number; atMost?: number; error?: string }> = [];
  for (const inv of invariants.filter(pointInTime)) {
    try {
      const result = await run(inv);
      if (result.pass) usable.push(inv);
      else dropped.push({ name: inv.name, actual: result.actual, atMost: inv.atMost });
    } catch (e) {
      dropped.push({ name: inv.name, actual: -1, error: String(e).slice(0, 120) });
    }
  }
  return { usable, dropped };
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
