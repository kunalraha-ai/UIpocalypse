import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { FakeLlm } from '../src/llm/index.js';
import { explore } from '../src/browser/runner.js';
import { PlanSchema } from '../src/plan/schema.js';
import { listFindings } from '../src/db/index.js';
import { serveStatic, tmpWorkspace } from './helpers.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'static-site');

/**
 * Phase 3 deliverable check (integration): scout + wanderer explore a real
 * (tiny) app, write the graph, and record findings with evidence — including
 * the dead click and the unhandled error planted in the fixture.
 *
 * Also proves the Phase 3 gate MECHANISM: run 2 on a cached graph makes
 * (at most) a fraction of run 1's LLM calls.
 */
describe('explore(): scout + wanderer end-to-end on the static fixture', () => {
  let server: { url: string; close: () => Promise<void> };
  let ws: ReturnType<typeof tmpWorkspace>;

  beforeAll(async () => {
    server = await serveStatic(FIXTURE);
    ws = tmpWorkspace();
  });

  afterAll(async () => {
    ws.cleanup();
    await server.close();
  });

  const plan = PlanSchema.parse({
    summary: 'fixture plan',
    personas: ['wanderer'],
    goals: [],
    seedRoutes: [],
    nastyInputs: { long: ['z'.repeat(200)] },
  });

  it('run 1: explores, finds the planted breakage, writes the graph', async () => {
    const llm = new FakeLlm();
    // scout script: go to page 2, come back, then done
    llm.script(() => ({ actionId: 3, reason: 'visit page 2' })); // "Page 2" link
    llm.script(() => ({ actionId: 0, reason: 'back home' })); // "Back home" on page2
    llm.script(() => ({ done: true }));

    const result = await explore({
      url: server.url,
      config: ws.config,
      plan,
      db: ws.db,
      routes: ['/', '/page2.html'],
      llm,
      logger: ws.logger,
      scoutSteps: 6,
      wandererSteps: 30,
      budgetSeconds: 60,
    });

    expect(result.llmCalls).toBe(3);
    expect(result.graph.states).toBeGreaterThanOrEqual(2); // home + page2
    expect(result.graph.actions).toBeGreaterThanOrEqual(5);
    expect(result.graph.transitions).toBeGreaterThanOrEqual(8); // scout 2 + wanderer ≥6

    const types = Object.keys(result.findingCounts);
    expect(types).toContain('dead_click');
    expect(types).toContain('page_error'); // "Boom button" -> notAFunction
    expect(result.findingCounts.dead_click).toBeGreaterThanOrEqual(1);
    expect(result.findingCounts.page_error).toBeGreaterThanOrEqual(1);

    const findings = listFindings(ws.db, result.runId);
    const deads = findings.filter((f) => f.type === 'dead_click');
    expect(deads.length).toBeGreaterThanOrEqual(1);
    // the planted dead click is reported…
    expect(deads.map((f) => (JSON.parse(f.evidence_json!) as { action: string }).action)).toContain(
      'Dead button',
    );
    // …and the garbage-email submit being flagged dead is also true: the
    // browser blocks an invalid form submission with zero user feedback
    const firstDead = deads.find(
      (f) => (JSON.parse(f.evidence_json!) as { action: string }).action === 'Dead button',
    )!;
    const evidence = JSON.parse(firstDead.evidence_json!) as { action: string; steps: string[] };
    expect(evidence.action).toBe('Dead button');
    expect(Array.isArray(evidence.steps)).toBe(true);
    // NOTE: the settle window (activity-bounded, up to ~1.5 s on quiet pages)
    // makes no-signal steps slower on purpose — precision over step count.
  }, 90_000);

  it('run 2 (cached graph): ≥ 50% fewer LLM calls — the Phase 3 gate mechanism', async () => {
    const llm2 = new FakeLlm();
    llm2.script(() => ({ done: true })); // at most one call before saturation

    const result = await explore({
      url: server.url,
      config: ws.config,
      plan,
      db: ws.db, // SAME database → the state graph from run 1
      routes: ['/', '/page2.html'],
      llm: llm2,
      logger: ws.logger,
      scoutSteps: 6,
      wandererSteps: 12,
      budgetSeconds: 60,
    });

    // run 1 used 3 scout calls; run 2 must use at most 1 (gate: ≤ 50%)
    expect(result.llmCalls).toBeLessThanOrEqual(1);
    expect(result.llmCalls).toBeLessThan(2);
    // the graph keeps growing, never shrinking
    expect(result.graph.states).toBeGreaterThanOrEqual(2);
    expect(result.coverage).toBeGreaterThan(0);
  });

  it('records run metadata for the diff/gate tooling (runs table)', () => {
    const runs = ws.db
      .prepare('SELECT id, target_url, agents, duration_ms, llm_calls, coverage FROM runs ORDER BY id')
      .all() as Array<{ id: number; target_url: string; agents: number; llm_calls: number; coverage: number }>;
    expect(runs.length).toBe(2);
    expect(runs[0]!.agents).toBe(1);
    expect(runs[0]!.llm_calls).toBe(3);
    expect(runs[1]!.llm_calls).toBeLessThanOrEqual(1);
  });
});
