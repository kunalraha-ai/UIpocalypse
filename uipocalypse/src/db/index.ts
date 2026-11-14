import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_SQL } from './schema.js';

/**
 * SQLite data-access layer for the state graph, runs and findings (TRD §4).
 * One DB per project, inside .uipocalypse/.
 */

export type Db = Database.Database;

export function openDb(dir: string): Db {
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'db.sqlite'));
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  return db;
}

// ---------------------------------------------------------------- states

export function getOrCreateState(
  db: Db,
  input: { hash: string; route: string; signatureJson: string; firstRun?: number },
): { id: number } {
  const now = input.firstRun ?? Date.now();
  const stmt = db.prepare(
    `INSERT INTO states (hash, route, signature_json, first_run) VALUES (?, ?, ?, ?)
     ON CONFLICT(hash) DO NOTHING`,
  );
  const info = stmt.run(input.hash, input.route, input.signatureJson, now);
  if (info.changes > 0) return { id: Number(info.lastInsertRowid) };
  const row = db.prepare('SELECT id FROM states WHERE hash = ?').get(input.hash) as { id: number };
  return { id: row.id };
}

// ---------------------------------------------------------------- actions

export function getOrCreateAction(
  db: Db,
  input: {
    stateId: number;
    locator: string;
    kind: string;
    label: string;
    riskClass: string;
  },
): { id: number } {
  const stmt = db.prepare(
    `INSERT INTO actions (state_id, locator, kind, label, risk_class) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(state_id, locator) DO NOTHING`,
  );
  const info = stmt.run(input.stateId, input.locator, input.kind, input.label, input.riskClass);
  if (info.changes > 0) return { id: Number(info.lastInsertRowid) };
  const row = db
    .prepare('SELECT id FROM actions WHERE state_id = ? AND locator = ?')
    .get(input.stateId, input.locator) as { id: number };
  return { id: row.id };
}

// ---------------------------------------------------------------- transitions

export function recordTransition(
  db: Db,
  input: { fromState: number; actionId: number; toState: number; ms: number; error: boolean },
): void {
  db.prepare(
    `INSERT INTO transitions (from_state, action_id, to_state, count, avg_ms, error_count)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(from_state, action_id, to_state) DO UPDATE SET
       count = count + 1,
       avg_ms = (avg_ms * count + excluded.avg_ms) / (count + 1),
       error_count = error_count + excluded.error_count`,
  ).run(input.fromState, input.actionId, input.toState, input.ms, input.error ? 1 : 0);
}

export function getTransition(
  db: Db,
  key: { fromState: number; actionId: number; toState: number },
): { count: number; avg_ms: number; error_count: number } | undefined {
  return db
    .prepare(
      'SELECT count, avg_ms, error_count FROM transitions WHERE from_state = ? AND action_id = ? AND to_state = ?',
    )
    .get(key.fromState, key.actionId, key.toState) as
    | { count: number; avg_ms: number; error_count: number }
    | undefined;
}

// ---------------------------------------------------------------- runs

export function createRun(db: Db, input: { targetUrl: string; agents: number }): number {
  const info = db
    .prepare('INSERT INTO runs (started_at, target_url, agents) VALUES (?, ?, ?)')
    .run(new Date().toISOString(), input.targetUrl, input.agents);
  return Number(info.lastInsertRowid);
}

export function finishRun(
  db: Db,
  input: { id: number; durationMs: number; llmCalls: number; coverage: number },
): void {
  db.prepare('UPDATE runs SET duration_ms = ?, llm_calls = ?, coverage = ? WHERE id = ?').run(
    input.durationMs,
    input.llmCalls,
    input.coverage,
    input.id,
  );
}

export function listRuns(db: Db): Array<{
  id: number;
  started_at: string;
  target_url: string;
  agents: number;
  duration_ms: number | null;
  llm_calls: number | null;
  coverage: number | null;
}> {
  return db
    .prepare('SELECT id, started_at, target_url, agents, duration_ms, llm_calls, coverage FROM runs ORDER BY id')
    .all() as Array<{
    id: number;
    started_at: string;
    target_url: string;
    agents: number;
    duration_ms: number | null;
    llm_calls: number | null;
    coverage: number | null;
  }>;
}

// ---------------------------------------------------------------- findings

export function addFinding(
  db: Db,
  input: {
    runId: number;
    type: string;
    severity: string;
    confidence: string;
    persona: string;
    stateId?: number | null;
    actionId?: number | null;
    clusterId?: string | null;
    evidence: unknown;
    screenshot?: string | null;
    trace?: string | null;
  },
): number {
  const info = db
    .prepare(
      `INSERT INTO findings (run_id, type, severity, confidence, persona, state_id, action_id, cluster_id, evidence_json, screenshot, trace)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.runId,
      input.type,
      input.severity,
      input.confidence,
      input.persona,
      input.stateId ?? null,
      input.actionId ?? null,
      input.clusterId ?? null,
      JSON.stringify(input.evidence),
      input.screenshot ?? null,
      input.trace ?? null,
    );
  return Number(info.lastInsertRowid);
}

export function listFindings(
  db: Db,
  runId: number,
): Array<{
  id: number;
  run_id: number;
  type: string;
  severity: string | null;
  confidence: string | null;
  persona: string | null;
  state_id: number | null;
  action_id: number | null;
  cluster_id: string | null;
  evidence_json: string | null;
  screenshot: string | null;
  trace: string | null;
}> {
  return db.prepare('SELECT * FROM findings WHERE run_id = ? ORDER BY id').all(runId) as Array<{
    id: number;
    run_id: number;
    type: string;
    severity: string | null;
    confidence: string | null;
    persona: string | null;
    state_id: number | null;
    action_id: number | null;
    cluster_id: string | null;
    evidence_json: string | null;
    screenshot: string | null;
    trace: string | null;
  }>;
}
