import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { assembleReport, markdownReport, reviewRun, type RunMeta } from '../src/report/reviewer.js';
import { clusterFindings, type CollectedRun } from '../src/collect/collector.js';
import { createLlm } from '../src/llm/index.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb } from '../src/db/index.js';

/**
 * Fresh-eyes prompt-test finding (run 3): when the target app dies mid-run,
 * the connection-refused noise is reported as ordinary findings and a naive
 * reader mistakes it for bugs. The report must say, in plain words and up
 * front, that the target was unreachable — those "findings" describe a dead
 * server, not the app.
 */

const EMPTY_APP_MAP = { routes: [], elements: [], envVars: [], apiCalls: [], supabaseTables: [], imports: {}, framework: 'unknown', stack: {}, files: [] } as never;

function collectedWith(rows: Array<Record<string, unknown>>): CollectedRun {
  const clusters = clusterFindings(rows as never[], EMPTY_APP_MAP);
  return {
    runId: 1,
    clusters,
    findingClusters: clusters.filter((c) => c.classification === 'finding'),
    correctRejections: [],
    artifacts: [],
    inconsistentFeedback: [],
    coverage: { coverage: 0, appMapCoverage: 0, reachedActions: 0, discoveredActions: 0, appMapTotal: 0, appMapReached: 0, appMapUnreached: [], unreached: [] },
  } as never;
}

const meta: RunMeta = { runId: 1, targetUrl: 'http://localhost:3995', agents: 30, wallMs: 60000, llmCalls: 0 };

function refusedRow(id: number) {
  return {
    id, run_id: 1, type: 'failed_request', severity: 'low', confidence: 'medium',
    evidence_json: JSON.stringify({ url: 'http://localhost:3995/', error: 'net::ERR_CONNECTION_REFUSED' }),
    steps_json: '[]', url: 'http://localhost:3995/', cluster_id: null, screenshot: null,
  };
}

function deadClickRow(id: number) {
  return {
    id, run_id: 1, type: 'dead_click', severity: 'medium', confidence: 'high',
    evidence_json: JSON.stringify({ action: 'Save', why: 'no mutation' }),
    steps_json: '[]', url: 'http://localhost:3995/', cluster_id: null, screenshot: null,
  };
}

describe('target-unreachability banner (fresh-eyes finding)', () => {
  it('a run dominated by connection-refused observations leads with an UNREACHABLE banner', async () => {
    const db = openDb(initWorkspace(mkdtempSync('/tmp/opencode/uip-unreach-')).db);
    // 12 refusals — above the banner minimum, mirroring the real dead-app run (307)
    const collected = collectedWith(Array.from({ length: 12 }, (_, i) => refusedRow(i + 1)));
    const review = await reviewRun({ collected, appMap: {} as never, llm: createLlm({ LLM_API_KEY: '' }), run: meta });
    const report = assembleReport(collected, review, meta);
    expect(report.targetUnreachable).toBeDefined();
    expect(report.targetUnreachable!.refused).toBeGreaterThan(0);
    const md = markdownReport(report);
    // the banner comes before everything except the title
    const bannerIdx = md.indexOf('UNREACHABLE');
    expect(bannerIdx).toBeGreaterThan(0);
    expect(md.slice(0, bannerIdx)).not.toContain('## Summary');
    expect(md).toMatch(/connection-refused/i);
    expect(md).toMatch(/not a bug list|describe a server that was down/i);
    db.close();
  });

  it('a healthy run with real findings shows no banner', async () => {
    const db = openDb(initWorkspace(mkdtempSync('/tmp/opencode/uip-unreach2-')).db);
    const collected = collectedWith([deadClickRow(1), deadClickRow(2)]);
    const review = await reviewRun({ collected, appMap: {} as never, llm: createLlm({ LLM_API_KEY: '' }), run: meta });
    const report = assembleReport(collected, review, meta);
    expect(report.targetUnreachable).toBeUndefined();
    expect(markdownReport(report)).not.toMatch(/UNREACHABLE/);
    db.close();
  });
});
