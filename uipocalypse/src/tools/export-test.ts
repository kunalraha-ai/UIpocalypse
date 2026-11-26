import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium, type Page } from 'playwright';
import type { Browser, BrowserContext } from 'playwright';
import type { Logger } from '../logger.js';
import { listFindings, type Db } from '../db/index.js';
import { replayFinding, type FixVerification } from '../browser/replay.js';
import { RUNTIME_SOURCE } from '../runtime/runtime-source.js';

/**
 * Bugs become permanent tests (2026-11-26). A finding the verified-fix loop
 * confirmed as FIXED is exported as a self-contained Playwright test the user
 * owns — no lock-in, the suite compounds with the product.
 *
 * The rules that keep generated tests trustworthy:
 *   - only `fixed` clusters export. A still-broken bug would just pin the
 *     breakage; fix it first, verify, then export.
 *   - the test asserts the CONTRACT, not the pixels: "the recorded error no
 *     longer occurs", "the control produces feedback". A redesign breaks the
 *     test only when it breaks the contract.
 *   - the optional stability gate re-runs the replay N times against the
 *     live app and refuses to emit a test that cannot pass consistently.
 *     Generated flakiness is the one thing this feature must never add.
 *
 * Generated files depend on @playwright/test only; BASE_URL comes from the
 * recorded origin and can be overridden with UIP_BASE_URL, so the test
 * survives port changes.
 */

export type TestSpec = {
  clusterKey: string;
  runId: number;
  type: string;
  evidence: Record<string, unknown>;
  fixVerified: FixVerification;
};

export type GeneratedTest = { filename: string; content: string };

const EXPORTABLE = new Set(['dead_click', 'console_error', 'page_error', 'failed_request', 'navigation_error', 'infinite_spinner']);

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'finding'
  );
}

function originOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

function pathOf(pageUrl: string): string {
  try {
    const u = new URL(pageUrl);
    return u.pathname + u.search;
  } catch {
    return '/';
  }
}

function header(spec: TestSpec, stability?: string): string {
  return [
    `/**`,
    ` * UIpocalypse regression test — generated from run #${spec.runId}, cluster ${spec.clusterKey}.`,
    ` * The swarm found this bug; verify_fix confirmed the fix; this test pins it.`,
    stability ? ` * ${stability}` : ` * Stability gate not run — export with stress enabled before trusting it in CI.`,
    ` *`,
    ` * Unstable or failing after a redesign? The contract is what the comments`,
    ` * assert ("the recorded error no longer occurs", "the control produces`,
    ` * feedback"). Loosen the locator or the matcher — don't delete the test.`,
    ` *`,
    ` * Requires @playwright/test:  npm i -D @playwright/test && npx playwright install chromium`,
    ` */`,
    `import { test, expect } from '@playwright/test';`,
    ``,
    `const BASE_URL = process.env.UIP_BASE_URL ?? '${originOf(String(spec.evidence.pageUrl ?? ''))}';`,
    ``,
  ].join('\n');
}

const GOTO = (spec: TestSpec) => `\tpage.goto(\`\${BASE_URL}${pathOf(String(spec.evidence.pageUrl ?? ''))}\`);`;

/** dead_click: assert the control produces SOME observable feedback. */
function deadClickTest(spec: TestSpec): string {
  const action = String(spec.evidence.action ?? 'control');
  return `${header(spec)}
test('control "${action}" produces feedback', async ({ page }) => {
${GOTO(spec)}
\tconst control = page.getByRole('button', { name: '${action.replace(/'/g, "\\'")}' });
\tawait expect(control.first()).toBeVisible();

\t// the contract: clicking changes something. A MutationObserver counts DOM
\t// work; a URL change also counts. (Locator too strict after a redesign?
\t// Adjust it — the assertion is the contract, not the locator.)
\tawait page.evaluate(() => {
\t\tconst w = window as unknown as { __uipMutations?: number };
\t\tw.__uipMutations = 0;
\t\tnew MutationObserver((list) => {
\t\t\tconst w = window as unknown as { __uipMutations?: number };
\t\t\tw.__uipMutations = (w.__uipMutations ?? 0) + list.length;
\t\t}).observe(document.documentElement, { subtree: true, childList: true, attributes: true });
\t});
\tconst before = page.url();
\tawait control.first().click();
\tawait page.waitForTimeout(1500);
\tconst mutations = await page.evaluate(() => (window as unknown as { __uipMutations?: number }).__uipMutations ?? 0);
\tconst feedback = mutations > 0 || page.url() !== before;
\texpect(feedback, 'clicking "${action}" produced no observable change — the dead control may be back').toBe(true);
});
`;
}

/** console_error / page_error: fail when the recorded error reappears. */
function consoleErrorTest(spec: TestSpec): string {
  const recorded = String(spec.evidence.text ?? spec.evidence.message ?? '');
  const masked = recorded.replace(/\d+/g, '#');
  return `${header(spec)}
test('recorded console error no longer occurs', async ({ page }) => {
\t// The recorded error (numbers masked — an id in the message never breaks the match):
\tconst recorded = '${masked.replace(/'/g, "\\'")}';
\tconst seen: string[] = [];
\tpage.on('console', (m) => { if (m.type() === 'error') seen.push(m.text()); });
\tpage.on('pageerror', (e) => seen.push(e.message));
${GOTO(spec)}
\tawait page.waitForTimeout(2500);
\tconst matches = seen.filter((t) => t.replace(/\\d+/g, '#').includes(recorded));
\texpect(matches, 'the recorded error reappeared').toEqual([]);
});
`;
}

/** navigation_error: the page must render content, not a framework error. */
function navigationErrorTest(spec: TestSpec): string {
  return `${header(spec)}
test('page renders content (no framework error)', async ({ page }) => {
${GOTO(spec)}
\tawait page.waitForTimeout(1000);
\tconst body = await page.evaluate(() => (document.body?.innerText ?? '').trim());
\texpect(body.length, 'the page rendered blank again').toBeGreaterThan(0);
\texpect(body).not.toMatch(/this page couldn.?t load|application error/i);
});
`;
}

/** failed_request: if the recorded request fires, it must not fail. */
function failedRequestTest(spec: TestSpec): string {
  let path = '/';
  try {
    path = new URL(String(spec.evidence.url ?? '')).pathname;
  } catch {
    /* default */
  }
  return `${header(spec)}
test('request ${path} no longer fails', async ({ page }) => {
\tconst failures: string[] = [];
\tpage.on('response', (r) => {
\t\ttry {
\t\t\tif (new URL(r.url()).pathname === '${path}' && r.status() >= 400) failures.push(String(r.status()));
\t\t} catch { /* non-URL — ignore */ }
\t});
${GOTO(spec)}
\tawait page.waitForTimeout(2500);
\texpect(failures, 'the recorded request failed again').toEqual([]);
});
`;
}

/** infinite_spinner: nothing may stay stuck for 12 s. */
function spinnerTest(spec: TestSpec): string {
  return `${header(spec)}
test('no spinner stays stuck for 12 s', async ({ page }) => {
${GOTO(spec)}
\tawait page.waitForTimeout(12000);
\tconst spinning = await page.evaluate(() => {
\t\tconst el = document.querySelector('[role="progressbar"], [aria-busy="true"], .spinner, .loading');
\t\treturn !!el && el.getBoundingClientRect().height > 0;
\t});
\texpect(spinning, 'a stuck spinner is visible again').toBe(false);
});
`;
}

function filenameFor(spec: TestSpec): string {
  if (spec.type === 'dead_click') return `uip-${slug(String(spec.evidence.action ?? 'control'))}.spec.ts`;
  if (spec.type === 'console_error' || spec.type === 'page_error') {
    const src = String(spec.evidence.text ?? spec.evidence.message ?? 'error');
    // the distinctive token: first word after the last colon ("notAFunction is
    // not defined" -> notAFunction), else the last few words
    const tail = src.split(':').pop() ?? src;
    const token = tail.trim().split(/\s+/)[0] ?? src;
    return `uip-console-${slug(token.length > 3 ? token : src)}.spec.ts`;
  }
  if (spec.type === 'failed_request') {
    try {
      return `uip-request-${slug(new URL(String(spec.evidence.url)).pathname)}.spec.ts`;
    } catch {
      return 'uip-request.spec.ts';
    }
  }
  return `uip-${slug(spec.clusterKey)}.spec.ts`;
}

/** Build one self-contained Playwright test file from a confirmed finding. */
export function buildTestFile(spec: TestSpec): GeneratedTest | { unsupported: string } {
  if (!EXPORTABLE.has(spec.type)) {
    const reason =
      spec.type === 'duplicate_request' || spec.type === 'duplicate_effect' || spec.type === 'race_violation'
        ? `duplicate and race findings need the swarm to re-fire them — export is for replayable findings (use diff_runs)`
        : `finding type "${spec.type}" is not exportable yet`;
    return { unsupported: reason };
  }
  switch (spec.type) {
    case 'dead_click':
      return { filename: filenameFor(spec), content: deadClickTest(spec) };
    case 'console_error':
    case 'page_error':
      return { filename: filenameFor(spec), content: consoleErrorTest(spec) };
    case 'navigation_error':
      return { filename: filenameFor(spec), content: navigationErrorTest(spec) };
    case 'failed_request':
      return { filename: filenameFor(spec), content: failedRequestTest(spec) };
    case 'infinite_spinner':
      return { filename: filenameFor(spec), content: spinnerTest(spec) };
    default:
      return { unsupported: `finding type "${spec.type}" is not exportable yet` };
  }
}

export type ExportResult = {
  files: GeneratedTest[];
  /** clusters not exported, each with the honest reason */
  skipped: Array<{ key: string; reason: string }>;
  written: string[];
};

/**
 * Export a run's confirmed fixes as Playwright tests. Only clusters whose
 * latest verification is `fixed` are eligible. With `stress` > 0, each
 * finding's replay is re-run that many times against the live app first —
 * a test that cannot pass consistently is refused, with its rate reported.
 */
export async function exportRunTests(opts: {
  db: Db;
  runId: number;
  logger: Logger;
  /** directory to write the .spec.ts files into — omit to only return them */
  outDir?: string;
  /** cluster keys to export (default: all eligible clusters) */
  keys?: string[];
  /** stability gate: re-run each finding's replay N times before emitting */
  stress?: number;
  /** where the app lives now (stress needs it; default: the recorded origin) */
  baseUrl?: string;
}): Promise<ExportResult> {
  const rows = listFindings(opts.db, opts.runId) as unknown as Array<{
    id: number;
    type: string;
    cluster_id: string | null;
    evidence_json: string | null;
  }>;
  // fix_verdicts is the durable source of truth (the same table the report
  // reads attach from) — evidence stamps are a convenience for raw consumers
  const verdictRows = opts.db
    .prepare('SELECT cluster_key, verdict, note, verified_at FROM fix_verdicts WHERE run_id = ?')
    .all(opts.runId) as Array<{ cluster_key: string; verdict: string; note: string; verified_at: string }>;
  const verdictByCluster = new Map<string, FixVerification>(
    verdictRows.map((v) => [v.cluster_key, { verdict: v.verdict as FixVerification['verdict'], note: v.note, verifiedAt: v.verified_at }] as const),
  );
  const wanted = opts.keys ? new Set(opts.keys) : null;

  // group by cluster; keep the row that carries the cluster's fix verdict
  const byCluster = new Map<string, { type: string; evidence: Record<string, unknown>; fixVerified?: FixVerification }>();
  for (const row of rows) {
    const cluster = row.cluster_id ?? `row:${row.id}`;
    if (wanted && !wanted.has(cluster)) continue;
    const evidence = JSON.parse(row.evidence_json ?? '{}') as Record<string, unknown>;
    // the table wins (latest replay), evidence stamps are the fallback
    const fixVerified = verdictByCluster.get(cluster) ?? (evidence.fixVerified as FixVerification | undefined);
    const existing = byCluster.get(cluster);
    if (!existing || (fixVerified && !existing.fixVerified)) {
      byCluster.set(cluster, { type: row.type, evidence, fixVerified });
    }
  }

  const files: GeneratedTest[] = [];
  const skipped: Array<{ key: string; reason: string }> = [];
  const written: string[] = [];
  const stress = opts.stress ?? 0;

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    for (const [cluster, info] of byCluster) {
      if (!info.fixVerified) {
        skipped.push({ key: cluster, reason: 'never verified — run verify_fix first, then export the fixed finding' });
        continue;
      }
      if (info.fixVerified.verdict !== 'fixed') {
        skipped.push({ key: cluster, reason: `latest verify_fix verdict is "${info.fixVerified.verdict}" — fix it, verify, then export` });
        continue;
      }
      const spec: TestSpec = {
        clusterKey: cluster,
        runId: opts.runId,
        type: info.type,
        evidence: info.evidence,
        fixVerified: info.fixVerified,
      };

      // stability gate: the replay must pass N/N times against the live app
      let stabilityNote: string | undefined;
      if (stress > 0) {
        const base =
          opts.baseUrl ??
          (() => {
            try {
              return new URL(String(info.evidence.pageUrl ?? '')).origin;
            } catch {
              return 'http://localhost:3000';
            }
          })();
        if (!browser) {
          browser = await chromium.launch();
          context = await browser.newContext();
          await context.addInitScript(RUNTIME_SOURCE);
        }
        let passed = 0;
        for (let i = 0; i < stress; i++) {
          const page: Page = await context!.newPage();
          try {
            const { verdict } = await replayFinding(page, info.type, info.evidence, base);
            if (verdict === 'fixed') passed++;
          } finally {
            await page.close().catch(() => {});
          }
        }
        if (passed < stress) {
          skipped.push({ key: cluster, reason: `unstable: replay passed ${passed}/${stress} — not exporting a test that cannot pass consistently` });
          continue;
        }
        stabilityNote = `Stability: ${passed}/${stress} replays passed on ${new Date().toISOString().slice(0, 10)}.`;
      }

      const built = buildTestFile(spec);
      if ('unsupported' in built) {
        skipped.push({ key: cluster, reason: built.unsupported });
        continue;
      }
      let content = built.content;
      if (stabilityNote) {
        // splice the stability line into the header (after the verify line)
        content = built.content.replace(
          ' * The swarm found this bug; verify_fix confirmed the fix; this test pins it.',
          ` * The swarm found this bug; verify_fix confirmed the fix; this test pins it.\n * ${stabilityNote}`,
        );
      }
      // distinct clusters can slug to the same filename (e.g. "Uncaught
      // ReferenceError: X" and "ReferenceError: X") — never overwrite silently
      let filename = built.filename;
      const used = new Set(files.map((f) => f.filename));
      if (used.has(filename)) {
        const base = built.filename.replace(/\.spec\.ts$/, '');
        let n = 2;
        while (used.has(`${base}-${n}.spec.ts`)) n++;
        filename = `${base}-${n}.spec.ts`;
      }
      files.push({ filename, content });
      if (opts.outDir) {
        const target = join(opts.outDir, built.filename);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
        written.push(target);
      }
    }
  } finally {
    await browser?.close().catch(() => {});
  }

  opts.logger.info('test export done', { exported: files.length, skipped: skipped.length });
  return { files, skipped, written };
}
