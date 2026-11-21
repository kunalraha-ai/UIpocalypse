import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import type { Logger } from '../logger.js';
import type { UiConfig } from '../config.js';
import type { LLM } from '../llm/index.js';
import type { Plan } from '../plan/schema.js';
import { ScoutDecisionSchema } from '../plan/schema.js';
import { createGuard, classifyAction } from '../guard/index.js';
import { createRateLimiter, createRampMonitor, type RampReport } from '../guard/ramp.js';
import { RUNTIME_SOURCE } from '../runtime/runtime-source.js';
import { StateGraph } from '../graph/graph.js';
import { hashAriaSnapshot, normalizeRoute } from '../graph/hash.js';
import { DetectorHub, type FindingCandidate, ALIVE_REASONS } from './detectors.js';
import { ALL_PERSONAS, createPersona, type PersonaDecision } from '../agent/personas.js';
import { runRace, pgInvariantRunner, dbUrlFromEnv, dbHostFromUrl, attributeDuplicateEffects, type InvariantResult } from './race.js';
import { withTimeout, OP_TIMEOUT_MS, armWatchdog } from './timeout.js';
import { addFinding, createRun, finishRun, type Db } from '../db/index.js';

/**
 * Swarm orchestrator (TRD §3.4): N contexts in ONE Chromium, each running a
 * code-policy persona with INDEPENDENT stepping (no lockstep rounds — Phase 0
 * S3 showed stragglers gate whole rounds). Concurrency ramps 5 → N with
 * degradation detection (G7), contexts crash-isolate, and the whole thing
 * aborts cleanly on Ctrl-C (SIGINT) with a partial report (SAFETY.md §6 row 7).
 */

export type SwarmOptions = {
  url: string;
  config: UiConfig;
  plan: Plan;
  db: Db;
  routes: string[];
  /** escalation budget (shared counter; scout model for cheap picks) */
  llm: LLM;
  logger: Logger;
  agents?: number;
  budgetSeconds?: number;
  perAgentSteps?: number;
  personas?: string[];
  abort?: AbortSignal;
  /** reuse a run row created by the scout phase */
  runId?: number;
  optIn?: { destructive?: boolean; externalSideEffects?: boolean };
  /** directory for failure screenshots (workspace.screenshots) — omit to skip */
  screenshotDir?: string;
  raceTarget?: {
    url: string;
    actionLabel: string;
    input?: string;
    contexts?: number;
    /** per-context setup (e.g. log in) before the race URL */
    setup?: (ctx: import('playwright').BrowserContext) => Promise<void>;
  };
};

export type SwarmResult = {
  runId: number;
  agents: number;
  steps: number;
  stepsPerSec: number;
  wallMs: number;
  coverage: number;
  findingCounts: Record<string, number>;
  graph: { states: number; actions: number; transitions: number };
  ramp: RampReport & { degradedAtLevel?: number };
  llmCalls: number;
  raceFired?: number;
  raceWallMs: number;
  /** why race mode did not run (G4 refusal, no invariants, or an error) */
  raceSkipReason?: string;
  /** invariant-confirmed duplicate damage (TRD §3.6 duplicate_effect) */
  duplicateEffects: InvariantResult[];
  /** invariants already failing before the race volley (owned by the sweep or unattributed) */
  racePreExisting: string[];
  /** dead-click verdicts suppressed because the control has produced feedback before (repeat-activation) */
  suppressedDeadVerdicts: number;
  /** controls that worked on some interactions this run but not others (inconsistent_feedback findings) */
  inconsistentFeedbackActions: string[];
  /** LLM calls made by stalled agents (should be ~0 after the phase-6 fix) */
  escalationCalls: number;
  /** detection classes that were NOT run because the Guard could not confirm a safe DB */
  disabledClasses: string[];
  /** every action the Safety Guard refused, by label — visible in the report, never silent */
  skippedActions: Array<{ label: string; reason: string }>;
  aborted: boolean;
  warnings: string[];
};

export async function swarm(opts: SwarmOptions): Promise<SwarmResult> {
  const effectiveConfig: UiConfig = {
    ...opts.config,
    destructiveOptIn: opts.optIn?.destructive ?? opts.config.destructiveOptIn,
    externalOptIn: opts.optIn?.externalSideEffects ?? opts.config.externalOptIn,
  };
  const guard = createGuard(effectiveConfig);
  const decision = await guard.checkTarget(opts.url);
  if (!decision.allowed) {
    throw new Error(`Safety Guard refused target ${opts.url}: ${decision.reasons.join(' | ')}`);
  }

  // No-safe-DB read-only mode (SAFETY.md G4 + volunteer readiness): when
  // the Guard cannot confirm a safe DB, the swarm still runs but writes
  // and form submits are skipped. The Guard's refusal of write-heavy modes
  // (race, fuzz) is NOT weakened — those are separate, stronger gates.
  const dbWriteSafe = decision.isLocal && effectiveConfig.db.allowedHosts.length > 0;
  const disabledClasses: string[] = [];
  if (!dbWriteSafe) {
    disabledClasses.push('duplicate_request', 'duplicate_effect', 'race_mode', 'form_submits');
  }

  const started = Date.now();
  const budgetMs = (opts.budgetSeconds ?? opts.config.budgetSeconds) * 1000;
  const agentsWanted = Math.min(opts.agents ?? opts.config.agents, 100);
  const perAgentSteps = opts.perAgentSteps ?? 100;
  const runId = opts.runId ?? createRun(opts.db, { targetUrl: opts.url, agents: agentsWanted });
  const log = opts.logger.child({ runId, phase: 'swarm' });
  const graph = new StateGraph(opts.db, opts.routes);
  const personaIds = (opts.personas ?? opts.plan.personas ?? ALL_PERSONAS).filter((p) => ALL_PERSONAS.includes(p));
  const rateLimiter = createRateLimiter({ rps: effectiveConfig.maxRps });
  const ramp = createRampMonitor({ startAgents: 5, maxAgents: agentsWanted, windowSize: 40 });
  const llmCallsAtStart = opts.llm.calls;

  const browser = await chromium.launch();
  // TRD §11 global watchdog: a wedged operation must never stall the swarm
  // past budget + bounded overshoot (agents + race + invariant sweep) —
  // force-close the browser, let pending ops reject, still emit the report.
  const cancelWatchdog = armWatchdog(() => browser.close(), budgetMs + 90_000, log);
  const findings: FindingCandidate[] = [];
  const stepsCounter = { n: 0 };
  const suppressedDeadVerdicts = { n: 0 };
  const inconsistentFeedbackSeen = new Set<string>();
  const inconsistentFeedbackActions: string[] = [];
  const shotCounter = { n: 0 };
  const escalationCallCounter = { n: 0 };
  // every Guard refusal, by label+reason — reported, and stored on the run row
  const skippedActionMap = new Map<string, { label: string; reason: string }>();

  /** failure screenshot (TRD §3.6: every finding may carry a screenshot path) */
  async function screenshot(page: Page): Promise<string | null> {
    if (!opts.screenshotDir) return null;
    try {
      shotCounter.n++;
      const file = join(opts.screenshotDir, `run-${runId}-${shotCounter.n}.png`);
      await page.screenshot({ path: file });
      return file;
    } catch {
      return null;
    }
  }
  let activeLevel = Math.min(5, agentsWanted);
  let degradedAtLevel: number | undefined;
  let lastStepUpAt = 0;
  const seedUrls = [...new Set([opts.url, ...opts.plan.seedRoutes.map((r) => new URL(r, opts.url).href)])];
  const nasty = Object.values(opts.plan.nastyInputs).flat();

  type Agent = {
    index: number;
    persona: ReturnType<typeof createPersona>;
    context: BrowserContext | null;
    page: Page | null;
    steps: number;
    postIndex: number;
    history: string[];
    stalledSteps: number;
    escalated: boolean;
    respawns: number;
    /** the agent's most recent graph state ID (for policy-based stall handling) */
    graphStateId: number;
  };

  const agents: Agent[] = [];
  for (let i = 0; i < agentsWanted; i++) {
    const seed = createHash('sha1').update(`uip-agent-${runId}-${i}`).digest();
    agents.push({
      index: i,
      persona: createPersona(personaIds[i % personaIds.length] ?? 'wanderer', seed[0]! * 256 + seed[1]!),
      context: null,
      page: null,
      steps: 0,
      postIndex: 0,
      history: [],
      stalledSteps: 0,
      escalated: false,
      respawns: 0,
      graphStateId: 0,
    });
  }

  const isDone = () => opts.abort?.aborted || Date.now() - started > budgetMs;

  async function ensureContext(agent: Agent): Promise<Page | null> {
    if (agent.page) return agent.page;
    try {
      const ctx = await browser.newContext();
      await ctx.addInitScript(RUNTIME_SOURCE);
      const hub = new DetectorHub({ appOrigin: new URL(opts.url).origin });
      const page = await ctx.newPage();
      hub.attachPage(page);
      agent.context = ctx;
      agent.page = page;
      (page as unknown as { __hub?: DetectorHub }).__hub = hub;
      await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      return page;
    } catch {
      return null;
    }
  }

  async function respawn(agent: Agent): Promise<Page | null> {
    await agent.context?.close().catch(() => {});
    agent.context = null;
    agent.page = null;
    agent.postIndex = 0;
    agent.respawns++;
    if (agent.respawns > 5) return null; // give up on this agent
    return ensureContext(agent);
  }

  async function currentState(page: Page): Promise<{ hash: string; url: string }> {
    const snap = await withTimeout(page.locator('body').ariaSnapshot(), OP_TIMEOUT_MS, 'ariaSnapshot');
    const { hash } = hashAriaSnapshot(snap);
    return { hash, url: normalizeRoute(page.url(), opts.routes) };
  }

  async function getActions(page: Page, stateId: number) {
    const raw = await withTimeout(
      page.evaluate(() => window.__uip.getActions()),
      OP_TIMEOUT_MS,
      'getActions',
    );
    const seen = new Map<string, number>();
    const actions = raw.map((a) => {
      const sig = `${a.role ?? 'unknown'}|${a.name}`;
      const n = seen.get(sig) ?? 0;
      seen.set(sig, n + 1);
      return { ...a, locator: `${sig}#${n}` };
    });
    const { allowed, skipped } = guard.filterActions(
      actions.map((a) => ({ id: a.id, label: a.name })),
      { dbOk: decision.isLocal },
    );
    const allowedIds = new Set(allowed.map((a) => a.id));
    const skipReasonById = new Map<number, string>();
    for (const s of skipped) skipReasonById.set(s.action.id, s.reason);
    if (!dbWriteSafe) {
      // read-only mode: also skip write-class actions (form submits, POST triggers)
      // that the Guard would normally allow with a safe DB
      for (const a of actions) {
        if (allowedIds.has(a.id) && (a.textLike || /submit|send|save|create|add|buy|pay|order|checkout|redeem/i.test(a.name))) {
          allowedIds.delete(a.id);
          const reason = 'read-only mode: no safe DB — writes and form submits skipped';
          skipReasonById.set(a.id, reason);
          skipped.push({ action: { id: a.id, label: a.name }, reason });
        }
      }
    }
    if (skipped.length) {
      log.info('safety: skipped actions', { actions: skipped.map((s) => s.action.label).slice(0, 8) });
    }
    // Skip visibility: a Guard refusal must never vanish. Register the skipped
    // action in the state graph as discovered-but-not-tested — it stays in the
    // coverage DENOMINATOR (unreached, with its reason) instead of being
    // silently dropped, and it is reported by label with the opt-in path.
    for (const a of actions) {
      const reason = skipReasonById.get(a.id);
      if (!reason) continue;
      graph.getOrCreateAction({
        stateId,
        locator: a.locator,
        kind: a.role ?? 'unknown',
        label: a.name.slice(0, 80),
        riskClass: classifyAction({ id: a.id, label: a.name }),
        skipReason: reason,
      });
      const key = `${a.name}::${reason}`;
      if (!skippedActionMap.has(key)) skippedActionMap.set(key, { label: a.name, reason });
    }
    return actions.filter((a) => allowedIds.has(a.id));
  }

  /** Execute one agent step (independent — no lockstep). Returns true on progress. */
  async function agentStep(agent: Agent): Promise<boolean> {
    const page = (await ensureContext(agent)) ?? (await respawn(agent));
    if (!page) return false;
    const hub = (page as unknown as { __hub: DetectorHub }).__hub;
    const t0 = Date.now();

    try {
      const state = await currentState(page);
      const graphState = graph.getOrCreateState({ hash: state.hash, url: state.url, signature: '' });
      const actions = await getActions(page, graphState.id);
      const dbActions = graph.actionsWithVisits(graphState.id);
      const ctx = {
        step: agent.steps,
        maxSteps: perAgentSteps,
        actions: actions.map((a) => ({
          runtimeId: a.id,
          graphId: dbActions.find((d) => d.locator === a.locator)?.id ?? -1,
          label: a.name,
          visits: dbActions.find((d) => d.locator === a.locator)?.visits ?? 0,
          textLike: a.textLike,
          risky: a.risky,
        })),
        nastyInputs: nasty,
        seedUrls,
        history: agent.history,
        url: page.url(),
      };
      const choice = agent.persona.decide(ctx);
      agent.history.push(`${describe(choice)} @ ${state.hash}`);
      if (agent.history.length > 16) agent.history.shift();

      if (choice.kind === 'abandon') return false;

      if (choice.kind === 'idle') {
        await page.waitForTimeout(Math.min(choice.ms, 1000));
        return true;
      }
      if (choice.kind === 'back') {
        await page.goBack({ timeout: 8000 }).catch(() => {});
        await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
        return true;
      }
      if (choice.kind === 'reload') {
        await page.reload({ timeout: 10000 }).catch(() => {});
        return true;
      }
      if (choice.kind === 'gotoSeed') {
        await page.goto(choice.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(300);
        return true;
      }

      // action
      if (!rateLimiter.tryAcquire()) {
        await page.waitForTimeout(50);
        return true; // rate limited (G7), try again next iteration
      }
      const action = actions.find((a) => a.id === choice.runtimeId);
      const label = action?.name ?? `action#${choice.runtimeId}`;
      const actionLocator = action?.locator ?? `rt:${choice.runtimeId}`;
      const graphAction = graph.getOrCreateAction({
        stateId: graphState.id,
        locator: actionLocator,
        kind: action?.role ?? 'unknown',
        label: label.slice(0, 80),
        riskClass: action?.risky ? 'destructive' : 'safe',
      });

      let result;
      try {
        result = await withTimeout(
          page.evaluate(
            ({
              id,
              input,
              performOpts,
            }: {
              id: number;
              input?: string;
              performOpts?: { doubleClick?: boolean; interClickDelayMs?: number; waitMs?: number };
            }) => window.__uip.perform(id, { input, ...(performOpts ?? {}) }),
            { id: choice.runtimeId, input: choice.input, performOpts: choice },
          ),
          OP_TIMEOUT_MS,
          'perform',
        );
      } catch {
        // full navigation destroyed the context mid-perform → nav signal
        await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
        result = { dead: false, reasons: ['nav'], nav: true, url: page.url() };
      }

      const after = await currentState(page);
      const toState = graph.getOrCreateState({ hash: after.hash, url: after.url, signature: '' });
      agent.graphStateId = toState.id;
      graph.recordTransition({
        fromState: graphState.id,
        actionId: graphAction.id,
        toState: toState.id,
        ms: 0,
        error: !!result.dead,
      });
      agent.stalledSteps = toState.isNew ? 0 : agent.stalledSteps + 1;

      // repeat-activation suppression (RUN-SCOPED): remember controls that
      // produced real feedback during THIS run — prior runs never suppress,
      // so a regression in this run is always reported (fix-verify loop)
      if (result.reasons.some((r) => ALIVE_REASONS.includes(r))) {
        graph.markAliveThisRun(runId, actionLocator);
      }

      // detectors: errors + dead click + duplicate writes
      const drain = await withTimeout(
        page.evaluate(() => window.__uip.drain()),
        OP_TIMEOUT_MS,
        'drain',
      ).catch(() => ({ requests: [], pageErrors: [] as string[], consoleErrors: [] as string[], spinners: [] }));
      let hadError = false;
      for (const err of drain.pageErrors) {
        hadError = true;
        findings.push({
          type: 'page_error',
          severity: 'high',
          confidence: 'high',
          evidence: { message: err, action: label, persona: agent.persona.id },
          steps: agent.history.slice(-8),
          url: page.url(),
        });
      }
      for (const err of drain.consoleErrors) {
        findings.push({
          type: 'console_error',
          severity: 'low',
          confidence: 'medium',
          evidence: { text: err, action: label, persona: agent.persona.id },
          steps: agent.history.slice(-8),
          url: page.url(),
        });
      }
      if (result.dead && !result.saturated && !result.blocked && drain.pageErrors.length === 0) {
        if (graph.aliveThisRun(runId, actionLocator)) {
          // this control produced feedback earlier in THIS run — a dead
          // verdict now is repeat-activation noise, suppressed as a dead_click…
          suppressedDeadVerdicts.n++;
          // …but never silenced entirely: the FIRST such verdict reports the
          // control as low-confidence inconsistent_feedback (usually an
          // idempotent toggle re-activated; occasionally a real intermittent
          // fault — "works once, then stops")
          if (!inconsistentFeedbackSeen.has(actionLocator)) {
            inconsistentFeedbackSeen.add(actionLocator);
            inconsistentFeedbackActions.push(label);
            findings.push({
              type: 'inconsistent_feedback',
              severity: 'low',
              confidence: 'low',
              evidence: {
                action: label,
                note: 'produced real feedback on some interactions this run but none on this one — idempotent repeat, or an intermittent fault',
              },
              steps: agent.history.slice(-8),
              url: page.url(),
              screenshot: await screenshot(page),
            });
          }
        } else {
          const verdict = hub.deadClick({
            actionLabel: label,
            reasons: [],
            steps: agent.history.slice(-8),
            url: page.url(),
            actionId: choice.runtimeId,
          });
          if (verdict) findings.push({ ...verdict, screenshot: await screenshot(page) });
        }
      }
      const dup = hub.duplicateRequests(page, agent.postIndex, { steps: agent.history.slice(-8) });
      findings.push(...dup.findings.map((f) => ({ ...f, evidence: { ...f.evidence, persona: agent.persona.id } })));
      agent.postIndex = dup.newIndex;

      ramp.record(Date.now() - t0, hadError);
      if (ramp.shouldStop && degradedAtLevel === undefined) {
        degradedAtLevel = activeLevel;
        log.warn('ramp stopped — app degraded', { level: activeLevel, reason: ramp.stopReason });
      } else if (!ramp.shouldStop && activeLevel < agentsWanted && stepsCounter.n - lastStepUpAt >= 20) {
        activeLevel = Math.min(agentsWanted, activeLevel + 5);
        lastStepUpAt = stepsCounter.n;
      }
      return true;
    } catch (e) {
      // crash isolation (TRD §11): a crashed context is logged and replaced
      log.warn('agent step failed — respawning', { agent: agent.index, error: String(e).slice(0, 120) });
      await respawn(agent);
      return true;
    }
  }

  async function agentLoop(agent: Agent): Promise<void> {
    while (agent.steps < perAgentSteps && !isDone()) {
      if (agent.index >= activeLevel) {
        await new Promise((r) => setTimeout(r, 200)); // not ramped up yet
        continue;
      }
      const progressed = await agentStep(agent);
      agent.steps++;
      stepsCounter.n++;
      if (!progressed) break;

      // FR-W3 escalation (revised, phase 6): agents on known states do NOT
      // burn LLM calls — that alone blew the PRD's ≤-20-per-rerun metric at
      // ~40 calls on a saturated graph. Policy handles every stall case:
      //   unvisited actions in this state → keep exploring (reset the counter)
      //   state saturated, graph has a frontier → restart from a seed route
      //   whole graph saturated → abandon
      // LLM escalation is reserved for genuinely unknown situations (dead
      // pages with no enumerable actions), which agentStep already handles
      // via the progressed=false path.
      if (agent.stalledSteps >= 15 && !agent.escalated) {
        agent.escalated = true; // one policy intervention per agent, zero LLM
        const stateActions = graph.actionsWithVisits(agent.graphStateId);
        const hasUnvisitedHere = stateActions.some((a) => a.visits === 0);
        if (hasUnvisitedHere) {
          // the agent is cycling visited transitions while unvisited actions
          // exist in this state — reset the counter, the persona's
          // coverage-guided weighting will find them
          agent.stalledSteps = 0;
          agent.escalated = false; // not a real intervention
        } else if (graph.frontierStates(1).length > 0) {
          // this state is done but the graph has unexplored states — restart
          // from a seed route (pure policy, no LLM)
          const seed = seedUrls[agent.index % seedUrls.length] ?? opts.url;
          await agent.page?.goto(seed, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          agent.stalledSteps = 0;
        } else {
          // the entire graph is saturated — abandon (log and move on, no LLM)
          break;
        }
      }
    }
  }

  const abortedBeforeStart = opts.abort?.aborted;
  const agentPhaseStart = Date.now();
  if (!abortedBeforeStart) {
    await Promise.all(agents.map((a) => agentLoop(a)));
  }
  const agentWallMs = Date.now() - agentPhaseStart;

  // -------------------------------------------- duplicate_effect sweep (TRD §3.6)
  // Runs BEFORE race mode: duplicate_request proves the app has no submit
  // guard; a failing invariant at this point (agents done, race not yet fired)
  // proves the damage landed and belongs to the swarm's double-clicks. Skipped
  // when the DB is not allow-listed (same G4 gate as race mode) and when no
  // duplicate_request was observed (an invariant failure without duplicates is
  // not this type).
  const dbUrl = dbUrlFromEnv();
  const dbHost = dbUrl ? dbHostFromUrl(dbUrl) : null;
  const modesOk =
    dbUrl && dbHost
      ? guard.checkModes({ dbHost, modes: ['race'] })
      : { allowed: false, reasons: ['no DATABASE_URL/SUPABASE_DB_URL resolved'] };
  const duplicateEffects: InvariantResult[] = [];
  const duplicateEffectNames = new Set<string>();
  if (!opts.abort?.aborted && modesOk.allowed) {
    const duplicateRequestCount = findings.filter((f) => f.type === 'duplicate_request').length;
    if (duplicateRequestCount > 0 && effectiveConfig.invariants.length) {
      try {
        const failed = await attributeDuplicateEffects({
          invariants: effectiveConfig.invariants,
          duplicateRequestCount,
          run: pgInvariantRunner(dbUrl!),
        });
        duplicateEffects.push(...failed);
        for (const inv of failed) {
          duplicateEffectNames.add(inv.name);
          findings.push({
            type: 'duplicate_effect',
            severity: 'high',
            confidence: 'high',
            evidence: {
              invariant: inv.name,
              sql: inv.sql,
              expected: inv.atMost ?? inv.expect,
              actual: inv.actual,
              correlatedDuplicateRequests: duplicateRequestCount,
            },
            steps: [],
            url: opts.url,
          });
          log.warn('duplicate_effect confirmed', { invariant: inv.name, expected: inv.expect, actual: inv.actual });
        }
      } catch (e) {
        log.warn('duplicate_effect sweep failed', { error: String(e).slice(0, 200) });
      }
    }
  }

  // ------------------------------------------------------------ race mode (G4-gated)
  let raceFired: number | undefined;
  let raceWallMs = 0;
  let raceSkipReason: string | undefined;
  const racePreExisting: string[] = [];
  if (opts.raceTarget && !opts.abort?.aborted) {
    if (modesOk.allowed && effectiveConfig.invariants.length) {
      try {
        const raceStart = Date.now();
        const race = await runRace(
          browser,
          {
            url: new URL(opts.raceTarget.url, opts.url).href,
            actionLabel: opts.raceTarget.actionLabel,
            input: opts.raceTarget.input,
            contexts: opts.raceTarget.contexts,
            config: effectiveConfig,
            logger: opts.logger,
            setup: opts.raceTarget.setup,
          },
          { runInvariants: pgInvariantRunner(dbUrl!) },
        );
        raceFired = race.fired;
        raceWallMs = Date.now() - raceStart;
        findings.push(...race.violations);
        for (const inv of race.invariants) {
          log.info('invariant', { name: inv.name, actual: inv.actual, expect: inv.expect, pass: inv.pass });
        }
        for (const inv of race.preExistingFailures) {
          racePreExisting.push(inv.name);
          if (duplicateEffectNames.has(inv.name)) continue; // already owned by the sweep
          log.warn('invariant failing before the race volley (not duplicate-correlated — unattributed)', {
            invariant: inv.name,
            actual: inv.actual,
            expect: inv.expect,
          });
        }
      } catch (e) {
        raceSkipReason = `race error: ${String(e).slice(0, 300)}`;
        log.warn('race mode failed', { error: String(e).slice(0, 200) });
      }
    } else {
      raceSkipReason = modesOk.allowed
        ? 'no invariants configured'
        : `G4 refused: ${modesOk.reasons.join(' | ')}`;
      log.warn('race mode skipped', { reason: raceSkipReason });
    }
  }

  // ------------------------------------------------------------ record + finish
  const lateSpinners = await (async () => {
    const firstLive = agents.find((a) => a.page)?.page;
    if (!firstLive) return [];
    try {
      const drain = await firstLive.evaluate(() => window.__uip.drain());
      return drain.spinners;
    } catch {
      return [];
    }
  })();
  void lateSpinners;

  findings.push(
    ...((
      await Promise.all(
        agents
          .filter((a) => a.page)
          .map(async (a) => {
            const hub = (a.page as unknown as { __hub: DetectorHub }).__hub;
            return hub.take();
          }),
      )
    ).flat() as FindingCandidate[]),
  );

  const counts: Record<string, number> = {};
  for (const f of findings) {
    counts[f.type] = (counts[f.type] ?? 0) + 1;
    addFinding(opts.db, {
      runId,
      type: f.type,
      severity: f.severity,
      confidence: f.confidence,
      persona: 'swarm',
      evidence: { ...f.evidence, steps: f.steps.slice(-8), pageUrl: f.url },
      screenshot: f.screenshot ?? null,
      trace: null,
    });
  }

  const stats = graph.stats();
  const aborted = !!opts.abort?.aborted;
  finishRun(opts.db, {
    id: runId,
    durationMs: agentWallMs + raceWallMs,
    llmCalls: opts.llm.calls - llmCallsAtStart,
    coverage: stats.coverage,
    disabledClasses,
    skippedActions: [...skippedActionMap.values()],
    agents: agentsWanted,
    agentsAtCollapse: degradedAtLevel,
  });

  await browser.close().catch(() => {});
  cancelWatchdog();

  log.info('swarm complete', {
    agents: agentsWanted,
    steps: stepsCounter.n,
    agentWallMs,
    raceWallMs,
    findings: findings.length,
    suppressedDeadVerdicts: suppressedDeadVerdicts.n,
    respawns: agents.reduce((s, a) => s + a.respawns, 0),
    aborted,
    ...stats,
  });

  return {
    runId,
    agents: agentsWanted,
    steps: stepsCounter.n,
    stepsPerSec: agentWallMs > 0 ? stepsCounter.n / (agentWallMs / 1000) : 0,
    wallMs: agentWallMs,
    coverage: stats.coverage,
    findingCounts: counts,
    graph: { states: stats.states, actions: stats.actions, transitions: stats.transitions },
    ramp: {
      level: activeLevel,
      maxAgents: agentsWanted,
      stopped: ramp.shouldStop,
      stopReason: ramp.stopReason
        ? `degraded at ${degradedAtLevel ?? activeLevel} agents: ${ramp.stopReason.split(': ').slice(1).join(': ')}`
        : null,
      currentErrorRate: ramp.report().currentErrorRate,
      p95LatencyMs: ramp.report().p95LatencyMs,
      degradedAtLevel,
    },
    llmCalls: opts.llm.calls - llmCallsAtStart,
    raceFired,
    raceWallMs,
    raceSkipReason,
    duplicateEffects,
    racePreExisting,
    suppressedDeadVerdicts: suppressedDeadVerdicts.n,
    inconsistentFeedbackActions,
    escalationCalls: escalationCallCounter.n,
    disabledClasses,
    skippedActions: [...skippedActionMap.values()],
    aborted,
    warnings: decision.warnings,
  };
}

function describe(choice: PersonaDecision): string {
  if (choice.kind === 'action') return `click #${choice.runtimeId}${choice.input ? ` (input)` : ''}${choice.doubleClick ? ' ×2' : ''}`;
  return choice.kind;
}
