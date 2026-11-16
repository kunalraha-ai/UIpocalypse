import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LLM } from '../llm/index.js';
import type { AppMap } from '../analyzer/types.js';
import { redactForLlm } from '../guard/index.js';
import { DEFAULT_NASTY_INPUTS, PlanSchema, FULL_PERSONA_ROSTER, type Plan } from './schema.js';

/**
 * Planner (TRD §3.2, LLM call #1): app-map summary → validated plan.
 * Cached by app-map hash (FR-P2): reruns reuse the plan with zero LLM calls.
 * Only a structured summary crosses to the LLM (ARCHITECTURE.md D5/privacy);
 * the payload is redacted first (SAFETY.md §4).
 */

const PLANNER_SYSTEM = [
  'You are the planner for UIpocalypse, a QA tool that releases a swarm of test users against a local web app.',
  'Given a structured app map, produce a test plan: personas to use, goals worth completing, seed routes to start from, nasty input sets, and — when DB tables are listed — point-in-time damage invariants.',
  'Personas: ALWAYS include the full roster ["wanderer", "double-clicker", "garbage-paster", "abandoner", "race-runner"] unless the user explicitly asked to narrow it — a missing Double-Clicker means double-submit bugs go undetected.',
  'Invariants are `atMost` count queries over the schema: they must be TRUE on a clean database and only break when the app is genuinely broken (e.g. duplicate rows within one second for a single-use/unique-intent table). Never draft an invariant that is already violated before the run.',
  'Be pragmatic: this is for finding real breakage (crashes, dead buttons, broken flows), not UX critique.',
  'Respond with ONLY the JSON object.',
].join(' ');

function appMapSummary(appMap: AppMap, targetUrl: string): Record<string, unknown> {
  return {
    targetUrl,
    framework: appMap.framework,
    stack: appMap.stack,
    routes: appMap.routes.map((r) => ({ path: r.path, kind: r.kind })),
    interactiveElementCount: appMap.elements.length,
    sampleElements: appMap.elements.slice(0, 25).map((e) => ({ tag: e.tag, label: e.label.slice(0, 40) })),
    apiCalls: appMap.apiCalls.slice(0, 25).map((c) => ({ url: c.url, method: c.method })),
    envVarNames: appMap.envVars.map((e) => e.name),
    // for FR-P1 invariant drafting: the schema the app writes to
    supabaseTables: appMap.supabase.tables,
    writeEndpoints: appMap.apiCalls.filter((c) => c.method !== 'GET' && c.method !== 'OTHER').map((c) => c.url),
  };
}

export function planHash(appMap: AppMap, targetUrl: string): string {
  const summary = { ...appMapSummary(appMap, targetUrl), extractedAt: undefined };
  return createHash('sha1').update(JSON.stringify(summary)).digest('hex').slice(0, 16);
}

export function planFile(workspacePlansDir: string, hash: string): string {
  return join(workspacePlansDir, `${hash}.json`);
}

export function degradedPlan(appMap: AppMap, targetUrl: string): Plan {
  const pageRoutes = appMap.routes.filter((r) => r.kind === 'page').map((r) => r.path).slice(0, 6);
  return PlanSchema.parse({
    summary: 'Degraded plan (no LLM configured): default personas and seeds from the app map.',
    personas: [...FULL_PERSONA_ROSTER],
    goals: [],
    seedRoutes: [new URL(targetUrl).pathname || '/', ...pageRoutes],
    nastyInputs: DEFAULT_NASTY_INPUTS,
    notes: 'plan created without LLM (TRD §10 --no-llm mode)',
  });
}

export async function createPlan(opts: {
  appMap: AppMap;
  targetUrl: string;
  llm: LLM;
  workspacePlansDir: string;
}): Promise<{ plan: Plan; planId: string; appMapRoutes: string[]; cached: boolean }> {
  mkdirSync(opts.workspacePlansDir, { recursive: true });
  const hash = planHash(opts.appMap, opts.targetUrl);
  const file = planFile(opts.workspacePlansDir, hash);
  const appMapRoutes = opts.appMap.routes.map((r) => r.path);

  if (existsSync(file)) {
    const stored = JSON.parse(readFileSync(file, 'utf8')) as { plan: unknown; appMapRoutes: string[] };
    const cached = PlanSchema.parse(stored.plan);
    return { plan: cached, planId: hash, appMapRoutes: stored.appMapRoutes ?? [], cached: true };
  }

  let plan: Plan;
  if (!opts.llm.configured) {
    plan = degradedPlan(opts.appMap, opts.targetUrl);
  } else {
    const payload = redactForLlm(
      {
        task: 'Produce the UIpocalypse test plan.',
        appMap: appMapSummary(opts.appMap, opts.targetUrl),
      },
      {},
    );
    const user = JSON.stringify(payload, null, 2);
    try {
      plan = await opts.llm.completeJSON({
        system: PLANNER_SYSTEM,
        user: `${user}\n\nJSON shape: { "summary": string, "personas": string[], "goals": [{ "description": string, "inputs"?: object, "expected"?: string }], "seedRoutes": string[], "nastyInputs": Record<string, string[]>, "invariants"?: [{ "name": string, "sql": string, "atMost": number }], "notes"?: string }`,
        schema: PlanSchema,
        maxTokens: 2000,
        label: 'planner',
      });
    } catch (e) {
      // planner failure → degrade rather than block exploration
      plan = degradedPlan(opts.appMap, opts.targetUrl);
      plan.notes = `planner LLM call failed, using degraded defaults: ${String(e).slice(0, 200)}`;
    }
  }

  writeFileSync(
    file,
    JSON.stringify({ planId: hash, createdAt: new Date().toISOString(), appMapRoutes, plan }, null, 2),
  );
  return { plan, planId: hash, appMapRoutes, cached: false };
}

/** Load a stored plan by id (plan_swarm → run_swarm handoff). */
export function loadPlan(
  workspacePlansDir: string,
  planId: string,
): { plan: Plan; appMapRoutes: string[] } | null {
  const file = planFile(workspacePlansDir, planId);
  if (!existsSync(file) || !/^[0-9a-f]{6,64}$/.test(planId)) return null;
  try {
    const stored = JSON.parse(readFileSync(file, 'utf8')) as { plan: unknown; appMapRoutes: string[] };
    return { plan: PlanSchema.parse(stored.plan), appMapRoutes: stored.appMapRoutes ?? [] };
  } catch {
    return null;
  }
}
