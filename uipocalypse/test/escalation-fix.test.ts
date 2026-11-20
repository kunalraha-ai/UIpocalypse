import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import type { LLM } from '../src/llm/index.js';
import { swarm } from '../src/browser/orchestrator.js';
import { PlanSchema } from '../src/plan/schema.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb } from '../src/db/index.js';
import { createLogger } from '../src/logger.js';
import { loadConfig } from '../src/config.js';
import { serveStatic } from './helpers.js';
import { z } from 'zod';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'static-site');

/**
 * PRD rerun LLM metric: ≤ 20 calls. The old escalation burned ~40 on a
 * saturated graph (one per stalled agent). After the phase-6 fix, agents
 * on known states take policy actions (gotoSeed / abandon) with ZERO LLM
 * calls. Escalation is dead code on a saturated graph.
 */

/** LLM that records every attempted call, successful or not. */
class AttemptTrackingLlm implements LLM {
  readonly model = 'tracking-fake';
  readonly configured = true;
  calls = 0;
  maxCalls = Infinity;
  attempts = 0;

  async completeJSON<T>(opts: { schema: z.ZodType<T, z.ZodTypeDef, unknown> }): Promise<T> {
    this.attempts++;
    this.calls++;
    return opts.schema.parse({ done: true });
  }
}

describe('escalation fix: saturated graph → zero LLM calls (PRD rerun ≤ 20)', () => {
  it('a warm (saturated) graph produces ZERO LLM attempts from the swarm', async () => {
    const server = await serveStatic(FIXTURE);
    const ws = initWorkspace(mkdtempSync('/tmp/opencode/uip-escfix-'));
    const db = openDb(ws.db);
    const { config } = loadConfig();
    const llm = new AttemptTrackingLlm();
    const plan = PlanSchema.parse({
      summary: 'escfix',
      personas: ['wanderer'],
      goals: [],
      seedRoutes: [server.url],
      nastyInputs: { long: ['z'.repeat(50)] },
    });
    const opts = {
      url: server.url,
      config,
      plan,
      db,
      routes: ['/', '/page2.html'],
      llm,
      logger: createLogger({}),
      agents: 4,
      perAgentSteps: 8,
      personas: ['wanderer'],
    };

    // Run 1: populate the graph (agents explore, no LLM needed with wanderer-only)
    await swarm({ ...opts, perAgentSteps: 25, budgetSeconds: 15 });
    const afterRun1 = llm.attempts;
    expect(afterRun1).toBe(0); // wanderer-only never calls the LLM

    // Run 2: warm graph — every state known, every action visited.
    // Agents should stall and take policy actions (gotoSeed / abandon),
    // with ZERO LLM calls.
    await swarm({ ...opts, perAgentSteps: 25, budgetSeconds: 15 });
    const afterRun2 = llm.attempts;

    // ZERO new LLM attempts on the saturated graph
    expect(afterRun2 - afterRun1).toBe(0);

    db.close();
    await server.close();
  }, 60_000);

  it('escalationCalls is reported separately in the result', async () => {
    const server = await serveStatic(FIXTURE);
    const ws = initWorkspace(mkdtempSync('/tmp/opencode/uip-escfix2-'));
    const db = openDb(ws.db);
    const { config } = loadConfig();
    const llm = new AttemptTrackingLlm();
    const plan = PlanSchema.parse({
      summary: 'escfix2',
      personas: ['wanderer'],
      goals: [],
      seedRoutes: [server.url],
      nastyInputs: { long: ['z'.repeat(50)] },
    });

    const result = await swarm({
      url: server.url,
      config,
      plan,
      db,
      routes: ['/', '/page2.html'],
      llm,
      logger: createLogger({}),
      agents: 3,
      budgetSeconds: 10,
      perAgentSteps: 8,
      personas: ['wanderer'],
    });

    // escalationCalls is a separate field (not conflated with scout calls)
    expect(result).toHaveProperty('escalationCalls');
    expect(typeof result.escalationCalls).toBe('number');
    // on a fresh graph with a tiny fixture, agents should never need to escalate
    expect(result.escalationCalls).toBe(0);

    db.close();
    await server.close();
  }, 60_000);
});
