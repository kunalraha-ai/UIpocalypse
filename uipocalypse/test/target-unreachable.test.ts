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
    expect(report.targetUnreachable!.mode).toBe('never');
    const md = markdownReport(report);
    // the banner comes before everything except the title
    const bannerIdx = md.search(/NEVER REACHABLE|BECAME UNREACHABLE/i);
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

  it('distinguishes NEVER reachable (empty graph) from BECAME unreachable (collapse finding with agent count)', async () => {
    const db = openDb(initWorkspace(mkdtempSync('/tmp/opencode/uip-unreach3-')).db);
    const review = await reviewRun({ collected: collectedWith([]), appMap: {} as never, llm: createLlm({ LLM_API_KEY: '' }), run: meta });

    // NEVER reachable: refusals dominate AND the graph is empty — the swarm
    // never saw a live page (the fresh-eyes run 1 shape)
    const neverCollected = collectedWith(Array.from({ length: 12 }, (_, i) => refusedRow(i + 1)));
    const never = assembleReport(neverCollected, review, meta);
    expect(never.targetUnreachable).toBeDefined();
    const neverMd = markdownReport(never);
    expect(neverMd).toMatch(/never reachable|down for this entire run/i);
    expect(neverMd).not.toMatch(/became unreachable/i);

    // BECAME unreachable: the graph is non-empty (the app WAS alive and
    // explored) but refusals dominate — it collapsed mid-run. With the ramp's
    // degradation level available, the report names the agent count and emits
    // an app-collapse FINDING.
    const collapseCollected = collectedWith([
      deadClickRow(1), // evidence the app was alive
      ...Array.from({ length: 24 }, (_, i) => refusedRow(i + 2)),
    ]);
    // 24 refusals of 25 observations? deadClickRow clusters separately, so
    // refusal dominance needs the refused cluster to outweigh — force it:
    const collapse: typeof collapseCollected = {
      ...collapseCollected,
      coverage: { ...collapseCollected.coverage, reachedActions: 3, discoveredActions: 5 },
    };
    const collapseMeta: typeof meta = { ...meta, agentsAtCollapse: 8 };
    const collapsed = assembleReport(collapse, review, collapseMeta);
    expect(collapsed.targetUnreachable).toBeDefined();
    const md = markdownReport(collapsed);
    expect(md).toMatch(/became unreachable/i);
    expect(md).toMatch(/at ~?8 agents/i);
    // the collapse is reported as a FINDING, not just a banner
    const collapseIssue = collapsed.issues.find((i) => i.key.includes('app:collapse'));
    expect(collapseIssue).toBeDefined();
    expect(collapseIssue!.severity).toBe('high');
    expect(collapseIssue!.title).toMatch(/collapsed under load/i);
    expect(collapseIssue!.fixPrompt).toMatch(/agents\s*=\s*8/i);
    db.close();
  });
});
