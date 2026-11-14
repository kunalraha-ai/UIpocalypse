import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join, resolve } from 'node:path';
import { initWorkspace } from './workspace.js';
import { createLogger } from './logger.js';
import { openDb, type Db } from './db/index.js';
import { scanCodebase } from './tools/scan-codebase.js';
import { loadConfig } from './config.js';
import { createLlm, createLlmSet } from './llm/index.js';
import { analyze } from './analyzer/analyzer.js';
import { createPlan, loadPlan } from './plan/planner.js';
import { DEFAULT_NASTY_INPUTS, PlanSchema, type Plan } from './plan/schema.js';
import { explore } from './browser/runner.js';
import { swarm } from './browser/orchestrator.js';
import type { Workspace } from './workspace.js';
import type { Logger } from './logger.js';

/**
 * MCP server (stdio, local-first).
 * Tool surface: scan_codebase (real rules), plan_swarm + run_swarm (Phase 3:
 * single-context scout + wanderer; N-agent swarm lands in Phase 4).
 */

export type ServerContext = {
  server: McpServer;
  db: Db;
  logger: Logger;
  workspace: Workspace;
};

function text(content: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(content, null, 2) }] };
}

export function createServer(opts: { workspaceRoot?: string } = {}): ServerContext {
  const workspace = initWorkspace(opts.workspaceRoot);
  const logger = createLogger({ filePath: join(workspace.logs, 'server.jsonl') });
  const db = openDb(workspace.db);

  const server = new McpServer(
    { name: 'uipocalypse', version: '0.0.2' },
    {
      instructions:
        'UIpocalypse: chaotic-user QA for vibecoded apps. scan_codebase for static issues, plan_swarm + run_swarm for live exploration. All runs are local-only and safety-guarded (SAFETY.md).',
    },
  );

  server.registerTool(
    'scan_codebase',
    {
      title: 'Scan codebase',
      description:
        'Statically scan a Next.js/Vite + Supabase codebase for vibecoder bugs and launch-safety holes: dead handlers, unwired forms, missing endpoints, missing RLS, service keys in client code, undefined env vars, unverified Stripe webhooks, missing error/loading states, exposed secrets.',
      inputSchema: { path: z.string().describe('Path to the repo root to scan') },
    },
    async ({ path }) => {
      const result = await scanCodebase({ path }, { logger });
      return text(result);
    },
  );

  server.registerTool(
    'plan_swarm',
    {
      title: 'Plan swarm',
      description:
        'Build a test plan from a codebase scan (LLM call #1, cached by app-map hash): personas, goals, seed routes, nasty inputs. Re-planning an unchanged codebase costs zero LLM calls.',
      inputSchema: {
        path: z.string().describe('Path to the repo root to scan'),
        url: z.string().optional().describe('Target URL the swarm will run against'),
      },
    },
    async ({ path, url }) => {
      const { config } = loadConfig();
      const targetUrl = url ?? config.target;
      const { appMap } = analyze(resolve(path));
      const llm = createLlm();
      const { plan, planId, cached } = await createPlan({
        appMap,
        targetUrl,
        llm,
        workspacePlansDir: workspace.plans,
      });
      logger.info('plan_swarm', { planId, cached, llmCalls: llm.calls });
      return text({
        planId,
        cached,
        llmCalls: llm.calls,
        summary: plan.summary,
        personas: plan.personas,
        goals: plan.goals,
        seedRoutes: plan.seedRoutes,
        nastyInputs: plan.nastyInputs,
        notes: plan.notes,
      });
    },
  );

  server.registerTool(
    'run_swarm',
    {
      title: 'Run swarm',
      description:
        'Release the swarm against a URL (safety-guarded): LLM scouts explore unseen states, then N code-policy agents (Wanderer, Double-Clicker, Garbage Paster, Abandoner) swarm with independent stepping, ramped concurrency and crash isolation. Optional barrier-synchronized race mode runs config invariants (requires an allow-listed DB).',
      inputSchema: {
        url: z.string().describe('Target URL, e.g. http://localhost:3000'),
        planId: z.string().optional().describe('Plan id from plan_swarm'),
        agents: z.number().int().min(1).max(100).optional().describe('Swarm size (default from config, 30)'),
        budgetSeconds: z.number().int().min(1).max(600).optional().describe('Swarm-phase wall-clock budget'),
        optIn: z
          .object({
            destructive: z.boolean().optional(),
            externalSideEffects: z.boolean().optional(),
          })
          .optional(),
        race: z
          .object({
            url: z.string().optional().describe('Defaults to the target URL'),
            actionLabel: z.string().describe('Action to fire concurrently, e.g. "Redeem coupon"'),
            input: z.string().optional().describe('Value for text inputs, e.g. the coupon code'),
            contexts: z.number().int().min(2).max(50).optional().describe('Concurrent firers (default 20)'),
          })
          .optional(),
      },
    },
    async ({ url, planId, agents, budgetSeconds, optIn, race }) => {
      const { config } = loadConfig();
      let plan: Plan;
      let routes: string[] = [];
      if (planId) {
        const stored = loadPlan(workspace.plans, planId);
        if (!stored) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Plan not found: ${planId}. Run plan_swarm first.` }],
          };
        }
        plan = stored.plan;
        routes = stored.appMapRoutes;
      } else {
        plan = PlanSchema.parse({
          summary: 'ad-hoc plan (no planId given)',
          personas: ['wanderer'],
          seedRoutes: [url],
          nastyInputs: DEFAULT_NASTY_INPUTS,
        });
      }

      const llms = createLlmSet();
      llms.planner.maxCalls = config.llm.maxCallsPerRun;
      llms.scout.maxCalls = config.llm.maxCallsPerRun;
      try {
        // phase 1: scouts fill the graph (single context, fast model)
        const exploreResult = await explore({
          url,
          config,
          plan,
          db,
          routes,
          llm: llms.planner,
          scoutLlm: llms.scout,
          logger,
          budgetSeconds: Math.min(budgetSeconds ?? config.budgetSeconds, 120),
        });
        // phase 2: the swarm (independent stepping, ramp, personas) — same run row
        const swarmResult = await swarm({
          url,
          config,
          plan,
          db,
          routes,
          llm: llms.scout,
          logger,
          agents,
          budgetSeconds,
          runId: exploreResult.runId,
          optIn,
          raceTarget: race
            ? {
                url: race.url ?? url,
                actionLabel: race.actionLabel,
                input: race.input,
                contexts: race.contexts,
              }
            : undefined,
        });

        const findingCounts: Record<string, number> = {};
        for (const [k, v] of Object.entries(exploreResult.findingCounts)) findingCounts[k] = v;
        for (const [k, v] of Object.entries(swarmResult.findingCounts)) findingCounts[k] = (findingCounts[k] ?? 0) + v;

        return text({
          runId: swarmResult.runId,
          explore: exploreResult,
          swarm: swarmResult,
          findingCounts,
        });
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: String(e) }] };
      }
    },
  );

  return { server, db, logger, workspace };
}
