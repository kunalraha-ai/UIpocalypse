import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join, resolve } from 'node:path';
import { initWorkspace } from './workspace.js';
import { createLogger } from './logger.js';
import { openDb, listRuns, type Db } from './db/index.js';
import { scanCodebase } from './tools/scan-codebase.js';
import { loadConfig } from './config.js';
import { createLlm, createLlmSet, healthCheck, llmModeLine } from './llm/index.js';
import { analyze } from './analyzer/analyzer.js';
import { createPlan, loadPlan } from './plan/planner.js';
import { DEFAULT_NASTY_INPUTS, PlanSchema, type Plan } from './plan/schema.js';
import { explore } from './browser/runner.js';
import { swarm } from './browser/orchestrator.js';
import { mergeDraftedInvariants } from './browser/race.js';
import { createGuard } from './guard/index.js';
import { generateReport, diffRuns, markdownReport, loadReport, type Report } from './report/reviewer.js';
import type { UiConfig } from './config.js';
import type { Workspace } from './workspace.js';
import type { Logger } from './logger.js';

/**
 * MCP server (stdio, local-first).
 * Tool surface: scan_codebase (static rules), plan_swarm + run_swarm
 * (scouts + swarm), get_report / list_runs / diff_runs (Phase 5 collector +
 * reviewer), and verify_deployment_safety chaining all of it in one call.
 */

export type ServerContext = {
  server: McpServer;
  db: Db;
  logger: Logger;
  workspace: Workspace;
};

/** placeholder when a cached report is served without a re-analysis */
const EMPTY_APP_MAP: import('./analyzer/types.js').AppMap = {
  framework: 'unknown',
  stack: [],
  files: [],
  routes: [],
  elements: [],
  apiCalls: [],
  envVars: [],
  imports: {},
  clientEntryFiles: [],
  supabase: { tables: [], clientFiles: [], migrations: [] },
  fileCount: 0,
  extractedAt: '',
};

function text(content: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(content, null, 2) }] };
}

/** FR-P1 wrapper: preflight the plan's drafted invariants against the DB. */
async function effectiveInvariants(
  config: UiConfig,
  plan: Plan,
  logger: Logger,
): Promise<{ config: UiConfig; drafted: number; used: number; dropped: number }> {
  return mergeDraftedInvariants(config, plan, createGuard(config), logger);
}

export function createServer(opts: { workspaceRoot?: string } = {}): ServerContext {
  const workspace = initWorkspace(opts.workspaceRoot);
  const logger = createLogger({ filePath: join(workspace.logs, 'server.jsonl') });
  const db = openDb(workspace.db);

  // FIRST OUTPUT (stderr — stdout belongs to MCP): LLM mode, provider, key
  // source — before any LLM call can happen, so a run's LLM status is never
  // ambiguous (prompt-test finding: a silently-picked-up key made 16 real
  // calls with no visible trace).
  console.error(llmModeLine(createLlmSet().planner));

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
        // run's first output: LLM mode, provider, key source — before any LLM call
        console.error(llmModeLine(llms.planner));
        // model health FIRST (fail with an actionable message, not mid-run)
        if (llms.planner.configured) await healthCheck(llms.planner, 'LLM_MODEL');
        if (llms.scout.configured) await healthCheck(llms.scout, 'LLM_SCOUT_MODEL');
        // FR-P1: drafted invariants preflight against the DB before the run
        const inv = await effectiveInvariants(config, plan, logger);
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
          screenshotDir: workspace.screenshots,
          traceDir: workspace.traces,
        });
        // phase 2: the swarm (independent stepping, ramp, personas) — same run row
        const swarmResult = await swarm({
          url,
          config: inv.config,
          plan,
          db,
          routes,
          llm: llms.scout,
          logger,
          agents,
          budgetSeconds,
          runId: exploreResult.runId,
          screenshotDir: workspace.screenshots,
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
          planInvariants: { drafted: inv.drafted, used: inv.used, dropped: inv.dropped },
        });
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: String(e) }] };
      }
    },
  );

  server.registerTool(
    'get_report',
    {
      title: 'Get report',
      description:
        'Clustered findings for a run, ranked, with root causes and paste-ready fix prompts (LLM call #2 over clusters only, cached per run). Correct rejections (4xx on existing routes) and cancellation artifacts are classified, not reported as bugs. `path` is only needed the first time (to map clusters to file/line via the app map).',
      inputSchema: {
        runId: z.number().int().describe('Run id from run_swarm'),
        format: z.enum(['markdown', 'json']).optional().describe('Report format (default markdown)'),
        path: z.string().optional().describe('Repo root — required only if the report is not cached yet'),
      },
    },
    async ({ runId, format, path }) => {
      try {
        // cached reports cost nothing — no analysis, no LLM
        if (!loadReport(workspace.runs, runId) && !path) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: `No cached report for run ${runId}. Pass \`path\` (the repo root) so clusters can be mapped to file/line via the app map; after the first call the report is cached.`,
              },
            ],
          };
        }
        const report = await generateReport({
          db,
          runId,
          appMap: path ? analyze(resolve(path)).appMap : EMPTY_APP_MAP,
          llm: createLlm(),
          runsDir: workspace.runs,
        });
        return text(format === 'json' ? report : markdownReport(report));
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: `${e}` }] };
      }
    },
  );

  server.registerTool(
    'list_runs',
    {
      title: 'List runs',
      description: 'All swarm runs recorded in this workspace, with timing, LLM calls, coverage and finding counts.',
      inputSchema: {},
    },
    async () => {
      const runs = listRuns(db).map((r) => ({
        ...r,
        findings: (db.prepare('SELECT COUNT(*) AS n FROM findings WHERE run_id = ?').get(r.id) as { n: number }).n,
      }));
      return text(runs);
    },
  );

  server.registerTool(
    'diff_runs',
    {
      title: 'Diff runs',
      description:
        'Compare the last N runs of the same app: which clustered issues were fixed, which are new, which still fail, and which are INTERMITTENT (present in some runs — detection variance, not a fix). A finding only counts as fixed after 2 consecutive absences; pass 3+ runs for meaningful labels. Keyed on stable cluster fingerprints — the fix-verify loop for agent-driven repair.',
      inputSchema: {
        runs: z.array(z.number().int().min(1)).min(2).describe('Run ids, oldest first (3+ recommended)'),
        path: z.string().describe('Repo root (the same codebase the runs tested, or its pre-fix state)'),
      },
    },
    async ({ runs, path }) => {
      try {
        return text(diffRuns(db, analyze(resolve(path)).appMap, runs));
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: `${e}` }] };
      }
    },
  );

  server.registerTool(
    'verify_deployment_safety',
    {
      title: 'Verify deployment safety (one call)',
      description:
        'The whole pipeline in one call: static scan → plan (LLM #1, cached) → scouts → swarm (personas, ramp, race mode if invariants configured) → clustered report with fix prompts (LLM #2). The one-prompt UX from the PRD.',
      inputSchema: {
        path: z.string().describe('Path to the repo root to scan'),
        url: z.string().describe('Target URL the swarm runs against, e.g. http://localhost:3000'),
        agents: z.number().int().min(1).max(100).optional(),
        budgetSeconds: z.number().int().min(1).max(600).optional(),
      },
    },
    async ({ path, url, agents, budgetSeconds }) => {
      const { config } = loadConfig();
      const llms = createLlmSet();
      llms.planner.maxCalls = config.llm.maxCallsPerRun;
      llms.scout.maxCalls = config.llm.maxCallsPerRun;
      try {
        const t0 = Date.now();
        // run's first output: LLM mode, provider, key source — before any LLM call
        console.error(llmModeLine(llms.planner));
        // model health FIRST (fail with an actionable message, not mid-run)
        if (llms.planner.configured) await healthCheck(llms.planner, 'LLM_MODEL');
        if (llms.scout.configured) await healthCheck(llms.scout, 'LLM_SCOUT_MODEL');
        const { appMap, issues } = await scanCodebase({ path }, { logger });
        const planning = await createPlan({ appMap, targetUrl: url, llm: llms.planner, workspacePlansDir: workspace.plans });
        const inv = await effectiveInvariants(config, planning.plan, logger);
        const exploreResult = await explore({
          url,
          config,
          plan: planning.plan,
          db,
          routes: planning.appMapRoutes,
          llm: llms.planner,
          scoutLlm: llms.scout,
          logger,
          budgetSeconds: Math.min(budgetSeconds ?? config.budgetSeconds, 120),
          screenshotDir: workspace.screenshots,
          traceDir: workspace.traces,
        });
        const swarmResult = await swarm({
          url,
          config: inv.config,
          plan: planning.plan,
          db,
          routes: planning.appMapRoutes,
          llm: llms.scout,
          logger,
          agents,
          budgetSeconds,
          runId: exploreResult.runId,
          screenshotDir: workspace.screenshots,
        });
        const report: Report = await generateReport({
          db,
          runId: swarmResult.runId,
          appMap,
          llm: llms.planner,
          runsDir: workspace.runs,
        });
        return text({
          llmMode: llmModeLine(llms.planner), // visible even when the client hides server stderr
          staticIssues: issues.length,
          runId: swarmResult.runId,
          planCached: planning.cached,
          planInvariants: { drafted: inv.drafted, used: inv.used, dropped: inv.dropped },
          llmCalls: llms.planner.calls + llms.scout.calls,
          wallMs: Date.now() - t0,
          report,
          reportMarkdown: markdownReport(report),
        });
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: `${e}` }] };
      }
    },
  );

  return { server, db, logger, workspace };
}
