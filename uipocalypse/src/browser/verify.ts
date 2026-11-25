import type { Browser } from 'playwright';
import type { Logger } from '../logger.js';
import { RUNTIME_SOURCE } from '../runtime/runtime-source.js';

/**
 * Post-swarm verification sweep (reproducibility filtering, 2026-11-25).
 *
 * A dead-click verdict is currently single-shot: one click, no observable
 * effect, flagged. This re-performs each dead_click / inconsistent_feedback
 * finding once on a fresh page and annotates the verdict:
 *
 *   still dead   → reproduced: true  — confidence high (dead_click) /
 *                  medium (inconsistent_feedback); this is a real no-op
 *   works now    → reproduced: false — FLAKY: downgraded to low severity
 *                  ("UI hadn't loaded on the first click" class)
 *   element gone → reproduced: 'unverifiable' — original verdict untouched,
 *                  stated honestly in the evidence
 *
 * The sweep only re-clicks controls the swarm ALREADY clicked during the run
 * (they passed the Safety Guard then; the same click passes now), bounded to
 * maxFindings and budgetMs. It never touches destructive-risk actions: those
 * were skipped by the guard, so they never became findings.
 */

export type VerifiableFinding = {
  type: string;
  severity: string;
  confidence: string;
  evidence: Record<string, unknown>;
  url?: string;
};

export type RetryOutcome =
  | { status: 'dead' }
  | { status: 'alive'; reasons: string[] }
  | { status: 'unverifiable'; reason: string };

export type VerificationStats = { attempted: number; reproduced: number; flaky: number; unverifiable: number };

/** Pure verdict mapping — the annotation policy, testable without a browser. */
export function applyVerdict<T extends VerifiableFinding>(finding: T, outcome: RetryOutcome): T {
  const ev = finding.evidence as Record<string, unknown> & { reproduced?: unknown; reproNote?: string };
  if (outcome.status === 'unverifiable') {
    // element gone or page unreachable on retry — keep the original verdict,
    // say so. Never silently upgrade or downgrade on missing data.
    ev.reproduced = 'unverifiable';
    ev.reproNote = `could not re-verify: ${outcome.reason}`;
    return finding;
  }
  if (outcome.status === 'dead') {
    ev.reproduced = true;
    if (finding.type === 'dead_click') {
      finding.confidence = 'high';
      ev.reproNote = 'reproduced: still no effect on a fresh page — true no-op';
    } else {
      finding.confidence = 'medium';
      ev.reproNote = 'dead again on re-verification — intermittent fault confirmed';
    }
    return finding;
  }
  // alive on retry — the first verdict was a fluke (slow load, race, one-off)
  ev.reproduced = false;
  finding.severity = 'low';
  finding.confidence = 'low';
  ev.reproNote = `flaky: produced feedback on re-verification (${outcome.reasons.join(', ') || 'effect observed'}) — the original verdict was likely a load-timing fluke`;
  return finding;
}

/** Which findings does the sweep verify, in what order? */
export function findingsToVerify(findings: VerifiableFinding[]): VerifiableFinding[] {
  // unique by (type, action label) — the collector clusters them anyway;
  // one re-click per distinct control is enough to verdict the cluster
  const seen = new Set<string>();
  const out: VerifiableFinding[] = [];
  for (const f of findings) {
    if (f.type !== 'dead_click' && f.type !== 'inconsistent_feedback') continue;
    const action = String(f.evidence.action ?? '');
    if (!action) continue;
    const key = `${f.type}:${action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** The sweep itself. Mutates findings in place; returns the tally. */
export async function verifyFindings(opts: {
  browser: Browser;
  findings: VerifiableFinding[];
  logger: Logger;
  maxFindings?: number;
  budgetMs?: number;
  abort?: { aborted: boolean };
}): Promise<VerificationStats> {
  const stats: VerificationStats = { attempted: 0, reproduced: 0, flaky: 0, unverifiable: 0 };
  const targets = findingsToVerify(opts.findings).slice(0, opts.maxFindings ?? 10);
  if (targets.length === 0) return stats;

  const deadline = Date.now() + (opts.budgetMs ?? 60_000);
  let context: Awaited<ReturnType<Browser['newContext']>> | null = null;
  try {
    for (const f of targets) {
      if (opts.abort?.aborted || Date.now() > deadline) {
        // budget out — remaining findings keep their original verdicts
        break;
      }
      const url = f.url ?? String(f.evidence.pageUrl ?? '');
      if (!url) {
        stats.unverifiable++;
        continue;
      }
      const actionLabel = String(f.evidence.action ?? '');
      stats.attempted++;
      try {
        if (!context) {
          context = await opts.browser.newContext();
          await context.addInitScript(RUNTIME_SOURCE);
        }
        const page = await context.newPage();
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
          await page.waitForTimeout(300); // let the page settle like the agents do
          const actions = (await page.evaluate(() => window.__uip.getActions())) as Array<{
            id: number;
            name: string;
          }>;
          const match = actions.find((a) => a.name === actionLabel);
          if (!match) {
            applyVerdict(f, { status: 'unverifiable', reason: 'control not present on re-visit' });
            stats.unverifiable++;
          } else {
            const result = (await page.evaluate((id) => window.__uip.perform(id), match.id)) as {
              dead: boolean;
              reasons: string[];
            };
            if (result.dead) {
              applyVerdict(f, { status: 'dead' });
              stats.reproduced++;
            } else {
              applyVerdict(f, { status: 'alive', reasons: result.reasons });
              stats.flaky++;
            }
          }
        } finally {
          await page.close().catch(() => {});
        }
      } catch (e) {
        applyVerdict(f, { status: 'unverifiable', reason: String(e).slice(0, 120) });
        stats.unverifiable++;
      }
    }
  } finally {
    await context?.close().catch(() => {});
  }
  opts.logger.info('verification sweep done', { ...stats });
  return stats;
}
