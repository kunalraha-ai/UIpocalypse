import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { clusterFindings, computeCoverage, collectRun, fingerprint } from '../src/collect/collector.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb, addFinding, createRun, type FindingRow } from '../src/db/index.js';
import type { AppMap } from '../src/analyzer/types.js';

const APP_MAP: AppMap = {
  framework: 'next-app',
  stack: ['next', 'supabase'],
  files: [],
  routes: [
    { path: '/', kind: 'page', file: 'app/page.tsx' },
    { path: '/api/orders', kind: 'api', file: 'app/api/orders/route.ts' },
    { path: '/api/coupon/redeem', kind: 'api', file: 'app/api/coupon/redeem/route.ts' },
    { path: '/item/:id', kind: 'page', file: 'app/item/[id]/page.tsx' },
  ],
  elements: [
    { tag: 'button', file: 'components/ProfileForm.tsx', line: 21, label: 'Save profile', handlers: ['onClick'], emptyHandlers: ['onClick'], inForm: false, ariaHidden: false, hasAction: false, hasOnSubmit: false, hasMethodAttr: false, submitType: false, disabled: false, typeAttr: null, hasSpread: false, hasSubmitControl: false, hasFormActionDescendant: false },
  ],
  apiCalls: [
    { file: 'components/OrdersList.tsx', line: 9, url: '/api/orders', method: 'GET', enclosingFnHasErrorHandling: false },
    { file: 'components/Checkout.tsx', line: 12, url: '/api/coupon/redeem', method: 'POST', enclosingFnHasErrorHandling: true },
  ],
  envVars: [],
  imports: {},
  clientEntryFiles: ['components/Checkout.tsx'],
  supabase: { tables: ['coupon_redemptions'], clientFiles: [], migrations: ['supabase/migrations/0001_init.sql'] },
  fileCount: 10,
  extractedAt: 'test',
};

function row(partial: Partial<FindingRow> & { type: string; evidence: Record<string, unknown> }): FindingRow {
  return {
    id: partial.id ?? Math.floor(Math.random() * 1e9),
    run_id: partial.run_id ?? 1,
    type: partial.type,
    severity: partial.severity ?? 'medium',
    confidence: partial.confidence ?? 'medium',
    persona: null,
    state_id: null,
    action_id: null,
    cluster_id: null,
    evidence_json: JSON.stringify(partial.evidence),
    screenshot: null,
    trace: null,
  };
}

describe('collector (Phase 5, FR-C1)', () => {
  it('the acceptance case: 52 duplicate observations collapse to one cluster per endpoint', () => {
    const findings = [
      ...Array.from({ length: 26 }, () => row({ type: 'duplicate_request', evidence: { url: 'http://localhost:3000/api/coupon/redeem', count: 2 } })),
      ...Array.from({ length: 22 }, () => row({ type: 'duplicate_request', evidence: { url: 'http://localhost:3000/api/checkout', count: 2 } })),
      ...Array.from({ length: 4 }, () => row({ type: 'duplicate_request', evidence: { url: 'http://localhost:3000/api/credits/buy', count: 2 } })),
    ];
    const clusters = clusterFindings(findings, APP_MAP);
    expect(clusters).toHaveLength(3);
    expect(clusters.every((c) => c.family === 'duplicate' && c.classification === 'finding')).toBe(true);
    const keys = clusters.map((c) => c.key).sort();
    expect(keys).toEqual(['dup:/api/checkout', 'dup:/api/coupon/redeem', 'dup:/api/credits/buy']);
    // observation counts survive the collapse
    const redeem = clusters.find((c) => c.key === 'dup:/api/coupon/redeem')!;
    expect(redeem.observations).toBe(26);
  });

  it('FP fix 2: >=3 403/429 clusters on one origin merge into ONE infrastructure finding that names the origin', () => {
    const findings = [
      row({ type: 'failed_request', evidence: { url: 'https://audora.art/_app/a.js', status: 403 } }),
      row({ type: 'failed_request', evidence: { url: 'https://audora.art/_app/b.js', status: 403 } }),
      row({ type: 'failed_request', evidence: { url: 'https://audora.art/_app/c.js', status: 403 } }),
      row({ type: 'failed_request', evidence: { url: 'https://audora.art/_app/d.js', status: 403 } }),
    ];
    const clusters = clusterFindings(findings, APP_MAP);
    const infra = clusters.filter((c) => c.types.includes('infrastructure'));
    expect(infra).toHaveLength(1);
    // the cluster subject is route-normalized (no origin) — the merged title
    // must fall back to the absolute URL in the evidence, never "unknown"
    expect(infra[0]!.title).toContain('https://audora.art');
    expect(infra[0]!.title).not.toContain('unknown');
    expect(infra[0]!.observations).toBe(4);
    // the individual 403s are gone
    expect(clusters.filter((c) => c.types.includes('failed_request'))).toHaveLength(0);
  });

  it('FP fix 2 edge: scattered 403s on DIFFERENT origins stay individual findings', () => {
    const findings = [
      row({ type: 'failed_request', evidence: { url: 'https://a.example/x', status: 403 } }),
      row({ type: 'failed_request', evidence: { url: 'https://b.example/y', status: 403 } }),
      row({ type: 'failed_request', evidence: { url: 'https://c.example/z', status: 403 } }),
    ];
    const clusters = clusterFindings(findings, APP_MAP);
    expect(clusters.some((c) => c.types.includes('infrastructure'))).toBe(false);
    expect(clusters.filter((c) => c.types.includes('failed_request'))).toHaveLength(3);
  });

  it('WAF fingerprint: Cloudflare-challenge 403s name the wall in the merged title', () => {
    const findings = [
      row({ type: 'failed_request', evidence: { url: 'https://audora.art/_app/a.js', status: 403, waf: 'cloudflare-challenge' } }),
      row({ type: 'failed_request', evidence: { url: 'https://audora.art/_app/b.js', status: 403, waf: 'cloudflare-challenge' } }),
      row({ type: 'failed_request', evidence: { url: 'https://audora.art/_app/c.js', status: 403, waf: 'cloudflare-challenge' } }),
    ];
    const clusters = clusterFindings(findings, APP_MAP);
    const infra = clusters.filter((c) => c.types.includes('infrastructure'));
    expect(infra).toHaveLength(1);
    expect(infra[0]!.title).toContain('Cloudflare');
    expect(infra[0]!.title).toContain('https://audora.art');
  });

  it('observation-derived confidence: >=2 observations on a finding cluster upgrades medium to high', () => {
    const findings = [
      row({ type: 'console_error', confidence: 'medium', evidence: { text: 'Uncaught TypeError: x is undefined' } }),
      row({ type: 'console_error', confidence: 'medium', evidence: { text: 'Uncaught TypeError: x is undefined' } }),
      row({ type: 'console_error', confidence: 'medium', evidence: { text: 'Uncaught TypeError: DIFFERENT message' } }),
    ];
    const clusters = clusterFindings(findings, APP_MAP);
    const twice = clusters.find((c) => c.observations === 2)!;
    expect(twice.confidence).toBe('high'); // observed twice — high confidence
    const once = clusters.find((c) => c.observations === 1)!;
    expect(once.confidence).toBe('medium'); // one-off stays medium
  });

  it('duplicate_effect and race_violation cluster by DB table, merging per table', () => {
    const findings = [
      row({ type: 'duplicate_effect', severity: 'high', confidence: 'high', evidence: { invariant: 'no dup tx', sql: 'select count(*) from transactions t1 join transactions t2 on ...', expected: 0, actual: 3 } }),
      row({ type: 'race_violation', severity: 'high', confidence: 'high', evidence: { invariant: 'coupon once', sql: 'select count(*) from coupon_redemptions', expected: 1, actual: 14 } }),
    ];
    const clusters = clusterFindings(findings, APP_MAP);
    expect(clusters.map((c) => c.key).sort()).toEqual(['dup:table:coupon_redemptions', 'dup:table:transactions']);
    expect(clusters.every((c) => c.severity === 'high' && c.confidence === 'high')).toBe(true);
  });

  it('classification: 4xx on an existing route is a correct rejection, on a missing route a finding; ERR_ABORTED is an artifact', () => {
    const findings = [
      row({ type: 'failed_request', evidence: { url: 'http://localhost:3000/api/auth/login', status: 401 } }),
      row({ type: 'failed_request', evidence: { url: 'http://localhost:3000/api/promo', status: 404 } }),
      row({ type: 'failed_request', evidence: { url: 'http://localhost:3000/api/orders', status: 500 } }),
      row({ type: 'failed_request', evidence: { url: 'http://localhost:3000/item/101?_rsc=x', status: 0, failure: 'net::ERR_ABORTED' } }),
      row({ type: 'failed_request', severity: 'high', evidence: { url: 'http://localhost:3000/api/orders', status: 500 } }),
    ];
    const byKey = new Map(clusterFindings(findings, { ...APP_MAP, routes: [...APP_MAP.routes, { path: '/api/auth/login', kind: 'api', file: 'x' }] }).map((c) => [c.key, c]));
    expect(byKey.get('ep:/api/auth/login:req:401')!.classification).toBe('correct_rejection');
    expect(byKey.get('ep:/api/auth/login:req:401')!.severity).toBe('info');
    expect(byKey.get('ep:/api/promo:req:404')!.classification).toBe('finding'); // route not in map
    expect(byKey.get('ep:/api/orders:req:500')!.classification).toBe('finding'); // 5xx always
    expect(byKey.get('ep:/api/orders:req:500')!.observations).toBe(2); // statuses merge
    expect(byKey.get('ep:/item/:id:req:net::ERR_ABORTED')!.classification).toBe('cancellation_artifact');
  });

  it('fingerprints are stable across runs: masked labels, normalized routes, no observation counts', () => {
    const run1 = row({ type: 'dead_click', evidence: { action: 'Save profile', why: '...' } });
    const run2 = row({ type: 'dead_click', evidence: { action: 'Save profile', why: '...' } });
    const dynamic1 = row({ type: 'page_error', evidence: { message: "TypeError: Cannot read properties of undefined (reading '0')", pageUrl: 'http://localhost:3000/profile' } });
    const dynamic2 = row({ type: 'page_error', evidence: { message: "TypeError: Cannot read properties of undefined (reading '1')", pageUrl: 'http://localhost:3000/profile' } });
    const dynamic3 = row({ type: 'page_error', evidence: { message: "TypeError: Cannot read properties of null (reading 'id')", pageUrl: 'http://localhost:3000/profile' } });
    const routes = APP_MAP.routes.map((r) => r.path);
    const set = new Set(routes);
    expect(fingerprint(run1, routes, set).key).toBe(fingerprint(run2, routes, set).key);
    expect(fingerprint(run1, routes, set).key).toBe('act:Save profile');
    // digits are masked: crash-class variants with only index differences collide
    // (same root cause, stable across React versions), but a different property
    // access ('id') is a different cluster
    expect(fingerprint(dynamic1, routes, set).key).toBe(fingerprint(dynamic2, routes, set).key);
    expect(fingerprint(dynamic1, routes, set).key).not.toBe(fingerprint(dynamic3, routes, set).key);
    // dynamic routes normalize
    const r1 = row({ type: 'failed_request', evidence: { url: 'http://localhost:3000/item/101', status: 500 } });
    const r2 = row({ type: 'failed_request', evidence: { url: 'http://localhost:3000/item/202', status: 500 } });
    expect(fingerprint(r1, routes, set).key).toBe(fingerprint(r2, routes, set).key);
    expect(fingerprint(r1, routes, set).key).toBe('ep:/item/:id:req:500');
  });

  it('code refs: actions map to elements, endpoints to routes + api calls, tables to migrations', () => {
    const clusters = clusterFindings(
      [
        row({ type: 'dead_click', evidence: { action: 'Save profile' } }),
        row({ type: 'failed_request', evidence: { url: 'http://localhost:3000/api/coupon/redeem', status: 500 } }),
        row({ type: 'duplicate_effect', evidence: { invariant: 'x', sql: 'select count(*) from coupon_redemptions', expected: 0, actual: 2 } }),
      ],
      APP_MAP,
    );
    const dead = clusters.find((c) => c.key === 'act:Save profile')!;
    expect(dead.codeRefs[0]).toMatchObject({ file: 'components/ProfileForm.tsx', line: 21 });
    const req = clusters.find((c) => c.key === 'ep:/api/coupon/redeem:req:500')!;
    expect(req.codeRefs.some((r) => r.file === 'app/api/coupon/redeem/route.ts')).toBe(true);
    expect(req.codeRefs.some((r) => r.file === 'components/Checkout.tsx' && r.line === 12)).toBe(true);
    const table = clusters.find((c) => c.key === 'dup:table:coupon_redemptions')!;
    expect(table.codeRefs[0]!.file).toBe('supabase/migrations/0001_init.sql');
  });

  it('collectRun: clusters, classification split, coverage with unreached reasons, cluster_id backfill', () => {
    const ws = initWorkspace(mkdtempSync('/tmp/opencode/uip-collect-'));
    const db = openDb(ws.db);
    const runId = createRun(db, { targetUrl: 'http://localhost:3000', agents: 5 });

    addFinding(db, { runId, type: 'dead_click', severity: 'medium', confidence: 'high', persona: 'wanderer', evidence: { action: 'Save profile' } });
    addFinding(db, { runId, type: 'dead_click', severity: 'medium', confidence: 'high', persona: 'wanderer', evidence: { action: 'Save profile' } });
    addFinding(db, { runId, type: 'failed_request', severity: 'medium', confidence: 'high', persona: 'swarm', evidence: { url: 'http://localhost:3000/api/promo', status: 404 } });

    const collected = collectRun(db, runId, APP_MAP);
    expect(collected.findingClusters).toHaveLength(2); // Save profile + promo 404
    expect(collected.findingClusters.map((c) => c.key).sort()).toEqual(['act:Save profile', 'ep:/api/promo:req:404']);
    expect(collected.coverage.discoveredActions).toBe(0); // empty graph
    expect(collected.coverage.coverage).toBe(0);

    // backfill: every raw row now carries its cluster key
    const rows = db.prepare('SELECT cluster_id FROM findings WHERE run_id = ?').all(runId) as Array<{ cluster_id: string }>;
    expect(rows.filter((r) => r.cluster_id === 'act:Save profile')).toHaveLength(2);
    expect(rows.filter((r) => r.cluster_id === 'ep:/api/promo:req:404')).toHaveLength(1);

    db.close();
  });

  it('coverage: unreached actions carry honest reasons (destructive, input, auth, budget)', () => {
    const ws = initWorkspace(mkdtempSync('/tmp/opencode/uip-cov-'));
    const db = openDb(ws.db);
    const graph = db; // direct SQL: build a tiny graph by hand
    const s1 = graph.prepare('INSERT INTO states (hash, route) VALUES (?, ?)').run('h1', '/settings');
    const mk = (label: string, kind: string, risk: string) =>
      graph.prepare('INSERT INTO actions (state_id, locator, kind, label, risk_class) VALUES (?, ?, ?, ?, ?)').run(s1.lastInsertRowid, `x-${label}`, kind, label, risk);
    mk('Delete account', 'button', 'destructive');
    mk('Coupon code', 'textbox', 'safe');
    mk('Sign in to see orders', 'link', 'safe');
    const aPlain = mk('Show more', 'button', 'safe');
    // the one reached action is the plain button — destructive stays untested by policy
    graph.prepare('INSERT INTO transitions (from_state, action_id, to_state, count) VALUES (?, ?, ?, 1)').run(s1.lastInsertRowid, aPlain.lastInsertRowid, s1.lastInsertRowid);

    const cov = computeCoverage(db, ['/settings']);
    expect(cov.discoveredActions).toBe(4);
    expect(cov.reachedActions).toBe(1);
    expect(cov.coverage).toBeCloseTo(0.25);
    const reasons = Object.fromEntries(cov.unreached.map((u) => [u.label, u.reason]));
    expect(reasons['Coupon code']).toMatch(/requires input/);
    expect(reasons['Sign in to see orders']).toMatch(/auth wall/);
    // destructive actions are untested by policy — the report says so honestly
    expect(reasons['Delete account']).toMatch(/destructive/);

    db.close();
  });
});
