import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import {
  openDb,
  getOrCreateState,
  getOrCreateAction,
  recordTransition,
  getTransition,
  createRun,
  finishRun,
  addFinding,
  listRuns,
} from '../src/db/index.js';

let dir: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

beforeAll(() => {
  dir = mkdtempSync('/tmp/opencode/uip-db-');
  db = openDb(dir);
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SQLite state graph DAL (TRD §4 schema)', () => {
  it('states are idempotent by hash', () => {
    const a = getOrCreateState(db, { hash: 'h1', route: '/', signatureJson: '[]' });
    const b = getOrCreateState(db, { hash: 'h1', route: '/', signatureJson: '[]' });
    expect(a.id).toBe(b.id);
    const c = getOrCreateState(db, { hash: 'h2', route: '/x', signatureJson: '[]' });
    expect(c.id).not.toBe(a.id);
  });

  it('actions are unique per (state, locator)', () => {
    const s = getOrCreateState(db, { hash: 'hs', route: '/s', signatureJson: '[]' });
    const a1 = getOrCreateAction(db, { stateId: s.id, locator: 'button:nth(1)', kind: 'click', label: 'Save', riskClass: 'safe' });
    const a2 = getOrCreateAction(db, { stateId: s.id, locator: 'button:nth(1)', kind: 'click', label: 'Save', riskClass: 'safe' });
    expect(a1.id).toBe(a2.id);
    const other = getOrCreateAction(db, { stateId: s.id, locator: 'button:nth(2)', kind: 'click', label: 'Buy', riskClass: 'write' });
    expect(other.id).not.toBe(a1.id);
  });

  it('transitions accumulate count, rolling average and error count', () => {
    const from = getOrCreateState(db, { hash: 'tf', route: '/f', signatureJson: '[]' });
    const to = getOrCreateState(db, { hash: 'tt', route: '/t', signatureJson: '[]' });
    const action = getOrCreateAction(db, { stateId: from.id, locator: 'a', kind: 'click', label: 'go', riskClass: 'safe' });
    recordTransition(db, { fromState: from.id, actionId: action.id, toState: to.id, ms: 100, error: false });
    recordTransition(db, { fromState: from.id, actionId: action.id, toState: to.id, ms: 200, error: true });
    const t = getTransition(db, { fromState: from.id, actionId: action.id, toState: to.id });
    expect(t.count).toBe(2);
    expect(t.avg_ms).toBeCloseTo(150);
    expect(t.error_count).toBe(1);
  });

  it('runs and findings round-trip', () => {
    const runId = createRun(db, { targetUrl: 'http://localhost:3123', agents: 30 });
    const state = getOrCreateState(db, { hash: 'hr', route: '/r', signatureJson: '[]' });
    const action = getOrCreateAction(db, { stateId: state.id, locator: 'b', kind: 'click', label: 'Save profile', riskClass: 'safe' });
    const findingId = addFinding(db, {
      runId,
      type: 'dead_click',
      severity: 'high',
      confidence: 'high',
      persona: 'wanderer',
      stateId: state.id,
      actionId: action.id,
      clusterId: 'c1',
      evidence: { reasons: ['no mutation', 'no request'] },
      screenshot: null,
      trace: null,
    });
    expect(findingId).toBeGreaterThan(0);
    finishRun(db, { id: runId, durationMs: 1234, llmCalls: 2, coverage: 0.5 });

    const runs = listRuns(db);
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(runId);
    expect(runs[0].duration_ms).toBe(1234);
    expect(runs[0].llm_calls).toBe(2);
    expect(runs[0].coverage).toBe(0.5);

    const findings = listFindings(db, runId);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('dead_click');
    expect(JSON.parse(findings[0].evidence_json).reasons).toContain('no mutation');
  });
});
