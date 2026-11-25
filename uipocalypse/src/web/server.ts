import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, normalize } from 'node:path';
import { createLlmSet, llmModeLine } from '../llm/index.js';
import { loadConfig } from '../config.js';
import { initWorkspace, type Workspace } from '../workspace.js';
import { findDueMonitors, stampMonitorLaunched, stampMonitorRunId } from './monitors.js';
import { openDb, listRuns, getRun, type Db } from '../db/index.js';
import { createLogger, type Logger } from '../logger.js';
import { scanCodebase } from '../tools/scan-codebase.js';
import { createPlan } from '../plan/planner.js';
import { PlanSchema, DEFAULT_NASTY_INPUTS, FULL_PERSONA_ROSTER, type Plan } from '../plan/schema.js';
import type { AppMap } from '../analyzer/types.js';
import { explore } from '../browser/runner.js';
import { swarm } from '../browser/orchestrator.js';
import { mergeDraftedInvariants } from '../browser/race.js';
import { createGuard, isLocalHost, hostMatches } from '../guard/index.js';
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

const EMPTY_APP_MAP: AppMap = {
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

const URL_RE = /^(https|file):\/\/\S+$/;

/** True for git URLs the tool will clone (https for github & co, file:// for
 *  local remotes and tests). Anything else must be a plain filesystem path. */
function isGitUrl(value: string): boolean {
  return URL_RE.test(value);
}

/**
 * Resolve a scan source: plain paths pass through; git URLs (https://github.com/…,
 * file://…) are shallow-cloned into a per-URL cache under the workspace and the
 * clone dir is returned. Cache is reused across runs — delete the dir to re-clone.
 */
function resolveSource(input: string, workspace: Workspace): Promise<string> {
  if (!isGitUrl(input)) return Promise.resolve(input);
  if (/^http:\/\//.test(input)) {
    return Promise.reject(new Error('insecure http:// git URL refused — use https://'));
  }
  const dir = join(workspace.root, 'repos', createHash('sha1').update(input).digest('hex').slice(0, 16));
  if (existsSync(join(dir, '.git'))) return Promise.resolve(dir);
  mkdirSync(dirname(dir), { recursive: true });
  return new Promise((resolve, reject) => {
    execFile('git', ['clone', '--depth', '1', '--', input, dir], { timeout: 120_000 }, (err, _so, se) => {
      if (err) {
        reject(new Error(`git clone failed: ${String(se || err.message).slice(0, 300)}`));
        return;
      }
      resolve(dir);
    });
  });
}

/** thrown for request-level refusals (bad input, guard refusals) — mapped to
 *  its HTTP status by the request handler instead of a job error */
class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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
  let { config } = loadConfig();
  // works both as ESM source (import.meta.dirname) and in the CJS bundle
  // (import.meta.dirname is undefined there — fall back to the executable path)
  const version = (() => {
    const here = import.meta.dirname ?? dirname(process.argv[1] ?? '');
    for (const p of [join(here, '..', '..', 'package.json'), join(here, '..', 'package.json'), join(here, 'package.json')]) {
      try {
        return JSON.parse(readFileSync(p, 'utf8')).version as string;
      } catch {
        /* keep looking */
      }
    }
    return 'unknown';
  })();

  // ---------------------------------------------------------------- jobs
  let nextJobId = 1;
  const jobs = new Map<number, Job>();

  function emit(job: Job, type: string, payload: Record<string, unknown> = {}): void {
    const ev: WebJobEvent = { at: Date.now(), type, ...payload };
    job.events.push(ev);
    for (const w of [...job.waiters]) w(ev);
  }

  async function startRun(input: { path?: string; url: string; agents?: number; budgetSeconds?: number; optIn?: { destructive?: boolean; externalSideEffects?: boolean; idempotencyReplay?: boolean }; liveTarget?: { attested?: boolean; ownershipToken?: string; prodOverride?: boolean }; onJobDone?: (job: Job) => void }): Promise<number> {
    // live-target handling FIRST — before the job is registered, so a refusal
    // can never leave a zombie "running" job blocking the queue. Non-local
    // targets need an ownership claim: either the operator's one-click
    // attestation (the web UI checkbox — no token file) or the strict token
    // flow (ownershipToken served at /.well-known/uipocalypse.txt, SAFETY.md G2).
    let runConfig = config;
    const host = (() => {
      try {
        return new URL(input.url).hostname;
      } catch {
        return '';
      }
    })();
    const isLiveTarget = host !== '' && !isLocalHost(host) && !hostMatches(host, config.allowHosts);
    if (isLiveTarget) {
      const attested = input.liveTarget?.attested === true;
      const token = input.liveTarget?.ownershipToken?.trim();
      if (!attested && !token) {
        throw new HttpError(
          403,
          `the target ${host} is not localhost — a live website. Confirm you own it (or have permission to test it) in the New Run panel, or pass liveTarget: { "attested": true }. Live runs are read-only unless a safe DB is configured.`,
        );
      }
      runConfig = {
        ...config,
        allowHosts: [...config.allowHosts, host],
        ownershipAttested: attested,
        ownershipToken: token || config.ownershipToken,
        prodOverride: input.liveTarget?.prodOverride === true || config.prodOverride,
      };
    }

    const jobId = nextJobId++;
    const job: Job = { id: jobId, status: 'running', events: [], startedAt: Date.now(), waiters: [] };
    jobs.set(jobId, job);

    const llms = createLlmSet(opts.llmEnv);    llms.planner.maxCalls = config.llm.maxCallsPerRun;
    llms.scout.maxCalls = config.llm.maxCallsPerRun;
    const t0 = Date.now();

    void (async () => {
      try {
        const path = input.path?.trim() || '';
        const url = input.url;
        if (isLiveTarget) emit(job, 'liveTarget', { host, note: 'live target — read-only unless a safe DB is configured' });
        emit(job, 'phase', { phase: 'scan' });
        let appMap: AppMap = EMPTY_APP_MAP;
        if (!path) {
          // URL-only run: no source to scan — say so honestly and use an empty
          // app map (plan defaults to the full persona roster + the target seed)
          emit(job, 'scan', { skipped: true, staticIssues: 0 });
        } else {
          const resolved = await resolveSource(path, workspace);
          const scanned = await scanCodebase({ path: resolved }, { logger });
          appMap = scanned.appMap;
          emit(job, 'scan', { staticIssues: scanned.issues.length, clonedFrom: resolved === path ? undefined : path });
        }

        emit(job, 'phase', { phase: 'plan' });
        let planning: { plan: Plan; cached: boolean; appMapRoutes: string[] };
        if (!path) {
          planning = {
            plan: PlanSchema.parse({
              summary: 'URL-only run (no source scan)',
              personas: [...FULL_PERSONA_ROSTER],
              goals: [],
              seedRoutes: [url],
              nastyInputs: DEFAULT_NASTY_INPUTS,
            }),
            cached: false,
            appMapRoutes: [],
          };
        } else {
          planning = await createPlan({ appMap, targetUrl: url, llm: llms.planner, workspacePlansDir: workspace.plans });
        }
        const inv = await mergeDraftedInvariants(runConfig, planning.plan, createGuard(runConfig), logger);
        emit(job, 'plan', { cached: planning.cached, seeds: planning.plan.seedRoutes.length });

        emit(job, 'phase', { phase: 'scout' });
        const exploreResult = await explore({
          url,
          config: runConfig,
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
      // lifecycle hook — fired from the job's own completion, so callers
      // (e.g. the monitor scheduler) never need to poll for the final state
      input.onJobDone?.(job);
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
            const body = (await readBody()) as { path?: string; url?: string; agents?: number; budgetSeconds?: number; optIn?: { destructive?: boolean; externalSideEffects?: boolean; idempotencyReplay?: boolean }; liveTarget?: { attested?: boolean; ownershipToken?: string; prodOverride?: boolean } };
            if (typeof body.url !== 'string' || !body.url.trim()) {
              return send(400, { error: '"url" (the target app) is required' });
            }
            const path = typeof body.path === 'string' ? body.path.trim() : '';
            if (path && /^([a-z]+):\/\//i.test(path) && !isGitUrl(path)) {
              return send(400, { error: `unsupported URL scheme in "path" — only https:// and file:// git URLs are cloned; everything else must be a local folder` });
            }
            if (path && /^http:\/\//.test(path)) {
              return send(400, { error: 'insecure http:// git URL refused — use https://' });
            }
            const jobId = await startRun({
              path: path || undefined,
              url: body.url,
              agents: typeof body.agents === 'number' ? body.agents : undefined,
              budgetSeconds: typeof body.budgetSeconds === 'number' ? body.budgetSeconds : undefined,
              optIn: body.optIn,
              liveTarget: body.liveTarget,
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

          // ---- monitors (scheduled recurring runs against live sites)
          if (url.pathname === '/api/monitors' && req.method === 'GET') {
            const rows = db
              .prepare('SELECT * FROM monitors ORDER BY id DESC')
              .all() as Array<Record<string, unknown>>;
            const monitors = rows.map((r) => {
              const lastRunId = r.last_run_id as number | null;
              const lastRun = lastRunId ? getRun(db, lastRunId) : null;
              const findings = lastRunId
                ? (db.prepare('SELECT COUNT(DISTINCT cluster_id) AS n FROM findings WHERE run_id = ?').get(lastRunId) as { n: number }).n
                : 0;
              return {
                id: r.id,
                name: r.name,
                url: r.url,
                frequency: r.frequency,
                enabled: Boolean(r.enabled),
                last_run_at: r.last_run_at,
                last_run_id: lastRunId,
                last_run_status: lastRun?.disabled_classes ? 'read-only' : 'completed',
                open_findings: findings,
                created_at: r.created_at,
              };
            });
            return send(200, { monitors });
          }

          if (url.pathname === '/api/monitors' && req.method === 'POST') {
            const body = (await readBody()) as { url?: string; name?: string; frequency?: string };
            if (typeof body.url !== 'string' || !body.url.trim()) return send(400, { error: '"url" is required' });
            const freq = ['hourly', 'daily', 'weekly', 'manual'].includes(body.frequency ?? '') ? body.frequency! : 'daily';
            const name = body.name?.trim() || new URL(body.url).hostname;
            const info = db
              .prepare('INSERT INTO monitors (name, url, frequency) VALUES (?, ?, ?)')
              .run(name, body.url.trim(), freq);
            const row = db.prepare('SELECT * FROM monitors WHERE id = ?').get(Number(info.lastInsertRowid));
            return send(201, { monitor: row });
          }

          const monitorMatch = /^\/api\/monitors\/(\d+)$/.exec(url.pathname);
          if (monitorMatch) {
            const id = Number(monitorMatch[1]);
            const existing = db.prepare('SELECT id FROM monitors WHERE id = ?').get(id);
            if (!existing) return send(404, { error: 'no such monitor' });

            if (req.method === 'DELETE') {
              db.prepare('DELETE FROM monitors WHERE id = ?').run(id);
              return send(200, { deleted: true });
            }
            if (req.method === 'PATCH') {
              const body = (await readBody()) as { enabled?: boolean; frequency?: string };
              if (typeof body.enabled === 'boolean') db.prepare('UPDATE monitors SET enabled = ? WHERE id = ?').run(body.enabled ? 1 : 0, id);
              if (body.frequency && ['hourly', 'daily', 'weekly', 'manual'].includes(body.frequency)) db.prepare('UPDATE monitors SET frequency = ? WHERE id = ?').run(body.frequency, id);
              const row = db.prepare('SELECT * FROM monitors WHERE id = ?').get(id);
              return send(200, { monitor: row });
            }
            return send(405, { error: 'method not allowed' });
          }

          // trigger a manual run for a monitor
          const monitorRunMatch = /^\/api\/monitors\/(\d+)\/run$/.exec(url.pathname);
          if (monitorRunMatch && req.method === 'POST') {
            const id = Number(monitorRunMatch[1]);
            const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(id) as Record<string, unknown> | undefined;
            if (!monitor) return send(404, { error: 'no such monitor' });
            if (hasRunningJob()) return send(409, { error: 'a run is already in progress' });
            const monitorUrl = monitor.url as string;
            const host = (() => { try { return new URL(monitorUrl).hostname; } catch { return ''; } })();
            const isLive = host !== '' && !isLocalHost(host) && !hostMatches(host, config.allowHosts);
            // monitors imply ownership: the user added the URL deliberately.
            // The attestation flows through startRun's per-run config — the
            // shared `config` is never mutated (that broke later manual runs).
            const jobId = await startRun({
              url: monitorUrl,
              agents: 5,
              budgetSeconds: 60,
              liveTarget: isLive ? { attested: true } : undefined,
              onJobDone: (job) => {
                if (job.runId) stampMonitorRunId(db, id, job.runId);
              },
            });
            stampMonitorLaunched(db, id);
            return send(202, { jobId });
          }

          if (req.method === 'POST' && url.pathname === '/api/scan') {
            const body = (await readBody()) as { path?: string };
            if (typeof body.path !== 'string' || !body.path.trim()) return send(400, { error: '"path" is required (a local folder or a git URL)' });
            try {
              const resolved = await resolveSource(body.path.trim(), workspace);
              const { appMap, issues } = await scanCodebase({ path: resolved }, { logger });
              return send(200, { issues, clonedFrom: resolved === body.path!.trim() ? undefined : body.path!.trim(), summary: { routes: appMap.routes.length, elements: appMap.elements.length, envVars: appMap.envVars.length } });
            } catch (e) {
              return send(400, { error: String(e instanceof Error ? e.message : e) });
            }
          }

          return send(404, { error: `no such API route: ${req.method} ${url.pathname}` });
        } catch (e) {
          if (e instanceof HttpError) return send(e.status, { error: e.message });
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

  // ---- monitor scheduler: checks every 60s if any monitor is due
  const schedulerTimer = setInterval(async () => {
    try {
      const due = findDueMonitors(db);
      for (const monitor of due) {
        if (hasRunningJob()) break; // one at a time
        const monitorUrl = monitor.url as string;
        const host = (() => { try { return new URL(monitorUrl).hostname; } catch { return ''; } })();
        const isLive = host !== '' && !isLocalHost(host) && !hostMatches(host, config.allowHosts);
        // attestation flows through startRun's per-run config; the shared
        // config is never mutated (that was the runaway-scheduler bug's twin)
        const jobId = await startRun({
          url: monitorUrl,
          agents: 3,
          budgetSeconds: 45,
          liveTarget: isLive ? { attested: true } : undefined,
          onJobDone: (job) => {
            if (job.runId) stampMonitorRunId(db, monitor.id, job.runId);
          },
        });
        stampMonitorLaunched(db, monitor.id);
        logger.info('monitor scheduled run started', { monitorId: monitor.id, url: monitorUrl, jobId });
      }
    } catch (e) {
      logger.warn('monitor scheduler error', { error: String(e).slice(0, 200) });
    }
  }, 60_000);

  return {
    httpServer,
    port: addr.port,
    address: addr.address,
    workspace,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(schedulerTimer);
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
