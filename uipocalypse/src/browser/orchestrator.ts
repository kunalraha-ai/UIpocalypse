import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import type { BrowserContext, Page } from 'playwright';
import type { Logger } from '../logger.js';
import type { UiConfig } from '../config.js';
import type { LLM } from '../llm/index.js';
import type { Plan } from '../plan/schema.js';
import { ScoutDecisionSchema } from '../plan/schema.js';
import { createGuard } from '../guard/index.js';
import { createRateLimiter, createRampMonitor, type RampReport } from '../guard/ramp.js';
import { RUNTIME_SOURCE } from '../runtime/runtime-source.js';
import { StateGraph } from '../graph/graph.js';
import { hashAriaSnapshot, normalizeRoute } from '../graph/hash.js';
import { DetectorHub, type FindingCandidate } from './detectors.js';
import { ALL_PERSONAS, createPersona, type PersonaDecision } from '../agent/personas.js';
import { runRace, pgInvariantRunner, dbUrlFromEnv, dbHostFromUrl } from './race.js';
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
  raceTarget?: { url: string; actionLabel: string; input?: string; contexts?: number };
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
  const findings: FindingCandidate[] = [];
  const stepsCounter = { n: 0 };
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
    const snap = await page.locator('body').ariaSnapshot();
    const { hash } = hashAriaSnapshot(snap);
    return { hash, url: normalizeRoute(page.url(), opts.routes) };
  }

  async function getActions(page: Page) {
    const raw = await page.evaluate(() => window.__uip.getActions());
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
    if (skipped.length) {
      log.info('safety: skipped actions', { actions: skipped.map((s) => s.action.label).slice(0, 8) });
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
      const actions = await getActions(page);
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
      const graphAction = graph.getOrCreateAction({
        stateId: graphState.id,
        locator: action?.locator ?? `rt:${choice.runtimeId}`,
        kind: action?.role ?? 'unknown',
        label: label.slice(0, 80),
        riskClass: action?.risky ? 'destructive' : 'safe',
      });

      let result;
      try {
        result = await page.evaluate(
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
        );
      } catch {
        // full navigation destroyed the context mid-perform → nav signal
        await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
        result = { dead: false, reasons: ['nav'], nav: true, url: page.url() };
      }

      const after = await currentState(page);
      const toState = graph.getOrCreateState({ hash: after.hash, url: after.url, signature: '' });
      graph.recordTransition({
        fromState: graphState.id,
        actionId: graphAction.id,
        toState: toState.id,
        ms: 0,
        error: !!result.dead,
      });
      agent.stalledSteps = toState.isNew ? 0 : agent.stalledSteps + 1;

      // detectors: errors + dead click + duplicate writes
      const drain = await page.evaluate(() => window.__uip.drain());
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
      if (result.dead && !result.saturated && drain.pageErrors.length === 0) {
        const verdict = hub.deadClick({
          actionLabel: label,
          reasons: [],
          steps: agent.history.slice(-8),
          url: page.url(),
          actionId: choice.runtimeId,
        });
        if (verdict) findings.push(verdict);
      }
      const dup = hub.duplicateWrites(page, agent.postIndex, { steps: agent.history.slice(-8) });
      findings.push(...dup.findings.map((f) => ({ ...f, evidence: { ...f.evidence, persona: agent.persona.id } })));
      agent.postIndex = dup.newIndex;

      ramp.record(Date.now() - t0, hadError);
      if (ramp.shouldStop && degradedAtLevel === undefined) {
        degradedAtLevel = activeLevel;
        log.warn('ramp stopped — app degraded', { level: activeLevel, reason: ramp.stopReason });
      } else if (ramp.canStepUp() && stepsCounter.n - lastStepUpAt >= 20 && activeLevel < agentsWanted) {
        ramp.stepUp();
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
      // FR-W3 escalation: no new states for a while → one LLM call, globally capped
      if (agent.stalledSteps >= 15 && !agent.escalated && opts.llm.configured && opts.llm.calls < opts.llm.maxCalls) {
        agent.escalated = true;
        try {
          const esc = await opts.llm.completeJSON({
            system: 'You are helping a stuck test agent. Reply done: true if the app is fully explored, or pick a seed route.',
            user: JSON.stringify({
              url: agent.page?.url() ?? '',
              history: agent.history.slice(-6),
              seeds: seedUrls,
            }) + '\n\nJSON shape: { "actionId"?: number, "input"?: string, "done"?: boolean }',
            schema: ScoutDecisionSchema,
            maxTokens: 200,
            label: 'escalation',
          });
          if (esc.done) break;
        } catch {
          /* budget or bad reply — fall through to abandon below */
        }
        if (agent.stalledSteps >= 30) break; // abandon (log and move on, no more LLM)
      }
    }
  }

  const abortedBeforeStart = opts.abort?.aborted;
  if (!abortedBeforeStart) {
    await Promise.all(agents.map((a) => agentLoop(a)));
  }

  // ------------------------------------------------------------ race mode (G4-gated)
  let raceFired: number | undefined;
  if (opts.raceTarget && !opts.abort?.aborted) {
    const dbUrl = dbUrlFromEnv();
    const dbHost = dbUrl ? dbHostFromUrl(dbUrl) : null;
    const modeOk = dbUrl && dbHost ? guard.checkModes({ dbHost, modes: ['race'] }) : { allowed: false, reasons: ['no DATABASE_URL/SUPABASE_DB_URL resolved'] };
    if (modeOk.allowed && effectiveConfig.invariants.length) {
      try {
        const race = await runRace(
          browser,
          {
            url: new URL(opts.raceTarget.url, opts.url).href,
            actionLabel: opts.raceTarget.actionLabel,
            input: opts.raceTarget.input,
            contexts: opts.raceTarget.contexts,
            config: effectiveConfig,
            logger: opts.logger,
          },
          { runInvariants: pgInvariantRunner(dbUrl!) },
        );
        raceFired = race.fired;
        findings.push(...race.violations);
        for (const inv of race.invariants) {
          log.info('invariant', { name: inv.name, actual: inv.actual, expect: inv.expect, pass: inv.pass });
        }
      } catch (e) {
        log.warn('race mode failed', { error: String(e).slice(0, 200) });
      }
    } else {
      log.warn('race mode skipped', { reasons: modeOk.allowed ? ['no invariants configured'] : modeOk.reasons });
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
      screenshot: null,
      trace: null,
    });
  }

  const stats = graph.stats();
  const wallMs = Date.now() - started;
  const aborted = !!opts.abort?.aborted;
  finishRun(opts.db, {
    id: runId,
    durationMs: wallMs,
    llmCalls: opts.llm.calls - llmCallsAtStart,
    coverage: stats.coverage,
  });

  await browser.close().catch(() => {});

  log.info('swarm complete', {
    agents: agentsWanted,
    steps: stepsCounter.n,
    wallMs,
    findings: findings.length,
    respawns: agents.reduce((s, a) => s + a.respawns, 0),
    aborted,
    ...stats,
  });

  return {
    runId,
    agents: agentsWanted,
    steps: stepsCounter.n,
    stepsPerSec: wallMs > 0 ? stepsCounter.n / (wallMs / 1000) : 0,
    wallMs,
    coverage: stats.coverage,
    findingCounts: counts,
    graph: { states: stats.states, actions: stats.actions, transitions: stats.transitions },
    ramp: { ...ramp.report(), degradedAtLevel },
    llmCalls: opts.llm.calls - llmCallsAtStart,
    raceFired,
    aborted,
    warnings: decision.warnings,
  };
}

function describe(choice: PersonaDecision): string {
  if (choice.kind === 'action') return `click #${choice.runtimeId}${choice.input ? ` (input)` : ''}${choice.doubleClick ? ' ×2' : ''}`;
  return choice.kind;
}
