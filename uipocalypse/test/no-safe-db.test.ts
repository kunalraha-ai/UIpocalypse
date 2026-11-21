import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { swarm } from '../src/browser/orchestrator.js';
import { PlanSchema, DEFAULT_NASTY_INPUTS } from '../src/plan/schema.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb, listFindings } from '../src/db/index.js';
import { createLogger } from '../src/logger.js';
import { loadConfig } from '../src/config.js';
import { serveStatic } from './helpers.js';
import { createLlm } from '../src/llm/index.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'static-site');

/**
 * SAFETY.md G4 + volunteer readiness: when the Guard cannot confirm a safe DB,
 * the tool runs in READ-ONLY mode (writes and form submits skipped) instead
 * of refusing outright. The report must say which detection classes were
 * disabled and why. The Guard's refusal of write-heavy modes (race, fuzz)
 * is NOT weakened.
 */

describe('no-safe-DB read-only mode (SAFETY.md G4)', () => {
  it('prod-like DB host → swarm runs read-only: zero writes issued, disabled classes listed', async () => {
    const server = await serveStatic(FIXTURE);
    const ws = initWorkspace(mkdtempSync('/tmp/opencode/uip-readonly-'));
    const db = openDb(ws.db);
    const { config } = loadConfig();
    const plan = PlanSchema.parse({
      summary: 'readonly-test',
      personas: ['wanderer', 'double-clicker', 'garbage-paster'],
      goals: [],
      seedRoutes: [server.url],
      nastyInputs: DEFAULT_NASTY_INPUTS,
    });

    // simulate a prod-like DB: the guard should refuse write-heavy modes,
    // but the swarm should still run (read-only)
    const configWithProdDb = {
      ...config,
      db: { allowedHosts: [] }, // empty = no DB is allow-listed
    };

    const result = await swarm({
      url: server.url,
      config: configWithProdDb,
      plan,
      db,
      routes: ['/', '/page2.html'],
      llm: createLlm({ LLM_API_KEY: '' }),
      logger: createLogger({}),
      agents: 4,
      budgetSeconds: 10,
      perAgentSteps: 8,
    });

    // the swarm ran and produced results (not a refusal)
    expect(result.aborted).toBe(false);
    expect(result.steps).toBeGreaterThan(0);

    // no duplicate_request findings (writes were skipped)
    const findings = listFindings(db, result.runId);
    const writes = findings.filter((f) => f.type === 'duplicate_request' || f.type === 'duplicate_effect');
    expect(writes).toEqual([]);

    // no race violation
    expect(result.raceFired).toBeUndefined();

    // the result reports which classes were disabled
    expect(result).toHaveProperty('disabledClasses');
    expect(result.disabledClasses).toContain('duplicate_request');
    expect(result.disabledClasses).toContain('duplicate_effect');
    expect(result.disabledClasses).toContain('race_mode');
    expect(result.disabledClasses).toContain('form_submits');

    db.close();
    await server.close();
  }, 60_000);

  it('local DB still allows writes (the normal path is unchanged)', async () => {
    const server = await serveStatic(FIXTURE);
    const ws = initWorkspace(mkdtempSync('/tmp/opencode/uip-normaldb-'));
    const db = openDb(ws.db);
    const { config } = loadConfig();
    const plan = PlanSchema.parse({
      summary: 'normal-db-test',
      personas: ['wanderer'],
      goals: [],
      seedRoutes: [server.url],
      nastyInputs: DEFAULT_NASTY_INPUTS,
    });

    const result = await swarm({
      url: server.url,
      config, // default: localhost is allow-listed
      plan,
      db,
      routes: ['/', '/page2.html'],
      llm: createLlm({ LLM_API_KEY: '' }),
      logger: createLogger({}),
      agents: 3,
      budgetSeconds: 10,
      perAgentSteps: 6,
    });

    // no disabled classes when the DB is safe
    expect(result.disabledClasses ?? []).toEqual([]);

    db.close();
    await server.close();
  }, 60_000);
});
