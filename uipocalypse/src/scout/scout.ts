import type { Page } from 'playwright';
import type { LLM } from '../llm/index.js';
import type { StateGraph } from '../graph/graph.js';
import type { Plan, ScoutDecision } from '../plan/schema.js';
import { ScoutDecisionSchema } from '../plan/schema.js';
import { redactForLlm } from '../guard/index.js';

/**
 * Scout (TRD §3.3): LLM-driven exploration from seed states using
 * accessibility text. Writes every observed transition to the state graph.
 * Stops when discovery saturates or the budget is hit (FR-S3).
 *
 * Run-2 savings come from saturation: states whose actions are all visited are
 * skipped WITHOUT an LLM call — that is the Phase 3 gate mechanism.
 */

const SCOUT_SYSTEM = [
  'You are a QA scout exploring a web app in a real browser. Your goal: discover NEW screens and states.',
  'You see the current URL, the list of actionable elements (id, role, name, visited count), and your recent action history.',
  'Pick the action most likely to reach a state you have not seen. Avoid actions marked visited unless they plausibly lead onward.',
  'If the app needs input in a text field, provide a short plausible value via "input".',
  'If nothing looks new, return done: true.',
  'Respond with ONLY the JSON object.',
].join(' ');

export type StepContext = {
  stepNumber: number;
  history: string[];
};

export type ScoutResult = {
  steps: number;
  llmCalls: number;
  stopped: 'saturated' | 'budget' | 'done' | 'no-actions' | 'error';
  error?: string;
};

export async function runScout(opts: {
  page: Page;
  graph: StateGraph;
  llm: LLM;
  plan: Plan;
  seedUrl: string;
  maxSteps: number;
  /** hard wall-clock deadline (epoch ms): stop scouting when reached */
  deadlineMs?: number;
  getActions: () => Promise<
    Array<{ id: number; role: string | null; name: string; risky: boolean; textLike: boolean; locator: string }>
  >;
  perform: (id: number, input?: string) => Promise<{ dead: boolean; reasons: string[]; nav: boolean }>;
  currentState: () => Promise<{ hash: string; url: string }>;
  onStep?: (info: { step: number; action: string; from: number; to: number; new: boolean }) => void;
}): Promise<ScoutResult> {
  const { page, graph, llm } = opts;
  const history: string[] = [];
  let steps = 0;
  const llmCallsAtStart = llm.calls;

  for (; steps < opts.maxSteps; steps++) {
    // hard cap: a slow LLM must not make the run unpredictable — stop scouting
    // at the deadline wherever we are in the loop (checked per step, so at
    // most one in-flight LLM call overshoots)
    if (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) {
      return { steps, llmCalls: llm.calls - llmCallsAtStart, stopped: 'budget' };
    }
    const state = await opts.currentState();
    const graphState = graph.getOrCreateState({ hash: state.hash, url: state.url, signature: '' });
    const actions = await opts.getActions();
    const safe = actions.filter((a) => !a.risky);
    if (!safe.length) return { steps, llmCalls: llm.calls - llmCallsAtStart, stopped: 'no-actions' };

    const dbActions = graph.actionsWithVisits(graphState.id);
    const visitsFor = (locator: string) => dbActions.find((a) => a.locator === locator)?.visits ?? 0;
    const anyUnvisited = safe.some((a) => visitsFor(a.locator) === 0);

    // saturation: everything here has been visited and nothing is new — stop
    if (!anyUnvisited && steps > 0) {
      return { steps, llmCalls: llm.calls - llmCallsAtStart, stopped: 'saturated' };
    }

    let decision: ScoutDecision | null = null;
    let lastError: string | null = null;
    const offered = safe.map((a) => ({
      id: a.id,
      role: a.role,
      name: a.name.slice(0, 60),
      visited: visitsFor(a.locator),
    }));
    for (let attempt = 0; attempt < 2 && !decision; attempt++) {
      try {
        const payload = redactForLlm({
          url: page.url(),
          step: steps + 1,
          history: history.slice(-6),
          actions: offered,
          hint: opts.plan.goals.length ? opts.plan.goals[0]!.description : 'explore broadly',
        });
        decision = await llm.completeJSON({
          system: SCOUT_SYSTEM,
          user:
            JSON.stringify(payload, null, 2) +
            '\n\nJSON shape: { "actionId": number, "input"?: string, "reason"?: string, "done"?: boolean }',
          schema: ScoutDecisionSchema,
          maxTokens: 1500, // reasoning models spend tokens on reasoning first — leave room
          label: `scout${attempt ? '-retry' : ''}`,
        });
      } catch (e) {
        lastError = String(e).slice(0, 200);
      }
    }
    if (!decision) {
      return { steps, llmCalls: llm.calls - llmCallsAtStart, stopped: 'error', error: lastError ?? 'unknown' };
    }

    if (decision.done) return { steps, llmCalls: llm.calls - llmCallsAtStart, stopped: 'done' };

    const chosen = safe.find((a) => a.id === Number(decision.actionId));
    if (!chosen) {
      history.push(`invalid actionId ${String(decision.actionId)} (offered: ${offered.map((o) => o.id).join(',')})`);
      continue; // fail closed: skip the step rather than guess
    }

    const result = await opts.perform(chosen.id, decision.input);
    const after = await opts.currentState();
    const toState = graph.getOrCreateState({ hash: after.hash, url: after.url, signature: '' });
    const graphAction = graph.getOrCreateAction({
      stateId: graphState.id,
      locator: chosen.locator,
      kind: chosen.role ?? 'unknown',
      label: chosen.name.slice(0, 80),
      riskClass: chosen.risky ? 'destructive' : 'safe',
    });
    graph.recordTransition({
      fromState: graphState.id,
      actionId: graphAction.id,
      toState: toState.id,
      ms: 0,
      error: result.dead,
    });
    history.push(`${chosen.name} -> ${after.hash}${result.nav ? ' (nav)' : ''}`);
    opts.onStep?.({
      step: steps + 1,
      action: chosen.name,
      from: graphState.id,
      to: toState.id,
      new: toState.isNew,
    });

    if (result.nav) {
      await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
    }
  }

  return { steps, llmCalls: llm.calls - llmCallsAtStart, stopped: 'budget' };
}
