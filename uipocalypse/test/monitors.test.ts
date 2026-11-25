import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startWebServer } from '../src/web/server.js';
import { findDueMonitors, stampMonitorLaunched } from '../src/web/monitors.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb } from '../src/db/index.js';
import { tmpWorkspace, serveStatic } from './helpers.js';

/**
 * Monitors (scheduled recurring runs) — the scheduler/stamp logic extracted
 * after two live bugs (2026-11-25):
 *   1. the last_run_at stamp used datetime("now") — SQLite double quotes are
 *      identifiers, so the UPDATE threw EVERY tick and a "daily" monitor
 *      re-fired a full swarm every ~60s, forever.
 *   2. the monitor paths mutated the server's shared config.allowHosts at
 *      runtime, which silently flipped later manual runs of the same host
 *      onto the no-attestation path (Safety Guard refusal).
 */

describe('monitors: due logic + stamp (unit)', () => {
  it('stampMonitorLaunched stamps last_run_at with VALID sqlite datetime — a daily monitor then stops being due', () => {
    const dir = mkdtempSync('/tmp/opencode/uip-mon-');
    const ws = initWorkspace(dir);
    const db = openDb(ws.db);
    const info = db
      .prepare('INSERT INTO monitors (name, url, frequency) VALUES (?, ?, ?)')
      .run('t', 'https://example.com', 'daily') as { lastInsertRowid: number };
    const id = Number(info.lastInsertRowid);

    // never run → due
    expect(findDueMonitors(db).map((m) => m.id)).toContain(id);

    // the stamp must not throw (this was the bug: datetime("now"))
    expect(() => stampMonitorLaunched(db, id)).not.toThrow();
    const row = db.prepare('SELECT last_run_at FROM monitors WHERE id = ?').get(id) as { last_run_at: string | null };
    expect(row.last_run_at).not.toBeNull();
    expect(new Date(row.last_run_at!).getTime()).not.toBeNaN();

    // just stamped + daily → not due anymore (the runaway loop, pinned)
    expect(findDueMonitors(db).map((m) => m.id)).not.toContain(id);
    db.close();
  });

  it('manual monitors are never due; hourly ones come due again after an hour', () => {
    const dir = mkdtempSync('/tmp/opencode/uip-mon2-');
    const ws = initWorkspace(dir);
    const db = openDb(ws.db);
    const insert = db.prepare('INSERT INTO monitors (name, url, frequency) VALUES (?, ?, ?)');
    const manualId = Number((insert.run('m', 'https://example.com', 'manual') as { lastInsertRowid: number }).lastInsertRowid);
    const hourlyId = Number((insert.run('h', 'https://example.com', 'hourly') as { lastInsertRowid: number }).lastInsertRowid);

    // a manual monitor due right now would fire forever — never due
    expect(findDueMonitors(db).map((m) => m.id)).not.toContain(manualId);

    // hourly, stamped just now → not due
    stampMonitorLaunched(db, hourlyId);
    expect(findDueMonitors(db).map((m) => m.id)).not.toContain(hourlyId);

    // hourly, stamped 90 minutes ago → due again
    db.prepare("UPDATE monitors SET last_run_at = datetime('now', '-90 minutes') WHERE id = ?").run(hourlyId);
    expect(findDueMonitors(db).map((m) => m.id)).toContain(hourlyId);
    db.close();
  });
});

describe('web API: monitor manual run stamps last_run_at (end-to-end)', () => {
  let web: Awaited<ReturnType<typeof startWebServer>>;
  let app: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    const fixtureRepo = mkdtempSync('/tmp/opencode/uip-mon-repo-');
    writeFileSync(
      join(fixtureRepo, 'index.html'),
      '<!doctype html><html><body><button onclick="alert(1)">Alive</button><button>Dead one</button></body></html>',
    );
    app = await serveStatic(fixtureRepo);
    web = await startWebServer({
      port: 0,
      workspaceRoot: mkdtempSync('/tmp/opencode/uip-mon-ws-'),
      frontendDir: '/nonexistent',
      llmEnv: { LLM_API_KEY: '' },
    });
  });
  afterAll(async () => {
    await web.close();
    await app.close();
  });

  it('POST /api/monitors/:id/run → 202, last_run_at stamped, last_run_id linked when done', async () => {
    const base = `http://127.0.0.1:${web.port}`;
    const created = await fetch(`${base}/api/monitors`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'fixture watch', url: app.url, frequency: 'daily' }),
    });
    expect(created.status).toBe(201);
    const { monitor } = await (created.json() as Promise<{ monitor: { id: number } }>);

    const runRes = await fetch(`${base}/api/monitors/${monitor.id}/run`, { method: 'POST' });
    // regression: this route used to 500 AFTER launching — the broken stamp
    // UPDATE threw, the job still ran, and last_run_at stayed NULL forever
    expect(runRes.status).toBe(202);
    const { jobId } = await (runRes.json() as Promise<{ jobId: number }>);

    // last_run_at stamped immediately — the scheduler must not re-fire
    const list = await (await fetch(`${base}/api/monitors`)).json() as { monitors: Array<{ id: number; last_run_at: string | null }> };
    const row = list.monitors.find((m) => m.id === monitor.id)!;
    expect(row.last_run_at).not.toBeNull();

    // wait for the run to finish and link last_run_id
    let runId: number | undefined;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const job = await (await fetch(`${base}/api/jobs/${jobId}`)).json() as { status: string; runId?: number; error?: string };
      if (job.status === 'done') {
        runId = job.runId;
        break;
      }
      if (job.status === 'error') throw new Error(`monitor run failed: ${job.error}`);
    }
    expect(runId).toBeDefined();

    // the run-id link lands via the onJobDone lifecycle hook — poll briefly
    let done: { id: number; last_run_id: number | null; last_run_at: string | null; open_findings: number } | undefined;
    let after2: { open_findings: number } | undefined;
    for (let i = 0; i < 10; i++) {
      const after = await (await fetch(`${base}/api/monitors`)).json() as { monitors: Array<{ id: number; last_run_id: number | null; last_run_at: string | null; open_findings: number }> };
      done = after.monitors.find((m) => m.id === monitor.id)!;
      if (done.last_run_id === runId) {
        after2 = done;
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    expect(done!.last_run_id).toBe(runId);
    // regression: this route used Postgres's ::int cast in SQLite — the
    // moment last_run_id linked, the whole monitor list 500'd
    expect(typeof after2!.open_findings).toBe('number');
  }, 180_000);
});
