import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { swarm } from '../src/browser/orchestrator.js';
import { runRace } from '../src/browser/race.js';
import { PlanSchema } from '../src/plan/schema.js';
import { createLlm } from '../src/llm/index.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb, listFindings } from '../src/db/index.js';
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
    const dead = rows.find((r) => r.type === 'dead_click');
    expect(JSON.parse(dead!.evidence_json!).action).toBe('Dead button');
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

  it('race mode: barrier arms every context; failed invariant → race_violation', async () => {
    const browser = await chromium.launch();
    const result = await runRace(
      browser,
      {
        url: server.url,
        actionLabel: 'Boom button',
        contexts: 3,
        config: {
          ...ws.config,
          invariants: [{ name: 'single-use coupon honored once', sql: 'select count(*) from coupon_redemptions', expect: 1 }],
        },
        logger: ws.logger,
      },
      {
        // stub: pretend the concurrent volley violated the invariant (2 vs 1)
        runInvariants: async (inv) => ({ ...inv, actual: 2, pass: false }),
      },
    );
    await browser.close();

    expect(result.fired).toBe(3); // every context found the target and armed
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.type).toBe('race_violation');
    expect((result.violations[0]!.evidence as { actual: number; expected: number }).actual).toBe(2);
    expect((result.violations[0]!.evidence as { actual: number; expected: number }).expected).toBe(1);
  }, 60_000);

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
