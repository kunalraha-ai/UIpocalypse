import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { analyze } from '../src/analyzer/analyzer.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'mini-app');

describe('static rule library (TRD §8, first 10 rules) — fixture mini-app', () => {
  const { issues } = analyze(FIXTURE);
  const byRule = (rule: string) => issues.filter((i) => i.rule === rule);
  const has = (rule: string, re: RegExp) => byRule(rule).some((i) => re.test(i.message));
  const files = (rule: string) => new Set(byRule(rule).map((i) => i.file));

  it('dead-handler: empty onClick fires; real and decorative buttons do not', () => {
    expect(has('dead-handler', /Dead button/)).toBe(true);
    expect(has('dead-handler', /Alive button/)).toBe(false);
    expect(has('dead-handler', /✦/)).toBe(false); // aria-hidden decorative button is excluded
    expect(byRule('dead-handler')).toHaveLength(1);
  });

  it('unwired-form fires only on the unhandled form', () => {
    expect(has('unwired-form', /Newsletter/)).toBe(true);
    expect(has('unwired-form', /Working/)).toBe(false);
    expect(byRule('unwired-form')).toHaveLength(1);
  });

  it('missing-endpoint fires only for unresolved paths', () => {
    expect(has('missing-endpoint', /api\/missing/)).toBe(true);
    expect(byRule('missing-endpoint')).toHaveLength(1);
  });

  it('missing-rls fires for the unguarded table only', () => {
    expect(has('missing-rls', /no_rls/)).toBe(true);
    expect(has('missing-rls', /yes_rls/)).toBe(false);
    expect(byRule('missing-rls')).toHaveLength(1);
  });

  it('service-key-in-client fires in client-reachable code', () => {
    expect(files('service-key-in-client')).toContain('lib/secrets.ts');
  });

  it('undefined-env fires for undeclared vars only', () => {
    expect(has('undefined-env', /TOTALLY_MISSING/)).toBe(true);
    expect(has('undefined-env', /DEFINED_VAR/)).toBe(false);
  });

  it('unverified-stripe-webhook fires on the unverified route only', () => {
    expect(files('unverified-stripe-webhook')).toContain('app/api/webhook-bad/route.ts');
    expect(byRule('unverified-stripe-webhook')).toHaveLength(1);
  });

  it('no-error-state fires where there is no error handling', () => {
    expect(files('no-error-state')).toContain('components/bad-submit.tsx');
    expect(files('no-error-state')).toContain('components/bad-async.tsx');
    expect(files('no-error-state')).toContain('app/page.tsx'); // fire-and-forget fetch
    expect(files('no-error-state')).not.toContain('components/good-submit.tsx');
  });

  it('no-loading-state fires only for unguarded POST submits', () => {
    expect(files('no-loading-state')).toContain('components/bad-submit.tsx');
    expect(files('no-loading-state')).not.toContain('components/good-submit.tsx');
    expect(files('no-loading-state')).not.toContain('components/bad-async.tsx'); // GET is not a submit
    expect(byRule('no-loading-state')).toHaveLength(1);
  });

  it('exposed-secret fires on hardcoded live keys', () => {
    expect(files('exposed-secret')).toContain('lib/secrets.ts');
    expect(byRule('exposed-secret')).toHaveLength(1);
  });

  // ------------------------------------------------ Phase 5 rules (11–15)

  it('permissive-rls fires on using (true), not on scoped policies', () => {
    expect(byRule('permissive-rls')).toHaveLength(1);
    expect(has('permissive-rls', /yes_rls/)).toBe(true);
    expect(has('permissive-rls', /auth\.uid/)).toBe(false);
  });

  it('unauth-write-route fires only on the unauthenticated write endpoint', () => {
    expect(files('unauth-write-route')).toContain('app/api/write-noauth/route.ts');
    expect(files('unauth-write-route')).not.toContain('app/api/write-auth/route.ts');
    // auth endpoints are unauthenticated by design — never flagged
    expect(files('unauth-write-route')).not.toContain('app/api/auth/login/route.ts');
    expect(byRule('unauth-write-route')).toHaveLength(1);
  });

  it('no-rate-limit-auth fires on the bare login, not on the limited signup', () => {
    expect(files('no-rate-limit-auth')).toContain('app/api/auth/login/route.ts');
    expect(files('no-rate-limit-auth')).not.toContain('app/api/auth/signup/route.ts');
    expect(byRule('no-rate-limit-auth')).toHaveLength(1);
  });

  it('missing-submit-guard fires on the unguarded write, not on the pending-disabled one', () => {
    expect(files('missing-submit-guard')).toContain('components/bad-submit.tsx');
    expect(files('missing-submit-guard')).not.toContain('components/good-submit.tsx');
    // GET-only components and route files never fire
    expect(byRule('missing-submit-guard')).toHaveLength(1);
  });

  it('missing-meta fires when the app has no root layout metadata (the mini-app has none)', () => {
    expect(byRule('missing-meta')).toHaveLength(1);
    expect(has('missing-meta', /root layout|No root layout/i)).toBe(true);
  });

  it('FP gates from the real-repo audit (vercel/commerce, shadcn/taxonomy, supabase user-management)', () => {
    // disabled controls are intentionally inert — not dead
    expect(has('dead-handler', /Coming soon/)).toBe(false);
    // disabled attr (shadcn/taxonomy mode-toggle class, supabase account-form email)
    expect(has('dead-handler', /Invisible submit/)).toBe(false); // type="submit" machinery
    expect(has('dead-handler', /UiWrapper/)).toBe(false); // {...props} spread (taxonomy ui/button)
    // forms without a submit control (skeletons, radio filter groups) never submit — not unwired
    expect(has('unwired-form', /Skeleton/)).toBe(false);
    // formAction server actions wire the form (supabase user-management login)
    expect(has('unwired-form', /ServerActions/)).toBe(false);
    // platform-injected env vars are always present at runtime
    expect(has('undefined-env', /NODE_ENV/)).toBe(false);
    expect(has('undefined-env', /VERCEL/)).toBe(false);
    expect(has('undefined-env', /PORT/)).toBe(false);
    expect(has('undefined-env', /FIGMA_PUBLIC_URL/)).toBe(false);
  });

  it('serverless catch-all routes (api/v1/[...path].ts) resolve /api/v1/* fetches (real-app eval)', () => {
    // the fixture fetches /api/v1/auth/google/start — served by the catch-all
    expect(has('missing-endpoint', /api\/v1\/auth/)).toBe(false);
    // genuinely missing endpoints still fire (the catch-all is scoped to /api/v1)
    expect(has('missing-endpoint', /api\/missing/)).toBe(true);
    expect(byRule('missing-endpoint')).toHaveLength(1);
  });
});
