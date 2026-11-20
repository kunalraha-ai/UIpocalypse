import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import type { Logger } from '../logger.js';
import type { LLM } from '../llm/index.js';
import type { UiConfig } from '../config.js';
import { createGuard } from '../guard/index.js';
import { RUNTIME_SOURCE } from '../runtime/runtime-source.js';
import { StateGraph } from '../graph/graph.js';
import { hashAriaSnapshot, normalizeRoute } from '../graph/hash.js';
import { DetectorHub, type FindingCandidate, ALIVE_REASONS } from './detectors.js';
import { withTimeout, OP_TIMEOUT_MS, armWatchdog } from './timeout.js';
import { runScout } from '../scout/scout.js';
import { Wanderer } from '../agent/wanderer.js';
import type { Plan } from '../plan/schema.js';
import { addFinding, createRun, finishRun, type Db } from '../db/index.js';

/**
 * Runner (Phase 3): one Chromium, one context — scouts first (LLM), then a
 * Wanderer (code policy). Everything observed lands in the state graph; every
 * detector hit becomes a finding with evidence and reproduction steps.
 */

export type RuntimeAction = {
  id: number;
  role: string | null;
  name: string;
  risky: boolean;
  textLike: boolean;
  /** stable graph locator: role|name#occurrence — immune to DOM-index shifts */
  locator: string;
};

export type PerformResult = {
  dead: boolean;
  reasons: string[];
  nav: boolean;
  url: string;
  saturated?: boolean;
  /** browser validation blocked the submit before any app handler could run */
  blocked?: boolean;
};

export type ExploreOptions = {
  url: string;
  config: UiConfig;
  plan: Plan;
  db: Db;
  routes: string[];
  /** planner/review LLM — also the budget counter for the whole run */
  llm: LLM;
  /** fast model for scout steps (shares the budget counter when from createLlmSet) */
  scoutLlm?: LLM;
  logger: Logger;
  budgetSeconds?: number;
  /** override config.scoutBudgetSeconds (the hard scouting-phase cap) */
  scoutBudgetSeconds?: number;
  scoutSteps?: number;
  wandererSteps?: number;
  /** reuse a run row (e.g. when the swarm phase follows the scout phase) */
  runId?: number;
  /** directory for failure screenshots — omit to skip */
  screenshotDir?: string;
  /** directory for the scout-phase Playwright trace (config.trace enables) */
  traceDir?: string;
};

export type ExploreResult = {
  runId: number;
  summary: Record<string, unknown>;
  coverage: number;
  findingCounts: Record<string, number>;
  graph: { states: number; actions: number; transitions: number };
  llmCalls: number;
  durationMs: number;
  warnings: string[];
};

declare global {
  interface Window {
    __uip: {
      getActions: () => RuntimeAction[];
      perform: (
        id: number,
        o?: { input?: string; doubleClick?: boolean; interClickDelayMs?: number; waitMs?: number },
      ) => Promise<PerformResult>;
      drain: () => {
        requests: Array<{ url: string; status: number }>;
        pageErrors: string[];
        consoleErrors: string[];
        spinners: Array<{ label: string; since: number; stillVisible: boolean }>;
      };
      getState: () => { url: string; title: string; spinners: Array<{ label: string; since: number }> };
      raceFire: (id: number, delayMs: number) => { ok: boolean };
    };
  }
}

export async function explore(opts: ExploreOptions): Promise<ExploreResult> {
  const guard = createGuard(opts.config);
  const decision = await guard.checkTarget(opts.url);
  if (!decision.allowed) {
    throw new Error(`Safety Guard refused target ${opts.url}: ${decision.reasons.join(' | ')}`);
  }

  const budgetMs = (opts.budgetSeconds ?? opts.config.budgetSeconds) * 1000;
  const started = Date.now();
  const monoStart = performance.now(); // monotonic: survives clock jumps/suspends
  const runId =
    opts.runId ??
    createRun(opts.db, {
      targetUrl: opts.url,
      agents: 1,
      llmModels: `planner=${opts.llm.model};scout=${(opts.scoutLlm ?? opts.llm).model}`,
    });
  const log = opts.logger.child({ runId });
  const graph = new StateGraph(opts.db, opts.routes);
  const wanderer = new Wanderer(seedFrom(runId));
  const llmCallsAtStart = opts.llm.calls;

  const browser = await chromium.launch();
  // TRD §11 global watchdog: a wedged operation must never stall the phase
  // past budget + bounded overshoot — force-close the browser, let pending
  // ops reject, and still emit the partial report.
  const cancelWatchdog = armWatchdog(
    () => browser.close(),
    budgetMs + 60_000,
    log,
  );
  // Budgets are MONOTONIC (performance.now): a suspend or clock jump must not
  // make a budget look expired (or a wall look inflated) — Date.now() jumps
  // with the wall clock; the execution-3 suspend proved it (23.6 h).
  const elapsedMono = () => performance.now() - monoStart;
  let context: BrowserContext;
  try {
    context = await browser.newContext();
  } catch (e) {
    await browser.close();
    throw e;
  }
  await context.addInitScript(RUNTIME_SOURCE);
  // Playwright trace for replay (TRD §6 v1): opt-in via config.trace; the
  // scout context has a clean lifecycle, so one trace covers the phase
  const tracing = !!(opts.traceDir && opts.config.trace);
  const tracePath = tracing ? join(opts.traceDir!, `run-${runId}-scout.zip`) : null;
  if (tracing) {
    await context.tracing.start({ name: `run-${runId}-scout`, screenshots: true, snapshots: true });
  }
  const page = await context.newPage();
  const hub = new DetectorHub({ appOrigin: new URL(opts.url).origin });
  hub.attachPage(page);

  const findings: FindingCandidate[] = [];
  const suppressedDead = { n: 0 };
  const inconsistentFeedbackSeen = new Set<string>();
  const shotCounter = { n: 0 };
  const history: string[] = [];

  async function screenshot(): Promise<string | null> {
    if (!opts.screenshotDir) return null;
    try {
      shotCounter.n++;
      const file = join(opts.screenshotDir, `run-${runId}-scout-${shotCounter.n}.png`);
      await page.screenshot({ path: file });
      return file;
    } catch {
      return null;
    }
  }

  async function currentState(): Promise<{ hash: string; url: string }> {
    const snap = await withTimeout(page.locator('body').ariaSnapshot(), OP_TIMEOUT_MS, 'ariaSnapshot');
    const { hash } = hashAriaSnapshot(snap);
    return { hash, url: normalizeRoute(page.url(), opts.routes) };
  }

  async function getActions(): Promise<RuntimeAction[]> {
    const raw = await withTimeout(
      page.evaluate(() => window.__uip.getActions()),
      OP_TIMEOUT_MS,
      'getActions',
    );
    // stable locator: role|name#occurrence — non-interactive DOM changes (alerts,
    // spinners) shift enumeration indices but never reorder same-signature
    // elements, so this identity is stable across visits (graph-growth probe)
    const seen = new Map<string, number>();
    const actions: RuntimeAction[] = raw.map((a) => {
      const sig = `${a.role ?? 'unknown'}|${a.name}`;
      const n = seen.get(sig) ?? 0;
      seen.set(sig, n + 1);
      return { ...a, locator: `${sig}#${n}` };
    });
    // Safety Guard G5: risky-labelled actions never run without opt-in
    const { allowed, skipped } = guard.filterActions(
      actions.map((a) => ({ id: a.id, label: a.name })),
      { dbOk: decision.isLocal },
    );
    const allowedIds = new Set(allowed.map((a) => a.id));
    if (skipped.length) {
      log.info('safety: skipped actions', { actions: skipped.map((s) => s.action.label).slice(0, 10) });
    }
    return actions.filter((a) => allowedIds.has(a.id));
  }

  async function perform(id: number, input?: string, performOpts?: { doubleClick?: boolean }) {
    return withTimeout(
      page.evaluate(
        ({ id, input, performOpts }) => window.__uip.perform(id, { input, ...(performOpts ?? {}) }),
        { id, input, performOpts },
      ),
      OP_TIMEOUT_MS,
      'perform',
    ) as Promise<PerformResult>;
  }

  /** Perform + record the transition + detector verdicts. Shared by scout and wanderer. */
  async function stepAndRecord(id: number, input?: string): Promise<PerformResult> {
    const before = await currentState();
    const graphFrom = graph.getOrCreateState({ hash: before.hash, url: before.url, signature: '' });
    const actions = await getActions();
    const action = actions.find((a) => a.id === id);
    const label = action?.name ?? `action#${id}`;
    const actionLocator = action?.locator ?? `rt:${id}`;
    const graphAction = graph.getOrCreateAction({
      stateId: graphFrom.id,
      locator: actionLocator,
      kind: action?.role ?? 'unknown',
      label: label.slice(0, 80),
      riskClass: action?.risky ? 'destructive' : 'safe',
    });
    history.push(`${label} @ ${before.hash}`);

    let result: PerformResult;
    try {
      result = await perform(id, input);
    } catch {
      // a full navigation destroyed the execution context mid-perform → nav signal
      await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
      result = { dead: false, reasons: ['nav'], nav: true, url: page.url() };
    }
    const after = await currentState();
    const graphTo = graph.getOrCreateState({ hash: after.hash, url: after.url, signature: '' });
    graph.recordTransition({
      fromState: graphFrom.id,
      actionId: graphAction.id,
      toState: graphTo.id,
      ms: 0,
      error: result.dead,
    });

    // repeat-activation suppression (RUN-SCOPED): feedback earlier in THIS
    // run suppresses later dead verdicts for the same control; prior runs
    // never suppress, so regressions in this run are always reported
    if (result.reasons.some((r) => ALIVE_REASONS.includes(r))) {
      graph.markAliveThisRun(runId, actionLocator);
    }

    // detector verdicts for this action (drain resets per step → per-action attribution)
    const drain = await withTimeout(page.evaluate(() => window.__uip.drain()), OP_TIMEOUT_MS, 'drain');
    const hadErrors = drain.pageErrors.length > 0 || drain.consoleErrors.length > 0;
    for (const err of drain.pageErrors) {
      findings.push({
        type: 'page_error',
        severity: 'high',
        confidence: 'high',
        evidence: { message: err, action: label },
        steps: history.slice(-8),
        url: page.url(),
        actionId: id,
      });
    }
    for (const err of drain.consoleErrors) {
      findings.push({
        type: 'console_error',
        severity: 'low',
        confidence: 'medium',
        evidence: { text: err, action: label },
        steps: history.slice(-8),
        url: page.url(),
        actionId: id,
      });
    }
    // dead click — but an action that THREW is not "dead": the error is the finding
    if (result.dead && !result.saturated && !result.blocked && !hadErrors) {
      if (graph.aliveThisRun(runId, actionLocator)) {
        // repeat-activation noise — suppressed as dead_click, but the first
        // such verdict reports the control as low-confidence inconsistent_feedback
        suppressedDead.n++;
        if (!inconsistentFeedbackSeen.has(actionLocator)) {
          inconsistentFeedbackSeen.add(actionLocator);
          findings.push({
            type: 'inconsistent_feedback',
            severity: 'low',
            confidence: 'low',
            evidence: {
              action: label,
              note: 'produced real feedback on some interactions this run but none on this one — idempotent repeat, or an intermittent fault',
            },
            steps: history.slice(-8),
            url: page.url(),
            screenshot: await screenshot(),
          });
        }
      } else {
        const verdict = hub.deadClick({
          actionLabel: label,
          reasons: [],
          steps: history.slice(-8),
          url: page.url(),
          actionId: id,
        });
        if (verdict) findings.push({ ...verdict, screenshot: await screenshot() });
      }
    }
    if (result.nav) await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    return result;
  }

  try {
    // ---------------------------------------------------------- seeds + scouts
    // HARD wall-clock cap on the scouting phase (config.scoutBudgetSeconds,
    // default 90): when it trips, scouting stops and the swarm proceeds —
    // total run time stays predictable when the LLM is slow. Effective cap
    // never exceeds the overall phase budget.
    const seedUrls = [...new Set([opts.url, ...opts.plan.seedRoutes.map((r) => new URL(r, opts.url).href)])];
    const scoutBudget = opts.scoutBudgetSeconds ?? Math.min(opts.config.scoutBudgetSeconds, budgetMs / 1000);
    const scoutDeadline = scoutBudget * 1000; // monotonic ms from monoStart
    const scoutBudgetSteps = opts.scoutSteps ?? 24;
    let scoutOutcome = 'skipped';
    let scoutCalls = 0;
    for (const seed of seedUrls.slice(0, 4)) {
      if (elapsedMono() >= scoutDeadline) {
        scoutOutcome = 'budget';
        break;
      }
      await page.goto(seed, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(400);
      let result;
      try {
        result = await runScout({
          page,
          graph,
          llm: opts.scoutLlm ?? opts.llm,
          plan: opts.plan,
          seedUrl: seed,
          maxSteps: Math.min(scoutBudgetSteps, 12),
          deadlineMs: scoutDeadline - elapsedMono(), // remaining budget, monotonic
          getActions,
          perform: async (id, input) => stepAndRecord(id, input),
          currentState,
          onStep: (info) =>
            log.info('scout step', { step: info.step, action: info.action.slice(0, 40), newState: info.new }),
        });
      } catch (e) {
        // a wedged/timed-out operation must not kill the phase — skip the seed
        result = { steps: 0, llmCalls: 0, stopped: 'error' as const, error: String(e).slice(0, 200) };
      }
      scoutCalls += result.llmCalls;
      scoutOutcome = result.stopped;
      if (result.stopped === 'error') {
        // one seed failing must not kill the rest — log and move on
        log.warn('scout seed failed', { seed, error: result.error });
        continue;
      }
    }
    if (elapsedMono() >= scoutDeadline && scoutOutcome !== 'error') scoutOutcome = 'budget';
    log.info('scout phase done', { outcome: scoutOutcome, llmCalls: scoutCalls, wallMs: elapsedMono(), capMs: scoutBudget * 1000 });

    // ---------------------------------------------------------- wanderer (code policy, no LLM)
    const maxWandererSteps = opts.wandererSteps ?? 40;
    const nasty = Object.values(opts.plan.nastyInputs).flat();
    for (let step = 0; step < maxWandererSteps; step++) {
      if (elapsedMono() > budgetMs) break;
      const state = await currentState();
      const graphState = graph.getOrCreateState({ hash: state.hash, url: state.url, signature: '' });
      const actions = await getActions();
      const dbActions = graph.actionsWithVisits(graphState.id);
      const choice = wanderer.decide({
        step,
        maxSteps: maxWandererSteps,
        actions: actions.map((a) => ({
          runtimeId: a.id,
          graphId: dbActions.find((d) => d.locator === a.locator)?.id ?? -1,
          label: a.name,
          visits: dbActions.find((d) => d.locator === a.locator)?.visits ?? 0,
          textLike: a.textLike,
          risky: a.risky,
        })),
        nastyInputs: nasty,
      });
      if (choice.kind === 'abandon') break;
      try {
        await stepAndRecord(choice.runtimeId, choice.input);
      } catch (e) {
        // wedged/timed-out op — stop the wanderer, keep everything recorded
        log.warn('wanderer step failed — stopping wanderer', { error: String(e).slice(0, 200) });
        break;
      }
    }

    // ---------------------------------------------------------- late checks
    const drain = await withTimeout(page.evaluate(() => window.__uip.drain()), OP_TIMEOUT_MS, 'drain').catch(() => null);
    if (drain) {
      findings.push(...hub.infiniteSpinners(drain.spinners, { steps: history.slice(-8), url: page.url() }));
    }
    const navError = await hub.navigationError(page, history.slice(-8));
    if (navError) findings.push(navError);

    // ---------------------------------------------------------- record + finish
    findings.push(...hub.take());
    const counts: Record<string, number> = {};
    for (const f of findings) {
      counts[f.type] = (counts[f.type] ?? 0) + 1;
      addFinding(opts.db, {
        runId,
        type: f.type,
        severity: f.severity,
        confidence: f.confidence,
        persona: 'scout+wanderer',
        evidence: { ...f.evidence, steps: f.steps.slice(-8), pageUrl: f.url },
        screenshot: f.screenshot ?? null,
        trace: tracing ? tracePath : null,
      });
    }

    const stats = graph.stats();
    const durationMs = Date.now() - started;
    finishRun(opts.db, {
      id: runId,
      durationMs,
      llmCalls: opts.llm.calls - llmCallsAtStart,
      coverage: stats.coverage,
    });

    log.info('explore complete', {
      durationMs,
      findings: findings.length,
      scoutOutcome,
      ...stats,
    });

    return {
      runId,
      summary: { scoutOutcome, seeds: seedUrls.slice(0, 4), findingsTotal: findings.length, suppressedDeadClicks: suppressedDead.n },
      coverage: stats.coverage,
      findingCounts: counts,
      graph: { states: stats.states, actions: stats.actions, transitions: stats.transitions },
      llmCalls: opts.llm.calls - llmCallsAtStart,
      durationMs,
      warnings: decision.warnings,
    };
  } finally {
    cancelWatchdog();
    if (tracing && tracePath) {
      await context.tracing.stop({ path: tracePath }).catch(() => {});
    }
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function seedFrom(runId: number): number {
  const digest = createHash('sha1').update(`uip-run-${runId}`).digest();
  return digest[0]! * 256 + digest[1]!;
}
