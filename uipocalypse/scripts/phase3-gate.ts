/**
 * Phase 3 gate (IMPLEMENTATION_PLAN.md): "Does run 2 need ≥ 50% fewer LLM
 * calls than run 1?" — run for real against the sample app with the
 * configured LLM (Cloudflare Workers AI / any OpenAI-compatible endpoint).
 *
 * Usage (from uipocalypse/): npx tsx scripts/phase3-gate.ts [url] [repoPath]
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyze } from '../src/analyzer/analyzer.js';
import { createPlan } from '../src/plan/planner.js';
import { createLlmSet } from '../src/llm/index.js';
import { explore } from '../src/browser/runner.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb, listFindings } from '../src/db/index.js';
import { createLogger } from '../src/logger.js';
import { loadConfig } from '../src/config.js';

const url = process.argv[2] ?? 'http://localhost:3123';
const repoPath = resolve(process.argv[3] ?? '../sample-app');

const wsDir = mkdtempSync('/tmp/opencode/uip-gate-');
const ws = initWorkspace(wsDir);
const db = openDb(ws.db);
const { config } = loadConfig();
const logger = createLogger({});
const llms = createLlmSet();
llms.planner.maxCalls = config.llm.maxCallsPerRun;
llms.scout.maxCalls = config.llm.maxCallsPerRun;

console.log(
  `LLM: planner=${llms.planner.configured ? llms.planner.model : 'NOT CONFIGURED'} | scout=${llms.scout.configured ? llms.scout.model : 'NOT CONFIGURED'}`,
);
console.log(`Target: ${url} — repo: ${repoPath}`);
console.log(`Workspace: ${wsDir}\n`);

// ---------------------------------------------------------------- planner
const { appMap } = analyze(repoPath);
const plannerStarted = llms.planner.calls;
const planning = await createPlan({ appMap, targetUrl: url, llm: llms.planner, workspacePlansDir: ws.plans });
const plannerCalls = llms.planner.calls - plannerStarted;
console.log(
  `Plan ${planning.planId} (cached=${planning.cached}) — personas: ${planning.plan.personas.join(', ')} | seeds: ${planning.plan.seedRoutes.join(', ')} | planner LLM calls: ${plannerCalls}`,
);

// ---------------------------------------------------------------- run 1
console.log('\n=== RUN 1 (fresh graph) ===');
const t1 = Date.now();
const run1 = await explore({
  url,
  config,
  plan: planning.plan,
  db,
  routes: planning.appMapRoutes,
  llm: llms.planner,
  scoutLlm: llms.scout,
  logger,
  budgetSeconds: 300,
  scoutSteps: 24,
  wandererSteps: 30,
});
run1.llmCalls += plannerCalls; // the planner call belongs to run 1's budget
console.log(JSON.stringify(run1, null, 2));

// ---------------------------------------------------------------- run 2 (cached graph + cached plan)
console.log('\n=== RUN 2 (cached plan + graph) ===');
// simulate a fresh session: re-load the plan from cache (0 LLM calls)
const rePlan = await createPlan({ appMap, targetUrl: url, llm: llms.planner, workspacePlansDir: ws.plans });
const run2 = await explore({
  url,
  config,
  plan: rePlan.plan,
  db,
  routes: rePlan.appMapRoutes,
  llm: llms.planner,
  scoutLlm: llms.scout,
  logger,
  budgetSeconds: 180,
  scoutSteps: 24,
  wandererSteps: 24,
});
console.log(JSON.stringify(run2, null, 2));

// ---------------------------------------------------------------- gate
const total1 = run1.llmCalls;
const total2 = run2.llmCalls;
const reduction = total1 === 0 ? 0 : 1 - total2 / total1;
console.log('\n=== PHASE 3 GATE ===');
console.log(`run 1 LLM calls: ${total1} (planner ${plannerCalls} + scouts/escalations)`);
console.log(`run 2 LLM calls: ${total2}`);
console.log(`reduction: ${(reduction * 100).toFixed(1)}% (gate: ≥ 50%) → ${total2 <= total1 * 0.5 ? 'PASS' : 'FAIL'}`);
console.log(`wall: run 1 ${((Date.now() - t1) / 1000).toFixed(0)}s cumulative`);

// ---------------------------------------------------------------- findings digest
console.log('\n=== findings digest (both runs) ===');
for (const runId of [run1.runId, run2.runId]) {
  const findings = listFindings(db, runId);
  const seen = new Set<string>();
  console.log(`\nrun ${runId}: ${findings.length} findings`);
  for (const f of findings) {
    const evidence = JSON.parse(f.evidence_json ?? '{}') as Record<string, unknown>;
    const key = `${f.type}:${String(evidence.action ?? evidence.url ?? evidence.message ?? '').slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bits = Object.entries(evidence)
      .filter(([k]) => k !== 'steps')
      .map(([k, v]) => `${k}=${String(v).slice(0, 70)}`)
      .join(' ');
    console.log(`  [${f.type}] ${bits}`);
  }
}

db.close();
rmSync(wsDir, { recursive: true, force: true });
console.log('\n(gate workspace cleaned up)');
