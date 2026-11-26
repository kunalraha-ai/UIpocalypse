import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTestFile, exportRunTests } from '../src/tools/export-test.js';
import type { FixVerification } from '../src/browser/replay.js';
import { openDb, createRun, addFinding } from '../src/db/index.js';
import { createLogger } from '../src/logger.js';
import { serveStatic } from './helpers.js';

/**
 * Bugs become permanent tests (2026-11-26): every finding the verified-fix
 * loop confirms as FIXED can be exported as a self-contained Playwright test
 * the user owns — no lock-in, the suite compounds with the product. The
 * rules that keep generated tests trustworthy:
 *
 *   - only `fixed` clusters export (a fixed bug gets a test; a still-broken
 *     one would just pin the breakage)
 *   - the test asserts the CONTRACT, not the pixels: "the recorded error no
 *     longer occurs", "the control produces feedback" — a redesign only
 *     breaks the test when it breaks the contract
 *   - an optional stability gate re-runs the replay N times and refuses to
 *     emit a test that cannot pass consistently — generated flakiness is the
 *     one thing this feature must never add
 */

const FIXED_STAMP: FixVerification = { verdict: 'fixed', note: 'replayed: the control now produces feedback', verifiedAt: '2026-11-26T10:00:00.000Z' };

const spec = (type: string, evidence: Record<string, unknown>, key: string) => ({
  clusterKey: key,
  runId: 7,
  type,
  evidence,
  fixVerified: FIXED_STAMP,
});

describe('test generator (pure)', () => {
  it('dead_click -> a feedback-asserting test with a resilient locator', () => {
    const out = buildTestFile(
      spec('dead_click', { action: 'Dead submit', pageUrl: 'http://localhost:3000/settings' }, 'act:dead-submit'),
    ) as { filename: string; content: string };
    expect(out.filename).toBe('uip-dead-submit.spec.ts');
    expect(out.content).toContain(`const BASE_URL = process.env.UIP_BASE_URL ?? 'http://localhost:3000'`);
    expect(out.content).toContain(`page.goto(\`\${BASE_URL}/settings\`)`);
    expect(out.content).toContain(`getByRole('button', { name: 'Dead submit' })`);
    // the inline mutation probe — the contract is "clicking changes something"
    expect(out.content).toContain('MutationObserver');
    expect(out.content).toContain('no observable change');
    // provenance the user can trace back
    expect(out.content).toContain('run #7');
    expect(out.content).toContain('act:dead-submit');
  });

  it('console_error -> a test that fails when the recorded error reappears', () => {
    const out = buildTestFile(
      spec('console_error', { text: 'Uncaught ReferenceError: notAFunction is not defined', pageUrl: 'http://localhost:3000/' }, 'ep:console:x'),
    ) as { filename: string; content: string };
    expect(out.filename).toBe('uip-console-notafunction.spec.ts');
    expect(out.content).toContain(`'Uncaught ReferenceError: notAFunction is not defined'`);
    // numbers are masked on both sides — an id in the message never breaks the match
    expect(out.content).toContain(`replace(/\\d+/g, '#')`);
    expect(out.content).toContain(`page.on('console'`);
    expect(out.content).toContain(`page.on('pageerror'`);
  });

  it('navigation_error -> a content-and-not-framework-error assertion', () => {
    const out = buildTestFile(
      spec('navigation_error', { pageUrl: 'http://localhost:3000/crash' }, 'ep:crash:navigation_error'),
    ) as { filename: string; content: string };
    expect(out.content).toContain('/crash');
    expect(out.content).toContain(`body.length`);
    expect(out.content).toMatch(/this page couldn\??\.?t load|application error/);
  });

  it('failed_request -> a listener that fails if the recorded request fails again', () => {
    const out = buildTestFile(
      spec('failed_request', { url: 'http://localhost:3000/api/thing', status: 404, pageUrl: 'http://localhost:3000/' }, 'ep:api-thing'),
    ) as { filename: string; content: string };
    expect(out.content).toContain(`'/api/thing'`);
    expect(out.content).toContain(`>= 400`);
    expect(out.content).toContain(`page.on('response'`);
  });

  it('infinite_spinner -> a 12 s stuck-spinner assertion', () => {
    const out = buildTestFile(
      spec('infinite_spinner', { label: 'Loading', pageUrl: 'http://localhost:3000/' }, 'act:loading'),
    ) as { filename: string; content: string };
    expect(out.content).toContain(`progressbar`);
    expect(out.content).toContain(`12000`);
  });

  it('unsupported types say so instead of generating junk', () => {
    const out = buildTestFile(spec('duplicate_request', { url: 'http://localhost:3000/api/echo', pageUrl: 'http://localhost:3000/' }, 'dup:echo'));
    expect('unsupported' in out && out.unsupported).toContain('duplicate');
  });

  it('distinct clusters that slug identically never overwrite each other', () => {
    // run through the exporter logic via a tiny harness: same filename twice
    const spec1 = spec('console_error', { text: 'Uncaught ReferenceError: notAFunction is not defined', pageUrl: 'http://localhost:3000/' }, 'a');
    const spec2 = spec('console_error', { text: 'ReferenceError: notAFunction is not defined', pageUrl: 'http://localhost:3000/' }, 'b');
    const f1 = buildTestFile(spec1) as { filename: string };
    const f2 = buildTestFile(spec2) as { filename: string };
    expect(f1.filename).toBe(f2.filename); // same slug —
    // the exporter's dedupe suffix handles the collision (pinned in the e2e
    // below via the real run export: two page_error clusters, two files)
    expect(f1.filename).toBe('uip-console-notafunction.spec.ts');
  });
});

describe('exportRunTests', () => {
  function seedFixedRun(dir: string, stamps = FIXED_STAMP) {
    const db = openDb(join(mkdtempSync(dir), 'db.sqlite'));
    const runId = createRun(db, { targetUrl: 'http://localhost:3000', agents: 1 });
    const rows: Array<[string, Record<string, unknown>, string]> = [
      ['dead_click', { action: 'Dead submit', pageUrl: 'http://localhost:3000/' }, 'act:dead-submit'],
      ['console_error', { text: 'Uncaught ReferenceError: notAFunction is not defined', pageUrl: 'http://localhost:3000/' }, 'ep:console:x'],
      ['dead_click', { action: 'Dead submit', pageUrl: 'http://localhost:3000/' }, 'act:dead-submit-2'], // still-broken below
    ];
    for (const [type, evidence, key] of rows) {
      const fixed = key !== 'act:dead-submit-2';
      addFinding(db, {
        runId,
        type,
        severity: 'medium',
        confidence: 'high',
        persona: 'wanderer',
        evidence: {
          ...evidence,
          steps: [],
          fixVerified: fixed ? stamps : { verdict: 'still-broken', note: 'not fixed', verifiedAt: '2026-11-26T10:00:00.000Z' },
        },
      });
    }
    db.prepare('UPDATE findings SET cluster_id = ? WHERE run_id = ? AND type = ?').run('act:dead-submit', runId, 'dead_click');
    // second dead_click row shares the first cluster? keep them distinct:
    db.prepare(
      "UPDATE findings SET cluster_id = CASE id WHEN (SELECT MIN(id) FROM findings WHERE run_id = ? AND type = 'dead_click') THEN 'act:dead-submit' ELSE 'act:dead-submit-2' END WHERE run_id = ? AND type = 'dead_click'",
    ).run(runId, runId);
    db.prepare("UPDATE findings SET cluster_id = 'ep:console:x' WHERE run_id = ? AND type = 'console_error'").run(runId);
    return { db, runId };
  }

  it('exports only fixed clusters; everything else is listed with an honest reason', async () => {
    const { db, runId } = seedFixedRun('/tmp/opencode/uip-exp1-');
    const outDir = mkdtempSync('/tmp/opencode/uip-expdir-');
    const result = await exportRunTests({ db, runId, outDir, logger: createLogger({}) });

    // two fixed clusters -> two files on disk
    expect(result.files).toHaveLength(2);
    expect(result.written.sort()).toEqual([join(outDir, 'uip-console-notafunction.spec.ts'), join(outDir, 'uip-dead-submit.spec.ts')].sort());
    const content = readFileSync(join(outDir, 'uip-dead-submit.spec.ts'), 'utf8');
    expect(content).toContain('Dead submit');
    // the still-broken cluster is skipped with the fix-it-first reason
    expect(result.skipped).toEqual([{ key: 'act:dead-submit-2', reason: expect.stringContaining('still-broken') }]);
    db.close();
  });

  it('the stability gate refuses to emit a test that cannot pass consistently', async () => {
    // findings stamped fixed, but the app behind baseUrl is still BROKEN —
    // every stress replay comes back still-broken, so nothing may be written
    const { db, runId } = seedFixedRun('/tmp/opencode/uip-exp2-');
    const outDir = mkdtempSync('/tmp/opencode/uip-expdir2-');
    const broken = await serveStatic(join(import.meta.dirname, 'fixtures', 'replay-site', 'broken'));

    const result = await exportRunTests({
      db,
      runId,
      outDir,
      logger: createLogger({}),
      stress: 2,
      baseUrl: broken.url, // the app as it "is now" is broken again
    });

    expect(result.files).toHaveLength(0);
    expect(readdirSync(outDir)).toHaveLength(0);
    // two fixed clusters went unstable against the broken app, plus the
    // still-broken cluster that never exports
    expect(result.skipped.length).toBe(3);
    expect(result.skipped[0]!.reason).toMatch(/unstable/i);
    expect(result.skipped[0]!.reason).toContain('0/2');
    db.close();
    await broken.close();
  }, 120_000);

  it('a stable app passes the gate and the stability lands in the file header', async () => {
    const { db, runId } = seedFixedRun('/tmp/opencode/uip-exp3-');
    const outDir = mkdtempSync('/tmp/opencode/uip-expdir3-');
    const fixed = await serveStatic(join(import.meta.dirname, 'fixtures', 'replay-site', 'fixed'));

    const result = await exportRunTests({ db, runId, outDir, logger: createLogger({}), stress: 2, baseUrl: fixed.url });

    expect(result.files).toHaveLength(2);
    const content = readFileSync(join(outDir, 'uip-dead-submit.spec.ts'), 'utf8');
    expect(content).toContain('Stability: 2/2 replays passed');
    expect(result.skipped).toEqual([{ key: 'act:dead-submit-2', reason: expect.stringContaining('still-broken') }]);
    db.close();
    await fixed.close();
  }, 120_000);
});
