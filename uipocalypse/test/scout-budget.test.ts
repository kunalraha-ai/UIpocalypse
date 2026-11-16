import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { LLM } from '../src/llm/index.js';
import { explore } from '../src/browser/runner.js';
import { PlanSchema } from '../src/plan/schema.js';
import { ScoutDecisionSchema } from '../src/plan/schema.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb } from '../src/db/index.js';
import { createLogger } from '../src/logger.js';
import { loadConfig } from '../src/config.js';
import { serveStatic } from './helpers.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'static-site');

/**
 * A deliberately SLOW LLM whose decisions never let discovery saturate: each
 * step fills the email textbox with a fresh value, which mints a fresh state
 * hash. Without a wall-clock cap on the scouting phase, a slow LLM makes the
 * whole run unpredictably long (the phase 5 gate saw 180–200 s scouts).
 */
class SlowNeverSaturatingLlm implements LLM {
  readonly model = 'slow-fake';
  readonly configured = true;
  calls = 0;
  maxCalls = Infinity;

  async completeJSON<T>(opts: { user: string; schema: z.ZodType<T, z.ZodTypeDef, unknown> }): Promise<T> {
    this.calls++;
    await new Promise((r) => setTimeout(r, 350));
    const payload = JSON.parse(opts.user.split('\n\nJSON shape')[0]!) as { actions?: Array<{ id: number; name: string; role: string | null }> };
    const textbox = payload.actions?.find((a) => /you@example|textbox/i.test(`${a.name} ${a.role ?? ''}`));
    const decision = textbox
      ? { actionId: textbox.id, input: `never-saturating-${this.calls}@x.test` }
      : { actionId: payload.actions?.[0]?.id ?? 0, input: `v${this.calls}` };
    return opts.schema.parse(decision);
  }
}

describe('scout hard wall-clock cap (config scoutBudgetSeconds, default 90)', () => {
  it('a slow LLM cannot drag the scout phase past its cap — run stays predictable, proceeds to the swarm', async () => {
    const server = await serveStatic(FIXTURE);
    const ws = initWorkspace(mkdtempSync('/tmp/opencode/uip-scoutcap-'));
    const db = openDb(ws.db);
    const { config } = loadConfig();
    const llm = new SlowNeverSaturatingLlm();
    const plan = PlanSchema.parse({
      summary: 'cap test',
      seedRoutes: [server.url],
      nastyInputs: { long: ['z'.repeat(50)] },
    });

    const t0 = Date.now();
    const result = await explore({
      url: server.url,
      config: { ...config, scoutBudgetSeconds: 1 }, // 1 s cap, slow LLM
      plan,
      db,
      routes: ['/', '/page2.html'],
      llm,
      scoutLlm: llm,
      logger: createLogger({}),
      budgetSeconds: 30,
      scoutSteps: 24, // would take ~40+ s uncapped at 350 ms/call
      wandererSteps: 0, // isolate the scout phase
    });
    const wall = Date.now() - t0;

    // the cap tripped, scouting stopped, the run continued and finished
    expect(result.summary.scoutOutcome).toBe('budget');
    // the whole phase is bounded by the cap (+ one in-flight call), not by the
    // LLM's step count: without the fix this takes 40+ s
    expect(wall).toBeLessThan(10_000);
    expect(result.llmCalls).toBeGreaterThan(0); // it did scout — until the cap

    db.close();
    await server.close();
  }, 60_000);

  it('step-0 saturation (PHASE3_RESULTS behavior): a fully-known seed costs ZERO LLM calls on the rerun', async () => {
    const server = await serveStatic(FIXTURE);
    const ws = initWorkspace(mkdtempSync('/tmp/opencode/uip-sat0-'));
    const db = openDb(ws.db);
    const { config } = loadConfig();

    // run 1: explore the tiny fixture to saturation (wanderer visits everything)
    const first = new SlowNeverSaturatingLlm();
    first.completeJSON = (async () => ScoutDecisionSchema.parse({ done: true })) as typeof first.completeJSON;
    const plan = PlanSchema.parse({ summary: 'sat0', seedRoutes: [server.url], nastyInputs: { long: ['z'] } });
    await explore({
      url: server.url,
      config,
      plan,
      db,
      routes: ['/', '/page2.html'],
      llm: first,
      scoutLlm: first,
      logger: createLogger({}),
      budgetSeconds: 30,
      wandererSteps: 40, // enough for the weighted-random wanderer to visit every seed-state action
    });

    // PRECONDITION: the seed state must be fully visited, or the run-2 scout
    // is legitimately allowed to call the LLM (an unexplored action is not saturation)
    const seedState = db
      .prepare('SELECT s.id AS id FROM states s ORDER BY s.id LIMIT 1')
      .get() as { id: number };
    const unvisited = db
      .prepare(
        `SELECT COUNT(*) AS n FROM actions a WHERE a.state_id = ?
          AND NOT EXISTS (SELECT 1 FROM transitions t WHERE t.from_state = a.state_id AND t.action_id = a.id)`,
      )
      .get(seedState.id) as { n: number };
    expect(unvisited.n).toBe(0);

    // run 2: same workspace — every seed state is fully known, so the scouts
    // must saturate at step 0 with ZERO calls. The llm throws on any call.
    const counting = new SlowNeverSaturatingLlm();
    counting.completeJSON = (async () => {
      counting.calls++; // count even the refused call — the assertion must see it
      throw new Error('unexpected LLM call: a saturated seed must cost zero calls');
    }) as typeof counting.completeJSON;
    const second = await explore({
      url: server.url,
      config,
      plan,
      db,
      routes: ['/', '/page2.html'],
      llm: counting,
      scoutLlm: counting,
      logger: createLogger({}),
      budgetSeconds: 30,
      wandererSteps: 0,
    });
    expect(counting.calls).toBe(0); // RED today: each saturated seed burns one call
    expect(second.summary.scoutOutcome).toMatch(/saturated|skipped/);

    db.close();
    await server.close();
  }, 60_000);
});
