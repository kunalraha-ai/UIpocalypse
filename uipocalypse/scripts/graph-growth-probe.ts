/**
 * Graph-growth probe: diagnose why the graph grew 24 -> 42 actions between
 * Phase 3 gate runs. Runs explore() twice (wanderer-only, no LLM) and dumps:
 *  - new states in run 2 (auth-variant candidates)
 *  - actions added at pre-existing states in run 2
 *  - duplicate action labels at the same state (locator instability)
 *
 * Usage: npx tsx scripts/graph-growth-probe.ts [url]
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { explore } from '../src/browser/runner.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb } from '../src/db/index.js';
import { createLogger } from '../src/logger.js';
import { loadConfig } from '../src/config.js';
import { createLlm } from '../src/llm/index.js';
import { analyze } from '../src/analyzer/analyzer.js';
import { degradedPlan } from '../src/plan/planner.js';

const url = process.argv[2] ?? 'http://localhost:3123';
const repo = resolve('../sample-app');

const wsDir = mkdtempSync('/tmp/opencode/uip-probe-');
const ws = initWorkspace(wsDir);
const db = openDb(ws.db);
const { config } = loadConfig();
const logger = createLogger({});
const llm = createLlm({ LLM_API_KEY: '' }); // NullLlm: wanderer-only probe, zero LLM calls
const { appMap } = analyze(repo);
const plan = degradedPlan(appMap, url);

function dumpGraph(tag: string) {
  const states = db
    .prepare('SELECT id, hash, route FROM states ORDER BY id')
    .all() as Array<{ id: number; hash: string; route: string | null }>;
  const actions = db
    .prepare('SELECT id, state_id, locator, label FROM actions ORDER BY id')
    .all() as Array<{ id: number; state_id: number; locator: string; label: string | null }>;
  console.log(`\n===== ${tag}: ${states.length} states, ${actions.length} actions =====`);
  for (const s of states) {
    const acts = actions.filter((a) => a.state_id === s.id);
    const dupLabels = acts
      .map((a) => a.label ?? '(none)')
      .filter((l, i, arr) => arr.indexOf(l) !== i);
    console.log(
      `state ${s.id} ${s.route} (${acts.length} actions)${dupLabels.length ? '  !! DUPLICATE LABELS: ' + [...new Set(dupLabels)].join(' | ') : ''}`,
    );
    for (const a of acts) console.log(`    [${a.locator}] ${a.label}`);
  }
  return { states, actions };
}

await explore({ url, config, plan, db, routes: [], llm, logger, budgetSeconds: 45, wandererSteps: 50 });
const g1 = dumpGraph('after run 1');
await explore({ url, config, plan, db, routes: [], llm, logger, budgetSeconds: 45, wandererSteps: 50 });
const g2 = dumpGraph('after run 2');

const g1StateIds = new Set(g1.states.map((s) => s.id));
const newStates = g2.states.filter((s) => !g1StateIds.has(s.id));
const g1ActionIds = new Set(g1.actions.map((a) => a.id));
const newActionsAtOldStates = g2.actions.filter((a) => !g1ActionIds.has(a.id) && g1StateIds.has(a.state_id));

console.log('\n===== ANALYSIS =====');
console.log(`new states in run 2: ${newStates.length}`);
for (const s of newStates) console.log(`  + state ${s.id} ${s.route}`);
console.log(
  `new actions at PRE-EXISTING states: ${newActionsAtOldStates.length}` +
    (newActionsAtOldStates.length ? '  <-- locator instability or late discovery' : ''),
);
for (const a of newActionsAtOldStates.slice(0, 25)) console.log(`  + [${a.locator}] ${a.label} @ state ${a.state_id}`);

db.close();
rmSync(wsDir, { recursive: true, force: true });
