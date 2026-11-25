import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { swarm } from '../src/browser/orchestrator.js';
import { PlanSchema } from '../src/plan/schema.js';
import { createLlm } from '../src/llm/index.js';
import { openDb, listFindings } from '../src/db/index.js';
import { serveStatic, tmpWorkspace } from './helpers.js';

/**
 * The fixture benchmark: measured precision/recall over planted bugs AND
 * planted decoys (BENCHMARK.md §2 — "looks odd but fine" elements that must
 * NEVER be flagged). One place answers "what is the measured FP rate", and
 * any detector change that regresses either side fails here.
 *
 * Honest scope: this matrix covers the DECLARED truth set only — the swarm
 * may legitimately surface other real-but-undeclared observations on these
 * fixtures (e.g. the console noise from the boom button); those are not
 * counted either way. Precision here = decoy survival, not full precision.
 */

const STATIC = join(import.meta.dirname, 'fixtures', 'static-site');
const FLAKY = join(import.meta.dirname, 'fixtures', 'flaky-site');

type Truth = {
  fixture: string;
  mustFind: Array<{ type: string; match: (ev: Record<string, unknown>) => boolean; label: string }>;
  mustNotFind: Array<{ type: string; match: (ev: Record<string, unknown>) => boolean; label: string }>;
};

const evAction = (name: string) => (ev: Record<string, unknown>) => ev.action === name;

const STATIC_TRUTH: Truth = {
  fixture: 'static-site',
  mustFind: [
    { type: 'dead_click', match: evAction('Dead button'), label: 'planted dead button' },
    { type: 'page_error', match: (ev) => String(ev.message ?? '').includes('notAFunction'), label: 'planted uncaught ReferenceError' },
    { type: 'duplicate_request', match: (ev) => String(ev.url ?? '').includes('/api/echo'), label: 'unguarded POST double-fire' },
  ],
  mustNotFind: [
    { type: 'dead_click', match: evAction('Alive button'), label: 'decoy: working button' },
    { type: 'dead_click', match: evAction('Alert button'), label: 'decoy: alert-only feedback' },
    { type: 'dead_click', match: evAction('Flag once'), label: 'decoy: once-per-page toggle (repeat-activation suppression)' },
    { type: 'dead_click', match: evAction('Echo submit'), label: 'decoy: fires a POST' },
    { type: 'dead_click', match: evAction('Subscribe'), label: 'decoy: browser-blocked invalid form submit' },
    { type: 'dead_click', match: evAction('Page 2'), label: 'decoy: real navigation link (fix 1+7)' },
    { type: 'dead_click', match: evAction('your name'), label: 'decoy: text input' },
    { type: 'dead_click', match: evAction('you@example.com'), label: 'decoy: form email input' },
  ],
};

const FLAKY_TRUTH: Truth = {
  fixture: 'flaky-site',
  mustFind: [
    { type: 'dead_click', match: (ev) => ev.action === 'Truly dead' && ev.reproduced === true, label: 'planted dead button, REPRODUCED by the sweep' },
  ],
  mustNotFind: [
    { type: 'dead_click', match: evAction('Slow handler'), label: 'decoy: ~900 ms handler (settle window)' },
    { type: 'dead_click', match: evAction('Store only'), label: 'decoy: localStorage-only effect (storage signal)' },
    { type: 'dead_click', match: evAction('Error only'), label: 'decoy: console.error-only effect (console signal)' },
    { type: 'dead_click', match: evAction('Wears out'), label: 'decoy: works on first click per page — later deads suppress to inconsistent_feedback' },
  ],
};

async function runSwarm(url: string, personas?: string[], agents = 4, steps = 16) {
  const server = await serveStatic(url === 'static' ? STATIC : FLAKY);
  const ws = tmpWorkspace();
  const db = openDb(join(mkdtempSync('/tmp/opencode/uip-bench-'), 'db.sqlite'));
  const plan = PlanSchema.parse({ summary: 'benchmark', goals: [], seedRoutes: [server.url], nastyInputs: { long: ['z'.repeat(200)] } });
  const result = await swarm({
    url: server.url,
    config: ws.config,
    plan,
    db,
    routes: ['/'],
    llm: createLlm({ LLM_API_KEY: '' }),
    logger: ws.logger,
    agents,
    budgetSeconds: 90,
    perAgentSteps: steps,
    ...(personas ? { personas } : {}),
  });
  const findings = listFindings(db, result.runId).map((r) => ({
    type: r.type,
    evidence: JSON.parse(r.evidence_json ?? '{}') as Record<string, unknown>,
  }));
  db.close();
  await server.close();
  ws.cleanup();
  return findings;
}

function score(truth: Truth, findings: Array<{ type: string; evidence: Record<string, unknown> }>) {
  const misses: string[] = [];
  let found = 0;
  for (const want of truth.mustFind) {
    const hit = findings.some((f) => f.type === want.type && want.match(f.evidence));
    if (hit) found++;
    else misses.push(`RECALL MISS [${truth.fixture}] ${want.type}: ${want.label}`);
  }
  let fp = 0;
  for (const decoy of truth.mustNotFind) {
    const hit = findings.some((f) => f.type === decoy.type && decoy.match(f.evidence));
    if (hit) {
      fp++;
      misses.push(`PRECISION HIT [${truth.fixture}] ${decoy.type}: ${decoy.label}`);
    }
  }
  const recall = truth.mustFind.length ? found / truth.mustFind.length : 1;
  const decoySurvival = truth.mustNotFind.length ? 1 - fp / truth.mustNotFind.length : 1;
  console.log(
    `[benchmark] ${truth.fixture}: recall ${found}/${truth.mustFind.length} (${(recall * 100).toFixed(0)}%), ` +
      `decoy FPs ${fp}/${truth.mustNotFind.length}, decoy survival ${(decoySurvival * 100).toFixed(0)}%`,
  );
  return { misses, recall, decoySurvival };
}

describe('fixture benchmark: measured precision/recall gate', () => {
  it(
    'static-site: planted bugs found, planted decoys untouched',
    async () => {
      const roster = await runSwarm('static'); // default roster: dead button + boom
      const pressure = await runSwarm('static', ['double-clicker']); // duplicate pressure: /api/echo
      const findings = [...roster, ...pressure];
      const { misses, recall, decoySurvival } = score(STATIC_TRUTH, findings);
      expect(misses, misses.join('\n')).toEqual([]);
      expect(recall).toBe(1);
      expect(decoySurvival).toBe(1);
    },
    300_000,
  );

  it(
    'flaky-site: the sweep reproduces the planted dead control, wired decoys stay silent',
    async () => {
      const findings = await runSwarm('flaky');
      const { misses, recall, decoySurvival } = score(FLAKY_TRUTH, findings);
      expect(misses, misses.join('\n')).toEqual([]);
      expect(recall).toBe(1);
      expect(decoySurvival).toBe(1);
    },
    300_000,
  );
});
