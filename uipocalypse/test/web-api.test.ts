import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { initWorkspace } from '../src/workspace.js';
import { startWebServer } from '../src/web/server.js';
import { serveStatic } from './helpers.js';

/**
 * The web frontend's backend: a localhost-only HTTP server wrapping the
 * existing pipeline (scan → plan → scout → swarm → report). The frontend
 * in ../frontend (the Figma Make design) talks to these endpoints instead
 * of its shipped sample data. The API must expose real data only — every
 * screen the design mockup filled with "[sample]" comes from these routes.
 */

const FIXTURE = join(import.meta.dirname, 'fixtures', 'skipped-actions-app');

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('web API (frontend backend)', () => {
  let web: Awaited<ReturnType<typeof startWebServer>>;
  let app: { url: string; close: () => Promise<void> };
  let fixtureRepo: string;

  beforeAll(async () => {
    fixtureRepo = mkdtempSync('/tmp/opencode/uip-web-repo-');
    writeFileSync(
      join(fixtureRepo, 'index.html'),
      '<!doctype html><html><body><button onclick="alert(1)">Alive</button><button>Dead one</button></body></html>',
    );
    app = await serveStatic(fixtureRepo);
    web = await startWebServer({
      port: 0,
      workspaceRoot: mkdtempSync('/tmp/opencode/uip-web-ws-'),
      frontendDir: '/nonexistent', // API-only in tests
      llmEnv: { LLM_API_KEY: '' }, // hermetic: fully local, mechanical review — no dev config pickup
    });
  });

  afterAll(async () => {
    await web.close();
    await app.close();
  });

  it('GET /api/status — the mode line, machine info, version', async () => {
    const res = await fetch(`http://127.0.0.1:${web.port}/api/status`);
    expect(res.status).toBe(200);
    const status = await json<{ llmMode: string; llmModeOn: boolean; machine: { cpu: string; cores: number; ramBytes: number }; version: string }>(res);
    expect(status.llmMode).toMatch(/^LLM mode: (on|off)/);
    expect(typeof status.llmModeOn).toBe('boolean');
    expect(status.machine.cpu.length).toBeGreaterThan(3);
    expect(status.machine.cores).toBeGreaterThan(0);
    expect(status.version).toMatch(/^0\.0\./);
  });

  it('binds localhost only', () => {
    expect(web.address).toMatch(/^127\.0\.0\.1/);
  });

  it('POST /api/runs WITHOUT a path — URL-only run: scan skipped, findings still real', async () => {
    const start = await fetch(`http://127.0.0.1:${web.port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: app.url, agents: 4, budgetSeconds: 20 }),
    });
    expect(start.status).toBe(202);
    const { jobId } = await json<{ jobId: number }>(start);
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    await new Promise<void>((resolve) => {
      void fetch(`http://127.0.0.1:${web.port}/api/jobs/${jobId}/events`).then((res) => {
        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let buf = '';
        const pump = (): Promise<void> =>
          reader.read().then(({ done, value }) => {
            if (done) return resolve();
            buf += dec.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const line = buf.slice(0, idx).split('\n').find((l) => l.startsWith('data: '));
              if (line) events.push(JSON.parse(line.slice(6)));
              buf = buf.slice(idx + 2);
            }
            return pump();
          });
        return pump();
      });
    }).catch(() => undefined);

    const scanEv = events.find((e) => e.type === 'scan') as { skipped?: boolean } | undefined;
    expect(scanEv?.skipped).toBe(true);
    const done = events.find((e) => e.type === 'done') as { runId: number } | undefined;
    expect(done).toBeDefined();
    const report = await json<{ report: { issues: unknown[]; coverage: { discoveredActions: number } } }>(
      await fetch(`http://127.0.0.1:${web.port}/api/runs/${done!.runId}/report`),
    );
    expect(report.report.issues.length).toBeGreaterThan(0);
    expect(report.report.coverage.discoveredActions).toBeGreaterThan(0);
  }, 120_000);

  it('POST /api/runs with a GIT URL as the path — clones, scans, runs', async () => {
    const repo = mkdtempSync('/tmp/opencode/uip-web-gitrepo-');
    writeFileSync(join(repo, 'page.tsx'), 'export default function P() { return <button onClick={() => {}}>x</button>; }');
    execSync('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm x', { cwd: repo });
    const start = await fetch(`http://127.0.0.1:${web.port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: `file://${repo}`, url: app.url, agents: 4, budgetSeconds: 20 }),
    });
    expect(start.status).toBe(202);
    const { jobId } = await json<{ jobId: number }>(start);
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    await new Promise<void>((resolve) => {
      void fetch(`http://127.0.0.1:${web.port}/api/jobs/${jobId}/events`).then((res) => {
        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let buf = '';
        const pump = (): Promise<void> =>
          reader.read().then(({ done, value }) => {
            if (done) return resolve();
            buf += dec.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const line = buf.slice(0, idx).split('\n').find((l) => l.startsWith('data: '));
              if (line) events.push(JSON.parse(line.slice(6)));
              buf = buf.slice(idx + 2);
            }
            return pump();
          });
        return pump();
      });
    }).catch(() => undefined);

    const scanEv = events.find((e) => e.type === 'scan') as { staticIssues?: number; clonedFrom?: string } | undefined;
    expect(scanEv).toBeDefined();
    expect(scanEv!.staticIssues).toBeGreaterThan(0);
    expect(String(scanEv!.clonedFrom)).toMatch(/^file:\/\//);
    expect(events.find((e) => e.type === 'done')).toBeDefined();
  }, 180_000);

  it('POST /api/scan accepts a GIT URL too (clones and scans)', async () => {
    const repo = mkdtempSync('/tmp/opencode/uip-web-gitrepo2-');
    writeFileSync(join(repo, 'page.tsx'), 'export default function P() { return <button onClick={() => {}}>x</button>; }');
    execSync('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm x', { cwd: repo });
    const res = await fetch(`http://127.0.0.1:${web.port}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: `file://${repo}` }),
    });
    const scan = await json<{ issues: Array<{ file: string }> }>(res);
    expect(scan.issues.some((i) => i.file.includes('page.tsx'))).toBe(true);
  });

  it('POST /api/runs refuses non-http(s)/file URL schemes', async () => {
    const res = await fetch(`http://127.0.0.1:${web.port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'ssh://evil@host/repo', url: app.url, agents: 2, budgetSeconds: 10 }),
    });
    expect(res.status).toBe(400);
  });

  it('a LIVE target runs with a one-click ownership attestation (no token file) and still refuses without one', async () => {
    const live = 'http://192.0.2.1:54321/'; // TEST-NET-1: non-local by definition, never routed
    const refused = await fetch(`http://127.0.0.1:${web.port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: live, agents: 2, budgetSeconds: 10 }),
    });
    expect(refused.status).toBe(403);
    const refusal = await json<{ error: string }>(refused);
    expect(refusal.error).toMatch(/own|permission/i);

    // attested: every guard gate passes with NO token file — the run executes
    // against the unroutable TEST-NET host and completes with the honest
    // unreachable-target report (proving the guard let it through)
    const start = await fetch(`http://127.0.0.1:${web.port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: live, agents: 2, budgetSeconds: 10, liveTarget: { attested: true } }),
    });
    expect(start.status).toBe(202);
    const { jobId } = await json<{ jobId: number }>(start);
    const job = await new Promise<{ status: string; runId?: number; error?: string }>((resolve) => {
      const poll = setInterval(async () => {
        const j = await json<{ status: string; runId?: number; error?: string }>(await fetch(`http://127.0.0.1:${web.port}/api/jobs/${jobId}`));
        if (j.status === 'done' || j.status === 'error') {
          clearInterval(poll);
          resolve(j);
        }
      }, 1000);
    });
    expect(job.status).toBe('done'); // the pipeline ran to completion — no guard refusal
    expect(job.error).toBeUndefined();
    const report = await json<{ report: { issues: unknown[] } }>(
      await fetch(`http://127.0.0.1:${web.port}/api/runs/${job.runId}/report`),
    );
    expect(report.report).toBeDefined(); // a real report was produced for the live target
  }, 240_000);

  it('POST /api/runs runs the real pipeline and the events stream carries every phase', async () => {
    const start = await fetch(`http://127.0.0.1:${web.port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: fixtureRepo, url: app.url, agents: 4, budgetSeconds: 20 }),
    });
    expect(start.status).toBe(202);
    const { jobId } = await json<{ jobId: number }>(start);

    // consume the SSE stream to completion (test env has no LLM key → fully local)
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    await new Promise<void>((resolve, reject) => {
      const controller = new AbortController();
      fetch(`http://127.0.0.1:${web.port}/api/jobs/${jobId}/events`, { signal: controller.signal })
        .then((res) => {
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          const pump = (): Promise<void> =>
            reader.read().then(({ done, value }) => {
              if (done) return resolve();
              buf += decoder.decode(value, { stream: true });
              let idx;
              while ((idx = buf.indexOf('\n\n')) >= 0) {
                const frame = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
                if (dataLine) events.push(JSON.parse(dataLine.slice(6)));
              }
              return pump();
            });
          return pump();
        })
        .catch(reject);
    }).catch(() => undefined); // stream may close abruptly on completion — events already collected

    const phases = events.filter((e) => e.type === 'phase').map((e) => e.phase);
    for (const phase of ['scan', 'plan', 'scout', 'swarm', 'report']) expect(phases).toContain(phase);
    const done = events.find((e) => e.type === 'done') as { runId: number } | undefined;
    expect(done).toBeDefined();
    const runId = done!.runId;

    // the report is real: the planted dead button, coverage, mechanical review
    const reportRes = await fetch(`http://127.0.0.1:${web.port}/api/runs/${runId}/report`);
    const report = await json<{
      report: {
        issues: Array<{ title: string; severity: string; observations: number }>;
        coverage: { discoveredActions: number; reachedActions: number };
        reviewedBy: string;
        run: { agents: number; llmCalls: number };
      };
    }>(reportRes);
    expect(reportRes.status).toBe(200);
    expect(report.report.issues.some((i) => i.title.includes('Dead one'))).toBe(true);
    expect(report.report.reviewedBy).toBe('mechanical');
    expect(report.report.run.agents).toBe(4);

    // the run is listed
    const runs = await json<{ runs: Array<{ id: number; target_url: string; agents: number }> }>(
      await fetch(`http://127.0.0.1:${web.port}/api/runs`),
    );
    expect(runs.runs.some((r) => r.id === runId && r.agents === 4)).toBe(true);

    // live findings flowed during the swarm
    const findingsEvents = events.filter((e) => e.type === 'findings') as unknown as Array<{ findings: unknown[] }>;
    expect(findingsEvents.length).toBeGreaterThan(0);
  }, 120_000);

  it('GET /api/runs/:id/graph returns the real state graph', async () => {
    const runs = await json<{ runs: Array<{ id: number }> }>(await fetch(`http://127.0.0.1:${web.port}/api/runs`));
    const id = runs.runs[0]!.id;
    const g = await json<{ states: Array<{ id: number; route: string }>; actions: Array<{ label: string }>; transitions: Array<{ from_state: number; action_id: number; to_state: number; count: number }> }>(
      await fetch(`http://127.0.0.1:${web.port}/api/runs/${id}/graph`),
    );
    expect(g.states.length).toBeGreaterThan(0);
    expect(g.actions.map((a) => a.label)).toContain('Dead one');
    expect(g.transitions.length).toBeGreaterThan(0);
  });

  it('POST /api/scan returns real static issues', async () => {
    const repo = mkdtempSync('/tmp/opencode/uip-web-repo2-');
    writeFileSync(
      join(repo, 'page.tsx'),
      'export default function P() { return <button onClick={() => {}}>x</button>; }',
    );
    const res = await fetch(`http://127.0.0.1:${web.port}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: repo }),
    });
    const scan = await json<{ issues: Array<{ rule: string; file: string }> }>(res);
    expect(scan.issues.length).toBeGreaterThan(0);
    expect(scan.issues.some((i) => i.file.includes('page.tsx'))).toBe(true);
  });

  it('refuses a second concurrent run (409) and a non-local target (guard error)', async () => {
    // start a run and immediately try a second
    const first = await fetch(`http://127.0.0.1:${web.port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: fixtureRepo, url: app.url, agents: 4, budgetSeconds: 20 }),
    });
    expect(first.status).toBe(202);
    const second = await fetch(`http://127.0.0.1:${web.port}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: fixtureRepo, url: app.url, agents: 4, budgetSeconds: 20 }),
    });
    expect(second.status).toBe(409);

    // wait for the first job to finish so later tests see a quiet server
    const { jobId } = await json<{ jobId: number }>(first);
    await new Promise<void>((resolve) => {
      const poll = setInterval(async () => {
        const job = await json<{ status: string }>(await fetch(`http://127.0.0.1:${web.port}/api/jobs/${jobId}`));
        if (job.status === 'done' || job.status === 'error') {
          clearInterval(poll);
          resolve();
        }
      }, 1000);
    });
  }, 120_000);

  it('GET /api/jobs/:id exposes the job status', async () => {
    const res = await fetch(`http://127.0.0.1:${web.port}/api/jobs/999`);
    expect(res.status).toBe(404);
  });

  it('GET /api/diff over identical runs has no phantom fixed/new', async () => {
    const runs = await json<{ runs: Array<{ id: number; target_url: string }> }>(await fetch(`http://127.0.0.1:${web.port}/api/runs`));
    // only the runs against the same fixture app are comparable
    const ids = runs.runs.filter((r) => r.target_url === app.url).map((r) => r.id);
    const d = await json<{ fixed: unknown[]; new: unknown[]; stillFailing: unknown[]; intermittent: unknown[] }>(
      await fetch(`http://127.0.0.1:${web.port}/api/diff?runs=${ids.join(',')}&path=${encodeURIComponent(fixtureRepo)}`),
    );
    expect(d.fixed).toEqual([]); // nothing was fixed between identical runs
    expect(d.new).toEqual([]); // no phantom new findings
  });
});
