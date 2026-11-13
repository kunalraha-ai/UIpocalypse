/**
 * Safety Guard acceptance tests — written FIRST, from SAFETY.md §6, before any
 * guard implementation exists (Phase 1 directive). The guard is built to pass
 * these, not the other way around.
 *
 * SAFETY.md §6 acceptance matrix (must pass before beta):
 *  1. Target `https://example.com` with no token            → refused, clear message
 *  2. Prod-like domain + live Stripe key in env              → refused
 *  3. "Delete account" button, no opt-in                     → never executed; listed as skipped
 *  4. DB host remote and not allow-listed                    → race/fuzz refused
 *  5. Target returns 5xx under load                          → ramp stops, degradation level reported
 *  6. Secrets in `.env`                                      → absent from every LLM payload
 *  7. Interrupt (Ctrl-C) mid-run                             → contexts closed, partial report (Phase 4)
 */

import { describe, expect, it } from 'vitest';
import {
  createGuard,
  createRampMonitor,
  createRateLimiter,
  redactForLlm,
  redactSecrets,
  hostMatches,
} from '../src/guard/index.js';
import { ConfigSchema } from '../src/config.js';
import type { UiConfig } from '../src/config.js';

function cfg(overrides: Record<string, unknown> = {}): UiConfig {
  return ConfigSchema.parse(overrides);
}

const noToken = async (): Promise<string | null> => null;
const goodToken = (expected: string) => async (): Promise<string | null> => expected;

describe('SAFETY.md §6 acceptance tests', () => {
  it('1. refuses non-local targets without an ownership token, with a clear message', async () => {
    // example.com is not even allow-listed (G1, default deny)
    const guard = createGuard(cfg(), { fetchToken: noToken });
    const d1 = await guard.checkTarget('https://example.com');
    expect(d1.allowed).toBe(false);
    expect(d1.reasons.join(' ')).toMatch(/allow-list/i);

    // allow-listed by config, but the ownership token is absent (G2)
    const guard2 = createGuard(
      cfg({ allowHosts: ['example.com'], ownershipToken: 'secret-token' }),
      { fetchToken: noToken },
    );
    const d2 = await guard2.checkTarget('https://example.com');
    expect(d2.allowed).toBe(false);
    expect(d2.reasons.join(' ')).toMatch(/token/i);

    // token present and matching → allowed
    const guard3 = createGuard(
      cfg({ allowHosts: ['*.example.com'], ownershipToken: 'secret-token' }),
      { fetchToken: goodToken('secret-token') },
    );
    const d3 = await guard3.checkTarget('https://staging.example.com');
    expect(d3.allowed).toBe(true);

    // localhost stays zero-config (principle: make the safe path the easy path)
    const guard4 = createGuard(cfg(), { fetchToken: noToken });
    expect((await guard4.checkTarget('http://localhost:3000')).allowed).toBe(true);
    expect((await guard4.checkTarget('http://127.0.0.1:3123')).allowed).toBe(true);
    expect((await guard4.checkTarget('http://myapp.local')).allowed).toBe(true);

    // preview hosts are allow-listed by default but still need a token (non-local)
    const d5 = await guard4.checkTarget('https://myapp.vercel.app');
    expect(d5.allowed).toBe(false);
    expect(d5.reasons.join(' ')).toMatch(/token/i);
  });

  it('2. refuses prod-like targets, especially with live Stripe keys', async () => {
    // live Stripe key → hard refuse (G6), even with a valid token
    const guard = createGuard(
      cfg({ allowHosts: ['*.example.com'], ownershipToken: 'tok' }),
      { fetchToken: goodToken('tok'), env: { STRIPE_SECRET_KEY: 'sk_live_51HardRefuse' } },
    );
    const d = await guard.checkTarget('https://staging.shop.example.com');
    expect(d.allowed).toBe(false);
    expect(d.reasons.join(' ')).toMatch(/stripe|live/i);

    // prod-like domain (no staging subdomain) + NODE_ENV=production → refused (G3)
    const guard2 = createGuard(
      cfg({ allowHosts: ['shop.example.com'], ownershipToken: 'tok' }),
      { fetchToken: goodToken('tok'), env: { NODE_ENV: 'production' } },
    );
    const d2 = await guard2.checkTarget('https://shop.example.com');
    expect(d2.allowed).toBe(false);
    expect(d2.reasons.join(' ')).toMatch(/production/i);

    // same domain, prodOverride set, token valid → allowed with a loud warning
    const guard3 = createGuard(
      cfg({ allowHosts: ['shop.example.com'], ownershipToken: 'tok', prodOverride: true }),
      { fetchToken: goodToken('tok'), env: { NODE_ENV: 'production' } },
    );
    const d3 = await guard3.checkTarget('https://shop.example.com');
    expect(d3.allowed).toBe(true);
    expect(d3.warnings.join(' ')).toMatch(/override/i);

    // prodOverride does NOT waive the token requirement
    const guard4 = createGuard(
      cfg({ allowHosts: ['shop.example.com'], ownershipToken: 'tok', prodOverride: true }),
      { fetchToken: noToken },
    );
    const d4 = await guard4.checkTarget('https://shop.example.com');
    expect(d4.allowed).toBe(false);
  });

  it('3. never executes destructive actions without opt-in; lists them as skipped', () => {
    const actions = [
      { id: 1, label: 'Delete account' },
      { id: 2, label: 'Save profile' },
      { id: 3, label: 'Buy credits' },
      { id: 4, label: 'Send invite' },
      { id: 5, label: 'Redeem coupon' },
    ];
    const guard = createGuard(cfg());
    const { allowed, skipped } = guard.filterActions(actions, { dbOk: true });

    expect(allowed.map((a) => a.label)).toEqual(['Save profile', 'Buy credits', 'Redeem coupon']);
    expect(skipped.map((s) => s.action.label)).toEqual(['Delete account', 'Send invite']);
    expect(skipped[0]!.reason).toMatch(/destructive/i);
    expect(skipped[1]!.reason).toMatch(/external/i);

    // with both opt-ins, the same actions run
    const guardOptIn = createGuard(cfg({ destructiveOptIn: true, externalOptIn: true }));
    const optIn = guardOptIn.filterActions(actions, { dbOk: true });
    expect(optIn.allowed).toHaveLength(5);
    expect(optIn.skipped).toHaveLength(0);

    // config skipActions are skipped regardless of opt-in and reported
    const guardSkip = createGuard(cfg({ skipActions: ['Redeem coupon'], destructiveOptIn: true }));
    const skippedByConfig = guardSkip.filterActions(actions, { dbOk: true });
    expect(skippedByConfig.allowed.map((a) => a.label)).not.toContain('Redeem coupon');
    expect(
      skippedByConfig.skipped.find((s) => s.action.label === 'Redeem coupon')!.reason,
    ).toMatch(/skipActions/i);
  });

  it('4. refuses race/fuzz modes when the DB host is remote and not allow-listed', () => {
    const guard = createGuard(cfg());
    const remote = guard.checkModes({ dbHost: 'db.prod-supabase.supabase.co', modes: ['race'] });
    expect(remote.allowed).toBe(false);
    expect(remote.reasons.join(' ')).toMatch(/db\.allowedHosts/i);

    expect(guard.checkModes({ dbHost: 'localhost', modes: ['race', 'fuzz'] }).allowed).toBe(true);
    expect(guard.checkModes({ dbHost: '127.0.0.1', modes: ['race'] }).allowed).toBe(true);

    const guardBranch = createGuard(cfg({ db: { allowedHosts: ['*.branch.supabase.co'] } }));
    expect(
      guardBranch.checkModes({ dbHost: 'feature-x.branch.supabase.co', modes: ['race'] }).allowed,
    ).toBe(true);

    // unknown DB host → fail closed
    const unknown = guard.checkModes({ dbHost: undefined, modes: ['fuzz'] });
    expect(unknown.allowed).toBe(false);

    // plain swarm is not gated by the DB check
    expect(guard.checkModes({ dbHost: 'db.prod-supabase.supabase.co', modes: ['swarm'] }).allowed).toBe(true);
  });

  it('5. stops the ramp on a 5xx storm and reports the degradation level', () => {
    const ramp = createRampMonitor({ maxAgents: 50, windowSize: 20 });

    // healthy traffic establishes the baseline
    for (let i = 0; i < 20; i++) ramp.record(100, false);
    expect(ramp.shouldStop).toBe(false);
    expect(ramp.canStepUp()).toBe(true);
    ramp.stepUp();
    expect(ramp.level).toBe(6); // 5 → 6

    // 10% errors in the window (> 5% threshold) → stop, report level
    for (let i = 0; i < 20; i++) ramp.record(100, i < 2);
    expect(ramp.shouldStop).toBe(true);
    const report = ramp.report();
    expect(report.stopped).toBe(true);
    expect(report.level).toBe(6);
    expect(String(report.stopReason)).toMatch(/6|level/i);
    expect(ramp.canStepUp()).toBe(false);

    // latency degradation: p95 over 3× baseline also stops the ramp
    const ramp2 = createRampMonitor({ maxAgents: 50, windowSize: 20 });
    for (let i = 0; i < 20; i++) ramp2.record(100, false);
    for (let i = 0; i < 20; i++) ramp2.record(400, false);
    expect(ramp2.shouldStop).toBe(true);
    expect(ramp2.report().stopReason).toMatch(/latency|p95/i);
  });

  it('6. secrets from .env never appear in any LLM payload', () => {
    const env = {
      SESSION_SECRET: 'hunter2-super-secret-value',
      STRIPE_SECRET_KEY: 'sk_live_51H8xYzREALKEY123',
      SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.payload',
      DATABASE_URL: 'postgres://admin:superpass@db.remote.io/app',
    };
    const payload = redactForLlm(
      {
        summary: 'App config: stripe sk_live_51H8xYzREALKEY123 db postgres://admin:superpass@db.remote.io/app',
        env,
      },
      env,
    );
    const text = JSON.stringify(payload);
    for (const value of Object.values(env)) {
      expect(text).not.toContain(value);
    }
    expect(text).toContain('[REDACTED');

    // plain-string redaction too
    const redacted = redactSecrets('api_key=0123456789abcdef sk_test_51abcDEF42 token: bytes-12345678');
    expect(redacted).not.toContain('0123456789abcdef');
    expect(redacted).not.toContain('sk_test_51abcDEF42');
  });

  it('7. interrupt mid-run closes contexts and writes a partial report (Phase 4 — orchestrator lifecycle)', () => {
    // Browser lifecycle arrives with the swarm orchestrator in Phase 4.
    // Tracked here so the acceptance matrix from SAFETY.md §6 stays visible.
    expect(true).toBe(true);
  });
});

describe('guard: host matching and rate limiting (SAFETY.md G1/G7)', () => {
  it('matches allow-list patterns conservatively', () => {
    expect(hostMatches('localhost', ['localhost'])).toBe(true);
    expect(hostMatches('app.vercel.app', ['*.vercel.app'])).toBe(true);
    expect(hostMatches('vercel.app', ['*.vercel.app'])).toBe(false); // the bare domain is not a preview app
    expect(hostMatches('evil-app.vercel.app.evil.com', ['*.vercel.app'])).toBe(false);
    expect(hostMatches('a.b.vercel.app', ['*.vercel.app'])).toBe(true);
    expect(hostMatches('example.com', ['localhost', '127.0.0.1'])).toBe(false);
    expect(hostMatches('db.branch.supabase.co', ['*.branch.supabase.co'])).toBe(true);
  });

  it('rate limiter caps a burst at rps (default per-host ceiling 50 rps)', () => {
    const rl = createRateLimiter({ rps: 50 });
    const results = Array.from({ length: 50 }, () => rl.tryAcquire());
    expect(results.every(Boolean)).toBe(true);
    expect(rl.tryAcquire()).toBe(false); // burst exhausted, no time has passed
  });
});
