import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createLlmSet, llmModeLine } from '../llm/index.js';
import { loadConfig } from '../config.js';
import { initWorkspace, type Workspace } from '../workspace.js';
import { openDb, listRuns, getRun, type Db } from '../db/index.js';
import { createLogger, type Logger } from '../logger.js';
import { scanCodebase } from '../tools/scan-codebase.js';
import { createPlan } from '../plan/planner.js';
import { explore } from '../browser/runner.js';
import { swarm } from '../browser/orchestrator.js';
import { mergeDraftedInvariants } from '../browser/race.js';
import { createGuard } from '../guard/index.js';
import { generateReport, diffRuns, loadReport } from '../report/reviewer.js';

/**
 * Web backend for the UIpocalypse frontend (../frontend — the Figma Make
 * design). Localhost-only by design: the tool is a local QA agent, so the
 * web UI is too. Serves the built frontend statically and a JSON API that
 * wraps the existing pipeline (scan → plan → scout → swarm → report).
 *
 * One run job at a time — a local machine drives one browser swarm; a second
 * concurrent request gets 409.
 */

export type WebJobEvent = { at: number; type: string; [key: string]: unknown };
type Job = {
  id: number;
  status: 'running' | 'done' | 'error';
  events: WebJobEvent[];
  runId?: number;
  error?: string;
  startedAt: number;
  waiters: Array<(ev: WebJobEvent) => void>;
  finished?: () => void;
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

export type WebServer = {
  httpServer: Server;
  port: number;
  address: string;
  workspace: Workspace;
  close: () => Promise<void>;
};

export async function startWebServer(opts: {
  port?: number;
  workspaceRoot?: string;
  frontendDir?: string;
  logger?: Logger;
  /** LLM env overrides (see createLlmSet) — tests use { LLM_API_KEY: '' } for hermetic fully-local runs */
  llmEnv?: Record<string, string>;
} = {}): Promise<WebServer> {
  const workspace = initWorkspace(opts.workspaceRoot);
  const logger = opts.logger ?? createLogger({ filePath: join(workspace.logs, 'web.jsonl') });
  const db = openDb(workspace.db);
  const { config } = loadConfig();
  const version = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')).version as string;

  // ---------------------------------------------------------------- jobs
  let nextJobId = 1;
  const jobs = new Map<number, Job>();

  function emit(job: Job, type: string, payload: Record<string, unknown> = {}): void {
    const ev: WebJobEvent = { at: Date.now(), type, ...payload };
    job.events.push(ev);
    for (const w of [...job.waiters]) w(ev);
  }

  async function startRun(input: { path: string; url: string; agents?: number; budgetSeconds?: number; optIn?: { destructive?: boolean; externalSideEffects?: boolean } }): Promise<number> {
    const jobId = nextJobId++;
    const job: Job = { id: jobId, status: 'running', events: [], startedAt: Date.now(), waiters: [] };
    jobs.set(jobId, job);

    const llms = createLlmSet(opts.llmEnv);
    llms.planner.maxCalls = config.llm.maxCallsPerRun;
    llms.scout.maxCalls = config.llm.maxCallsPerRun;
    const t0 = Date.now();

    void (async () => {
      try {
        const path = input.path;
        const url = input.url;
        emit(job, 'phase', { phase: 'scan' });
        const { appMap, issues } = await scanCodebase({ path }, { logger });
        emit(job, 'scan', { staticIssues: issues.length });

        emit(job, 'phase', { phase: 'plan' });
        const planning = await createPlan({ appMap, targetUrl: url, llm: llms.planner, workspacePlansDir: workspace.plans });
        const inv = await mergeDraftedInvariants(config, planning.plan, createGuard(config), logger);
        emit(job, 'plan', { cached: planning.cached, seeds: planning.plan.seedRoutes.length });

        emit(job, 'phase', { phase: 'scout' });
        const exploreResult = await explore({
          url,
          config,
          plan: planning.plan,
          db,
          routes: planning.appMapRoutes,
          llm: llms.planner,
          scoutLlm: llms.scout,
          logger,
          budgetSeconds: Math.min(input.budgetSeconds ?? config.budgetSeconds, 120),
          screenshotDir: workspace.screenshots,
          traceDir: workspace.traces,
        });
        emit(job, 'scout', { llmCalls: exploreResult.llmCalls });

        emit(job, 'phase', { phase: 'swarm' });
        // live findings feed while the swarm runs
        let lastFeed = 0;
        const feed = setInterval(() => {
          if (Date.now() - lastFeed < 1000) return;
          lastFeed = Date.now();
          try {
            const findings = db
              .prepare('SELECT id, type, severity, evidence_json FROM findings WHERE run_id = ? ORDER BY id DESC LIMIT 12')
              .all(exploreResult.runId) as Array<{ id: number; type: string; severity: string; evidence_json: string }>;
            if (findings.length) emit(job, 'findings', { findings: findings.map((f) => ({ ...f, evidence: safeJson(f.evidence_json) })) });
          } catch {
            /* run finished mid-poll — the final report is the source of truth */
          }
        }, 1000);
        try {
          const swarmResult = await swarm({
            url,
            config: inv.config,
            plan: planning.plan,
            db,
            routes: planning.appMapRoutes,
            llm: llms.scout,
            logger,
            runId: exploreResult.runId,
            agents: input.agents,
            budgetSeconds: input.budgetSeconds,
            screenshotDir: workspace.screenshots,
            optIn: input.optIn,
          });
          emit(job, 'swarm', { steps: swarmResult.steps, findings: swarmResult.findingCounts, coverage: swarmResult.coverage });
        } finally {
          clearInterval(feed);
        }

        emit(job, 'phase', { phase: 'report' });
        const report = await generateReport({ db, runId: exploreResult.runId, appMap, llm: llms.planner, runsDir: workspace.runs });
        job.runId = exploreResult.runId;
        emit(job, 'report', { report });
        job.status = 'done';
        emit(job, 'done', { runId: exploreResult.runId, wallMs: Date.now() - t0, llmCalls: llms.planner.calls + llms.scout.calls });
      } catch (e) {
        job.status = 'error';
        job.error = String(e);
        emit(job, 'error', { error: String(e) });
      }
    })();

    return jobId;
  }

  function hasRunningJob(): boolean {
    return [...jobs.values()].some((j) => j.status === 'running');
  }

  // ---------------------------------------------------------------- http
  const httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${opts.port ?? 0}`);
    const send = (code: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', ...headers });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const readBody = (): Promise<Record<string, unknown>> =>
      new Promise((resolve) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
          try {
            resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
          } catch {
            resolve({});
          }
        });
      });

    // ---- API
    if (url.pathname.startsWith('/api/')) {
      void (async () => {
        try {
          if (req.method === 'GET' && url.pathname === '/api/status') {
            const llms = createLlmSet(opts.llmEnv);
            const os = await import('node:os');
            return send(200, {
              version,
              llmMode: llmModeLine(llms.planner),
              llmModeOn: llms.planner.configured,
              machine: { cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, ramBytes: os.totalmem() },
              workspace: workspace.root,
            });
          }

          if (req.method === 'GET' && url.pathname === '/api/runs') {
            return send(200, { runs: listRuns(db) });
          }

          if (req.method === 'POST' && url.pathname === '/api/runs') {
            if (hasRunningJob()) return send(409, { error: 'a run is already in progress — one at a time on a local machine' });
            const body = (await readBody()) as { path?: string; url?: string; agents?: number; budgetSeconds?: number; optIn?: { destructive?: boolean; externalSideEffects?: boolean } };
            if (typeof body.path !== 'string' || typeof body.url !== 'string') {
              return send(400, { error: 'both "path" (repo root to scan) and "url" (target app) are required' });
            }
            const jobId = await startRun({
              path: body.path,
              url: body.url,
              agents: typeof body.agents === 'number' ? body.agents : undefined,
              budgetSeconds: typeof body.budgetSeconds === 'number' ? body.budgetSeconds : undefined,
              optIn: body.optIn,
            });
            return send(202, { jobId });
          }

          const jobMatch = /^\/api\/jobs\/(\d+)$/.exec(url.pathname);
          if (jobMatch) {
            const job = jobs.get(Number(jobMatch[1]));
            if (!job) return send(404, { error: 'no such job' });
            return send(200, { jobId: job.id, status: job.status, runId: job.runId, error: job.error });
          }

          const eventsMatch = /^\/api\/jobs\/(\d+)\/events$/.exec(url.pathname);
          if (eventsMatch && req.method === 'GET') {
            const job = jobs.get(Number(eventsMatch[1]));
            if (!job) return send(404, { error: 'no such job' });
            // SSE: replay the buffer, then stream live; close when the job ends
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
            for (const ev of job.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
            if (job.status !== 'running') {
              res.end();
              return;
            }
            const flush = (ev: WebJobEvent) => {
              res.write(`data: ${JSON.stringify(ev)}\n\n`);
              if (ev.type === 'done' || ev.type === 'error') {
                job.waiters = job.waiters.filter((w) => w !== flush);
                res.end();
              }
            };
            job.waiters.push(flush);
            req.on('close', () => {
              job.waiters = job.waiters.filter((w) => w !== flush);
            });
            return;
          }

          const reportMatch = /^\/api\/runs\/(\d+)\/report$/.exec(url.pathname);
          if (reportMatch && req.method === 'GET') {
            const runId = Number(reportMatch[1]);
            if (!getRun(db, runId)) return send(404, { error: 'no such run' });
            const report = loadReport(workspace.runs, runId);
            if (!report) return send(404, { error: 'report not generated yet' });
            return send(200, { report });
          }

          const graphMatch = /^\/api\/runs\/(\d+)\/graph$/.exec(url.pathname);
          if (graphMatch && req.method === 'GET') {
            const runId = Number(graphMatch[1]);
            if (!getRun(db, runId)) return send(404, { error: 'no such run' });
            const states = db.prepare('SELECT id, route, first_run FROM states ORDER BY id').all();
            const actions = db.prepare('SELECT id, state_id, locator, kind, label, risk_class, skip_reason FROM actions ORDER BY id').all();
            const transitions = db.prepare('SELECT from_state, action_id, to_state, count, error_count, avg_ms FROM transitions ORDER BY from_state, action_id, to_state').all();
            return send(200, { states, actions, transitions });
          }

          if (req.method === 'GET' && url.pathname === '/api/diff') {
            const runsParam = url.searchParams.get('runs');
            const pathParam = url.searchParams.get('path');
            if (!runsParam || !pathParam) return send(400, { error: 'runs (comma-separated ids, oldest first) and path are required' });
            const ids = runsParam.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
            if (ids.length < 2) return send(400, { error: 'diff needs at least 2 run ids' });
            const { appMap } = await scanCodebase({ path: pathParam }, { logger });
            const diff = diffRuns(db, appMap, ids);
            return send(200, diff);
          }

          if (req.method === 'POST' && url.pathname === '/api/scan') {
            const body = (await readBody()) as { path?: string };
            if (typeof body.path !== 'string') return send(400, { error: '"path" is required' });
            const { appMap, issues } = await scanCodebase({ path: body.path }, { logger });
            return send(200, { issues, summary: { routes: appMap.routes.length, elements: appMap.elements.length, envVars: appMap.envVars.length } });
          }

          return send(404, { error: `no such API route: ${req.method} ${url.pathname}` });
        } catch (e) {
          return send(500, { error: String(e) });
        }
      })();
      return;
    }

    // ---- static frontend (SPA fallback to index.html)
    const dist = opts.frontendDir;
    if (!dist || !existsSync(dist)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html><body style="font-family:system-ui;padding:3rem"><h1>UIpocalypse web UI</h1><p>The API is running, but the frontend bundle was not found.</p><p>Build it with <code>cd frontend && npm install && npm run build</code> and start the web server with <code>--frontend frontend/dist</code>.</p></body></html>',
      );
      return;
    }
    let file = join(dist, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    file = normalize(file);
    if (!file.startsWith(dist)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    if (!existsSync(file) || extname(file) === '') file = join(dist, 'index.html'); // SPA hash routes
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });

  await new Promise<void>((resolve) => httpServer.listen(opts.port ?? 4310, '127.0.0.1', resolve));
  const addr = httpServer.address() as { address: string; port: number };

  logger.info('uipocalypse web UI listening', { address: addr.address, port: addr.port });

  return {
    httpServer,
    port: addr.port,
    address: addr.address,
    workspace,
    close: () =>
      new Promise<void>((resolve) => {
        db.close();
        httpServer.close(() => resolve());
      }),
  };
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export type { Db };
