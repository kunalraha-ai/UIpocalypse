import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { FakeLlm, createLlm } from '../src/llm/index.js';
import type { CollectedRun, Cluster } from '../src/collect/collector.js';
import type { AppMap } from '../src/analyzer/types.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb, createRun, addFinding, finishRun } from '../src/db/index.js';
import { diffRuns } from '../src/report/reviewer.js';
import {
  mechanicalReview,
  reviewRun,
  assembleReport,
  markdownReport,
  saveReport,
  loadReport,
  reportFile,
  type RunMeta,
} from '../src/report/reviewer.js';

const APP_MAP = {
  framework: 'next-app',
  stack: ['next'],
  files: [],
  routes: [
    { path: '/api/orders', kind: 'api', file: 'app/api/orders/route.ts' },
    { path: '/api/auth/login', kind: 'api', file: 'app/api/auth/login/route.ts' },
    { path: '/api/credits/buy', kind: 'api', file: 'app/api/credits/buy/route.ts' },
    // NOTE: /api/promo intentionally absent — the missing-endpoint bug
  ],
  elements: [
    { tag: 'button', file: 'components/ProfileForm.tsx', line: 21, label: 'Save profile', handlers: ['onClick'], emptyHandlers: ['onClick'], inForm: false, ariaHidden: false, hasAction: false, hasOnSubmit: false, hasMethodAttr: false, submitType: false },
  ],
  apiCalls: [],
  envVars: [],
  imports: {},
  clientEntryFiles: [],
  supabase: { tables: [], clientFiles: [], migrations: [] },
  fileCount: 3,
  extractedAt: new Date().toISOString(),
} as unknown as AppMap;

function cluster(partial: Partial<Cluster> & { key: string; title: string }): Cluster {
  return {
    key: partial.key,
    family: partial.family ?? 'action',
    types: partial.types ?? ['dead_click'],
    title: partial.title,
    subject: partial.subject ?? '/profile',
    severity: partial.severity ?? 'medium',
    confidence: partial.confidence ?? 'high',
    classification: partial.classification ?? 'finding',
    observations: partial.observations ?? 3,
    samples: partial.samples ?? [{ action: 'Save profile' }],
    steps: partial.steps ?? ['click #2 @ abc', 'click #7 (input) @ abc'],
    codeRefs: partial.codeRefs ?? [{ file: 'components/ProfileForm.tsx', line: 21, what: '<button>' }],
  };
}

const RUN: RunMeta = { runId: 7, targetUrl: 'http://localhost:3123', agents: 50, wallMs: 96_400, llmCalls: 40 };

function collected(over: Partial<CollectedRun> = {}): CollectedRun {
  const clusters = over.clusters ?? [
    cluster({ key: 'act:Save profile', title: 'dead control: "Save profile"' }),
    cluster({
      key: 'dup:/api/credits/buy',
      family: 'duplicate',
      types: ['duplicate_request'],
      title: 'double-submitted writes to /api/credits/buy',
      severity: 'medium',
      confidence: 'medium',
      observations: 6,
    }),
  ];
  return {
    runId: RUN.runId,
    clusters,
    findingClusters: over.findingClusters ?? clusters,
    correctRejections: over.correctRejections ?? [
      cluster({ key: 'ep:/api/auth/login:req:401', title: 'correct rejection (401) on /api/auth/login', severity: 'info', classification: 'correct_rejection', observations: 58, codeRefs: [] }),
    ],
    artifacts: over.artifacts ?? [],
    coverage: over.coverage ?? {
      coverage: 1,
      appMapCoverage: 1,
      reachedActions: 42,
      discoveredActions: 42,
      appMapTotal: 42,
      appMapReached: 42,
      unreached: [],
    },
  };
}

describe('reviewer + report (TRD §3.7 FR-R1, LLM call #2)', () => {
  let runsDir: string;
  beforeEach(() => {
    runsDir = mkdtempSync('/tmp/opencode/uip-reports-');
  });
  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it('degrades to a mechanical review without an LLM (–no-llm mode)', async () => {
    const llm = createLlm({ LLM_API_KEY: '' }); // NullLlm
    const review = await reviewRun({ collected: collected(), appMap: APP_MAP, llm, run: RUN });
    expect(llm.configured).toBe(false);
    expect(review.issues).toHaveLength(2);
    expect(review.issues[0]!.fixPrompt).toMatch(/Wire the "Save profile"/);
    expect(review.issues[0]!.file).toBe('components/ProfileForm.tsx');
    expect(review.issues[1]!.fixPrompt).toMatch(/submit guard/);
  });

  it('one LLM call over clustered findings, validated; failure falls back to mechanical', async () => {
    const llm = new FakeLlm();
    llm.script((user) => {
      expect(user).toContain('act:Save profile');
      expect(user).toContain('dup:/api/credits/buy');
      expect(user).not.toContain('correct rejection'); // rejections never reach the LLM
      return {
        summary: 'Two real issues: a dead button and a double-submit hole.',
        issues: [
          { key: 'act:Save profile', title: 'dead control: "Save profile"', rootCause: 'empty onClick', fixPrompt: 'Wire the onClick in ProfileForm.', file: 'components/ProfileForm.tsx', line: 21 },
          { key: 'dup:/api/credits/buy', title: 'double-submitted writes', rootCause: 'no submit guard', fixPrompt: 'Disable the button while the POST is in flight.' },
        ],
      };
    });
    const review = await reviewRun({ collected: collected(), appMap: APP_MAP, llm, run: RUN });
    expect(llm.calls).toBe(1);
    expect(review.summary).toMatch(/Two real issues/);
    expect(review.issues.find((i) => i.key === 'dup:/api/credits/buy')!.fixPrompt).toMatch(/Disable the button/);

    // a malformed/failed LLM reply must not lose the report
    const bad = new FakeLlm();
    bad.script(() => {
      throw new Error('over budget');
    });
    const fallback = await reviewRun({ collected: collected(), appMap: APP_MAP, llm: bad, run: RUN });
    expect(fallback.issues).toHaveLength(2); // mechanical review shipped
  });

  it('assembleReport: severity-ordered issues with evidence, rejections + coverage sections', () => {
    const review = mechanicalReview(collected());
    const report = assembleReport(collected(), review, RUN);
    expect(report.issues.every((i) => i.fixPrompt.length > 0)).toBe(true);
    expect(report.correctRejections).toHaveLength(1);
    expect(report.coverage.coverage).toBe(1);
    expect(report.run.runId).toBe(7);

    const md = markdownReport(report);
    expect(md).toContain('# UIpocalypse report — run 7');
    expect(md).toContain('**Fix prompt:**');
    expect(md).toContain('## Correct rejections');
    expect(md).toMatch(/Coverage \(app map\):\*\* 100%/);
  });

  it('reports are cached per run: repeated get_report costs zero LLM calls', () => {
    const report = assembleReport(collected(), mechanicalReview(collected()), RUN);
    const file = saveReport(runsDir, report);
    expect(existsSync(file)).toBe(true);
    expect(file).toBe(reportFile(runsDir, 7));
    const loaded = loadReport(runsDir, 7);
    expect(loaded!.issues).toHaveLength(report.issues.length);
    expect(JSON.parse(readFileSync(file, 'utf8')).runId).toBe(7);
    expect(loadReport(runsDir, 999)).toBeNull();
  });

  it('diff_runs: fixed needs 2 consecutive absences; mixed presence is intermittent (spec change, phase 5)', () => {
    const ws = initWorkspace(mkdtempSync('/tmp/opencode/uip-diff-'));
    const db = openDb(ws.db);
    const mkRun = (findings: Array<{ type: string; evidence: Record<string, unknown> }>) => {
      const runId = createRun(db, { targetUrl: 'http://x', agents: 5 });
      for (const f of findings) addFinding(db, { runId, type: f.type, severity: 'medium', confidence: 'high', persona: 'swarm', evidence: f.evidence });
      finishRun(db, { id: runId, durationMs: 1000, llmCalls: 0, coverage: 1 });
      return runId;
    };
    const stable = { type: 'failed_request', evidence: { url: 'http://x/api/promo', status: 404 } };
    const flapping = { type: 'dead_click', evidence: { action: 'Flaky button' } };
    const goneForGood = { type: 'dead_click', evidence: { action: 'Really fixed button' } };
    const justArrived = { type: 'duplicate_request', evidence: { url: 'http://x/api/checkout', count: 2 } };
    const oneShot = { type: 'page_error', evidence: { message: 'boom once', pageUrl: 'http://x/profile' } };
    const fading = { type: 'failed_request', evidence: { url: 'http://x/api/search', status: 500 } };

    const r1 = mkRun([stable, flapping, goneForGood, fading]);
    const r2 = mkRun([stable, fading, justArrived]);
    const r3 = mkRun([stable, flapping, justArrived, oneShot]);

    const diff = diffRuns(db, APP_MAP, [r1, r2, r3]);
    expect(diff.runs).toEqual([r1, r2, r3]);

    // present in all three → still failing
    expect(diff.stillFailing.map((f) => f.key)).toEqual(['ep:/api/promo:req:404']);
    // present in r1+r3, absent r2 → intermittent, NOT fixed/new
    expect(diff.intermittent.map((f) => f.key)).toEqual(expect.arrayContaining(['act:Flaky button']));
    expect(diff.intermittent.find((f) => f.key === 'act:Flaky button')!.presentIn).toEqual([r1, r3]);
    // present r1, absent r2 AND r3 (2 consecutive absences) → fixed
    expect(diff.fixed.map((f) => f.key)).toEqual(['act:Really fixed button']);
    // absent r1, present r2+r3 (last two consecutive) → new
    expect(diff.new.map((f) => f.key)).toEqual(['dup:/api/checkout']);
    // present only in r3 — a single-run appearance is intermittent, not "new"
    expect(diff.intermittent.map((f) => f.key)).toEqual(expect.arrayContaining(['ep:/profile:page:boom once']));
    expect(diff.new.map((f) => f.key)).not.toContain('ep:/profile:page:boom once');
    // present r1+r2, absent only r3 — ONE absence is NOT a fix
    expect(diff.intermittent.map((f) => f.key)).toEqual(expect.arrayContaining(['ep:/api/search:req:500']));
    expect(diff.fixed.map((f) => f.key)).not.toContain('ep:/api/search:req:500');
    // correct rejections never appear in any bucket — they are not findings
    const allBuckets = [...diff.fixed, ...diff.new, ...diff.stillFailing, ...diff.intermittent].map((x) => x.key);
    expect(allBuckets).not.toContain('ep:/api/auth/login:req:401');

    db.close();
  });
});
