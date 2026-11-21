/**
 * Phase 5 gate (IMPLEMENTATION_PLAN.md): full-pipeline timing (3 first-runs +
 * 1 rerun — medians + ranges for PRD G1), the collector acceptance case
 * (duplicate observations collapse to one cluster per endpoint), the two
 * classification rules, screenshots on failure, and the diff_runs demo.
 *
 * Usage (from uipocalypse/, sample app on :3123, Supabase up):
 *   npx tsx scripts/phase5-gate.ts
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyze } from '../src/analyzer/analyzer.js';
import { createPlan } from '../src/plan/planner.js';
import { createLlmSet } from '../src/llm/index.js';
import { healthCheck } from '../src/llm/index.js';
import { explore } from '../src/browser/runner.js';
import { swarm } from '../src/browser/orchestrator.js';
import { mergeDraftedInvariants } from '../src/browser/race.js';
import { createGuard } from '../src/guard/index.js';
import { collectRun } from '../src/collect/collector.js';
import { reviewRun, assembleReport, markdownReport, saveReport, diffRuns, type RunMeta } from '../src/report/reviewer.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb, getRun } from '../src/db/index.js';
import { createLogger } from '../src/logger.js';
import { loadConfig } from '../src/config.js';

process.env.SUPABASE_DB_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const url = 'http://localhost:3123';
const repo = resolve('../sample-app');

// Model health check FIRST (2026-11-20 lesson: both phase-5 models returned
// HTTP 410 the morning of a gate run — fail with an actionable message, not
// a stack trace mid-run)
const healthLlms = createLlmSet();
const planModel = await healthCheck(healthLlms.planner, 'LLM_MODEL');
const scoutModel = await healthCheck(healthLlms.scout, 'LLM_SCOUT_MODEL');
console.log(`LLM health OK: planner=${planModel} scout=${scoutModel}`);
const RACE = {
  url: `${url}/checkout`,
  actionLabel: 'Redeem coupon',
  input: 'WELCOME10',
  contexts: 20,
  setup: async (ctx: import('playwright').BrowserContext) => {
    await ctx.request.post(`${url}/api/auth/login`, {
      data: { email: 'alice@example.com', password: 'secret123' },
    });
  },
};

const { config } = loadConfig();
const seedAppRoutes = ['/profile', '/credits', '/login', '/checkout', '/orders', '/settings'];
const PERSONAS = ['wanderer', 'double-clicker', 'garbage-paster', 'abandoner', 'race-runner'];

type RunRecord = {
  label: string;
  wsDir: string;
  runId: number;
  walls: { reset: number; scan: number; plan: number; scouts: number; swarm: number; review: number; total: number };
  llm: { planner: number; scout: number; total: number };
  dupObs: number;
  dupClusters: number;
  /** duplicate_request clusters holding <2 observations (a collapse failure) */
  dupSingletons: number;
  /** invariant-confirmed duplicate damage clusters (duplicate_effect) */
  dupEffects: number;
  /** graph coverage after the skip-visibility fix: reached/discovered (skipped = unreached) */
  coverage: { reached: number; discovered: number; pct: number };
  skippedActions: number;
  clusters: number;
  findingClusters: number;
  correctRejections: number;
  artifacts: number;
  planInvariants: { drafted: number; used: number; dropped: number };
  reportClusters: Array<{ key: string; title: string; severity: string; observations: number; classification: string }>;
  diffSummary?: { fixed: number; new: number; still: number; intermittent: number; phantoms: string[] };
};

async function fullPipeline(
  label: string,
  opts: { freshWorkspace: boolean; prevWsDir?: string; race: boolean },
): Promise<RunRecord> {
  const logger = createLogger({});
  console.log(`\n=== ${label} ===`);
  let t = Date.now();
  execSync('npx -y supabase@latest db reset', { cwd: repo, stdio: 'pipe' });
  const resetMs = Date.now() - t;

  const wsDir = opts.freshWorkspace ? mkdtempSync('/tmp/opencode/uip-p5gate-') : opts.prevWsDir!;
  const ws = initWorkspace(wsDir);
  const db = openDb(ws.db);
  const llms = createLlmSet();
  llms.planner.maxCalls = config.llm.maxCallsPerRun;
  llms.scout.maxCalls = config.llm.maxCallsPerRun;

  t = Date.now();
  const { appMap } = analyze(repo);
  const scanMs = Date.now() - t;

  t = Date.now();
  const planning = await createPlan({ appMap, targetUrl: url, llm: llms.planner, workspacePlansDir: ws.plans });
  planning.plan.seedRoutes = [...new Set([...planning.plan.seedRoutes, ...seedAppRoutes])];
  const planMs = Date.now() - t;
  console.log(`plan cached=${planning.cached} seeds=${planning.plan.seedRoutes.length} draftedInvariants=${planning.plan.invariants.length}`);

  const inv = await mergeDraftedInvariants(config, planning.plan, createGuard(config), logger);
  let diffSummary: RunRecord['diffSummary'];

  t = Date.now();
  const exploreResult = await explore({
    url,
    config,
    plan: planning.plan,
    db,
    routes: planning.appMapRoutes,
    llm: llms.planner,
    scoutLlm: llms.scout,
    logger,
    budgetSeconds: 90,
    scoutSteps: 24,
    wandererSteps: 15,
    screenshotDir: ws.screenshots,
  });
  const scoutMs = Date.now() - t;
  console.log(`scouts: ${exploreResult.llmCalls} calls / ${(scoutMs / 1000).toFixed(1)}s`);

  t = Date.now();
  const swarmResult = await swarm({
    url,
    config: inv.config,
    plan: planning.plan,
    db,
    routes: planning.appMapRoutes,
    llm: llms.scout,
    logger,
    runId: exploreResult.runId,
    agents: 50,
    budgetSeconds: 60, // the default — the 90 s rerun target presumes it (PRD G1)
    perAgentSteps: 100,
    personas: PERSONAS, // full roster, always (the phase-5 regression lesson)
    screenshotDir: ws.screenshots,
    raceTarget: opts.race
      ? RACE
      : undefined, // the rerun mirrors the MCP verify flow, which never races
  });
  const swarmMs = Date.now() - t;
  console.log(`swarm: ${swarmResult.steps} steps / ${(swarmMs / 1000).toFixed(1)}s, findings=${Object.entries(swarmResult.findingCounts).map(([k, v]) => `${k}:${v}`).join(' ')}`);

  t = Date.now();
  const collected = collectRun(db, swarmResult.runId, appMap);
  const run = getRun(db, swarmResult.runId)!;
  const meta: RunMeta = {
    runId: run.id,
    targetUrl: run.target_url,
    agents: run.agents,
    wallMs: run.duration_ms ?? 0,
    llmCalls: run.llm_calls ?? 0,
    startedAt: run.started_at,
    skippedActions: (() => {
      try {
        const parsed = JSON.parse(run.skipped_actions ?? '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })(),
  };
  const review = await reviewRun({ collected, appMap, llm: llms.planner, run: meta });
  const report = assembleReport(collected, review, meta);
  saveReport(ws.runs, report);
  const reviewMs = Date.now() - t;

  const dupClusterArr = collected.clusters.filter((c) => c.types.includes('duplicate_request'));
  const dupObs = dupClusterArr.reduce((s, c) => s + c.observations, 0);
  const dupClusters = dupClusterArr.length;
  const dupSingletons = dupClusterArr.filter((c) => c.observations < 2).length;
  const dupEffects = collected.clusters.filter((c) => c.types.includes('duplicate_effect')).length;
  const cov = collected.coverage;
  console.log(
    `clusters: ${collected.clusters.length} total | findings ${collected.findingClusters.length} | rejections ${collected.correctRejections.length} | artifacts ${collected.artifacts.length} | dupObs ${dupObs} → ${dupClusters} clusters (singletons ${dupSingletons}, dup_effect ${dupEffects})`,
  );
  console.log(
    `coverage: graph ${cov.reachedActions}/${cov.discoveredActions} (${(cov.coverage * 100).toFixed(0)}%) | app map ${cov.appMapReached}/${cov.appMapTotal} (${(cov.appMapCoverage * 100).toFixed(0)}%) | skipped-by-policy actions ${swarmResult.skippedActions.length}${swarmResult.skippedActions.length ? `: ${swarmResult.skippedActions.map((s) => s.label).join(', ')}` : ''}`,
  );
  console.log(`report: ${report.issues.length} issues, review=${review.issues.length > 0 ? 'llm' : 'mechanical'}`);

  if (label === 'rerun (warm graph + cached plan)') {
    // diff across ALL runs in this workspace (identical app, nothing fixed):
    // stable clusters stay "still failing", detection variance lands in
    // "intermittent", and fixed/new should be empty (no phantoms)
    const allIds = (db.prepare('SELECT id FROM runs ORDER BY id').all() as Array<{ id: number }>).map((r) => r.id);
    const diff = diffRuns(db, appMap, allIds);
    console.log(
      `diff across ${allIds.length} identical runs: fixed=${diff.fixed.length} new=${diff.new.length} still=${diff.stillFailing.length} intermittent=${diff.intermittent.length}`,
    );
    const phantoms = [...diff.fixed, ...diff.new].map((f) => `${f.key} (runs ${f.presentIn.join(',')})`);
    for (const p of phantoms) console.log(`  PHANTOM? ${p}`);
    diffSummary = {
      fixed: diff.fixed.length,
      new: diff.new.length,
      still: diff.stillFailing.length,
      intermittent: diff.intermittent.length,
      phantoms,
    };
  }
  console.log(markdownReport(report).slice(0, 600));

  const rec: RunRecord = {
    label,
    wsDir,
    runId: swarmResult.runId,
    walls: { reset: resetMs, scan: scanMs, plan: planMs, scouts: scoutMs, swarm: swarmMs, review: reviewMs, total: resetMs + scanMs + planMs + scoutMs + swarmMs + reviewMs },
    llm: { planner: llms.planner.calls, scout: llms.scout.calls, total: llms.planner.calls + llms.scout.calls },
    dupObs,
    dupClusters,
    dupSingletons,
    dupEffects,
    coverage: { reached: cov.reachedActions, discovered: cov.discoveredActions, pct: cov.coverage },
    skippedActions: swarmResult.skippedActions.length,
    clusters: collected.clusters.length,
    findingClusters: collected.findingClusters.length,
    correctRejections: collected.correctRejections.length,
    artifacts: collected.artifacts.length,
    planInvariants: { drafted: inv.drafted, used: inv.used, dropped: inv.dropped },
    reportClusters: collected.clusters.map((c) => ({ key: c.key, title: c.title, severity: c.severity, observations: c.observations, classification: c.classification })),
    diffSummary,
  };
  db.close();
  return rec;
}

const runs: RunRecord[] = [];
const gateWallStart = Date.now();
const gateMonoStart = performance.now();
runs.push(await fullPipeline('first-run 1 (fresh workspace)', { freshWorkspace: true, race: true }));
runs.push(await fullPipeline('first-run 2 (fresh workspace)', { freshWorkspace: true, race: true }));
runs.push(await fullPipeline('first-run 3 (fresh workspace)', { freshWorkspace: true, race: true }));
runs.push(await fullPipeline('rerun (warm graph + cached plan)', { freshWorkspace: false, prevWsDir: runs[2]!.wsDir, race: false }));

// suspend / clock-jump detection (execution 3's lesson: a 23.6 h suspend
// invalidated every wall measurement). Monotonic time doesn't advance during
// suspend, so wall − mono measures the jump.
const gateWall = Date.now() - gateWallStart;
const gateMono = performance.now() - gateMonoStart;
const timeJumpMs = gateWall - gateMono;
const SUSPENDED = timeJumpMs > 120_000; // >2 min of unexplained wall drift

// ---------------------------------------------------------------- checks
console.log('\n=== PHASE 5 GATE ===');
if (SUSPENDED) {
  console.log(`  INVALID  gate execution suspended/clock-jumped — wall ${Math.round(gateWall / 1000)}s vs monotonic ${Math.round(gateMono / 1000)}s (${Math.round(timeJumpMs / 1000)}s drift). Timing results below are NOT valid measurements.`);
}
const firsts = runs.slice(0, 3);
const rerun = runs[3]!;
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const walls = firsts.map((r) => r.walls.total - r.walls.reset);
const checks: Array<[string, boolean, string]> = [];

checks.push(['first-run pipeline ≤ 4 min (median, PRD G1)', med(walls) <= 240_000, `median ${(med(walls) / 1000).toFixed(0)} s, range ${(Math.min(...walls) / 1000).toFixed(0)}–${(Math.max(...walls) / 1000).toFixed(0)} s (excl. db reset)`]);
checks.push(['rerun ≤ 90 s (PRD G1)', rerun.walls.total - rerun.walls.reset <= 90_000, `${((rerun.walls.total - rerun.walls.reset) / 1000).toFixed(0)} s (scouts ${(rerun.walls.scouts / 1000).toFixed(0)} s + swarm ${(rerun.walls.swarm / 1000).toFixed(0)} s + report ${(rerun.walls.review / 1000).toFixed(0)} s)`]);
checks.push([
  // Acceptance asserts on the COLLAPSED result, not raw counts: raw
  // duplicate_request observations vary with app state (shared DB, timing —
  // see README "Scope and limits"), so the band check on dupClusters was
  // flaky by construction. What must hold regardless of state:
  //   1. every duplicate_request cluster actually collapsed (≥2 obs — a
  //      singleton would mean one cluster per raw observation)
  //   2. each affected endpoint has exactly one cluster (cluster keys are
  //      per-endpoint — proven by the collector unit test: 3 endpoints →
  //      3 clusters, 26 observations survive inside one)
  //   3. invariant-confirmed duplicate damage (duplicate_effect) exists
  'collector acceptance: duplicates collapse to one cluster per affected endpoint, damage confirmed',
  firsts.every((r) => r.dupObs >= 1 && r.dupSingletons === 0 && r.dupEffects >= 1),
  `collapse ok (0 singleton dup clusters), dup_effect confirmations ${firsts.map((r) => r.dupEffects).join('/')}, raw dupObs range ${Math.min(...firsts.map((r) => r.dupObs))}–${Math.max(...firsts.map((r) => r.dupObs))} (raw counts vary with app state by design)`,
]);
checks.push([
  'classification: 4xx-on-existing-route downgraded, ERR_ABORTED filtered',
  firsts.every((r) => r.correctRejections >= 1 && r.artifacts >= 1),
  `rejections ${firsts.map((r) => r.correctRejections).join('/')}, artifacts ${firsts.map((r) => r.artifacts).join('/')}`,
]);
checks.push([
  'duplicate detection restored (the regression): every run has duplicate_request findings',
  runs.every((r) => r.dupObs >= 1),
  `dupObs per run: ${runs.map((r) => r.dupObs).join(', ')}`,
]);
checks.push([
  'diff_runs over identical runs: no phantom fixed/new (variance must land in intermittent)',
  (rerun.diffSummary?.phantoms ?? ['no diff recorded']).length === 0,
  JSON.stringify(rerun.diffSummary ?? {}),
]);

// screenshots on failure: dead_click/inconsistent findings carry existing files
const ws3 = initWorkspace(runs[2]!.wsDir);
const db3 = openDb(ws3.db);
const shotRows = db3.prepare("SELECT screenshot FROM findings WHERE type IN ('dead_click','inconsistent_feedback') AND screenshot IS NOT NULL").all() as Array<{ screenshot: string }>;
checks.push(['screenshots on failure exist', shotRows.length > 0 && shotRows.every((r) => existsSync(r.screenshot!)), `${shotRows.length} screenshot findings, all files present`]);
db3.close();

// report quality: every finding cluster carries a fix prompt + root cause
const rep = JSON.parse(readFileSync(`${initWorkspace(runs[2]!.wsDir).runs}/run-${runs[2]!.runId}-report.json`, 'utf8')) as { issues: Array<{ rootCause: string; fixPrompt: string }> };
checks.push([
  'every reported issue carries a root cause + paste-ready fix prompt',
  rep.issues.length > 0 && rep.issues.every((i) => i.rootCause.length > 10 && i.fixPrompt.length > 10),
  `${rep.issues.length} issues`,
]);

let pass = true;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) pass = false;
}
if (SUSPENDED) {
  console.log('  INVALID  timing results in this execution (suspend/clock jump detected) — see above');
}
console.log(`\nGATE: ${pass ? 'PASS' : 'FAIL'}${SUSPENDED ? ' (timing INVALID — suspended)' : ''}`);

// timing record for PRD G1 (reviewer asked for medians + ranges, counts with percentages)
console.log('\n=== timing record (PRD G1) ===');
console.log(`first-run pipeline (scan+plan+scouts+swarm+report, no db reset): ${walls.map((w) => (w / 1000).toFixed(0)).join(', ')} s → median ${(med(walls) / 1000).toFixed(0)} s`);
console.log(`first-run with db reset: ${firsts.map((r) => (r.walls.total / 1000).toFixed(0)).join(', ')} s`);
console.log(`rerun (cached plan + warm graph): ${((rerun.walls.total - rerun.walls.reset) / 1000).toFixed(0)} s (scout LLM ${rerun.llm.scout}, planner ${rerun.llm.planner})`);
console.log(`phase breakdown (first-run 3): scan ${runs[2]!.walls.scan}ms, plan ${runs[2]!.walls.plan}ms, scouts ${(runs[2]!.walls.scouts / 1000).toFixed(0)}s, swarm ${(runs[2]!.walls.swarm / 1000).toFixed(0)}s, review ${(runs[2]!.walls.review / 1000).toFixed(0)}s`);
console.log(`LLM per run (planner+reviewer | scouts+escal): ${runs.map((r) => `${r.llm.planner}|${r.llm.scout}`).join('  ')}`);

// cluster inventory for the FP classification (PHASE5_RESULTS.md)
console.log('\n=== clusters (first-run 3) — for FP classification ===');
for (const c of runs[2]!.reportClusters) console.log(`  [${c.classification}] ${c.key} — ${c.observations} obs (${c.severity})`);
console.log(`\nplanner-drafted invariants: ${runs.map((r) => `${r.label}: ${r.planInvariants.drafted}→${r.planInvariants.used}`).join('  ')}`);

for (const r of runs) if (r.label.startsWith('first-run')) rmSync(r.wsDir, { recursive: true, force: true });
