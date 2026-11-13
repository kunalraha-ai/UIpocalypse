import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { analyze } from '../src/analyzer/analyzer.js';

const SAMPLE_APP = resolve(import.meta.dirname, '..', '..', 'sample-app');

/**
 * Phase 2 deliverable gate: scan_codebase returns real issues on the sample app
 * (≤ 3 s) and detects its planted static bugs (README ground truth):
 * #1 dead-handler, #2 unwired-form, #3 missing-endpoint, #9 missing-rls,
 * #10 unverified-stripe-webhook + the documented undefined-env quirk and the
 * missing-submit-guard fixture.
 */
describe('sample-app integration (Phase 2 deliverable)', () => {
  const started = Date.now();
  const { issues, appMap } = analyze(SAMPLE_APP);
  const tookMs = Date.now() - started;

  const byRule = (rule: string) => issues.filter((i) => i.rule === rule);
  const has = (rule: string, re: RegExp) => byRule(rule).some((i) => re.test(i.message));
  const files = (rule: string) => [...new Set(byRule(rule).map((i) => i.file))].sort();

  it('detects the planted static bugs', () => {
    // bug #1: "Save profile" empty onClick — and nothing else (decoys clean)
    expect(has('dead-handler', /Save profile/)).toBe(true);
    expect(byRule('dead-handler')).toHaveLength(1);
    // bug #2: newsletter form
    expect(byRule('unwired-form')).toHaveLength(1);
    expect(byRule('unwired-form')[0]!.file).toBe('app/page.tsx');
    // bug #3: fetch('/api/promo') → 404
    expect(has('missing-endpoint', /api\/promo/)).toBe(true);
    expect(byRule('missing-endpoint')).toHaveLength(1);
    // bug #9: profiles table without RLS (and only that table)
    expect(has('missing-rls', /profiles/)).toBe(true);
    expect(byRule('missing-rls')).toHaveLength(1);
    // bug #10: stripe webhook without signature verification
    expect(byRule('unverified-stripe-webhook').map((i) => i.file)).toContain(
      'app/api/stripe/webhook/route.ts',
    );
    expect(byRule('unverified-stripe-webhook')).toHaveLength(1);
    // documented quirk: ORDERS_API_KEY read but never defined
    expect(has('undefined-env', /ORDERS_API_KEY/)).toBe(true);
    expect(byRule('undefined-env')).toHaveLength(1);
  });

  it('flags the true extras precisely (all verifiable defects)', () => {
    // writes with no pending guard: the planted Buy credits fixture + checkout,
    // login, and the destructive delete (double-click hazard) — all true
    expect(files('no-loading-state')).toEqual([
      'components/BuyCredits.tsx',
      'components/Checkout.tsx',
      'components/LoginForm.tsx',
      'components/SettingsPanel.tsx',
    ]);
    // awaits with no error handling at all
    expect(files('no-error-state')).toEqual(['components/Recommendations.tsx', 'components/SettingsPanel.tsx']);
  });

  it('does not fire the secret rules on the sample app (FP gate)', () => {
    expect(byRule('exposed-secret')).toHaveLength(0);
    expect(byRule('service-key-in-client')).toHaveLength(0);
  });

  it('extracts the stack and routes into the app map', () => {
    expect(appMap.framework).toBe('next-app');
    expect(appMap.stack).toContain('supabase');
    expect(appMap.routes.some((r) => r.kind === 'api' && r.path === '/api/promo')).toBe(false); // missing by design
    expect(appMap.routes.some((r) => r.kind === 'api' && r.path === '/api/checkout')).toBe(true);
    expect(appMap.routes.some((r) => r.kind === 'page' && r.path === '/profile')).toBe(true);
  });

  it('scans within the 3 s budget (FR-A5)', () => {
    expect(appMap.fileCount).toBeGreaterThan(10);
    expect(tookMs).toBeLessThan(3000);
  });
});
