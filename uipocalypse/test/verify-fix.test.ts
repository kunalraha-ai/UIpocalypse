import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { verifyRunFixes, type FixVerification } from '../src/browser/replay.js';
import { openDb, createRun, addFinding, listFindings } from '../src/db/index.js';
import { serveStatic, tmpWorkspace } from './helpers.js';

/**
 * Verified-fix loop (2026-11-26): after a coding agent applies a fix,
 * verify_fix replays each recorded finding against the app as it is NOW and
 * reports fixed / still broken / stale / intermittent / unverifiable — never
 * a binary guess. This is the verification sweep generalized across finding
 * types and pointed at the current code instead of the same run.
 *
 * Findings are seeded directly with the exact evidence shapes the detectors
 * persist (addFinding stores { ...evidence, steps, pageUrl }); the broken
 * and fixed fixture twins make every verdict deterministic.
 */

const BROKEN = join(import.meta.dirname, 'fixtures', 'replay-site', 'broken');
const FIXED = join(import.meta.dirname, 'fixtures', 'replay-site', 'fixed');

type Seed = { type: string; severity?: string; confidence?: string; evidence: Record<string, unknown> };

const FINDINGS: Seed[] = [
  { type: 'dead_click', severity: 'medium', confidence: 'high', evidence: { action: 'Dead submit', why: 'no effect' } },
  { type: 'console_error', severity: 'low', confidence: 'medium', evidence: { text: 'Uncaught ReferenceError: notAFunction is not defined' } },
  { type: 'page_error', severity: 'high', confidence: 'high', evidence: { message: 'Uncaught ReferenceError: notAFunction is not defined' } },
  { type: 'failed_request', severity: 'medium', confidence: 'high', evidence: { url: 'ORIGIN/missing.png', status: 404 } },
  { type: 'navigation_error', severity: 'high', confidence: 'high', evidence: { snippet: '', blank: true } },
];

function seedRun(baseUrl: string): ReturnType<typeof openDb> {
  const db = openDb(join(mkdtempSync('/tmp/opencode/uip-fix-'), 'db.sqlite'));
  const runId = createRun(db, { targetUrl: baseUrl, agents: 1 });
  for (const f of FINDINGS) {
    const pageUrl = f.type === 'navigation_error' ? `${baseUrl}/crash.html` : `${baseUrl}/`;
    const url = typeof f.evidence.url === 'string' ? (f.evidence.url as string).replace('ORIGIN', baseUrl) : undefined;
    addFinding(db, {
      runId,
      type: f.type,
      severity: f.severity ?? 'medium',
      confidence: f.confidence ?? 'medium',
      persona: 'wanderer',
      evidence: { ...f.evidence, ...(url ? { url } : {}), steps: [], pageUrl },
    });
  }
  return db;
}

function verdictOf(db: ReturnType<typeof openDb>, type: string): FixVerification | undefined {
  const row = listFindings(db, 1).find((r) => r.type === type);
  if (!row) return undefined;
  return (JSON.parse(row.evidence_json!) as Record<string, unknown>).fixVerified as FixVerification | undefined;
}

describe('verify_fix: the replay engine', () => {
  it('unchanged app → every supported finding is STILL BROKEN', async () => {
    const broken = await serveStatic(BROKEN);
    const db = seedRun(broken.url);
    const ws = tmpWorkspace();

    const summary = await verifyRunFixes({ db, runId: 1, baseUrl: broken.url, logger: ws.logger });

    expect(summary.verified).toBeGreaterThanOrEqual(5);
    expect(verdictOf(db, 'dead_click')!.verdict).toBe('still-broken');
    expect(verdictOf(db, 'console_error')!.verdict).toBe('still-broken');
    expect(verdictOf(db, 'page_error')!.verdict).toBe('still-broken');
    expect(verdictOf(db, 'failed_request')!.verdict).toBe('still-broken');
    expect(verdictOf(db, 'navigation_error')!.verdict).toBe('still-broken');
    // the note says what the replay observed, in the product's own voice
    expect(verdictOf(db, 'dead_click')!.note).toContain('no effect');

    db.close();
    await broken.close();
    ws.cleanup();
  }, 120_000);

  it('fixed app → every supported finding is FIXED, and the notes say why', async () => {
    const broken = await serveStatic(BROKEN);
    const fixed = await serveStatic(FIXED);
    const db = seedRun(broken.url); // findings recorded against the OLD origin…
    const ws = tmpWorkspace();

    // …replayed against the app as it is now (a different origin — same app)
    const summary = await verifyRunFixes({ db, runId: 1, baseUrl: fixed.url, logger: ws.logger });

    expect(verdictOf(db, 'dead_click')!.verdict).toBe('fixed');
    expect(verdictOf(db, 'console_error')!.verdict).toBe('fixed');
    expect(verdictOf(db, 'page_error')!.verdict).toBe('fixed');
    expect(verdictOf(db, 'failed_request')!.verdict).toBe('fixed');
    expect(verdictOf(db, 'navigation_error')!.verdict).toBe('fixed');
    expect(summary.results.filter((r) => r.verdict === 'fixed').length).toBe(5);

    db.close();
    await broken.close();
    await fixed.close();
    ws.cleanup();
  }, 120_000);

  it('page gone → STALE, honestly distinguished from fixed', async () => {
    const broken = await serveStatic(BROKEN);
    const db = seedRun(broken.url);
    const ws = tmpWorkspace();
    // a server with nothing at the recorded paths (the app was restructured)
    const empty = await serveStatic(join(import.meta.dirname, 'fixtures', 'flaky-site'));

    await verifyRunFixes({ db, runId: 1, baseUrl: empty.url, logger: ws.logger });

    const dead = verdictOf(db, 'dead_click')!;
    expect(dead.verdict).toBe('stale'); // the recorded control no longer exists
    expect(dead.note).toContain('no longer');
    expect(verdictOf(db, 'navigation_error')!.verdict).toBe('stale'); // recorded page is gone

    db.close();
    await broken.close();
    await empty.close();
    ws.cleanup();
  }, 120_000);

  it('unsupported finding types say so instead of guessing', async () => {
    const broken = await serveStatic(BROKEN);
    const db = openDb(join(mkdtempSync('/tmp/opencode/uip-fix3-'), 'db.sqlite'));
    const runId = createRun(db, { targetUrl: broken.url, agents: 1 });
    addFinding(db, {
      runId,
      type: 'duplicate_request',
      severity: 'medium',
      confidence: 'medium',
      persona: 'double-clicker',
      evidence: { url: `${broken.url}/api/echo`, count: 2, operation: undefined, steps: [], pageUrl: `${broken.url}/` },
    });
    const ws = tmpWorkspace();

    const summary = await verifyRunFixes({ db, runId, baseUrl: broken.url, logger: ws.logger });

    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]!.verdict).toBe('unsupported');
    expect(summary.results[0]!.note).toContain('swarm');
    db.close();
    await broken.close();
    ws.cleanup();
  }, 120_000);

  it('cluster aggregation: one cluster, many rows — every row carries the verdict', async () => {
    const broken = await serveStatic(BROKEN);
    const db = openDb(join(mkdtempSync('/tmp/opencode/uip-fix4-'), 'db.sqlite'));
    const runId = createRun(db, { targetUrl: broken.url, agents: 1 });
    for (let i = 0; i < 3; i++) {
      addFinding(db, {
        runId,
        type: 'dead_click',
        severity: 'medium',
        confidence: 'high',
        persona: 'wanderer',
        evidence: { action: 'Dead submit', why: 'no effect', steps: [], pageUrl: `${broken.url}/` },
      });
    }
    const ws = tmpWorkspace();
    // backfill the cluster key like collectRun does
    db.prepare("UPDATE findings SET cluster_id = 'act:dead-submit' WHERE run_id = ?").run(runId);

    await verifyRunFixes({ db, runId, baseUrl: broken.url, logger: ws.logger });

    const rows = listFindings(db, runId);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const ev = JSON.parse(r.evidence_json!) as { fixVerified?: { verdict: string } };
      expect(ev.fixVerified?.verdict).toBe('still-broken');
    }
    db.close();
    await broken.close();
    ws.cleanup();
  }, 120_000);
});
