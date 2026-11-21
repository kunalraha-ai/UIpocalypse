import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { analyze } from '../src/analyzer/analyzer.js';
import { swarm } from '../src/browser/orchestrator.js';
import { collectRun } from '../src/collect/collector.js';
import { reviewRun, assembleReport, markdownReport, type RunMeta } from '../src/report/reviewer.js';
import { PlanSchema, DEFAULT_NASTY_INPUTS } from '../src/plan/schema.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb, getRun } from '../src/db/index.js';
import { createLogger } from '../src/logger.js';
import { loadConfig } from '../src/config.js';
import { createLlm } from '../src/llm/index.js';
import { serveStatic } from './helpers.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'skipped-actions-app');

/**
 * Volunteer-readiness cleanup item 1: actions skipped by the Safety Guard
 * must be VISIBLE — listed in the report by label with the reason and the
 * opt-in path, and counted as UNREACHED in the graph coverage denominator
 * (never silently dropped). This is the Plain Pages blind spot made honest:
 * a dead "Reset preferences" button must not vanish from coverage.
 */

describe('skipped actions: visible in result, report, and coverage', () => {
  it('a dead "Reset" button appears in skippedActions and lowers graph coverage', async () => {
    const server = await serveStatic(FIXTURE);
    const ws = initWorkspace(mkdtempSync('/tmp/opencode/uip-skipact-'));
    const db = openDb(ws.db);
    const { config } = loadConfig();
    const plan = PlanSchema.parse({
      summary: 'skipped-actions test',
      personas: ['wanderer'],
      goals: [],
      seedRoutes: [server.url],
      nastyInputs: DEFAULT_NASTY_INPUTS,
    });

    const result = await swarm({
      url: server.url,
      config,
      plan,
      db,
      routes: [],
      llm: createLlm({ LLM_API_KEY: '' }),
      logger: createLogger({}),
      agents: 3,
      budgetSeconds: 10,
      perAgentSteps: 12,
    });

    // 1) the skipped list is exposed on the result, by label, with reason
    expect(result.skippedActions).toBeDefined();
    const labels = result.skippedActions.map((s) => s.label);
    expect(labels).toContain('Reset preferences');
    expect(labels).toContain('Delete account');
    const reset = result.skippedActions.find((s) => s.label === 'Reset preferences')!;
    expect(reset.reason).toMatch(/destructive/i);
    expect(reset.reason).toMatch(/opt-in/i);

    // 2) skipped actions count as UNREACHED in the graph coverage figure —
    //    in the denominator, never dropped
    const { appMap } = analyze(FIXTURE);
    const collected = collectRun(db, result.runId, appMap);
    const cov = collected.coverage;
    expect(cov.discoveredActions).toBeGreaterThan(cov.reachedActions);
    expect(cov.coverage).toBeLessThan(1);
    const unreachedReset = cov.unreached.find((u) => u.label.startsWith('Reset preferences'));
    expect(unreachedReset).toBeDefined();
    expect(unreachedReset?.reason).toMatch(/skipped by safety policy/i);

    // 3) the report lists it with the reason and how to opt in
    const run = getRun(db, result.runId)!;
    const meta: RunMeta = {
      runId: run.id,
      targetUrl: run.target_url,
      agents: run.agents,
      wallMs: run.duration_ms ?? 0,
      llmCalls: run.llm_calls ?? 0,
      skippedActions: JSON.parse(run.skipped_actions ?? '[]'),
    };
    const review = await reviewRun({ collected, appMap, llm: createLlm({ LLM_API_KEY: '' }), run: meta });
    const report = assembleReport(collected, review, meta);
    const md = markdownReport(report);
    expect(md).toContain('Reset preferences');
    expect(md).toMatch(/skipped by safety policy/i);
    expect(md).toMatch(/destructiveOptIn/); // how to opt in

    db.close();
    await server.close();
  }, 60_000);
});
