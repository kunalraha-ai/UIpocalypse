import { chromium, type Page } from 'playwright';
import type { Logger } from '../logger.js';
import { RUNTIME_SOURCE } from '../runtime/runtime-source.js';
import { classifyAction } from '../guard/actions.js';
import { mask } from '../graph/hash.js';
import { listFindings, type Db } from '../db/index.js';

/**
 * Verified-fix loop (2026-11-26). After a coding agent applies a fix,
 * verify_fix replays each recorded finding against the app as it is NOW —
 * same mechanism as the post-swarm verification sweep, generalized across
 * finding types and pointed at the current code.
 *
 * Verdicts are honest, never binary guesses:
 *   fixed        the recorded failure no longer reproduces
 *   still-broken the exact failure reproduced on replay
 *   stale        the recorded page or control no longer exists (itself
 *                information: the finding is obsolete after a refactor)
 *   intermittent reproduced inconsistently across repeated replays
 *   unverifiable the replay could not decide (target down, mixed results)
 *   unsupported  finding classes that need a full swarm re-run (duplicates,
 *                race violations) — said plainly instead of guessed
 *
 * Safety: replay only navigates recorded pages and re-clicks controls the
 * swarm already clicked. Destructive-looking labels are skipped by the same
 * policy the guard applies everywhere.
 */

export type FixVerdict = 'fixed' | 'still-broken' | 'stale' | 'intermittent' | 'unverifiable' | 'unsupported';

export type FixVerification = {
  verdict: FixVerdict;
  note: string;
  verifiedAt: string;
  replayedUrl?: string;
};

export type VerifyFixResult = { key: string; type: string; verdict: FixVerdict; note: string };

export type VerifySummary = { verified: number; results: VerifyFixResult[] };

type FindingRow = { id: number; type: string; severity: string | null; cluster_id: string | null; evidence_json: string | null };

const SUPPORTED = new Set(['dead_click', 'inconsistent_feedback', 'console_error', 'page_error', 'failed_request', 'navigation_error', 'infinite_spinner']);
const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
// worst-first aggregation for clusters with multiple replayed rows
const VERDICT_RANK: Record<FixVerdict, number> = {
  'still-broken': 0,
  intermittent: 1,
  unverifiable: 2,
  fixed: 3,
  stale: 4,
  unsupported: 5,
};

/** Masked, whitespace-collapsed message core (same normalization the
 *  collector uses to cluster errors — numbers/ids/dates never break a match). */
function core(text: string): string {
  return mask(text).replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** The recorded page path replayed against the app as it is now. */
function replayUrlFor(ev: Record<string, unknown>, baseUrl: string): string {
  const pageUrl = typeof ev.pageUrl === 'string' ? ev.pageUrl : '';
  try {
    const path = new URL(pageUrl).pathname + new URL(pageUrl).search;
    return new URL(path, baseUrl).href;
  } catch {
    return baseUrl;
  }
}

async function settle(page: Page, ms = 2000): Promise<void> {
  await page.waitForTimeout(ms);
}

/** Replay one finding on a fresh page. Returns the verdict + a note in the
 *  product's own voice. Never throws — a failed replay is a verdict. */
async function replayFinding(
  page: Page,
  type: string,
  ev: Record<string, unknown>,
  baseUrl: string,
): Promise<{ verdict: FixVerdict; note: string; replayedUrl: string }> {
  const replayedUrl = replayUrlFor(ev, baseUrl);

  if (type === 'dead_click' || type === 'inconsistent_feedback') {
    const action = String(ev.action ?? '');
    if (classifyAction({ id: 'replay', label: action }) === 'destructive') {
      return { verdict: 'unsupported', note: 'destructive-looking control — replay is skipped by safety policy (opt in via a new run)', replayedUrl };
    }
    const attempts = type === 'inconsistent_feedback' ? 3 : 1;
    const outcomes: string[] = [];
    for (let i = 0; i < attempts; i++) {
      const resp = await page.goto(replayedUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null);
      if (!resp || resp.status() >= 400) return { verdict: 'stale', note: `the recorded page no longer exists (HTTP ${resp?.status() ?? 'unreachable'})`, replayedUrl };
      await settle(page, 500);
      const actions = (await page.evaluate(() => window.__uip.getActions()).catch(() => [])) as Array<{ id: number; name: string }>;
      const match = actions.find((a) => a.name === action);
      if (!match) return { verdict: 'stale', note: 'the recorded control no longer exists on this page — the finding is obsolete', replayedUrl };
      const result = (await page
        .evaluate((id: number) => window.__uip.perform(id), match.id)
        .catch(() => null)) as { dead: boolean; reasons: string[] } | null;
      if (!result) return { verdict: 'unverifiable', note: 'the replay click could not be executed', replayedUrl };
      outcomes.push(result.dead ? 'dead' : 'alive');
    }
    const dead = outcomes.filter((o) => o === 'dead').length;
    if (dead === 0) return { verdict: 'fixed', note: 'replayed: the control now produces feedback — the fix works', replayedUrl };
    if (dead === outcomes.length) return { verdict: 'still-broken', note: 'replayed: still no effect — true no-op, the fix did not land', replayedUrl };
    return { verdict: 'intermittent', note: `reproduced on ${dead} of ${outcomes.length} replays — intermittent, verify again after the next fix`, replayedUrl };
  }

  if (type === 'console_error' || type === 'page_error') {
    const recorded = core(String(ev.text ?? ev.message ?? ''));
    const seen: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') seen.push(core(msg.text()));
    });
    page.on('pageerror', (err) => {
      seen.push(core(err.message));
    });
    const resp = await page.goto(replayedUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null);
    if (!resp || resp.status() >= 400) return { verdict: 'stale', note: `the recorded page no longer exists (HTTP ${resp?.status() ?? 'unreachable'})`, replayedUrl };
    await settle(page);
    const hit = seen.find((s) => s === recorded || s.includes(recorded) || recorded.includes(s));
    return hit
      ? { verdict: 'still-broken', note: `replayed: the recorded error still occurs ("${recorded.slice(0, 60)}")`, replayedUrl }
      : { verdict: 'fixed', note: 'replayed: the recorded error no longer occurs on this page', replayedUrl };
  }

  if (type === 'failed_request') {
    let recordedPath = '';
    try {
      recordedPath = new URL(String(ev.url ?? '')).pathname;
    } catch {
      return { verdict: 'unverifiable', note: 'the finding records no request URL to watch', replayedUrl };
    }
    const observed: Array<{ status: number }> = [];
    page.on('response', (res) => {
      try {
        if (new URL(res.url()).pathname === recordedPath) observed.push({ status: res.status() });
      } catch {
        /* ignore */
      }
    });
    const resp = await page.goto(replayedUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null);
    if (!resp || resp.status() >= 400) return { verdict: 'stale', note: `the recorded page no longer exists (HTTP ${resp?.status() ?? 'unreachable'})`, replayedUrl };
    await settle(page);
    if (observed.length === 0) return { verdict: 'fixed', note: 'replayed: the failing request no longer occurs — the broken reference is gone', replayedUrl };
    const worst = Math.max(...observed.map((o) => o.status));
    return worst >= 400
      ? { verdict: 'still-broken', note: `replayed: the request still fails (HTTP ${worst})`, replayedUrl }
      : { verdict: 'fixed', note: `replayed: the request now succeeds (HTTP ${worst})`, replayedUrl };
  }

  if (type === 'navigation_error') {
    const resp = await page.goto(replayedUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null);
    if (!resp || resp.status() >= 400) return { verdict: 'stale', note: `the recorded page no longer exists (HTTP ${resp?.status() ?? 'unreachable'})`, replayedUrl };
    await settle(page, 1000);
    const state = await page
      .evaluate(() => ({ text: (document.body?.innerText ?? '').slice(0, 400), blank: (document.body?.innerText ?? '').trim().length === 0 }))
      .catch(() => null);
    if (!state) return { verdict: 'unverifiable', note: 'the page could not be inspected on replay', replayedUrl };
    const broken = state.blank || /this page couldn.?t load|application error/i.test(state.text);
    return broken
      ? { verdict: 'still-broken', note: 'replayed: the page still renders a framework error or blank body', replayedUrl }
      : { verdict: 'fixed', note: 'replayed: the page now renders real content', replayedUrl };
  }

  if (type === 'infinite_spinner') {
    const resp = await page.goto(replayedUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null);
    if (!resp || resp.status() >= 400) return { verdict: 'stale', note: `the recorded page no longer exists (HTTP ${resp?.status() ?? 'unreachable'})`, replayedUrl };
    await settle(page, 12_000);
    const spinning = await page
      .evaluate(() => {
        const el = document.querySelector('[role="progressbar"], [aria-busy="true"], .spinner, .loading');
        return !!el && el.getBoundingClientRect().height > 0;
      })
      .catch(() => null);
    return spinning === null
      ? { verdict: 'unverifiable', note: 'the page could not be inspected on replay', replayedUrl }
      : spinning
        ? { verdict: 'still-broken', note: 'replayed: the spinner is still visible after 12 s', replayedUrl }
        : { verdict: 'fixed', note: 'replayed: no stuck spinner after 12 s', replayedUrl };
  }

  return { verdict: 'unsupported', note: 'this finding type needs a full swarm re-run — use diff_runs to compare', replayedUrl };
}

/** Verify every (or the selected) cluster of a run against the app as it is
 *  now. Stamps each finding row's evidence with its fixVerified verdict —
 *  the finding carries its own verification history. */
export async function verifyRunFixes(opts: {
  db: Db;
  runId: number;
  baseUrl: string;
  logger: Logger;
  /** cluster keys to verify (default: all supported clusters) */
  keys?: string[];
  /** total replay cap (default 12) */
  maxFindings?: number;
}): Promise<VerifySummary> {
  const rows = (listFindings(opts.db, opts.runId) as unknown as FindingRow[]).map((r) => ({
    id: r.id,
    type: r.type,
    severity: r.severity ?? 'medium',
    cluster: r.cluster_id ?? `row:${r.id}`,
    evidence: JSON.parse(r.evidence_json ?? '{}') as Record<string, unknown>,
  }));
  const wanted = opts.keys ? new Set(opts.keys) : null;

  const stamps = new Map<number, FixVerification>(); // finding id -> verdict
  const perCluster = new Map<string, FixVerification[]>();
  // unsupported types are answered without touching a browser
  for (const row of rows) {
    if (SUPPORTED.has(row.type)) continue;
    const isWanted = !wanted || wanted.has(row.cluster);
    if (!isWanted) continue;
    const v: FixVerification = {
      verdict: 'unsupported',
      note:
        row.type === 'duplicate_request' || row.type === 'duplicate_effect' || row.type === 'race_violation'
          ? 'duplicate and race findings need the swarm to re-fire them — run the app again and use diff_runs'
          : 'this finding type is not replayable yet — use a new run',
      verifiedAt: new Date().toISOString(),
    };
    stamps.set(row.id, v);
    perCluster.set(row.cluster, [...(perCluster.get(row.cluster) ?? []), v]);
  }

  // group supported findings by cluster, worst severity first, capped
  const byCluster = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!SUPPORTED.has(row.type)) continue;
    if (wanted && !wanted.has(row.cluster)) continue;
    byCluster.set(row.cluster, [...(byCluster.get(row.cluster) ?? []), row]);
  }
  const queue = [...byCluster.values()]
    .map((group) => group.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]).slice(0, 2))
    .flat()
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, opts.maxFindings ?? 12);

  if (queue.length > 0) {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    await context.addInitScript(RUNTIME_SOURCE);
    try {
      // preflight: a dead target is one honest verdict, not N stale ones
      const probe = await context.newPage();
      const reachable = await probe.goto(opts.baseUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => null);
      await probe.close();
      if (!reachable) {
        const v: FixVerification = { verdict: 'unverifiable', note: 'the replay target is unreachable — start the app and verify again', verifiedAt: new Date().toISOString() };
        for (const row of queue) {
          stamps.set(row.id, v);
          perCluster.set(row.cluster, [...(perCluster.get(row.cluster) ?? []), v]);
        }
        return finish(opts, stamps, perCluster, rows);
      }

      for (const row of queue) {
        const page = await context.newPage();
        try {
          const { verdict, note, replayedUrl } = await replayFinding(page, row.type, row.evidence, opts.baseUrl);
          const v: FixVerification = { verdict, note, verifiedAt: new Date().toISOString(), replayedUrl };
          stamps.set(row.id, v);
          perCluster.set(row.cluster, [...(perCluster.get(row.cluster) ?? []), v]);
        } finally {
          await page.close().catch(() => {});
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }

  return finish(opts, stamps, perCluster, rows);
}

function finish(
  opts: { db: Db; runId: number; logger: Logger },
  stamps: Map<number, FixVerification>,
  perCluster: Map<string, FixVerification[]>,
  rows: Array<{ id: number; cluster: string; type: string }>,
): VerifySummary {
  // aggregate per cluster (worst verdict wins) and stamp EVERY row of the
  // cluster — the report samples evidence, so the verdict shows wherever the
  // cluster is read from
  const update = opts.db.prepare('UPDATE findings SET evidence_json = ? WHERE id = ?');
  const read = opts.db.prepare('SELECT evidence_json FROM findings WHERE id = ?');
  const upsertVerdict = opts.db.prepare(
    `INSERT INTO fix_verdicts (run_id, cluster_key, verdict, note, verified_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(run_id, cluster_key) DO UPDATE SET verdict = excluded.verdict, note = excluded.note, verified_at = excluded.verified_at`,
  );
  const aggregateByCluster = new Map<string, FixVerification>();
  const results: VerifyFixResult[] = [];
  for (const [cluster, vs] of perCluster) {
    if (vs.length === 0) continue;
    const worst = [...vs].sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict])[0]!;
    aggregateByCluster.set(cluster, worst);
    results.push({ key: cluster, type: rows.find((r) => r.cluster === cluster)?.type ?? 'cluster', verdict: worst.verdict, note: worst.note });
    if (!cluster.startsWith('row:')) {
      upsertVerdict.run(opts.runId, cluster, worst.verdict, worst.note, worst.verifiedAt);
    }
  }
  for (const row of rows) {
    const aggregate = aggregateByCluster.get(row.cluster) ?? stamps.get(row.id);
    if (!aggregate) continue;
    const current = JSON.parse((read.get(row.id) as { evidence_json: string | null }).evidence_json ?? '{}') as Record<string, unknown>;
    update.run(JSON.stringify({ ...current, fixVerified: aggregate }), row.id);
  }
  opts.logger.info('verify_fix done', { verified: results.filter((r) => r.verdict !== 'unsupported').length, results: results.length });
  return { verified: results.filter((r) => r.verdict !== 'unsupported').length, results };
}
