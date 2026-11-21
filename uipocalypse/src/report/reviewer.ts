import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LLM } from '../llm/index.js';
import { redactForLlm } from '../guard/index.js';
import { collectRun, type CollectedRun, type Cluster } from '../collect/collector.js';
import { getRun, type Db, type RunRow } from '../db/index.js';
import type { AppMap } from '../analyzer/types.js';

/**
 * Reviewer (TRD §3.7 FR-R1, LLM call #2): one call over CLUSTERED findings —
 * never raw logs — producing a plain-English summary, root-cause hypotheses
 * tied to file/line via the app map, and paste-ready fix prompts. Degrades to
 * a mechanical review without an LLM (TRD §10 --no-llm).
 */

export const ReviewSchema = z.object({
  summary: z.string().min(1),
  issues: z
    .array(
      z.object({
        key: z.string(), // the cluster key this issue explains
        title: z.string().min(1),
        rootCause: z.string().min(1),
        fixPrompt: z.string().min(1), // paste-ready for the coding agent
        file: z.string().optional(),
        line: z.number().optional(),
      }),
    )
    .min(0),
});

export type Review = z.infer<typeof ReviewSchema>;
/** which path produced the review — LLM-written or the mechanical template */
export type ReviewedBy = 'llm' | 'mechanical';
export type ReviewWithSource = Review & { reviewedBy: ReviewedBy; /** why the mechanical path ran — never leave three possible causes ambiguous */ mechanicalReason?: string };

export type RunMeta = {
  runId: number;
  targetUrl: string;
  agents: number;
  wallMs: number;
  llmCalls: number;
  startedAt?: string;
  /** model ids used, from the run row — so results stay interpretable after a model disappears */
  llmModels?: string | null;
  /** detection classes that were NOT run (read-only mode, no safe DB) */
  disabledClasses?: string[];
  /** every action the Safety Guard refused, by label with reason */
  skippedActions?: Array<{ label: string; reason: string }>;
  /** machine the run executed on — findings stay interpretable across volunteers */
  machine?: { cpu: string; cores: number; ramBytes: number };
  /** ramp level at which the app degraded/collapsed under load, when recorded */
  agentsAtCollapse?: number;
};

export type Report = {
  runId: number;
  generatedAt: string;
  run: RunMeta;
  summary: string;
  /** which path produced the review — 'llm' or 'mechanical' */
  reviewedBy: ReviewedBy;
  /** why the mechanical path ran, when it did */
  reviewReason?: string;
  issues: Array<{
    key: string;
    title: string;
    severity: string;
    confidence: string;
    types: string[];
    observations: number;
    rootCause: string;
    fixPrompt: string;
    file?: string;
    line?: number;
    evidence: Array<Record<string, unknown>>;
    steps: string[];
  }>;
  inconsistentFeedback: Array<{ key: string; title: string; observations: number; note: string }>;
  correctRejections: Array<{ key: string; title: string; observations: number }>;
  artifacts: Array<{ key: string; title: string; observations: number }>;
  coverage: CollectedRun['coverage'];
  /** detection classes not run (read-only mode, no safe DB) */
  disabledClasses?: string[];
  /** set when connection-refused observations dominate the run — never reachable, or an app collapse mid-run */
  targetUnreachable?: {
    refused: number;
    totalObservations: number;
    mode: 'never' | 'collapse';
    agentsAtCollapse?: number;
  };
  /** every action the Safety Guard refused, by label with reason — never silent */
  skippedActions?: Array<{ label: string; reason: string }>;
  /** both coverage figures, with their denominators spelled out */
  coverageFigures?: {
    graph: { reached: number; total: number };
    appMap: { reached: number; total: number };
    appMapUnreached?: string[];
  };
};

const REVIEWER_SYSTEM = [
  'You are the reviewer for UIpocalypse, a QA tool that swarms a local web app with chaotic test users.',
  'You receive CLUSTERED findings from a completed run. For each cluster, write a one-line root-cause hypothesis and a paste-ready fix prompt for the coding agent that will repair the app.',
  'Use the provided file/line references from the app map when they fit. Be concrete and mechanical — this is for finding real breakage, not UX critique.',
  'Rank by severity. Respond with ONLY the JSON object.',
].join(' ');

/** Mechanical fix-prompt fallback per finding type (no LLM needed). */
function fallbackPrompt(cluster: Cluster): { rootCause: string; fixPrompt: string } {
  const label = cluster.title.replace(/^[a-z ]+: /, '').replace(/^"|"$/g, '');
  const t = cluster.types;
  if (t.includes('dead_click')) {
    return {
      rootCause: 'The control produced no DOM mutation, request, navigation, focus or ARIA change within 500 ms of a click.',
      fixPrompt: `Wire the "${label}" control: its click handler is missing or empty. Attach the intended onClick/onSubmit handler and verify the click visibly changes state.`,
    };
  }
  if (t.includes('inconsistent_feedback')) {
    return {
      rootCause: 'The control responded on some interactions but not others this run.',
      fixPrompt: `Check "${label}": it worked sometimes and did nothing other times — usually an idempotent toggle, but verify the handler is not intermittently failing.`,
    };
  }
  if (t.includes('race_violation')) {
    return {
      rootCause: 'A barrier-synchronized volley of concurrent writes violated a configured DB invariant — a check-then-write race.',
      fixPrompt: `Wrap the write for ${cluster.subject} in a transaction with a row lock (SELECT ... FOR UPDATE), or add a unique constraint so the second concurrent write fails atomically.`,
    };
  }
  if (t.includes('duplicate_effect')) {
    return {
      rootCause: 'Double-clicked writes landed twice at the database — confirmed by invariant SQL.',
      fixPrompt: `Make ${cluster.subject} idempotent: disable the submit control while a request is in flight, and add a uniqueness/idempotency constraint server-side.`,
    };
  }
  if (t.includes('duplicate_request')) {
    return {
      rootCause: 'A double-click fired the same write twice within a second — the app has no submit guard (the second request may still have been rejected server-side).',
      fixPrompt: `Add a submit guard to ${cluster.subject}: disable the control while the request is in flight and/or make the endpoint idempotent.`,
    };
  }
  if (t.includes('page_error')) {
    return {
      rootCause: 'An unhandled client-side exception crashed the page after an in-app action.',
      fixPrompt: `Guard the crashing render on ${cluster.subject}: ${cluster.title.includes('null') ? 'the component reads a value that can be null/undefined' : 'the component indexes into a value that can be undefined'} — add an optional chain/fallback and an error boundary.`,
    };
  }
  if (t.includes('failed_request')) {
    return {
      rootCause: `A request to ${cluster.subject} failed.`,
      fixPrompt: `Fix ${cluster.subject}: handle the failing request (${cluster.title}) — add the missing route, or wrap the call in error handling with a visible error state.`,
    };
  }
  if (t.includes('infinite_spinner')) {
    return {
      rootCause: 'A loading indicator persisted beyond 10 seconds — a failed request with a swallowed error.',
      fixPrompt: `Add error handling to the request behind "${label}" so the spinner resolves or an error state renders.`,
    };
  }
  return {
    rootCause: 'Clustered detector observations.',
    fixPrompt: `Investigate ${cluster.title} (${cluster.observations} observations).`,
  };
}

export function mechanicalReview(collected: CollectedRun, reason = 'no LLM_API_KEY configured'): ReviewWithSource {
  const issues = collected.findingClusters.map((c) => {
    const f = fallbackPrompt(c);
    const ref = c.codeRefs[0];
    return {
      key: c.key,
      title: c.title,
      rootCause: f.rootCause,
      fixPrompt: f.fixPrompt,
      file: ref?.file,
      line: ref?.line,
    };
  });
  const high = collected.findingClusters.filter((c) => c.severity === 'high').length;
  return {
    summary:
      issues.length === 0
        ? 'No findings survived clustering and classification.'
        : `${issues.length} clustered issue${issues.length === 1 ? '' : 's'} (${high} high severity) over ${collected.coverage.discoveredActions} discovered actions; coverage ${(collected.coverage.coverage * 100).toFixed(0)}%.`,
    issues,
    reviewedBy: 'mechanical',
    mechanicalReason: reason,
  };
}

export async function reviewRun(opts: {
  collected: CollectedRun;
  appMap: AppMap;
  llm: LLM;
  run: RunMeta;
}): Promise<ReviewWithSource> {
  const { collected, llm } = opts;
  if (!llm.configured || collected.findingClusters.length === 0) {
    return mechanicalReview(
      collected,
      !llm.configured ? 'no LLM_API_KEY configured' : 'no findings to review',
    );
  }
  const payload = redactForLlm({
    run: { url: opts.run.targetUrl, agents: opts.run.agents },
    coveragePct: Math.round(collected.coverage.coverage * 100),
    findings: collected.findingClusters.map((c) => ({
      key: c.key,
      title: c.title,
      types: c.types,
      severity: c.severity,
      confidence: c.confidence,
      observations: c.observations,
      evidenceSample: c.samples,
      reproSteps: c.steps,
      codeRefs: c.codeRefs,
    })),
  });
  try {
    const review = await llm.completeJSON({
      system: REVIEWER_SYSTEM,
      user: JSON.stringify(payload) + '\n\nJSON shape: { "summary": string, "issues": [{ "key": string, "title": string, "rootCause": string, "fixPrompt": string, "file"?: string, "line"?: number }] }',
      schema: ReviewSchema,
      maxTokens: 2500,
      label: 'reviewer',
    });
    return { ...review, reviewedBy: 'llm' };
  } catch {
    // budget or malformed reply — the mechanical review still ships
    return mechanicalReview(collected, 'the reviewer LLM call failed (budget exhausted or malformed reply) — template review shipped');
  }
}

/**
 * Target unreachability (fresh-eyes prompt-test finding): when a run's
 * observations are dominated by connection refusals, the "findings" describe
 * a dead server, not app bugs. Two distinct shapes, distinguished by the
 * graph: an EMPTY graph means the target was NEVER reachable; a non-empty
 * graph with refusal dominance means the app was alive, got explored, and
 * collapsed mid-run — reported with the ramp's agent count when recorded.
 * Attribute each cluster's observations proportionally to its refusal-bearing
 * samples; flag only when refusals dominate (≥80% of all observations and at
 * least 10 of them). Presentation only — no detector logic involved.
 */
function unreachableSummary(
  collected: CollectedRun,
  run: RunMeta,
): Report['targetUnreachable'] {
  let refused = 0;
  let total = 0;
  for (const c of collected.clusters) {
    total += c.observations;
    if (!c.samples.length) continue;
    const refusedSamples = c.samples.filter((s) => JSON.stringify(s).includes('ERR_CONNECTION_REFUSED')).length;
    if (refusedSamples > 0) refused += Math.round((c.observations * refusedSamples) / c.samples.length);
  }
  if (!(refused >= 10 && refused / Math.max(1, total) >= 0.8)) return undefined;
  const neverReachable = collected.coverage.discoveredActions === 0;
  return {
    refused,
    totalObservations: total,
    mode: neverReachable ? ('never' as const) : ('collapse' as const),
    agentsAtCollapse: neverReachable ? undefined : run.agentsAtCollapse,
  };
}

/** Assemble the final report (markdown + json share this structure). */
export function assembleReport(collected: CollectedRun, review: Review | ReviewWithSource, run: RunMeta): Report {
  const byKey = new Map(collected.clusters.map((c) => [c.key, c] as const));
  const unreachable = unreachableSummary(collected, run);
  const issues: Report['issues'] = review.issues
    .map((i) => {
      const c = byKey.get(i.key);
      if (!c) return null;
      return {
        key: i.key,
        title: i.title,
        severity: c.severity,
        confidence: c.confidence,
        types: c.types,
        observations: c.observations,
        rootCause: i.rootCause,
        fixPrompt: i.fixPrompt,
        file: i.file ?? c.codeRefs[0]?.file,
        line: i.line ?? c.codeRefs[0]?.line,
        evidence: c.samples,
        steps: c.steps,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2, info: 3 } as Record<string, number>;
      return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || b.observations - a.observations;
    });

  // an app that was alive, explored, and collapsed mid-run is itself a
  // FINDING — the highest-value thing a load swarm can tell you (final task:
  // report the agent count from the ramp's degradation point)
  if (unreachable?.mode === 'collapse') {
    const n = unreachable.agentsAtCollapse;
    issues.unshift({
      key: `app:collapse:${n ?? 'unknown'}`,
      title: `app collapsed under load${n ? ` (unreachable at ~${n} agents)` : ''}`,
      severity: 'high',
      confidence: n ? 'high' : 'medium',
      types: ['app_collapse'],
      observations: unreachable.refused,
      rootCause: n
        ? `The app stopped responding while the swarm was at ~${n} concurrent agents — it crashed, saturated, or was killed under load.`
        : 'The app stopped responding partway through the run — it crashed, saturated, or was killed under load (the ramp did not record the exact agent level).',
      fixPrompt: n
        ? `Reproduce: start the app, then apply load (re-run UIpocalypse with agents=${n}). Watch the app process and logs for a crash, OOM kill, or exit at that concurrency; fix the crash or add rate limiting/back-pressure.`
        : 'Reproduce: start the app and re-run UIpocalypse with increasing agent counts until it stops responding; watch the app process and logs for a crash, OOM kill, or exit; fix the crash or add rate limiting/back-pressure.',
      evidence: [{ note: `${unreachable.refused} of ${unreachable.totalObservations} observations are connection-refused after the app had been explored` }],
      steps: [],
    });
  }

  return {
    runId: collected.runId,
    generatedAt: new Date().toISOString(),
    run,
    summary: review.summary,
    reviewedBy: (review as ReviewWithSource).reviewedBy ?? 'mechanical',
    reviewReason: (review as ReviewWithSource).mechanicalReason,
    targetUnreachable: unreachable,
    issues,
    inconsistentFeedback: collected.findingClusters
      .filter((c) => c.types.includes('inconsistent_feedback'))
      .map((c) => ({ key: c.key, title: c.title, observations: c.observations, note: 'works on some interactions, not others — usually an idempotent toggle; ranked low until a run shows it failing for real' })),
    correctRejections: collected.correctRejections.map((c) => ({ key: c.key, title: c.title, observations: c.observations })),
    artifacts: collected.artifacts.map((c) => ({ key: c.key, title: c.title, observations: c.observations })),
    coverage: collected.coverage,
    coverageFigures: {
      graph: { reached: collected.coverage.reachedActions, total: collected.coverage.discoveredActions },
      appMap: { reached: collected.coverage.appMapReached, total: collected.coverage.appMapTotal },
      appMapUnreached: collected.coverage.appMapUnreached,
    },
    disabledClasses: run.disabledClasses ?? [],
    skippedActions: run.skippedActions ?? [],
  };
}

export function markdownReport(report: Report): string {
  const lines: string[] = [];
  lines.push(`# UIpocalypse report — run ${report.runId}`);
  lines.push('');
  // target unreachability comes FIRST: everything below it is dead-server
  // noise, and a reader skimming the findings must be stopped before that
  if (report.targetUnreachable) {
    const u = report.targetUnreachable;
    if (u.mode === 'never') {
      lines.push(`> 🛑 **THE TARGET WAS NEVER REACHABLE — it was down for this entire run** (${u.refused} of ${u.totalObservations} observations are connection-refused; nothing was explored).`);
      lines.push(`> The "findings" below describe a server that was down, not bugs in the app.`);
    } else {
      lines.push(`> 🛑 **THE TARGET BECAME UNREACHABLE during this run** — ${u.refused} of ${u.totalObservations} observations are connection-refused after the app had been explored${u.agentsAtCollapse ? `, at ~${u.agentsAtCollapse} concurrent agents` : ''}.`);
      lines.push(`> The app likely collapsed under swarm load — this is reported as a finding, but everything else below describes a dead server, not app bugs.`);
    }
    lines.push(`> Check that the app is running on the target URL/port, start it, and re-run. This report is not a bug list.`);
    lines.push('');
  }
  // SAFETY.md G4 + volunteer readiness: lead with what was NOT tested
  if (report.disabledClasses?.length) {
    lines.push(`> ⚠️ **NOT TESTED (no safe database confirmed):** ${report.disabledClasses.join(', ')}.`);
    lines.push(`> This is a read-only run — writes, form submits, race tests, and duplicate-write`);
    lines.push(`> detection were skipped. A clean report here is NOT a clean bill of health.`);
    lines.push('');
  }
  const models = report.run.llmModels ? ` · **Models:** ${report.run.llmModels}` : '';
  const machine = report.run.machine
    ? ` · **Machine:** ${report.run.machine.cpu} · ${report.run.machine.cores} cores · ${(report.run.machine.ramBytes / 1024 ** 3).toFixed(1)} GB RAM`
    : '';
  const reviewed =
    report.reviewedBy === 'llm'
      ? ' · Reviewed by: LLM (root causes and fix prompts are model-written)'
      : ` · Reviewed by: mechanical template (no LLM review — ${report.reviewReason ?? 'reason unknown'})`;
  lines.push(`**Target:** ${report.run.targetUrl} · **Agents:** ${report.run.agents} · **Swarm wall:** ${(report.run.wallMs / 1000).toFixed(1)} s · **Swarm-phase LLM calls:** ${report.run.llmCalls}${models}${machine}${reviewed} · **Coverage (runtime graph):** ${(report.coverage.coverage * 100).toFixed(0)}% (${report.coverage.reachedActions}/${report.coverage.discoveredActions} discovered actions) · **Coverage (app map):** ${(report.coverage.appMapCoverage * 100).toFixed(0)}% (${report.coverage.appMapReached}/${report.coverage.appMapTotal} code-declared interactive elements)`);
  lines.push('');
  // Skip visibility: every Guard refusal, by label, with the opt-in path.
  // These actions are counted as UNREACHED in the coverage figures above.
  if (report.skippedActions?.length) {
    lines.push(`## Skipped by safety policy (${report.skippedActions.length}) — NOT TESTED`);
    lines.push('');
    for (const s of report.skippedActions) {
      lines.push(`- "${s.label}" — ${s.reason}`);
    }
    lines.push('');
    lines.push('_To test these controls anyway, set `destructiveOptIn: true` (or `externalOptIn: true`) in `uipocalypse.config.yaml`, or remove the label from the default skip list via `skipActions` — and re-run against a SAFE test copy, never production. See docs/volunteer/SAFE_TEST_COPY.md._');
    lines.push('');
  }
  lines.push(`## Summary`);
  lines.push('');
  lines.push(report.summary);
  lines.push('');
  lines.push(`## Findings (${report.issues.length})`);
  lines.push('');
  if (report.issues.length === 0) lines.push('_None._');
  for (const [n, i] of report.issues.entries()) {
    lines.push(`### ${n + 1}. ${i.title}`);
    lines.push('');
    lines.push(`\`${i.key}\` · **${i.severity}** · confidence **${i.confidence}** · ${i.observations} observation${i.observations === 1 ? '' : 's'}${i.file ? ` · \`${i.file}\`${i.line ? `:${i.line}` : ''}` : ''}`);
    lines.push('');
    lines.push(`**Root cause:** ${i.rootCause}`);
    lines.push('');
    lines.push(`**Fix prompt:**`);
    lines.push('');
    lines.push('```');
    lines.push(i.fixPrompt);
    lines.push('```');
    if (i.steps.length) {
      lines.push('');
      lines.push(`Repro: ${i.steps.map((s) => `\`${s}\``).join(' → ')}`);
    }
    lines.push('');
  }
  if (report.inconsistentFeedback.length) {
    lines.push(`## Inconsistent controls (low confidence — usually idempotent toggles)`);
    lines.push('');
    for (const c of report.inconsistentFeedback) lines.push(`- ${c.title} (${c.observations} obs)`);
    lines.push('');
  }
  if (report.correctRejections.length) {
    lines.push(`## Correct rejections (the app behaved as designed — not bugs)`);
    lines.push('');
    for (const c of report.correctRejections) lines.push(`- ${c.title} ×${c.observations}`);
    lines.push('');
  }
  if (report.artifacts.length) {
    lines.push(`## Filtered artifacts (cancelled in-flight requests)`);
    lines.push('');
    for (const c of report.artifacts) lines.push(`- ${c.title} ×${c.observations}`);
    lines.push('');
  }
  if (report.coverage.unreached.length) {
    lines.push(`## Not tested (${report.coverage.unreached.length})`);
    lines.push('');
    for (const u of report.coverage.unreached) lines.push(`- "${u.label}" (${u.route}) — ${u.reason}`);
    lines.push('');
  }
  const amUnreached = report.coverageFigures?.appMapUnreached ?? [];
  if (amUnreached.length) {
    lines.push(`## Code-declared but never exercised (${amUnreached.length} of ${report.coverageFigures?.appMap.total ?? 0})`);
    lines.push('');
    lines.push('_Interactive elements the static analyzer found in the code that no runtime action matched:_');
    lines.push('');
    for (const u of amUnreached) lines.push(`- ${u}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Reports are cached per run so repeated get_report calls cost zero LLM. */
export function reportFile(runsDir: string, runId: number): string {
  return join(runsDir, `run-${runId}-report.json`);
}

export function loadReport(runsDir: string, runId: number): Report | null {
  const file = reportFile(runsDir, runId);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as Report;
}

export function saveReport(runsDir: string, report: Report): string {
  mkdirSync(runsDir, { recursive: true });
  const file = reportFile(runsDir, report.runId);
  writeFileSync(file, JSON.stringify(report, null, 2));
  return file;
}

/**
 * The full report path for one run: cached report if present, otherwise
 * collect → review (LLM call #2, or mechanical fallback) → assemble → cache.
 */
export async function generateReport(opts: {
  db: Db;
  runId: number;
  appMap: AppMap;
  llm: LLM;
  runsDir: string;
  /** skip the on-disk cache (force a regeneration) */
  fresh?: boolean;
}): Promise<Report> {
  const cached = opts.fresh ? null : loadReport(opts.runsDir, opts.runId);
  if (cached) return cached;

  const run = getRun(opts.db, opts.runId);
  if (!run) throw new Error(`Run not found: ${opts.runId}`);

  const collected = collectRun(opts.db, opts.runId, opts.appMap);
  const review = await reviewRun({
    collected,
    appMap: opts.appMap,
    llm: opts.llm,
    run: toMeta(run),
  });
  const report = assembleReport(collected, review, toMeta(run));
  saveReport(opts.runsDir, report);
  return report;
}

function toMeta(run: RunRow): RunMeta {
  return {
    runId: run.id,
    targetUrl: run.target_url,
    agents: run.agents,
    wallMs: run.duration_ms ?? 0,
    llmCalls: run.llm_calls ?? 0,
    startedAt: run.started_at,
    llmModels: run.llm_models,
    disabledClasses: run.disabled_classes?.split(',').filter(Boolean) ?? [],
    skippedActions: parseSkipped(run.skipped_actions),
    machine: run.cpu ? { cpu: run.cpu, cores: run.cores ?? 0, ramBytes: run.ram_bytes ?? 0 } : undefined,
    agentsAtCollapse: run.agents_at_collapse ?? undefined,
  };
}

/** skipped_actions is a JSON array on the run row — missing/corrupt means none */
function parseSkipped(raw: string | null | undefined): Array<{ label: string; reason: string }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => s && typeof s.label === 'string' && typeof s.reason === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * diff_runs (TRD §6, phase 5 semantics): fixed / new / still failing /
 * intermittent across the last N runs, keyed on the stable cluster fingerprint.
 *
 * Intermittent is the honest label for detection variance: a finding present
 * in some but not all runs is NOT fixed (a fix needs 2 consecutive absences)
 * and NOT new (a new finding must hold for the last 2 consecutive runs). The
 * run-scoped suppression protects this loop (PHASE4_RESULTS.md).
 */
export type DiffEntry = {
  key: string;
  title: string;
  severity: string;
  presentIn: number[];
  observations: number;
};

export function diffRuns(
  db: Db,
  appMap: AppMap,
  runIds: number[],
): {
  runs: number[];
  fixed: DiffEntry[];
  new: DiffEntry[];
  stillFailing: DiffEntry[];
  intermittent: DiffEntry[];
} {
  if (runIds.length < 2) throw new Error('diff_runs needs at least 2 runs (3+ recommended: fixed requires 2 consecutive absences)');

  const perRun = runIds.map((id) => {
    const run = getRun(db, id);
    if (!run) throw new Error(`Run not found: ${id}`);
    return new Map(collectRun(db, id, appMap).findingClusters.map((c) => [c.key, c] as const));
  });

  const allKeys = new Set<string>();
  for (const m of perRun) for (const k of m.keys()) allKeys.add(k);

  const fixed: DiffEntry[] = [];
  const fresh: DiffEntry[] = [];
  const stillFailing: DiffEntry[] = [];
  const intermittent: DiffEntry[] = [];

  for (const key of allKeys) {
    const presence = perRun.map((m) => m.get(key));
    const presentIn = runIds.filter((_, i) => presence[i] !== undefined);
    const sample = presence.find((p) => p !== undefined)!;
    const observations = presence.reduce((s, c) => s + (c?.observations ?? 0), 0);
    const e: DiffEntry = { key, title: sample.title, severity: sample.severity, presentIn, observations };

    const last2Present = presence.slice(-2).every((p) => p !== undefined);
    const last2Absent = presence.slice(-2).every((p) => p === undefined);
    const allPresent = presence.every((p) => p !== undefined);
    const anyPresent = presentIn.length > 0;

    if (allPresent) stillFailing.push(e);
    else if (anyPresent && last2Absent) fixed.push(e);
    else if (last2Present) fresh.push(e);
    else intermittent.push(e);
  }

  const byObs = (a: DiffEntry, b: DiffEntry) => b.observations - a.observations || a.key.localeCompare(b.key);
  return {
    runs: runIds,
    fixed: fixed.sort(byObs),
    new: fresh.sort(byObs),
    stillFailing: stillFailing.sort(byObs),
    intermittent: intermittent.sort(byObs),
  };
}
