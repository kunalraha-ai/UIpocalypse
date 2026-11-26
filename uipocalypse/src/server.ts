import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join, resolve } from 'node:path';
import { initWorkspace } from './workspace.js';
import { createLogger } from './logger.js';
import { openDb, listRuns, getRun, type Db } from './db/index.js';
import { verifyRunFixes } from './browser/replay.js';
import { cloneLocalPostgres, dropClone } from './tools/clone-db.js';
import { exportRunTests } from './tools/export-test.js';
import { auditAuthorization } from './browser/authz.js';
import { resolvedAuthProfiles } from './config.js';
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
            idempotencyReplay: z.boolean().optional().describe(
              'Fix 8 opt-in: replay each double-fired write ONCE to verify server-side idempotency. Default off — makes one additional write request per duplicate found.',
            ),
          })
          .optional(),
        race: z
          .object({
            url: z.string().optional().describe('Defaults to the target URL'),
            actionLabel: z.string().describe('Action to fire concurrently, e.g. "Redeem coupon"'),
            input: z.string().optional().describe('Value for text inputs, e.g. the coupon code'),
            contexts: z.number().int().min(2).max(50).optional().describe('Concurrent firers (default 20)'),
            barrier: z
              .boolean()
              .optional()
              .describe(
                'Deterministic reproducer: hold every matching write at the network boundary until all contexts\' requests have arrived, then release them together. Turns "sometimes the coupon double-fires" into something repeatable. Give barrierPattern for exact matching.',
              ),
            barrierPattern: z
              .string()
              .optional()
              .describe('Path substring the barrier holds, e.g. "/api/coupon/redeem". Default: all same-origin writes.'),
          })
          .optional(),
        dbUrl: z
          .string()
          .optional()
          .describe(
            'Safe DB clone URL from prepare_safe_db — the run reads invariants from the throwaway copy and unlocks write-mode testing. The app must be restarted against this URL first.',
          ),
      },
    },
    async ({ url, planId, agents, budgetSeconds, optIn, race, dbUrl }) => {
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
          dbUrl,
          raceTarget: race
            ? {
                url: race.url ?? url,
                actionLabel: race.actionLabel,
                input: race.input,
                contexts: race.contexts,
                barrier: race.barrier ? { pattern: race.barrierPattern } : undefined,
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
    'audit_authorization',
    {
      title: 'Audit cross-user authorization',
      description:
        'The most valuable bug class for vibecoded apps: missing ownership checks. Crawls the app as the first configured login profile (auth.profiles in uipocalypse.config.yaml), then replays every resource URL that profile saw as every other profile plus a guest — read-only GETs — and classifies each answer: EXPOSED (200 with the same body the owner received), possible (200 with different content on an id-scoped resource — inspect), guarded (401/403/404 — the check exists). Findings land on their own run (type authorization_exposure) with a generated report. Needs at least one authenticated profile configured.',
      inputSchema: {
        url: z.string().describe('The app to audit, e.g. http://localhost:3000 — must be running'),
      },
    },
    async ({ url }) => {
      try {
        const { config } = loadConfig();
        const profiles = resolvedAuthProfiles(config);
        if (profiles.length === 0) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text:
                  'No login profiles configured. Add auth.profiles to uipocalypse.config.yaml, e.g.\nauth:\n  profiles:\n    - { name: alice, storageState: .auth/alice.json }\n    - { name: bob, storageState: .auth/bob.json }\nStorage-state files are Playwright exports (npx playwright codegen --save-storage=state.json logs in and writes one).',
              },
            ],
          };
        }
        const { chromium } = await import('playwright');
        const browser = await chromium.launch();
        try {
          const result = await auditAuthorization({ browser, url, db, profiles, logger });
          const lines = [
            `Authorization audit of ${url} as ${profiles.map((p) => p.name).join(', ')} + guest — ${result.tested} replays, ${result.exposures} flagged.`,
            '',
            ...result.results.map(
              (r) =>
                `${r.classification === 'exposed' ? '‼' : r.classification === 'possible' ? '?' : r.classification === 'guarded' ? '✓' : '·'} ${r.classification.padEnd(9)} as ${r.profile.padEnd(8)} HTTP ${String(r.status).padEnd(4)} ${r.url.slice(0, 80)}\n    ${r.note}`,
            ),
            '',
            `Run #${result.runId} carries the findings; get_report ${result.runId} for the clustered view.`,
          ];
          return text(lines.join('\n'));
        } finally {
          await browser.close().catch(() => {});
        }
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: `${e}` }] };
      }
    },
  );

  server.registerTool(
    'export_tests',
    {
      title: 'Export confirmed fixes as Playwright tests',
      description:
        'Every finding the verified-fix loop confirmed as FIXED becomes a self-contained Playwright test the user owns — the suite compounds with the product, no lock-in. Only fixed clusters export (fix a still-broken bug first); the optional stability gate re-runs each replay N times and REFUSES to emit a test that cannot pass consistently. Files depend on @playwright/test only; BASE_URL defaults to the recorded origin and can be overridden with UIP_BASE_URL.',
      inputSchema: {
        runId: z.number().int().min(1).describe('Run id whose fixed findings to export'),
        outDir: z.string().optional().describe('Directory to write the .spec.ts files into (default: tests/uipocalypse under the cwd)'),
        key: z.string().optional().describe('Cluster key to export (default: all eligible clusters)'),
        stress: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('Stability gate: re-run each finding\'s replay N times against the live app first. A test that cannot pass N/N is refused with its rate. The app must be running.'),
        url: z.string().optional().describe('Where the app lives now (for the stability gate; default: the run\'s target URL)'),
      },
    },
    async ({ runId, outDir, key, stress, url }) => {
      try {
        const run = getRun(db, runId);
        if (!run) return { isError: true, content: [{ type: 'text' as const, text: `Run ${runId} not found.` }] };
        const dir = outDir ?? join(process.cwd(), 'tests', 'uipocalypse');
        const result = await exportRunTests({
          db,
          runId,
          logger,
          outDir: dir,
          keys: key ? [key] : undefined,
          stress,
          baseUrl: url ?? run.target_url,
        });
        const lines = [
          result.files.length > 0
            ? `Exported ${result.files.length} Playwright test${result.files.length === 1 ? '' : 's'} to ${dir}:`
            : 'No tests exported.',
          ...result.files.map((f) => `  ${f.filename}`),
          ...result.skipped.map((s) => `  skipped ${s.key}: ${s.reason}`),
        ];
        if (result.files.length > 0) {
          lines.push('Run them: npx playwright test (needs @playwright/test: npm i -D @playwright/test)');
        }
        return text(lines.join('\n'));
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: `${e}` }] };
      }
    },
  );

  server.registerTool(
    'prepare_safe_db',
    {
      title: 'Prepare a safe DB copy',
      description:
        'Clone the LOCAL Postgres database into a throwaway sibling, so the app can restart against the copy and runs get write-mode testing: duplicate writes, race damage and destructive clicks all land in the clone. One clone per source — re-cloning replaces the previous copy. LOCAL POSTGRES ONLY (the source host must be in db.allowedHosts); needs psql, pg_dump and pg_restore on PATH. After this, tell the user to restart their app with DATABASE_URL set to the returned clone URL, then call run_swarm with dbUrl.',
      inputSchema: {
        sourceUrl: z
          .string()
          .describe('The app\'s local Postgres connection string, e.g. postgres://user:pass@localhost:5432/mydb'),
      },
    },
    async ({ sourceUrl }) => {
      try {
        const { config } = loadConfig();
        const result = await cloneLocalPostgres({ sourceUrl, db, allowHosts: config.db.allowedHosts, logger });
        const lines = [
          `Safe DB copy ready: ${result.clone.name}`,
          `Clone URL (restart the app with DATABASE_URL set to this):`,
          `  ${result.clone.url}`,
          result.droppedPrevious ? `Replaced previous clone: ${result.droppedPrevious}` : '',
          `Then: run_swarm with dbUrl set to the clone URL. Duplicate writes, race mode and invariants all read the copy.`,
        ].filter(Boolean);
        return text(lines.join('\n'));
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: `${e}` }] };
      }
    },
  );

  server.registerTool(
    'drop_safe_db',
    {
      title: 'Drop a safe DB copy',
      description: 'Drop a cloned database created by prepare_safe_db (WITH (FORCE) on Postgres 13+, so an app still connected is disconnected).',
      inputSchema: {
        name: z.string().describe('Clone name from prepare_safe_db'),
        sourceUrl: z.string().optional().describe('The original connection string (for the maintenance connection). Defaults to postgres://localhost:5432/<source>.'),
      },
    },
    async ({ name, sourceUrl }) => {
      try {
        const { config } = loadConfig();
        const row = db.prepare('SELECT source_name FROM db_clones WHERE name = ?').get(name) as { source_name: string } | undefined;
        if (!row) return { isError: true, content: [{ type: 'text' as const, text: `No such clone: ${name}` }] };
        const dropped = await dropClone({
          name,
          sourceUrl: sourceUrl ?? `postgres://localhost:5432/${row.source_name}`,
          db,
          allowHosts: config.db.allowedHosts,
          logger,
        });
        return text(dropped ? `Dropped clone ${name}.` : `Clone ${name} was already gone.`);
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: `${e}` }] };
      }
    },
  );

  server.registerTool(
    'verify_fix',
    {
      title: 'Verify a fix',
      description:
        'Replay recorded findings against the app as it is NOW and report fixed / still broken / stale / intermittent / unverifiable — never a binary guess. THE CLOSED LOOP: apply the fix with your coding agent, then call this instead of re-running the whole swarm. Dead clicks, console/page errors, failed requests, navigation errors and stuck spinners replay directly; duplicate and race findings honestly say they need a swarm re-run. The verdict (with note and timestamp) is stamped into each finding\'s evidence.',
      inputSchema: {
        runId: z.number().int().min(1).describe('Run id whose findings to verify'),
        key: z.string().optional().describe('Cluster key to verify (default: all replayable findings of the run)'),
        url: z.string().optional().describe('Where the app lives now (default: the run\'s target URL)'),
      },
    },
    async ({ runId, key, url }) => {
      try {
        const run = getRun(db, runId);
        if (!run) {
          return { isError: true, content: [{ type: 'text' as const, text: `Run ${runId} not found.` }] };
        }
        const summary = await verifyRunFixes({
          db,
          runId,
          baseUrl: url ?? run.target_url,
          keys: key ? [key] : undefined,
          logger,
        });
        const lines = [
          `verify_fix: run ${runId} against ${url ?? run.target_url} — ${summary.verified} verified`,
          '',
          ...summary.results.map(
            (r) => `${r.verdict === 'fixed' ? '✔' : r.verdict === 'still-broken' ? '✖' : '•'} ${r.verdict.padEnd(13)} ${r.type.padEnd(18)} ${r.key}\n  ${r.note}`,
          ),
        ];
        return text(lines.join('\n'));
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: `${e}` }] };
      }
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
