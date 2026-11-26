import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { enrichedRisk, deadHandlerLabels, annotateCorroboration } from '../src/browser/corroborate.js';
import { swarm } from '../src/browser/orchestrator.js';
import { PlanSchema } from '../src/plan/schema.js';
import { createLlm } from '../src/llm/index.js';
import { openDb, listFindings } from '../src/db/index.js';
import type { AppMap, Issue } from '../src/analyzer/types.js';
import { serveStatic, tmpWorkspace } from './helpers.js';

/**
 * Static ↔ runtime corroboration (2026-11-26): the analyzer's app-map knows
 * each control's component file and the HTTP methods that file fires; the
 * runtime knows what the control actually did. Joining them fixes the two
 * failure modes of label-regex risk classes:
 *  - "Remove filter" (destructive-sounding, actually a UI toggle) is TESTED
 *    when its component file provably writes nothing
 *  - "Nuke record" (benign-sounding label, DELETE in its file) is skipped
 *    as destructive despite the label
 * And a runtime dead_click whose control has a static dead-handler issue is
 * corroborated: source and runtime agree.
 *
 * Fail-safe rule: with no source map (URL-only runs) or no element match,
 * the label verdict stands unchanged.
 */

const appMap = (elements: Array<{ label: string; file: string }>, apiCalls: Array<{ file: string; method: string }>): AppMap => ({
  framework: 'unknown',
  stack: [],
  files: [],
  routes: [],
  elements: elements.map((e) => ({
    tag: 'button', file: e.file, line: 1, label: e.label, handlers: [], emptyHandlers: [],
    inForm: false, ariaHidden: false, hasAction: false, hasOnSubmit: false, hasMethodAttr: false,
    submitType: false, disabled: false, typeAttr: null, hasSpread: false, hasSubmitControl: false, hasFormActionDescendant: false,
  })),
  apiCalls: apiCalls.map((c) => ({ file: c.file, line: 1, url: '/api/x', method: c.method as 'GET', enclosingFnHasErrorHandling: false })),
  envVars: [],
  imports: {},
  clientEntryFiles: [],
  supabase: { tables: [], clientFiles: [], migrations: [] },
  fileCount: 1,
  extractedAt: 'test',
});

describe('enrichedRisk: label ↔ predicted-method join (pure)', () => {
  it('upgrade: benign label + DELETE in the component file → destructive', () => {
    const map = appMap([{ label: 'Nuke record', file: 'Nuke.tsx' }], [{ file: 'Nuke.tsx', method: 'DELETE' }]);
    expect(enrichedRisk(map, 'Nuke record')).toEqual({ risk: 'destructive', via: 'method', method: 'DELETE' });
  });

  it('downgrade: destructive-sounding label + write-free component file → write (testable), not skipped', () => {
    const map = appMap([{ label: 'Remove filter', file: 'Filters.tsx' }], [{ file: 'Filters.tsx', method: 'GET' }]);
    expect(enrichedRisk(map, 'Remove filter')).toEqual({ risk: 'write', via: 'method', method: 'GET' });
  });

  it('fail-safe: destructive label + component file that DOES write → stays destructive', () => {
    const map = appMap([{ label: 'Remove filter', file: 'Filters.tsx' }], [{ file: 'Filters.tsx', method: 'DELETE' }]);
    expect(enrichedRisk(map, 'Remove filter').risk).toBe('destructive');
  });

  it('fail-safe: no source map or no element match → the label verdict stands', () => {
    expect(enrichedRisk(undefined, 'Remove filter').risk).toBe('destructive'); // label-only, as ever
    const map = appMap([{ label: 'Other thing', file: 'A.tsx' }], []);
    expect(enrichedRisk(map, 'Remove filter').risk).toBe('destructive');
  });

  it('write detection for clean labels: POST in the component file → write', () => {
    const map = appMap([{ label: 'Sync now', file: 'Sync.tsx' }], [{ file: 'Sync.tsx', method: 'POST' }]);
    expect(enrichedRisk(map, 'Sync now')).toEqual({ risk: 'write', via: 'method', method: 'POST' });
  });

  it('empty labels never match (icon-only buttons stay label-verdict — ambiguous join)', () => {
    const map = appMap([{ label: '', file: 'Icon.tsx' }], [{ file: 'Icon.tsx', method: 'DELETE' }]);
    expect(enrichedRisk(map, '').via).toBe('label');
  });

  it('duplicate labels across files: the strongest method wins (fail-safe)', () => {
    const map = appMap([{ label: 'Save', file: 'A.tsx' }, { label: 'Save', file: 'B.tsx' }], [{ file: 'A.tsx', method: 'GET' }, { file: 'B.tsx', method: 'DELETE' }]);
    expect(enrichedRisk(map, 'Save').risk).toBe('destructive');
  });

  it('label casing and whitespace are normalized on both sides', () => {
    const map = appMap([{ label: 'Remove   FILTER', file: 'F.tsx' }], [{ file: 'F.tsx', method: 'GET' }]);
    expect(enrichedRisk(map, '  remove filter ').risk).toBe('write');
  });
});

describe('static dead-handler corroboration (pure)', () => {
  const issues: Issue[] = [
    { rule: 'dead-handler', severity: 'high', file: 'A.tsx', line: 3, message: 'button "Truly dead" has an empty onClick handler — clicking it does nothing.', fixHint: 'wire it' },
    { rule: 'missing-rls', severity: 'high', file: 'db.sql', line: 1, message: 'profiles has no RLS', fixHint: 'add RLS' },
  ];

  it('extracts normalized labels from dead-handler issues only', () => {
    const labels = deadHandlerLabels(issues);
    expect(labels.has('truly dead')).toBe(true);
    expect(labels.size).toBe(1);
  });

  it('a runtime dead_click on a statically-flagged control is corroborated', () => {
    const evidence: { action: string; why: string; corroboration?: string } = { action: 'Truly dead', why: 'no effect' };
    annotateCorroboration(evidence, deadHandlerLabels(issues));
    expect(String(evidence.corroboration)).toContain('static dead-handler');
    expect(String(evidence.corroboration)).toContain('agree');
  });

  it('no static counterpart → evidence untouched (static analysis has false negatives; no downgrade)', () => {
    const evidence: { action: string; why: string; corroboration?: string } = { action: 'Something else', why: 'no effect' };
    annotateCorroboration(evidence, deadHandlerLabels(issues));
    expect(evidence.corroboration).toBeUndefined();
  });
});

describe('corroboration end-to-end (swarm with app map + static issues)', () => {
  it('method-enriched risk classes change what the swarm tests, and dead clicks are corroborated', async () => {
    const server = await serveStatic(join(import.meta.dirname, 'fixtures', 'flaky-site'));
    const ws = tmpWorkspace();
    const db = openDb(join(mkdtempSync('/tmp/opencode/uip-corr-'), 'db.sqlite'));
    const plan = PlanSchema.parse({ summary: 'fixture', goals: [], seedRoutes: [server.url], nastyInputs: { long: ['z'.repeat(50)] } });

    // the source map for this "app": Truly dead is statically dead;
    // Remove filter's component provably writes nothing (GET only);
    // Wears out's component fires a DELETE — destructive despite the label
    const map = appMap(
      [
        { label: 'Truly dead', file: 'Dead.tsx' },
        { label: 'Remove filter', file: 'Filters.tsx' },
        { label: 'Wears out', file: 'Wears.tsx' },
      ],
      [
        { file: 'Filters.tsx', method: 'GET' },
        { file: 'Wears.tsx', method: 'DELETE' },
      ],
    );
    const staticIssues: Issue[] = [
      { rule: 'dead-handler', severity: 'high', file: 'Dead.tsx', line: 5, message: 'button "Truly dead" has an empty onClick handler — clicking it does nothing.', fixHint: 'wire it' },
    ];

    const result = await swarm({
      url: server.url,
      config: ws.config,
      plan,
      db,
      routes: ['/'],
      llm: createLlm({ LLM_API_KEY: '' }),
      logger: ws.logger,
      agents: 4,
      budgetSeconds: 90,
      perAgentSteps: 16,
      appMap: map,
      staticIssues,
    });

    // "Wears out": label is benign, method is DELETE → upgraded destructive →
    // skipped, with the method provenance in the skip reason
    const wearsSkip = result.skippedActions.find((s) => s.label === 'Wears out');
    expect(wearsSkip).toBeDefined();
    expect(wearsSkip!.reason).toContain('destructive');

    // "Remove filter": label looks destructive, method says GET → downgraded
    // to write → the swarm must actually TEST it (a transition recorded)
    expect(result.skippedActions.find((s) => s.label === 'Remove filter')).toBeUndefined();
    const tested = db
      .prepare(
        `SELECT COUNT(*) AS n FROM transitions t JOIN actions a ON t.action_id = a.id WHERE a.label = ? AND a.skip_reason IS NULL`,
      )
      .get('Remove filter') as { n: number };
    expect(tested.n).toBeGreaterThan(0);

    // "Truly dead": runtime dead click + static dead-handler issue → corroborated
    const dead = listFindings(db, result.runId).find((r) => r.type === 'dead_click');
    expect(dead).toBeDefined();
    const ev = JSON.parse(dead!.evidence_json!) as { action: string; corroboration?: string; reproduced?: boolean };
    expect(ev.action).toBe('Truly dead');
    expect(String(ev.corroboration)).toContain('static dead-handler');

    db.close();
    await server.close();
    ws.cleanup();
  }, 120_000);
});
