import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { startWebServer } from '../src/web/server.js';
import { generateReport } from '../src/report/reviewer.js';
import { createLlm } from '../src/llm/index.js';
import { initWorkspace } from '../src/workspace.js';
import type { AppMap } from '../src/analyzer/types.js';
import {
  openDb,
  createRun,
  addFinding,
  addIgnoredFinding,
  listIgnoredFindings,
  removeIgnoredFinding,
} from '../src/db/index.js';

/**
 * Acknowledged findings (the triage loop, 2026-11-25): an operator can mark
 * a report issue as known/false — a "dead to us" list keyed by the cluster
 * fingerprint. Ignored issues are filtered OUT of every report read (old
 * cached reports included) and listed in an honest "suppressed" section with
 * the acknowledge reason. Un-ignore restores the issue instantly: the
 * filter runs at read time, the stored report is never rewritten.
 */

function seedRun(db: ReturnType<typeof openDb>): { runId: number; deadKey: string; errKey: string } {
  const runId = createRun(db, { targetUrl: 'http://127.0.0.1:1', agents: 1 });
  for (let i = 0; i < 3; i++) {
    addFinding(db, {
      runId,
      type: 'dead_click',
      severity: 'medium',
      confidence: 'high',
      persona: 'wanderer',
      evidence: { action: 'Legacy toggle', why: 'no effect' },
    });
  }
  addFinding(db, {
    runId,
    type: 'console_error',
    severity: 'low',
    confidence: 'medium',
    persona: 'wanderer',
    evidence: { text: 'Failed to load resource: 404' },
  });
  return { runId, deadKey: '', errKey: '' };
}

describe('ignored findings: db helpers', () => {
  it('add / list / upsert / remove round-trip', () => {
    const db = openDb(join(mkdtempSync('/tmp/opencode/uip-ign-'), 'db.sqlite'));
    addIgnoredFinding(db, { key: 'act:legacy-toggle', title: 'dead control: "Legacy toggle"', reason: 'intentional — placeholder button' });
    addIgnoredFinding(db, { key: 'ep:/x:console:failed-to-load', title: 'console error', reason: null });

    let all = listIgnoredFindings(db);
    expect(all).toHaveLength(2);
    expect(all.find((i) => i.cluster_key === 'act:legacy-toggle')!.reason).toContain('intentional');

    // re-acknowledging the same key UPDATES the reason (no duplicate rows)
    addIgnoredFinding(db, { key: 'act:legacy-toggle', title: 'dead control: "Legacy toggle"', reason: 'changed my mind' });
    all = listIgnoredFindings(db);
    expect(all).toHaveLength(2);
    expect(all.find((i) => i.cluster_key === 'act:legacy-toggle')!.reason).toBe('changed my mind');

    expect(removeIgnoredFinding(db, all.find((i) => i.cluster_key === 'act:legacy-toggle')!.id)).toBe(true);
    expect(listIgnoredFindings(db)).toHaveLength(1);
    db.close();
  });
});

describe('ignored findings: report read-time filtering (API)', () => {
  let web: Awaited<ReturnType<typeof startWebServer>>;
  let wsDir: string;
  let wsDb: ReturnType<typeof openDb>;
  let runId: number;
  let deadKey: string;

  beforeAll(async () => {
    wsDir = mkdtempSync('/tmp/opencode/uip-ign-ws-');
    web = await startWebServer({
      port: 0,
      workspaceRoot: wsDir,
      frontendDir: '/nonexistent',
      llmEnv: { LLM_API_KEY: '' },
    });
    // seed the server's own workspace DB with a run + findings, and cache a
    // mechanical report exactly the way a finished scan would
    const ws = initWorkspace(wsDir);
    wsDb = openDb(ws.db);
    runId = createRun(wsDb, { targetUrl: 'http://127.0.0.1:1', agents: 1 });
    for (let i = 0; i < 3; i++) {
      addFinding(wsDb, {
        runId,
        type: 'dead_click',
        severity: 'medium',
        confidence: 'high',
        persona: 'wanderer',
        evidence: { action: 'Legacy toggle', why: 'no effect' },
      });
    }
    addFinding(wsDb, {
      runId,
      type: 'console_error',
      severity: 'low',
      confidence: 'medium',
      persona: 'wanderer',
      evidence: { text: 'Failed to load resource: 404' },
    });
    const report = await generateReport({
      db: wsDb,
      runId,
      appMap: {
        framework: 'unknown',
        stack: [],
        files: [],
        routes: [], elements: [], apiCalls: [], envVars: [], imports: {}, clientEntryFiles: [],
        supabase: { tables: [], clientFiles: [], migrations: [] }, fileCount: 0, extractedAt: 'test',
      } satisfies AppMap,
      llm: createLlm({ LLM_API_KEY: '' }),
      runsDir: ws.runs,
    });
    expect(report.issues.length).toBeGreaterThanOrEqual(2);
    deadKey = report.issues.find((i) => i.title.includes('Legacy toggle'))!.key;
  });

  afterAll(async () => {
    wsDb.close();
    await web.close();
  });

  it('ignore an issue → it leaves the report and appears in the suppressed section with the reason', async () => {
    const base = `http://127.0.0.1:${web.port}`;
    const ack = await fetch(`${base}/api/runs/${runId}/ignore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: deadKey, reason: 'intentional placeholder — shipping decision' }),
    });
    expect(ack.status).toBe(201);

    const res = await fetch(`${base}/api/runs/${runId}/report`);
    const body = await res.json() as { report: { issues: Array<{ key: string }>; knownIssues: Array<{ key: string; reason: string | null; title: string }> } };
    expect(body.report.issues.find((i) => i.key === deadKey)).toBeUndefined();
    expect(body.report.issues.length).toBeGreaterThanOrEqual(1); // the console error stays
    const known = body.report.knownIssues;
    expect(known.find((k) => k.key === deadKey)!.reason).toContain('intentional placeholder');

    const list = await (await fetch(`${base}/api/ignored`)).json() as { ignored: Array<{ cluster_key: string }> };
    expect(list.ignored.some((i) => i.cluster_key === deadKey)).toBe(true);
  });

  it('un-ignore → the issue is back in the report instantly (read-time filter)', async () => {
    const base = `http://127.0.0.1:${web.port}`;
    const list = await (await fetch(`${base}/api/ignored`)).json() as { ignored: Array<{ id: number; cluster_key: string }> };
    const id = list.ignored.find((i) => i.cluster_key === deadKey)!.id;

    const del = await fetch(`${base}/api/ignored/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);

    const res = await fetch(`${base}/api/runs/${runId}/report`);
    const body = await res.json() as { report: { issues: Array<{ key: string }>; knownIssues: unknown[] } };
    expect(body.report.issues.find((i) => i.key === deadKey)).toBeDefined();
    expect(body.report.knownIssues).toHaveLength(0);
  });
});
