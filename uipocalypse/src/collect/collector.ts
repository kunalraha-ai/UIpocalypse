import type { Db, FindingRow } from '../db/index.js';
import { mask, normalizeRoute } from '../graph/hash.js';
import type { AppMap, Severity } from '../analyzer/types.js';

/**
 * Collector (TRD §3.7 FR-C1): dedupe and cluster raw findings into issues on
 * the fingerprint key decided pre-Phase 5:
 *   `type-family + normalized endpoint (app-map route template; DB table for
 *    invariant findings) + action label (masked, occurrence-collapsed)`
 * — never raw URLs, DOM indices or observation counts, so `diff_runs`
 * "fixed / new / still failing" is stable across runs.
 *
 * The two classification rules land here (review-directed):
 *   - a 4xx on a route that EXISTS in the app map is a *correct rejection*
 *     (the app behaved as designed) — downgraded, not reported as a finding;
 *   - `net::ERR_ABORTED` is a cancellation artifact (agent navigated away
 *     mid-request) — filtered the same way.
 */

export type Classification = 'finding' | 'correct_rejection' | 'cancellation_artifact';

export type CodeRef = { file: string; line: number; what: string };

export type Cluster = {
  /** the stable fingerprint — diff_runs identity (FR-C1) */
  key: string;
  family: 'duplicate' | 'endpoint' | 'action';
  types: string[];
  title: string;
  /** normalized app-map route (or `table:<name>` for invariant findings) */
  subject: string;
  severity: Severity;
  confidence: 'high' | 'medium' | 'low';
  classification: Classification;
  observations: number;
  /** capped evidence samples for the reviewer */
  samples: Array<Record<string, unknown>>;
  steps: string[];
  codeRefs: CodeRef[];
};

export type CoverageReport = {
  /** reached (state,action) pairs ÷ discovered pairs in the runtime graph */
  coverage: number;
  /** reached app-map interactive elements ÷ ALL interactive elements the static analyzer found in the code */
  appMapCoverage: number;
  reachedActions: number;
  discoveredActions: number;
  appMapTotal: number;
  appMapReached: number;
  appMapUnreached?: string[];
  unreached: Array<{ label: string; route: string; riskClass: string; reason: string }>;
};

export type CollectedRun = {
  runId: number;
  clusters: Cluster[];
  coverage: CoverageReport;
  /** clusters that are real findings (classification === 'finding') */
  findingClusters: Cluster[];
  correctRejections: Cluster[];
  artifacts: Cluster[];
};

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 } as const;

/** Extract the DB table an invariant SQL reads (`from <table>`). */
function tableFromSql(sql: string): string | null {
  const m = sql.match(/\bfrom\s+([a-z_][a-z0-9_]*)/i);
  return m ? m[1]!.toLowerCase() : null;
}

/** Route template for a request URL, or `table:<name>` for invariant findings. */
function endpointOf(ev: Record<string, unknown>, routes: string[]): string | null {
  if (typeof ev.invariant === 'string' && typeof ev.sql === 'string') {
    const table = tableFromSql(ev.sql);
    return table ? `table:${table}` : `invariant:${ev.invariant.slice(0, 40)}`;
  }
  const url = ev.url ?? ev.pageUrl;
  if (typeof url !== 'string' || url === '') return null;
  return normalizeRoute(url, routes);
}

/** A short stable message core for error clusters (masked, punctuation-kept). */
function messageCore(text: string): string {
  return mask(text).replace(/\s+/g, ' ').trim().slice(0, 80);
}

function classificationOf(type: string, ev: Record<string, unknown>, routeSet: Set<string>): Classification {
  if (type === 'failed_request') {
    const status = Number(ev.status ?? 0);
    if (status === 0 && String(ev.failure ?? '').includes('ERR_ABORTED')) return 'cancellation_artifact';
    if (status >= 400 && status < 500) {
      // 4xx on a route that exists in the app map = the app correctly rejected
      // garbage input / bad auth. A 4xx on a route NOT in the map (e.g. a
      // missing endpoint 404) is a finding.
      const url = typeof ev.url === 'string' ? ev.url : '';
      const path = (() => {
        try {
          return new URL(url).pathname;
        } catch {
          return url;
        }
      })();
      const known =
        routeSet.has(path) ||
        routeSet.has(`${path}/`) ||
        [...routeSet].some((r) => path.startsWith(`${r}/`));
      return known ? 'correct_rejection' : 'finding';
    }
  }
  return 'finding';
}

type Draft = {
  key: string;
  family: Cluster['family'];
  types: string[];
  title: string;
  subject: string;
  severity: Severity;
  confidence: 'high' | 'medium' | 'low';
  classification: Classification;
  observations: number;
  samples: Array<Record<string, unknown>>;
  steps: string[];
};

/** The fingerprint for one raw finding (pure — the diff_runs identity). */
export function fingerprint(f: FindingRow, routes: string[], routeSet: Set<string>): Omit<Draft, 'observations' | 'samples' | 'steps'> {
  const ev = JSON.parse(f.evidence_json ?? '{}') as Record<string, unknown>;
  const type = f.type as string;
  const subject = endpointOf(ev, routes) ?? 'unknown';
  const classification = classificationOf(type, ev, routeSet);

  let key: string;
  let family: Cluster['family'];
  let title: string;
  let severity: Severity = (f.severity as Severity) ?? 'medium';
  const confidence = (f.confidence as 'high' | 'medium' | 'low') ?? 'medium';

  if (type === 'duplicate_request' || type === 'duplicate_effect' || type === 'race_violation') {
    family = 'duplicate';
    key = `dup:${subject}`;
    const what =
      type === 'duplicate_request'
        ? `double-submitted writes to ${subject}`
        : type === 'duplicate_effect'
          ? `invariant-confirmed duplicate damage: ${ev.invariant ?? subject}`
          : `race violation: ${ev.invariant ?? subject}`;
    title = what;
    if (type !== 'duplicate_request') severity = 'high';
  } else if (type === 'dead_click' || type === 'inconsistent_feedback' || type === 'infinite_spinner') {
    family = 'action';
    const action = mask(String(ev.action ?? ev.label ?? '?'));
    key = `act:${action}`;
    title =
      type === 'dead_click'
        ? `dead control: "${action}"`
        : type === 'inconsistent_feedback'
          ? `inconsistent control: "${action}" (works sometimes, not always)`
          : `infinite spinner: "${action}"`;
  } else if (type === 'page_error' || type === 'console_error') {
    family = 'endpoint';
    const core = messageCore(String(ev.message ?? ev.text ?? '?'));
    key = `ep:${subject}:${type === 'page_error' ? 'page' : 'console'}:${core}`;
    title = `${type === 'page_error' ? 'page crash' : 'console error'} on ${subject}: ${core}`;
  } else if (type === 'failed_request') {
    family = 'endpoint';
    const status = Number(ev.status ?? 0);
    key = `ep:${subject}:req:${status === 0 ? String(ev.failure ?? 'net').slice(0, 30) : status}`;
    title =
      classification === 'cancellation_artifact'
        ? `cancelled in-flight request: ${subject}`
        : classification === 'correct_rejection'
          ? `correct rejection (${status}) on ${subject}`
          : `request ${status} on ${subject}`;
    if (classification === 'correct_rejection') severity = 'info';
  } else {
    // navigation_error and anything future
    family = 'endpoint';
    key = `ep:${subject}:${type}`;
    title = `${type} on ${subject}`;
  }

  return { key, family, types: [type], title, subject, severity, confidence, classification };
}

/** Map a cluster back to code through the app map (file/line for fix prompts). */
function codeRefsFor(draft: Omit<Draft, 'observations' | 'samples' | 'steps'>, appMap: AppMap): CodeRef[] {
  const refs: CodeRef[] = [];
  if (draft.family === 'action') {
    const label = draft.key.replace(/^act:/, '');
    for (const el of appMap.elements) {
      if (mask(el.label) === label || el.label === label) {
        refs.push({ file: el.file, line: el.line, what: `<${el.tag}> "${el.label.slice(0, 40)}"` });
        if (refs.length >= 3) break;
      }
    }
  } else if (draft.subject.startsWith('table:')) {
    const table = draft.subject.replace('table:', '');
    for (const m of appMap.supabase.migrations) {
      refs.push({ file: m, line: 0, what: `migration defining "${table}"` });
      if (refs.length >= 3) break;
    }
  } else if (draft.subject !== 'unknown') {
    const path = draft.subject.replace(/^\//, '');
    for (const r of appMap.routes) {
      if (r.path.replace(/^\//, '') === path || r.path === draft.subject) {
        refs.push({ file: r.file, line: 0, what: `${r.kind} route ${r.path}` });
        break;
      }
    }
    for (const c of appMap.apiCalls) {
      if (draft.subject.startsWith(c.url) || c.url.startsWith(draft.subject)) {
        refs.push({ file: c.file, line: c.line, what: `fetch ${c.method} ${c.url}` });
        if (refs.length >= 3) break;
      }
    }
  }
  return refs;
}

export function clusterFindings(findings: FindingRow[], appMap: AppMap): Cluster[] {
  const routes = appMap.routes.map((r) => r.path);
  const routeSet = new Set(routes);
  const byKey = new Map<string, Draft>();

  for (const f of findings) {
    const base = fingerprint(f, routes, routeSet);
    let draft = byKey.get(base.key);
    if (!draft) {
      draft = { ...base, observations: 0, samples: [], steps: [] };
      byKey.set(base.key, draft);
    }
    draft.observations++;
    if (!draft.types.includes(f.type as string)) draft.types.push(f.type as string);
    if (SEVERITY_RANK[base.severity] < SEVERITY_RANK[draft.severity]) draft.severity = base.severity;
    if (CONFIDENCE_RANK[base.confidence] < CONFIDENCE_RANK[draft.confidence]) draft.confidence = base.confidence;
    const ev = JSON.parse(f.evidence_json ?? '{}') as Record<string, unknown>;
    if (draft.samples.length < 3) draft.samples.push(ev);
    const steps = Array.isArray(ev.steps) ? (ev.steps as string[]) : [];
    if (steps.length && draft.steps.length === 0) draft.steps = steps.slice(-8);
  }

  // FP fix 2: group bot-protection 403/429 clusters into a single infrastructure
  // finding instead of dozens of individual "request 403" findings.
  const clusters: Cluster[] = [...byKey.values()]
    .map<Cluster>((d) => ({
      key: d.key,
      family: d.family,
      types: d.types,
      title: d.title,
      subject: d.subject,
      severity: d.severity,
      confidence: d.confidence,
      classification: d.classification,
      observations: d.observations,
      samples: d.samples,
      steps: d.steps,
      codeRefs: codeRefsFor(d, appMap),
    }));

  return mergeBotProtectionClusters(clusters);
}

/** FP fix 2: when >=3 failed_request clusters share the same origin and
 *  status 403/429, merge them into a single infrastructure finding. */
function mergeBotProtectionClusters(clusters: Cluster[]): Cluster[] {
  const botBlocked = clusters.filter(
    (c) => c.family === 'endpoint' && c.types.includes('failed_request') && /request (403|429) /.test(c.title),
  );
  if (botBlocked.length < 3) return clusters;

  // The cluster subject is route-normalized (no origin) — resolve the real
  // origin from the absolute URLs the detector recorded in the evidence.
  // Without this, every origin falls into one "unknown" bucket and unrelated
  // hosts get merged into a single finding (seen live on audora.art).
  const originOf = (c: Cluster): string => {
    for (const s of c.samples) {
      const u = (s as Record<string, unknown> | undefined)?.url;
      if (typeof u === 'string' && /^https?:\/\//.test(u)) {
        try {
          return new URL(u).origin;
        } catch {
          /* try the next sample */
        }
      }
    }
    try {
      return new URL(c.subject).origin;
    } catch {
      return 'unknown';
    }
  };

  const byOrigin = new Map<string, Cluster[]>();
  for (const c of botBlocked) {
    const origin = originOf(c);
    byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), c]);
  }

  const merged: Cluster[] = [];
  const absorbed = new Set<string>();

  for (const [origin, items] of byOrigin) {
    if (items.length < 3) continue;
    for (const i of items) absorbed.add(i.key);
    const totalObs = items.reduce((s, i) => s + i.observations, 0);
    merged.push({
      key: `infra:bot-protection:${origin}`,
      family: 'endpoint',
      types: ['infrastructure'],
      title: `bot protection or rate limiting on ${origin} — ${items.length} resources blocked (${totalObs} observations)`,
      subject: origin,
      severity: 'medium',
      confidence: 'low',
      classification: 'finding',
      observations: totalObs,
      samples: items.flatMap((i) => i.samples.slice(0, 1)).slice(0, 3),
      steps: [],
      codeRefs: [],
    });
  }

  return [...clusters.filter((c) => !absorbed.has(c.key)), ...merged].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.observations - a.observations ||
      a.key.localeCompare(b.key),
  );
}

/**
 * Coverage (FR-C2): reached (state,action) pairs ÷ discovered, plus unreached
 * actions with the most likely reason (destructive-skipped, requires input,
 * requires auth) — honest about what the swarm could not test.
 */
export function computeCoverage(db: Db, routes: string[]): CoverageReport {
  const stats = { actions: 0, performed: 0 } as { actions: number; performed: number };
  const unreached: CoverageReport['unreached'] = [];

  const all = db
    .prepare(
      `SELECT a.id, a.label, a.risk_class, a.kind, a.skip_reason, s.route AS route,
              EXISTS(SELECT 1 FROM transitions t WHERE t.action_id = a.id) AS reached
       FROM actions a JOIN states s ON s.id = a.state_id`,
    )
    .all() as Array<{ id: number; label: string; risk_class: string; kind: string; skip_reason: string | null; route: string; reached: number }>;

  stats.actions = all.length;
  for (const a of all) {
    if (a.reached) {
      stats.performed++;
      continue;
    }
    // a recorded Guard refusal is the authoritative reason — the action was
    // DISCOVERED but never tested, by policy, and must not be dropped
    const reason = a.skip_reason
      ? `${a.skip_reason} — skipped by safety policy, not tested`
      : a.risk_class === 'destructive'
        ? 'destructive — skipped by safety policy'
        : /textbox|combobox|searchbox|spinbutton/i.test(a.kind)
          ? 'requires input — needs a goal agent or auth storage state to complete the flow'
          : /sign in|log in|auth/i.test(a.label)
            ? 'auth wall — provide storageState or loginScript in config'
            : 'not reached within the budget';
    unreached.push({ label: (a.label ?? '').slice(0, 60), route: normalizeRoute(a.route ?? '', routes), riskClass: a.risk_class, reason });
  }

  return {
    coverage: stats.actions === 0 ? 0 : stats.performed / stats.actions,
    appMapCoverage: 0,
    reachedActions: stats.performed,
    discoveredActions: stats.actions,
    appMapTotal: 0,
    appMapReached: 0,
    unreached: unreached.slice(0, 30),
  };
}

/**
 * Second coverage denominator (benchmark §0): every interactive element the
 * STATIC analyzer found in the code (excluding aria-hidden). Reached = an
 * element whose masked label matches a runtime action that was actually
 * performed. This catches "the swarm never even saw the button in the code."
 */
export function computeAppMapCoverage(db: Db, appMap: AppMap): { coverage: number; total: number; reached: number; unreachedLabels: string[] } {
  const performed = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT a.label FROM actions a
           JOIN transitions t ON t.action_id = a.id`,
        )
        .all() as Array<{ label: string | null }>
    )
      .map((r) => mask((r.label ?? '').toLowerCase()))
      .filter(Boolean),
  );
  const interactive = appMap.elements.filter((e) => !e.ariaHidden && /button|a|input|select|textarea|form/i.test(e.tag));
  let reached = 0;
  const unreachedLabels: string[] = [];
  for (const el of interactive) {
    const key = mask(el.label.toLowerCase().trim());
    if (!key) continue;
    if (performed.has(key)) reached++;
    else unreachedLabels.push(`${el.tag} "${el.label.slice(0, 40)}" (${el.file})`);
  }
  return {
    coverage: interactive.length === 0 ? 0 : reached / interactive.length,
    total: interactive.length,
    reached,
    unreachedLabels: unreachedLabels.slice(0, 40),
  };
}

/** Collect one run: clusters, classification, coverage, and cluster_id backfill. */
export function collectRun(db: Db, runId: number, appMap: AppMap): CollectedRun {
  const findings = db
    .prepare('SELECT * FROM findings WHERE run_id = ? ORDER BY id')
    .all(runId) as FindingRow[];
  const routes = appMap.routes.map((r) => r.path);
  const clusters = clusterFindings(findings, appMap);

  // backfill cluster_id on the raw rows so diff_runs and later queries are cheap
  const update = db.prepare('UPDATE findings SET cluster_id = ? WHERE id = ?');
  const idByKey = new Map(clusters.map((c) => [c.key, c] as const));
  const tx = db.transaction(() => {
    for (const f of findings) {
      const c = idByKey.get(fingerprint(f, routes, new Set(routes)).key);
      if (c) update.run(c.key, f.id);
    }
  });
  tx();

  const graphCoverage = computeCoverage(db, routes);
  const appMapCoverage = computeAppMapCoverage(db, appMap);

  return {
    runId,
    clusters,
    coverage: {
      ...graphCoverage,
      appMapCoverage: appMapCoverage.coverage,
      appMapTotal: appMapCoverage.total,
      appMapReached: appMapCoverage.reached,
      appMapUnreached: appMapCoverage.unreachedLabels,
    },
    findingClusters: clusters.filter((c) => c.classification === 'finding'),
    correctRejections: clusters.filter((c) => c.classification === 'correct_rejection'),
    artifacts: clusters.filter((c) => c.classification === 'cancellation_artifact'),
  };
}
