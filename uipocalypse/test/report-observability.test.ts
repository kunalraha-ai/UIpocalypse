import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { swarm } from '../src/browser/orchestrator.js';
import { explore } from '../src/browser/runner.js';
import { reviewRun, assembleReport, markdownReport, type RunMeta } from '../src/report/reviewer.js';
import { clusterFindings, type CollectedRun } from '../src/collect/collector.js';
import { PlanSchema, DEFAULT_NASTY_INPUTS } from '../src/plan/schema.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb, getRun, type Db } from '../src/db/index.js';
import { createLogger } from '../src/logger.js';
import { loadConfig } from '../src/config.js';
import { createLlm, FakeLlm } from '../src/llm/index.js';
import { serveStatic } from './helpers.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'static-site');

/**
 * Prompt-test findings (docs/volunteer/PROMPT_TEST.md): a fresh-context agent
 * ran the volunteer quickstart and hit three report-observability gaps —
 * 1. "Agents: 1" in the header while 30 agents ran (the run row is created
 *    in the scout phase and was never updated by the swarm)
 * 2. the report never says whether the review was LLM-written or mechanical
 * 3. "LLM calls: 0" was the swarm-phase delta presented as if it were the
 *    whole run's usage
 * Plus the cwd/.env pickup: the report should say where the LLM key came
 * from, so a silently-picked-up key is visible.
 */

/** minimal CollectedRun for review-level tests (no browser needed) */
function syntheticCollected(db: Db): CollectedRun {
  const rows = [
    { id: 1, run_id: 1, type: 'dead_click', severity: 'medium', confidence: 'high', evidence_json: '{"action":"Save"}', steps_json: '[]', url: 'http://localhost:3000/', cluster_id: null, screenshot: null },
    { id: 2, run_id: 1, type: 'dead_click', severity: 'medium', confidence: 'high', evidence_json: '{"action":"Save"}', steps_json: '[]', url: 'http://localhost:3000/', cluster_id: null, screenshot: null },
  ] as never[];
  const clusters = clusterFindings(rows, { routes: [], elements: [], envVars: [], apiCalls: [], supabaseTables: [], imports: {}, framework: 'next', stack: {}, files: [] } as never);
  return {
    runId: 1,
    clusters,
    findingClusters: clusters.filter((c) => c.classification === 'finding'),
    correctRejections: [],
    artifacts: [],
    inconsistentFeedback: [],
    coverage: {
      coverage: 0.5, appMapCoverage: 0, reachedActions: 1, discoveredActions: 2,
      appMapTotal: 0, appMapReached: 0, appMapUnreached: [], unreached: [],
    },
  } as never;
}

describe('report observability (prompt-test findings)', () => {
  it('the swarm updates the run row: agents matches the swarm size, not the scout', async () => {
    const server = await serveStatic(FIXTURE);
    const ws = initWorkspace(mkdtempSync('/tmp/opencode/uip-obs-'));
    const db = openDb(ws.db);
    const { config } = loadConfig();
    const plan = PlanSchema.parse({
      summary: 'obs test',
      personas: ['wanderer'],
      goals: [],
      seedRoutes: [server.url],
      nastyInputs: DEFAULT_NASTY_INPUTS,
    });
    const llm = createLlm({ LLM_API_KEY: '' });

    // explore creates the run row with agents=1 (single scout context)
    const exploreResult = await explore({
      url: server.url,
      config,
      plan,
      db,
      routes: [],
      llm,
      scoutLlm: llm,
      logger: createLogger({}),
      budgetSeconds: 8,
      scoutSteps: 3,
      wandererSteps: 3,
      screenshotDir: ws.screenshots,
    });
    expect(getRun(db, exploreResult.runId)!.agents).toBe(1); // the bug's origin

    // the swarm must correct it to the swarm size
    await swarm({
      url: server.url,
      config,
      plan,
      db,
      routes: [],
      llm,
      logger: createLogger({}),
      runId: exploreResult.runId,
      agents: 3,
      budgetSeconds: 8,
      perAgentSteps: 6,
    });
    expect(getRun(db, exploreResult.runId)!.agents).toBe(3);

    db.close();
    await server.close();
  }, 60_000);

  it('the report states whether the review was LLM-written or mechanical, and WHY mechanical', async () => {
    const collected = syntheticCollected(openDb(initWorkspace(mkdtempSync('/tmp/opencode/uip-obs2-')).db));
    const meta: RunMeta = { runId: 1, targetUrl: 'http://localhost:3000', agents: 5, wallMs: 1000, llmCalls: 0 };

    // no LLM configured → mechanical, with the actual reason (prompt-test finding:
    // the old text listed three possible causes without saying which applied)
    const mech = await reviewRun({ collected, appMap: {} as never, llm: createLlm({ LLM_API_KEY: '' }), run: meta });
    expect(mech.reviewedBy).toBe('mechanical');
    expect(mech.mechanicalReason).toBe('no LLM_API_KEY configured');
    const mechMd = markdownReport(assembleReport(collected, mech, meta));
    expect(mechMd).toMatch(/Reviewed by: mechanical template/i);
    expect(mechMd).toMatch(/no LLM_API_KEY configured/);
    expect(mechMd).not.toMatch(/no findings to review/);

    // no findings to review → that reason (needs a CONFIGURED llm: with no
    // key, "no key configured" is the honest first reason)
    const empty: typeof collected = { ...collected, findingClusters: [] };
    const emptyReview = await reviewRun({ collected: empty, appMap: {} as never, llm: new FakeLlm(), run: meta });
    expect(emptyReview.mechanicalReason).toBe('no findings to review');

    // reviewer call fails → mechanical fallback with that reason
    const failing = new FakeLlm().script(() => {
      throw new Error('budget exhausted');
    });
    const failed = await reviewRun({ collected, appMap: {} as never, llm: failing, run: meta });
    expect(failed.reviewedBy).toBe('mechanical');
    expect(failed.mechanicalReason).toMatch(/reviewer.*call failed/i);

    // configured LLM answering → LLM review, and the report says so
    const fake = new FakeLlm().script(() => ({
      summary: 'one issue',
      issues: [{ key: collected.findingClusters[0]!.key, title: 'Dead "Save"', rootCause: 'no handler', fixPrompt: 'wire it' }],
    }));
    const llmReview = await reviewRun({ collected, appMap: {} as never, llm: fake, run: meta });
    expect(llmReview.reviewedBy).toBe('llm');
    const llmMd = markdownReport(assembleReport(collected, llmReview, meta));
    expect(llmMd).toMatch(/Reviewed by: LLM/i);
  });

  it('the header labels the LLM call count as swarm-phase and names the key source', async () => {
    const collected = syntheticCollected(openDb(initWorkspace(mkdtempSync('/tmp/opencode/uip-obs3-')).db));
    const meta: RunMeta = {
      runId: 1, targetUrl: 'http://localhost:3000', agents: 5, wallMs: 1000, llmCalls: 0,
      llmModels: 'planner=@cf/zai-org/glm-5.3;scout=@cf/meta/llama-3.2-3b-instruct (key from: /somewhere/.env)',
    };
    const review = await reviewRun({ collected, appMap: {} as never, llm: createLlm({ LLM_API_KEY: '' }), run: meta });
    const md = markdownReport(assembleReport(collected, review, meta));
    expect(md).toMatch(/Swarm-phase LLM calls/i);
    expect(md).toMatch(/key from: \/somewhere\/\.env/);
  });

  it('createLlm records where the key came from (explicit sources only)', () => {
    // from an explicit env block (what MCP clients pass)
    const fromEnv = createLlm({ LLM_API_KEY: 'k', LLM_BASE_URL: 'http://x', LLM_MODEL: 'm' });
    expect(fromEnv.keySource).toMatch(/MCP config env block/);
    expect(fromEnv.provider).toBe('x');
    // not configured at all
    const none = createLlm({ LLM_API_KEY: '' });
    expect(none.keySource).toBeUndefined();
  });
});
