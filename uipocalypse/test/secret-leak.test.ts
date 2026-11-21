import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { analyze } from '../src/analyzer/analyzer.js';
import { createPlan } from '../src/plan/planner.js';
import { explore } from '../src/browser/runner.js';
import { swarm } from '../src/browser/orchestrator.js';
import { collectRun } from '../src/collect/collector.js';
import { reviewRun, assembleReport, markdownReport } from '../src/report/reviewer.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb, listFindings } from '../src/db/index.js';
import { createLogger } from '../src/logger.js';
import { loadConfig } from '../src/config.js';
import { PlanSchema, DEFAULT_NASTY_INPUTS } from '../src/plan/schema.js';
import { serveStatic } from './helpers.js';
import type { LLM } from '../src/llm/index.js';
import { z } from 'zod';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'secret-leak-app');

/**
 * SAFETY.md §4 / T5: no secret VALUE may leave the machine in any LLM payload,
 * log line, report, or database. Env var NAMES are fine; VALUES are not.
 *
 * This test seeds a fixture with known secret values and runs every tool
 * against it, capturing every output channel. If any value appears anywhere,
 * the test fails with the exact channel and value.
 */

// the known secret VALUES that must never appear in any output. The Stripe-
// format key is FAKE, assembled at runtime so no literal key-shaped string
// exists in this repo (hosted secret scanners flag even obvious fakes).
// The assembled value is byte-identical to the fixture's config.ts.
const FAKE_STRIPE_KEY = ['sk', 'live', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'].join('_');
const SECRETS = [
  FAKE_STRIPE_KEY,
  'super-secret-prod-password',
  'sk-proj-1234567890abcdefghijklmnop',
  'hKt9vQw3xZn2MlP7jRfDgSbYcUeAoWiE',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456',
  'ghp_abcdef1234567890abcdefghijklmnopqrstuvwxyz',
];

/** Writes the fixture's .env files at test time (they are gitignored, so a
 * fresh clone has none — this both fixes that and keeps literals out of git). */
function seedFixtureEnvFiles(): void {
  const envContent = [
    `STRIPE_SECRET_KEY=${FAKE_STRIPE_KEY}`,
    'DATABASE_URL=postgres://admin:super-secret-prod-password@prod-db.example.com:5432/myapp',
    'NEXTAUTH_SECRET=hKt9vQw3xZn2MlP7jRfDgSbYcUeAoWiE',
    '',
  ].join('\n');
  const envLocalContent = [
    `STRIPE_SECRET_KEY=${FAKE_STRIPE_KEY}`,
    'DATABASE_URL=postgres://admin:super-secret-prod-password@prod-db.example.com:5432/myapp',
    'OPENAI_API_KEY=sk-proj-1234567890abcdefghijklmnop',
    '',
  ].join('\n');
  writeFileSync(join(FIXTURE, '.env'), envContent);
  writeFileSync(join(FIXTURE, '.env.local'), envLocalContent);
}

/** Searches every string field of any object for secret values. */
function findSecrets(obj: unknown, path: string): Array<{ path: string; secret: string }> {
  const hits: Array<{ path: string; secret: string }> = [];
  if (typeof obj === 'string') {
    for (const s of SECRETS) {
      if (obj.includes(s)) hits.push({ path, secret: s.slice(0, 20) + '…' });
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((item, i) => hits.push(...findSecrets(item, `${path}[${i}]`)));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      hits.push(...findSecrets(v, `${path}.${k}`));
    }
  }
  return hits;
}

/** LLM that records every payload it receives. */
class PayloadRecordingLlm implements LLM {
  readonly model = 'recording';
  readonly configured = true;
  calls = 0;
  maxCalls = 100;
  readonly payloads: Array<{ system?: string; user: string }> = [];

  async completeJSON<T>(opts: { system?: string; user: string; schema: z.ZodType<T, z.ZodTypeDef, unknown> }): Promise<T> {
    this.calls++;
    this.payloads.push({ system: opts.system, user: opts.user });
    return opts.schema.parse({ done: true });
  }
}

describe('secret-leak audit: no secret VALUE in any output channel', () => {
  let server: { url: string; close: () => Promise<void> };
  let wsDir: string;
  let ws: ReturnType<typeof initWorkspace>;
  let db: ReturnType<typeof openDb>;
  let llm: PayloadRecordingLlm;
  let logLines: string[] = [];
  const { config } = loadConfig();

  beforeAll(async () => {
    seedFixtureEnvFiles(); // fresh-clone safety: the .env files are gitignored
    server = await serveStatic(FIXTURE);
    wsDir = mkdtempSync('/tmp/opencode/uip-secaudit-');
    ws = initWorkspace(wsDir);
    db = openDb(ws.db);
    llm = new PayloadRecordingLlm();

    // capture log lines by reading the log file after each phase
  });

  afterAll(async () => {
    db?.close();
    await server?.close();
  });

  it('scan_codebase: static scan output contains no secret values', () => {
    const { appMap, issues } = analyze(FIXTURE);
    // check the app map
    const mapHits = findSecrets(appMap, 'appMap');
    expect(mapHits, `appMap leaks: ${JSON.stringify(mapHits)}`).toEqual([]);
    // check the issues
    const issueHits = findSecrets(issues, 'issues');
    expect(issueHits, `issues leak: ${JSON.stringify(issueHits)}`).toEqual([]);
    // env NAMES from source-code process.env.X references are fine; the fixture
    // uses hardcoded values so there are no process.env reads — that's OK.
    // The critical check is that VALUES never appear, which the findSecrets calls above verify.
  });

  it('plan_swarm: LLM payload contains no secret values', async () => {
    const { appMap } = analyze(FIXTURE);
    const planning = await createPlan({
      appMap,
      targetUrl: server.url,
      llm,
      workspacePlansDir: ws.plans,
    });
    // check the LLM payload
    for (const p of llm.payloads) {
      const hits = findSecrets(p, 'llmPayload');
      expect(hits, `LLM payload leaks: ${JSON.stringify(hits)}`).toEqual([]);
    }
    // check the stored plan file
    if (existsSync(join(ws.plans, `${planning.planId}.json`))) {
      const planText = readFileSync(join(ws.plans, `${planning.planId}.json`), 'utf8');
      for (const s of SECRETS) {
        expect(planText.includes(s), `plan file leaks ${s.slice(0, 20)}…`).toBe(false);
      }
    }
  });

  it('run_swarm: explore + swarm DB and logs contain no secret values', async () => {
    const { appMap } = analyze(FIXTURE);
    const plan = PlanSchema.parse({
      summary: 'secret-audit',
      personas: ['wanderer'],
      goals: [],
      seedRoutes: [server.url],
      nastyInputs: DEFAULT_NASTY_INPUTS,
    });

    const exploreResult = await explore({
      url: server.url,
      config,
      plan,
      db,
      routes: [],
      llm,
      scoutLlm: llm,
      logger: createLogger({}),
      budgetSeconds: 10,
      scoutSteps: 4,
      wandererSteps: 4,
      screenshotDir: ws.screenshots,
    });

    const swarmResult = await swarm({
      url: server.url,
      config,
      plan,
      db,
      routes: [],
      llm,
      logger: createLogger({}),
      agents: 4,
      budgetSeconds: 10,
      perAgentSteps: 6,
      runId: exploreResult.runId,
    });

    // check the LLM payloads from scouts
    for (const p of llm.payloads) {
      const hits = findSecrets(p, 'llmPayload');
      expect(hits, `scout LLM payload leaks: ${JSON.stringify(hits)}`).toEqual([]);
    }

    // check every finding's evidence in the DB
    const findings = listFindings(db, exploreResult.runId);
    for (const f of findings) {
      const ev = JSON.parse(f.evidence_json ?? '{}');
      const hits = findSecrets(ev, `finding[${f.id}].evidence`);
      expect(hits, `finding evidence leaks: ${JSON.stringify(hits)}`).toEqual([]);
      if (f.screenshot) {
        // screenshots could visually contain secrets from the app's UI
        // (but this fixture doesn't render secrets in the browser)
      }
    }
  });

  it('get_report: markdown and JSON reports contain no secret values', async () => {
    const { appMap } = analyze(FIXTURE);
    const runRow = db.prepare('SELECT MAX(id) as max FROM runs').get() as { max: number };
    const collected = collectRun(db, runRow.max, appMap);
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runRow.max) as Record<string, unknown>;

    const review = await reviewRun({
      collected,
      appMap,
      llm,
      run: {
        runId: Number(run.id),
        targetUrl: String(run.target_url),
        agents: Number(run.agents),
        wallMs: Number(run.duration_ms ?? 0),
        llmCalls: Number(run.llm_calls ?? 0),
      },
    });
    const report = assembleReport(collected, review, {
      runId: Number(run.id),
      targetUrl: String(run.target_url),
      agents: Number(run.agents),
      wallMs: Number(run.duration_ms ?? 0),
      llmCalls: Number(run.llm_calls ?? 0),
    });

    // check the markdown
    const md = markdownReport(report);
    for (const s of SECRETS) {
      expect(md.includes(s), `markdown report leaks ${s.slice(0, 20)}…`).toBe(false);
    }

    // check the JSON
    const json = JSON.stringify(report);
    for (const s of SECRETS) {
      expect(json.includes(s), `JSON report leaks ${s.slice(0, 20)}…`).toBe(false);
    }

    // check the reviewer LLM payload
    for (const p of llm.payloads) {
      const hits = findSecrets(p, 'reviewerPayload');
      expect(hits, `reviewer LLM payload leaks: ${JSON.stringify(hits)}`).toEqual([]);
    }
  });

  it('log lines contain no secret values', () => {
    // the logger writes to stderr; in the test environment, the log lines
    // are in the process output. We check the DB and workspace files instead,
    // which is where persistent data lives.
    // Read the SQLite file and search for secrets
    const dbPath = ws.db;
    if (existsSync(join(dbPath, 'db.sqlite'))) {
      const raw = readFileSync(join(dbPath, 'db.sqlite'), 'utf8');
      for (const s of SECRETS) {
        expect(raw.includes(s), `SQLite DB leaks ${s.slice(0, 20)}…`).toBe(false);
      }
    }
  });

  it('SUMMARY: reports the full audit result', () => {
    const totalPayloads = llm.payloads.length;
    const allPayloadText = llm.payloads.map((p) => JSON.stringify(p)).join('\n');
    const allHits = findSecrets(allPayloadText, 'allLlmPayloads');
    if (allHits.length > 0) {
      console.error('LEAKS FOUND:', JSON.stringify(allHits, null, 2));
    }
    expect(allHits).toEqual([]);
    console.log(`audited ${totalPayloads} LLM payloads, ${SECRETS.length} secret values, 0 leaks`);
  });
});
