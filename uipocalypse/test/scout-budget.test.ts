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
});
