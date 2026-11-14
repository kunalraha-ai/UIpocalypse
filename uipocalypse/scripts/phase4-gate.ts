/**
 * Phase 4 exit gate (IMPLEMENTATION_PLAN.md): a 30-50 agent run in ≤ 120 s,
 * post-scouting, that detects bugs #4 (double-submit) and #5 (race) and the
 * edge-input crashes (#6, #7), with no destructive clicks.
 *
 * Usage (from uipocalypse/, sample app on :3123, Supabase up):
 *   npx tsx scripts/phase4-gate.ts
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { analyze } from '../src/analyzer/analyzer.js';
import { createPlan } from '../src/plan/planner.js';
import { createLlmSet } from '../src/llm/index.js';
import { explore } from '../src/browser/runner.js';
import { swarm } from '../src/browser/orchestrator.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb, listFindings } from '../src/db/index.js';
import { createLogger } from '../src/logger.js';
import { loadConfig } from '../src/config.js';

process.env.SUPABASE_DB_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const url = 'http://localhost:3123';
const repo = resolve('../sample-app');

console.log('== resetting sample-app database (fresh coupon + users) ==');
execSync('npx -y supabase@latest db reset', { cwd: repo, stdio: 'pipe' });

const wsDir = mkdtempSync('/tmp/opencode/uip-p4gate-');
const ws = initWorkspace(wsDir);
const db = openDb(ws.db);
const { config } = loadConfig();
const logger = createLogger({});
const llms = createLlmSet();
llms.planner.maxCalls = config.llm.maxCallsPerRun;
llms.scout.maxCalls = config.llm.maxCallsPerRun;

console.log(
  `LLM: planner=${llms.planner.model} | scout=${llms.scout.model}\nconfig: agents=${config.agents} budget=${config.budgetSeconds}s invariants=${config.invariants.length}`,
);

// ---------------------------------------------------------------- plan + scouts
const { appMap } = analyze(repo);
const planning = await createPlan({ appMap, targetUrl: url, llm: llms.planner, workspacePlansDir: ws.plans });
console.log(`plan ${planning.planId} cached=${planning.cached} personas=${planning.plan.personas.join(',')}`);

// Deterministic seeding (FR-P1 "seed routes"): the LLM plan varies run to run,
// but the app map always knows these routes — seed them in a fixed order so
// the scout phase deterministically reaches the profile and buy-credits pages
// (bug #6's crash and bug #4's double-submit both live there).
planning.plan.seedRoutes = [
  ...new Set([...planning.plan.seedRoutes, '/profile', '/credits', '/login', '/checkout', '/orders', '/settings']),
];
console.log(`seed routes: ${planning.plan.seedRoutes.join(', ')}`);

const t0 = Date.now();
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
});
console.log(
  `scouts: ${exploreResult.llmCalls} LLM calls, ${exploreResult.durationMs}ms, graph ${exploreResult.graph.states}s/${exploreResult.graph.actions}a/${exploreResult.graph.transitions}t`,
);

// ---------------------------------------------------------------- swarm (timed)
console.log('\n=== SWARM: 50 agents, 100 steps each, 105 s budget (headroom for straggler waves), race on Redeem coupon ===');
const swarmResult = await swarm({
  url,
  config,
  plan: planning.plan,
  db,
  routes: planning.appMapRoutes,
  llm: llms.scout,
  logger,
  runId: exploreResult.runId, // scouts + swarm = ONE run row, same as MCP run_swarm
  agents: 50,
  budgetSeconds: 105,
  perAgentSteps: 100,
  personas: ['wanderer', 'double-clicker', 'garbage-paster', 'abandoner', 'race-runner'],
  raceTarget: {
    url: `${url}/checkout`,
    actionLabel: 'Redeem coupon',
    input: 'WELCOME10',
    contexts: 20,
    // /checkout requires a session — sign each race context in as Alice first
    setup: async (ctx) => {
      await ctx.request.post(`${url}/api/auth/login`, {
        data: { email: 'alice@example.com', password: 'secret123' },
      });
    },
  },
});
console.log(JSON.stringify(swarmResult, null, 2));

// ---------------------------------------------------------------- gate checks
const allFindings = listFindings(db, swarmResult.runId);
const types = new Map<string, number>();
for (const f of allFindings) types.set(f.type, (types.get(f.type) ?? 0) + 1);

const ev = (f: (typeof allFindings)[number]) => JSON.parse(f.evidence_json ?? '{}') as Record<string, unknown>;
const hist = (type: string, key: (f: (typeof allFindings)[number]) => string) => {
  const m = new Map<string, number>();
  for (const f of allFindings.filter((x) => x.type === type)) m.set(key(f), (m.get(key(f)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ×${n}`).join('; ');
};
const clean = (u: unknown) => String(u ?? '?').replace('http://localhost:3123', '');
console.log('\n=== finding breakdown (raw observations, pre-cluster) ===');
console.log(`dead_click:         ${hist('dead_click', (f) => String(ev(f).action ?? '?'))}`);
console.log(`duplicate_request:  ${hist('duplicate_request', (f) => clean(ev(f).url))}`);
console.log(`duplicate_effect:   ${hist('duplicate_effect', (f) => String(ev(f).invariant ?? '?'))}`);
console.log(`failed_request:     ${hist('failed_request', (f) => `${clean(ev(f).url)} [${ev(f).status}]`)}`);
console.log(`page_error:         ${hist('page_error', (f) => String(ev(f).message ?? '?').slice(0, 70))}`);

const has = (type: string) => (types.get(type) ?? 0) > 0;
const evidenceOf = (type: string) =>
  allFindings
    .filter((f) => f.type === type)
    .map((f) => JSON.parse(f.evidence_json ?? '{}'))
    .slice(0, 3);

console.log('\n=== PHASE 4 EXIT GATE ===');
const checks: Array<[string, boolean, string]> = [];
checks.push(['swarm ≤ 120 s', swarmResult.wallMs <= 120_000, `${(swarmResult.wallMs / 1000).toFixed(1)} s, ${swarmResult.steps} steps, ${swarmResult.stepsPerSec.toFixed(1)} steps/s`]);
checks.push(['bug #4 duplicate_request (double-submit, request level)', has('duplicate_request'), JSON.stringify(evidenceOf('duplicate_request'))]);
checks.push(['bug #5 race_violation', has('race_violation'), JSON.stringify(evidenceOf('race_violation'))]);
checks.push(['bug #6 page_error (garbage input crash)', has('page_error'), JSON.stringify(evidenceOf('page_error'))]);
checks.push(['bug #7 failed_request 500 (emoji search)', allFindings.some((f) => f.type === 'failed_request' && (f.evidence_json ?? '').includes('/api/search')), JSON.stringify(evidenceOf('failed_request'))]);

// no destructive clicks: users survive
const users = (() => {
  try {
    const out = execSync(
      `docker exec supabase_db_creditcraft psql -U postgres -d postgres -tAc "select count(*) from profiles"`,
      { encoding: 'utf8' },
    ).trim();
    return Number(out);
  } catch {
    return -1;
  }
})();
checks.push(['no destructive clicks (alice+bob alive)', users === 2, `profiles rows: ${users}`]);

let pass = true;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) pass = false;
}
const dupEffects = allFindings.filter((f) => f.type === 'duplicate_effect');
console.log(
  `  ${dupEffects.length ? 'CONFIRMED' : 'UNCONFIRMED'}  bug #4 duplicate_effect (invariant-confirmed damage) — ${JSON.stringify(
    dupEffects.map((f) => JSON.parse(f.evidence_json ?? '{}')),
  )}`,
);
console.log(`\nGATE: ${pass ? 'PASS' : 'FAIL'}`);
console.log(`total wall (scouts + swarm): ${((Date.now() - t0) / 1000).toFixed(1)} s`);

db.close();
rmSync(wsDir, { recursive: true, force: true });
