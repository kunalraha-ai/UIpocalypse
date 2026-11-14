import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import type { BrowserContext } from 'playwright';
import type { Logger } from '../logger.js';
import type { LLM } from '../llm/index.js';
import type { UiConfig } from '../config.js';
import { createGuard } from '../guard/index.js';
import { RUNTIME_SOURCE } from '../runtime/runtime-source.js';
import { StateGraph } from '../graph/graph.js';
import { hashAriaSnapshot, normalizeRoute } from '../graph/hash.js';
import { DetectorHub, type FindingCandidate } from './detectors.js';
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
  scoutSteps?: number;
  wandererSteps?: number;
  /** reuse a run row (e.g. when the swarm phase follows the scout phase) */
  runId?: number;
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
  const runId = opts.runId ?? createRun(opts.db, { targetUrl: opts.url, agents: 1 });
  const log = opts.logger.child({ runId });
  const graph = new StateGraph(opts.db, opts.routes);
  const wanderer = new Wanderer(seedFrom(runId));
  const llmCallsAtStart = opts.llm.calls;

  const browser = await chromium.launch();
  let context: BrowserContext;
  try {
    context = await browser.newContext();
  } catch (e) {
    await browser.close();
    throw e;
  }
  await context.addInitScript(RUNTIME_SOURCE);
  const page = await context.newPage();
  const hub = new DetectorHub({ appOrigin: new URL(opts.url).origin });
  hub.attachPage(page);

  const findings: FindingCandidate[] = [];
  const history: string[] = [];

  async function currentState(): Promise<{ hash: string; url: string }> {
    const snap = await page.locator('body').ariaSnapshot();
    const { hash } = hashAriaSnapshot(snap);
    return { hash, url: normalizeRoute(page.url(), opts.routes) };
  }

  async function getActions(): Promise<RuntimeAction[]> {
    const raw = await page.evaluate(() => window.__uip.getActions());
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
    return page.evaluate(
      ({ id, input, performOpts }) => window.__uip.perform(id, { input, ...(performOpts ?? {}) }),
      { id, input, performOpts },
    );
  }

  /** Perform + record the transition + detector verdicts. Shared by scout and wanderer. */
  async function stepAndRecord(id: number, input?: string): Promise<PerformResult> {
    const before = await currentState();
    const graphFrom = graph.getOrCreateState({ hash: before.hash, url: before.url, signature: '' });
    const actions = await getActions();
    const action = actions.find((a) => a.id === id);
    const label = action?.name ?? `action#${id}`;
    const graphAction = graph.getOrCreateAction({
      stateId: graphFrom.id,
      locator: action?.locator ?? `rt:${id}`,
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

    // detector verdicts for this action (drain resets per step → per-action attribution)
    const drain = await page.evaluate(() => window.__uip.drain());
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
    if (result.dead && !result.saturated && !hadErrors) {
      const verdict = hub.deadClick({
        actionLabel: label,
        reasons: [],
        steps: history.slice(-8),
        url: page.url(),
        actionId: id,
      });
      if (verdict) findings.push(verdict);
    }
    if (result.nav) await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    return result;
  }

  try {
    // ---------------------------------------------------------- seeds + scouts
    const seedUrls = [...new Set([opts.url, ...opts.plan.seedRoutes.map((r) => new URL(r, opts.url).href)])];
    const scoutBudget = opts.scoutSteps ?? 24;
    let scoutOutcome = 'skipped';
    for (const seed of seedUrls.slice(0, 4)) {
      if (Date.now() - started > budgetMs * 0.6) {
        scoutOutcome = 'budget';
        break;
      }
      await page.goto(seed, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(400);
      const result = await runScout({
        page,
        graph,
        llm: opts.scoutLlm ?? opts.llm,
        plan: opts.plan,
        seedUrl: seed,
        maxSteps: Math.min(scoutBudget, 12),
        getActions,
        perform: async (id, input) => stepAndRecord(id, input),
        currentState,
        onStep: (info) =>
          log.info('scout step', { step: info.step, action: info.action.slice(0, 40), newState: info.new }),
      });
      scoutOutcome = result.stopped;
      if (result.stopped === 'error') {
        // one seed failing must not kill the rest — log and move on
        log.warn('scout seed failed', { seed, error: result.error });
        continue;
      }
    }

    // ---------------------------------------------------------- wanderer (code policy, no LLM)
    const maxWandererSteps = opts.wandererSteps ?? 40;
    const nasty = Object.values(opts.plan.nastyInputs).flat();
    for (let step = 0; step < maxWandererSteps; step++) {
      if (Date.now() - started > budgetMs) break;
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
      await stepAndRecord(choice.runtimeId, choice.input);
    }

    // ---------------------------------------------------------- late checks
    const drain = await page.evaluate(() => window.__uip.drain());
    findings.push(...hub.infiniteSpinners(drain.spinners, { steps: history.slice(-8), url: page.url() }));
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
        screenshot: null,
        trace: null,
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
      summary: { scoutOutcome, seeds: seedUrls.slice(0, 4), findingsTotal: findings.length },
      coverage: stats.coverage,
      findingCounts: counts,
      graph: { states: stats.states, actions: stats.actions, transitions: stats.transitions },
      llmCalls: opts.llm.calls - llmCallsAtStart,
      durationMs,
      warnings: decision.warnings,
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function seedFrom(runId: number): number {
  const digest = createHash('sha1').update(`uip-run-${runId}`).digest();
  return digest[0]! * 256 + digest[1]!;
}
