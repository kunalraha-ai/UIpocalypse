import type { Browser } from 'playwright';
import type { Logger } from '../logger.js';
import { createRun, addFinding, type Db } from '../db/index.js';

/**
 * Cross-user authorization audit (2026-11-26). Vibecoded apps often miss
 * ownership checks — the static missing-rls rule flags the precondition,
 * this proves it end to end. The audit crawls the app as user A, replays
 * every resource URL A saw as user B (and a guest), read-only — GET only,
 * by design — and classifies each answer:
 *
 *   exposed   200 with the same body A received — someone else's data, verbatim
 *   possible  200 with different content for an id-scoped resource — inspect
 *   own-data  200 with different content on a user-scoped endpoint (correct
 *             behavior — e.g. /api/me returns the viewer's own name)
 *   guarded   401/403/404/redirect — the ownership check exists
 *
 * Findings land on their own run row (type authorization_exposure), so the
 * audit flows into the same report, acknowledge, diff and export machinery
 * as every other finding.
 */

export type AuthzProfile = { name: string; storageState?: string };

export type AuthzClassification = 'exposed' | 'possible' | 'own-data' | 'guarded' | 'shared';

export type AuthzResult = {
  url: string;
  profile: string;
  status: number;
  classification: AuthzClassification;
  note: string;
};

export type AuthzAuditResult = {
  runId: number;
  crawled: number;
  tested: number;
  results: AuthzResult[];
  exposures: number;
};

const ASSET_RE = /\.(js|mjs|css|png|jpe?g|gif|svg|ico|woff2?|ttf|otf|map|webp|xml|txt)$/i;

/** Trailing path segment that looks like a record id: /api/orders/1,
 *  /notes/9f2c, /docs/abc-123 — but not /api/me or /api/profile. */
export function looksLikeResourceId(pathname: string): boolean {
  const seg = pathname.split('/').filter(Boolean).pop() ?? '';
  return /\d/.test(seg);
}

/** The honest classifier — pure, testable. Identical bodies on an
 *  id-scoped resource are an exposure; identical bodies on a public page
 *  are just a shared page (kept in the results with an inspect note, never
 *  a finding — flagging every public page would drown the report). */
export function classifyExposure(
  baseline: { status: number; body: string },
  replay: { status: number; body: string },
  idScoped: boolean,
): AuthzClassification {
  if (replay.status === 0 || replay.status >= 300) return 'guarded';
  if (replay.body === baseline.body) return idScoped ? 'exposed' : 'shared';
  return idScoped ? 'possible' : 'own-data';
}

function sameOriginGetUrl(raw: string, origin: string): string | null {
  try {
    const u = new URL(raw);
    if (u.origin !== origin) return null;
    if (ASSET_RE.test(u.pathname) || /favicon/i.test(u.pathname)) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Run the audit. Requires at least one authenticated profile (user A) —
 *  guest is always included as a second view, and any further profiles are
 *  replayed too. Read-only: replay requests are GETs from a logged-in page
 *  context, exactly what the app serves that user. */
export async function auditAuthorization(opts: {
  browser: Browser;
  url: string;
  db: Db;
  profiles: AuthzProfile[];
  logger: Logger;
  /** max resource URLs to replay (default 25, id-scoped first) */
  maxResources?: number;
  /** how many pages the crawl visits (default 5) */
  crawlPages?: number;
}): Promise<AuthzAuditResult> {
  if (opts.profiles.length === 0) {
    throw new Error(
      'authorization audit needs at least one authenticated profile (auth.profiles in config) — a crawl-as-A baseline and a second view to replay against.',
    );
  }
  const origin = new URL(opts.url).origin;
  const runId = createRun(opts.db, { targetUrl: opts.url, agents: 1, llmModels: 'authorization-audit' });
  const log = opts.logger.child({ phase: 'authz' });

  // ---- phase 1: crawl as user A, collect same-origin GET URLs + baselines
  const seen = new Set<string>();
  const baselines = new Map<string, { status: number; body: string }>();
  const ctxA = await opts.browser.newContext(
    opts.profiles[0]!.storageState ? { storageState: opts.profiles[0]!.storageState } : {},
  );
  const queue: string[] = [];
  try {
    ctxA.on('request', (req) => {
      if (req.method() !== 'GET') return; // replay is read-only by design
      const u = sameOriginGetUrl(req.url(), origin);
      if (u) seen.add(u);
    });
    ctxA.on('response', (res) => {
      if (res.request().method() !== 'GET') return;
      const u = sameOriginGetUrl(res.url(), origin);
      if (!u) return;
      seen.add(u);
      res
        .text()
        .then((body) => baselines.set(u, { status: res.status(), body: body.slice(0, 20_000) }))
        .catch(() => {});
    });

    const anchorsOf = async (page: import('playwright').Page): Promise<string[]> => {
      const out = (await page
        .evaluate((base: string): string[] => {
          const hrefs: string[] = [];
          for (const a of Array.from(document.querySelectorAll('a[href]'))) {
            const href = (a as HTMLAnchorElement).href;
            if (href.startsWith(base)) hrefs.push(href);
          }
          return hrefs;
        }, origin)
        .catch(() => [])) as string[];
      return out;
    };

    const pageA = await ctxA.newPage();
    await pageA.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
    await pageA.waitForTimeout(1500); // let XHRs fire
    queue.push(...(await anchorsOf(pageA)));

    const visited = new Set([opts.url]);
    let visits = 1;
    while (queue.length > 0 && visits < (opts.crawlPages ?? 5)) {
      const next = queue.shift()!;
      if (visited.has(next)) continue;
      visited.add(next);
      visits++;
      await pageA.goto(next, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
      await pageA.waitForTimeout(800);
      queue.push(...(await anchorsOf(pageA)));
    }
  } finally {
    await ctxA.close().catch(() => {});
  }

  // ---- phase 2: pick resources (id-scoped first, capped)
  const resources = [...seen]
    .filter((u) => baselines.has(u))
    .sort((a, b) => {
      const idA = looksLikeResourceId(new URL(a).pathname) ? 0 : 1;
      const idB = looksLikeResourceId(new URL(b).pathname) ? 0 : 1;
      return idA - idB;
    })
    .slice(0, opts.maxResources ?? 25);
  log.info('authorization crawl done', { urls: seen.size, resources: resources.length });

  // ---- phase 3: replay as every other view (profiles[1..] + guest)
  const views: AuthzProfile[] = [...opts.profiles.slice(1), { name: 'guest' }];
  const results: AuthzResult[] = [];
  let exposures = 0;

  for (const view of views) {
    const ctx = await opts.browser.newContext(view.storageState ? { storageState: view.storageState } : {});
    try {
      const page = await ctx.newPage();
      await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
      for (const resource of resources) {
        const baseline = baselines.get(resource)!;
        const replay = (await page
          .evaluate<{ status: number; body: string }, string>(
            (u) =>
              fetch(u, { credentials: 'include' })
                .then(async (r): Promise<{ status: number; body: string }> => ({ status: r.status, body: (await r.text()).slice(0, 20_000) }))
                .catch((): { status: number; body: string } => ({ status: 0, body: '' })),
            resource,
          )
          .catch(() => ({ status: 0, body: '' }))) as { status: number; body: string };

        const idScoped = looksLikeResourceId(new URL(resource).pathname);
        const classification = classifyExposure(baseline, replay, idScoped);
        const note =
          classification === 'exposed'
            ? `identical response for ${view.name} and the owner — the ownership check is missing`
            : classification === 'possible'
              ? `${view.name} received a 200 with different content for an id-scoped resource — inspect`
              : classification === 'guarded'
                ? `${view.name} is correctly refused (HTTP ${replay.status})`
                : classification === 'shared'
                  ? `identical for ${view.name} and the owner — a public page, unless this page should be personal`
                  : `user-scoped endpoint — different content for ${view.name} is correct behavior`;
        results.push({ url: resource, profile: view.name, status: replay.status, classification, note });

        if (classification === 'exposed' || classification === 'possible') {
          exposures++;
          addFinding(opts.db, {
            runId,
            type: 'authorization_exposure',
            severity: classification === 'exposed' ? 'high' : 'medium',
            confidence: classification === 'exposed' ? 'high' : 'medium',
            persona: view.name,
            evidence: {
              url: resource.slice(0, 300),
              profile: view.name,
              status: replay.status,
              baselineStatus: baseline.status,
              idScoped,
              note,
            },
          });
        }
      }
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  log.info('authorization audit done', { tested: results.length, exposures });
  return { runId, crawled: seen.size, tested: results.length, results, exposures };
}
