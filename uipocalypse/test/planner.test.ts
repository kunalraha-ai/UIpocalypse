import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeLlm, createLlm } from '../src/llm/index.js';
import { createPlan, loadPlan, planHash } from '../src/plan/planner.js';
import { PlanSchema } from '../src/plan/schema.js';
import type { AppMap } from '../src/analyzer/types.js';

const appMap = {
  framework: 'next-app',
  stack: ['next', 'react', 'supabase'],
  files: [],
  routes: [
    { path: '/', kind: 'page', file: 'app/page.tsx' },
    { path: '/profile', kind: 'page', file: 'app/profile/page.tsx' },
    { path: '/api/promo', kind: 'missing' as never, file: '' },
  ].filter((r) => r.kind !== 'missing') as AppMap['routes'],
  elements: [
    { tag: 'button', file: 'app/page.tsx', line: 1, label: 'Buy credits', handlers: ['onClick'], emptyHandlers: [], inForm: false, ariaHidden: false, hasAction: false, hasOnSubmit: false, hasMethodAttr: false, submitType: true },
  ],
  apiCalls: [],
  envVars: [],
  imports: {},
  clientEntryFiles: [],
  supabase: { tables: [], clientFiles: [], migrations: [] },
  fileCount: 3,
  extractedAt: new Date().toISOString(),
} as unknown as AppMap;

const TARGET = 'http://localhost:3123';

describe('Planner (TRD §3.2, LLM call #1, cached by app-map hash)', () => {
  let plansDir: string;

  beforeEach(() => {
    plansDir = mkdtempSync('/tmp/opencode/uip-plans-');
  });

  afterEach(() => {
    rmSync(plansDir, { recursive: true, force: true });
  });

  it('produces a validated plan with one LLM call and caches it', async () => {
    const llm = new FakeLlm();
    llm.script(() => ({
      summary: 'store/credits app',
      personas: ['wanderer', 'double-clicker'],
      goals: [{ description: 'complete signup', expected: 'user lands on home' }],
      seedRoutes: ['/profile'],
      nastyInputs: { long: ['y'.repeat(9999)] },
      notes: '',
    }));

    const first = await createPlan({ appMap, targetUrl: TARGET, llm, workspacePlansDir: plansDir });
    expect(first.cached).toBe(false);
    expect(llm.calls).toBe(1);
    expect(first.plan.personas).toEqual(['wanderer', 'double-clicker']);
    expect(first.plan.seedRoutes).toEqual(['/profile']);
    expect(existsSync(join(plansDir, `${first.planId}.json`))).toBe(true);

    // second call with an unchanged app map → cache hit, zero new LLM calls
    const second = await createPlan({ appMap, targetUrl: TARGET, llm, workspacePlansDir: plansDir });
    expect(second.cached).toBe(true);
    expect(llm.calls).toBe(1);
    expect(second.planId).toBe(first.planId);

    // stored file round-trips through loadPlan
    const loaded = loadPlan(plansDir, first.planId);
    expect(loaded?.plan.personas).toEqual(['wanderer', 'double-clicker']);
    expect(loaded?.appMapRoutes).toContain('/profile');
  });

  it('degrades to app-map defaults when no LLM is configured', async () => {
    const llm = createLlm({ LLM_API_KEY: '' }); // NullLlm — even if the machine has a key
    const result = await createPlan({ appMap, targetUrl: TARGET, llm, workspacePlansDir: plansDir });
    expect(result.cached).toBe(false);
    expect(result.plan.personas).toContain('double-clicker'); // full roster even degraded
    expect(result.plan.personas).toContain('race-runner');
    expect(result.plan.seedRoutes[0]).toBe('/');
    expect(result.plan.seedRoutes).toContain('/profile');
    expect(result.plan.nastyInputs.long[0]).toHaveLength(10000);
  });

  it('changes the plan id when the app map changes', () => {
    const otherMap = { ...appMap, routes: [...appMap.routes, { path: '/new', kind: 'page', file: 'app/new/page.tsx' }] } as AppMap;
    expect(planHash(otherMap, TARGET)).not.toBe(planHash(appMap, TARGET));
  });

  it('REGRESSION (phase5 gate): a plan without explicit personas defaults to the FULL roster, never a lone wanderer', () => {
    // A wanderer-only default silently removes the Double-Clicker/Garbage
    // Paster from every swarm that honors plan.personas — the phase 5 gate
    // lost ALL duplicate_request detection this way (0 findings across 4
    // runs where the phase 4 gate produced 18–52 per run).
    const plan = PlanSchema.parse({ summary: 'no personas given' });
    expect(plan.personas).toContain('double-clicker');
    expect(plan.personas).toContain('garbage-paster');
    expect(plan.personas).toContain('abandoner');
    expect(plan.personas).toContain('race-runner');
    expect(plan.personas).toContain('wanderer');
  });

  it('explicit narrow personas are still honored (user intent, not the default)', () => {
    const plan = PlanSchema.parse({ summary: 'narrowed on purpose', personas: ['wanderer'] });
    expect(plan.personas).toEqual(['wanderer']);
  });

  it('planner LLM failures degrade instead of blocking', async () => {
    const llm = {
      configured: true,
      model: 'fake',
      calls: 0,
      maxCalls: Infinity,
      async completeJSON() {
        throw new Error('boom');
      },
    };
    const result = await createPlan({ appMap, targetUrl: TARGET, llm: llm as never, workspacePlansDir: plansDir });
    expect(result.plan.personas).toContain('double-clicker'); // degraded → full roster
    expect(result.plan.notes).toMatch(/planner LLM call failed/);
  });

  it('cache file content is JSON with the expected envelope', async () => {
    const llm = new FakeLlm();
    llm.script(() => ({ summary: 'x', personas: ['wanderer'], goals: [], seedRoutes: [], nastyInputs: {} }));
    const { planId } = await createPlan({ appMap, targetUrl: TARGET, llm, workspacePlansDir: plansDir });
    const raw = JSON.parse(readFileSync(join(plansDir, `${planId}.json`), 'utf8')) as {
      planId: string;
      createdAt: string;
      appMapRoutes: string[];
      plan: { personas: string[] };
    };
    expect(raw.planId).toBe(planId);
    expect(raw.appMapRoutes).toContain('/');
    expect(raw.plan.personas).toEqual(['wanderer']);
  });
});
