import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { swarm } from '../src/browser/orchestrator.js';
import { runRace, attributeDuplicateEffects, invariantViolated, type InvariantSpec, type InvariantRunner } from '../src/browser/race.js';import { PlanSchema } from '../src/plan/schema.js';
import { createLlm } from '../src/llm/index.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb, listFindings } from '../src/db/index.js';
import { StateGraph } from '../src/graph/graph.js';
import { createLogger } from '../src/logger.js';
import { loadConfig } from '../src/config.js';
import { serveStatic } from './helpers.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'static-site');

/**
 * Phase 4 acceptance on the static fixture: independent-stepping swarm,
 * abort mid-run → partial report (SAFETY.md §6 row 7), race mode with
 * invariant stubs → race_violation findings.
 */

function fixturePlan(url: string) {
  return PlanSchema.parse({
    summary: 'fixture',
    personas: ['wanderer', 'double-clicker', 'garbage-paster', 'abandoner'],
    goals: [],
    seedRoutes: [url],
    nastyInputs: { long: ['z'.repeat(50)], emoji: ['🎉'] },
  });
}

function tmpWs() {
  const dir = mkdtempSync('/tmp/opencode/uip-p4-');
  const w = initWorkspace(dir);
  const db = openDb(w.db);
  const config = loadConfig().config;
  return { dir, db, config, logger: createLogger({}) };
}

describe('swarm orchestrator (Phase 4)', () => {
  let server: { url: string; close: () => Promise<void> };
  let ws: ReturnType<typeof tmpWs>;

  beforeAll(async () => {
    server = await serveStatic(FIXTURE);
    ws = tmpWs();
  });

  afterAll(async () => {
    ws.db.close();
    await server.close();
  });

  it('runs N agents with independent stepping, records findings, finishes the run', async () => {
    const result = await swarm({
      url: server.url,
      config: ws.config,
      plan: fixturePlan(server.url),
      db: ws.db,
      routes: ['/', '/page2.html'],
      llm: createLlm({ LLM_API_KEY: '' }), // NullLlm: escalations degrade, no calls
      logger: ws.logger,
      agents: 8,
      budgetSeconds: 30,
      perAgentSteps: 12,
    });

    expect(result.agents).toBe(8);
    expect(result.steps).toBeGreaterThan(20); // several agents made progress
    expect(result.aborted).toBe(false);
    expect(result.ramp.level).toBeGreaterThanOrEqual(5);
    expect(result.graph.states).toBeGreaterThanOrEqual(2);
    // transitions are DISTINCT (from, action, to) triples — a 2-page fixture
    // caps the distinct count around 10
    expect(result.graph.transitions).toBeGreaterThanOrEqual(6);

    expect(Object.keys(result.findingCounts)).toContain('dead_click'); // the fixture's Dead button
    expect(result.findingCounts.dead_click).toBeGreaterThanOrEqual(1);

    const rows = listFindings(ws.db, result.runId);
    const deadActions = rows
      .filter((r) => r.type === 'dead_click')
      .map((r) => (JSON.parse(r.evidence_json!) as { action: string }).action);
    // the fixture has exactly ONE dead control — every dead_click finding must
    // be on it (guards both detection and false positives)
    expect(new Set(deadActions)).toEqual(new Set(['Dead button']));
  }, 120_000);

  it('abort mid-run: partial report written, aborted: true (SAFETY.md §6 row 7)', async () => {
    const abort = new AbortController();
    const resultPromise = swarm({
      url: server.url,
      config: ws.config,
      plan: fixturePlan(server.url),
      db: ws.db,
      routes: ['/', '/page2.html'],
      llm: createLlm({ LLM_API_KEY: '' }),
      logger: ws.logger,
      agents: 6,
      budgetSeconds: 60,
      perAgentSteps: 300,
      abort: abort.signal,
    });
    setTimeout(() => abort.abort(), 2500);
    const result = await resultPromise;

    expect(result.aborted).toBe(true);
    expect(result.steps).toBeGreaterThan(0);
    expect(result.steps).toBeLessThan(6 * 300); // clearly partial
    const row = ws.db
      .prepare('SELECT id, duration_ms, coverage FROM runs WHERE id = ?')
      .get(result.runId) as { id: number; duration_ms: number | null };
    expect(row).toBeTruthy(); // partial report written
    expect(row.duration_ms).not.toBeNull();
  }, 90_000);

  it('race mode: barrier arms every context; pass→fail invariant transition → race_violation', async () => {
    const browser = await chromium.launch();
    // stateful stub: baseline passes, post-volley fails — the pass→fail
    // transition is what the race owns (pre-existing failures are not race damage)
    const calls = new Map<string, number>();
    const runInvariants: InvariantRunner = async (inv) => {
      const n = (calls.get(inv.name) ?? 0) + 1;
      calls.set(inv.name, n);
      return n === 1 ? { ...inv, actual: inv.atMost ?? 0, pass: true } : { ...inv, actual: 2, pass: false };
    };
    const result = await runRace(
      browser,
      {
        url: server.url,
        actionLabel: 'Boom button',
        contexts: 3,
        config: {
          ...ws.config,
          invariants: [
            { name: 'single-use coupon honored once', sql: 'select count(*) from coupon_redemptions', atMost: 1 },
            // end-state invariants are meaningless mid-run and must be skipped by the race
            { name: 'end-state expectation', sql: 'select 1', expect: 1 },
          ],
        },
        logger: ws.logger,
      },
      { runInvariants },
    );
    await browser.close();

    expect(result.fired).toBe(3); // every context found the target and armed
    expect(result.violations).toHaveLength(1);
    expect(result.preExistingFailures).toEqual([]);
    expect(result.violations[0]!.type).toBe('race_violation');
    expect((result.violations[0]!.evidence as { actual: number; expected: number }).actual).toBe(2);
    expect((result.violations[0]!.evidence as { actual: number; expected: number }).expected).toBe(1);
    // the end-state invariant was never evaluated mid-run (one baseline call + one post call for the atMost one)
    expect(calls.get('end-state expectation')).toBeUndefined();
    expect(calls.get('single-use coupon honored once')).toBe(2);
  }, 60_000);

  it('race mode: an invariant already failing pre-volley is preExisting, never a race_violation', async () => {
    const browser = await chromium.launch();
    // constant stub: baseline already failing → the volley did not cause it
    const runInvariants: InvariantRunner = async (inv) => ({ ...inv, actual: 2, pass: false });
    const result = await runRace(
      browser,
      {
        url: server.url,
        actionLabel: 'Boom button',
        contexts: 3,
        config: {
          ...ws.config,
          invariants: [{ name: 'already broken', sql: 'select 1', atMost: 0 }],
        },
        logger: ws.logger,
      },
      { runInvariants },
    );
    await browser.close();

    expect(result.fired).toBe(3);
    expect(result.violations).toEqual([]);
    expect(result.preExistingFailures).toHaveLength(1);
    expect(result.preExistingFailures[0]!.name).toBe('already broken');
  }, 60_000);

  it('invariant comparator: atMost is point-in-time, expect is end-state, expect-only is skipped mid-run', async () => {
    // atMost: damage predicate — any observation point
    expect(invariantViolated({ atMost: 1 }, 0)).toBe(false); // not redeemed yet — fine mid-run
    expect(invariantViolated({ atMost: 1 }, 1)).toBe(false);
    expect(invariantViolated({ atMost: 1 }, 2)).toBe(true); // double redemption — damage
    // expect: exact end-state
    expect(invariantViolated({ expect: 1 }, 0)).toBe(true);
    expect(invariantViolated({ expect: 1 }, 1)).toBe(false);
    expect(invariantViolated({ expect: 0 }, 0)).toBe(false);
    expect(invariantViolated({ expect: 0 }, 3)).toBe(true);
  });

  it('duplicate_effect attribution: failing atMost invariants, only when duplicates exist; end-state ones never run mid-run', async () => {
    const invA: InvariantSpec = { name: 'A', sql: 'select 1', atMost: 0 };
    const invB: InvariantSpec = { name: 'B', sql: 'select 2', atMost: 1 };
    const invEnd: InvariantSpec = { name: 'end', sql: 'select 3', expect: 1 };
    const seen: string[] = [];
    const run: InvariantRunner = async (inv) => {
      seen.push(inv.name);
      return { ...inv, actual: inv.name === 'A' ? 2 : 0, pass: inv.name !== 'A' };
    };

    // duplicates observed → the failing point-in-time invariant is attributed as duplicate damage
    expect(await attributeDuplicateEffects({ invariants: [invA, invB, invEnd], duplicateRequestCount: 3, run }))
      .toEqual([{ ...invA, actual: 2, pass: false }]);
    // the end-state invariant was never evaluated mid-run
    expect(seen).toEqual(['A', 'B']);
    // no duplicate_request observations → nothing runs (an invariant failure
    // without duplicates is not a duplicate effect)
    expect(await attributeDuplicateEffects({ invariants: [invA], duplicateRequestCount: 0, run }))
      .toEqual([]);
  });

  it('repeat-activation suppression is RUN-SCOPED: prior-run feedback never masks this run (regression guarantee)', () => {
    const g = new StateGraph(ws.db, []);
    const s = g.getOrCreateState({ hash: 'h-sup', url: '/', signature: '' });
    g.getOrCreateAction({ stateId: s.id, locator: 'button|X#0', kind: 'button', label: 'X', riskClass: 'safe' });
    // run 1: the control works — marked alive
    g.markAliveThisRun(1, 'button|X#0');
    expect(g.aliveThisRun(1, 'button|X#0')).toBe(true);
    // run 2: NO carry-over — a dead verdict here is reported at full confidence
    // (this is the fix-verify loop: works in run 1, regressed in run 2 → flagged)
    expect(g.aliveThisRun(2, 'button|X#0')).toBe(false);
    expect(g.aliveThisRun(2, 'button|Dead button#0')).toBe(false);
  });

  it('regression test (review): a control that worked in run 1 whose handler is emptied must still be flagged in run 2', async () => {
    // run 1: the full fixture — "Flag once" works (first click flags, repeats suppressed)
    const server1 = await serveStatic(FIXTURE);
    const first = await swarm({
      url: server1.url,
      config: ws.config,
      plan: fixturePlan(server1.url),
      db: ws.db,
      routes: ['/', '/page2.html'],
      llm: createLlm({ LLM_API_KEY: '' }),
      logger: ws.logger,
      agents: 8,
      budgetSeconds: 30,
      perAgentSteps: 12,
    });
    await server1.close();
    const run1Dead = listFindings(ws.db, first.runId)
      .filter((r) => r.type === 'dead_click')
      .map((r) => (JSON.parse(r.evidence_json!) as { action: string }).action);
    // within run 1, Flag once never reads dead (its first click always flags → later repeats suppressed)
    expect(new Set(run1Dead)).toEqual(new Set(['Dead button']));

    // run 2: the SAME fixture with Flag once's handler EMPTIED — a regression.
    // Run 1's feedback must NOT suppress this run's dead verdicts.
    const variantDir = mkdtempSync('/tmp/opencode/uip-regression-');
    const variantHtml = readFileSync(join(FIXTURE, 'index.html'), 'utf8').replace(
      /<button id="flagonce"[^>]*>Flag once<\/button>/,
      '<button id="flagonce">Flag once</button>',
    );
    writeFileSync(join(variantDir, 'index.html'), variantHtml);
    writeFileSync(join(variantDir, 'page2.html'), readFileSync(join(FIXTURE, 'page2.html'), 'utf8'));
    const server2 = await serveStatic(variantDir);
    const second = await swarm({
      url: server2.url,
      config: ws.config,
      plan: fixturePlan(server2.url),
      db: ws.db,
      routes: ['/', '/page2.html'],
      llm: createLlm({ LLM_API_KEY: '' }),
      logger: ws.logger,
      agents: 8,
      budgetSeconds: 30,
      perAgentSteps: 12,
    });
    await server2.close();
    const run2Dead = listFindings(ws.db, second.runId)
      .filter((r) => r.type === 'dead_click')
      .map((r) => (JSON.parse(r.evidence_json!) as { action: string }).action);
    // the regressed control is flagged despite run 1's recorded feedback
    expect(run2Dead).toContain('Flag once');
    expect(new Set(run2Dead)).toEqual(new Set(['Dead button', 'Flag once']));
  }, 180_000);

  it('orchestrator race is skipped without a DB URL (G4 fails closed)', async () => {
    const dir = mkdtempSync('/tmp/opencode/uip-p4-race-');
    const w = initWorkspace(dir);
    const db = openDb(w.db);
    const server2 = await serveStatic(FIXTURE);
    const result = await swarm({
      url: server2.url,
      config: {
        ...loadConfig().config,
        invariants: [{ name: 'x', sql: 'select 1', expect: 1 }],
      },
      plan: fixturePlan(server2.url),
      db,
      routes: [],
      llm: createLlm({ LLM_API_KEY: '' }),
      logger: createLogger({}),
      agents: 3,
      budgetSeconds: 5,
      perAgentSteps: 2,
      raceTarget: { url: server2.url, actionLabel: 'Boom button', contexts: 2 },
    });
    expect(result.raceFired).toBeUndefined(); // G4: no DB URL resolved → refused
    await server2.close();
    db.close();
  }, 60_000);
});
