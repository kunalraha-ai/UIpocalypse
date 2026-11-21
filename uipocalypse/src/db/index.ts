import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cpus, totalmem } from 'node:os';
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
  // migration: runs.llm_models (project DBs created before model recording)
  const runCols = db.prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>;
  if (!runCols.some((c) => c.name === 'llm_models')) {
    db.exec('ALTER TABLE runs ADD COLUMN llm_models TEXT');
  }
  // migration: runs.disabled_classes (project DBs created before read-only mode)
  if (!runCols.some((c) => c.name === 'disabled_classes')) {
    db.exec('ALTER TABLE runs ADD COLUMN disabled_classes TEXT');
  }
  // migration: runs.skipped_actions (project DBs created before skip visibility)
  if (!runCols.some((c) => c.name === 'skipped_actions')) {
    db.exec('ALTER TABLE runs ADD COLUMN skipped_actions TEXT');
  }
  // migration: machine info + collapse level (volunteer-log comparability)
  if (!runCols.some((c) => c.name === 'cpu')) {
    db.exec('ALTER TABLE runs ADD COLUMN cpu TEXT');
  }
  if (!runCols.some((c) => c.name === 'cores')) {
    db.exec('ALTER TABLE runs ADD COLUMN cores INTEGER');
  }
  if (!runCols.some((c) => c.name === 'ram_bytes')) {
    db.exec('ALTER TABLE runs ADD COLUMN ram_bytes INTEGER');
  }
  if (!runCols.some((c) => c.name === 'agents_at_collapse')) {
    db.exec('ALTER TABLE runs ADD COLUMN agents_at_collapse INTEGER');
  }
  // migration: actions.skip_reason (skipped actions count as UNREACHED, never dropped)
  const actionCols = db.prepare('PRAGMA table_info(actions)').all() as Array<{ name: string }>;
  if (!actionCols.some((c) => c.name === 'skip_reason')) {
    db.exec('ALTER TABLE actions ADD COLUMN skip_reason TEXT');
  }
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
    /** Safety Guard refusal reason — records the action as discovered-but-not-tested */
    skipReason?: string;
  },
): { id: number } {
  const stmt = db.prepare(
    `INSERT INTO actions (state_id, locator, kind, label, risk_class, skip_reason) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(state_id, locator) DO NOTHING`,
  );
  const info = stmt.run(
    input.stateId,
    input.locator,
    input.kind,
    input.label,
    input.riskClass,
    input.skipReason ?? null,
  );
  if (info.changes > 0) return { id: Number(info.lastInsertRowid) };
  const row = db
    .prepare('SELECT id FROM actions WHERE state_id = ? AND locator = ?')
    .get(input.stateId, input.locator) as { id: number };
  // the row already exists (seen in a prior step or run). If it has never
  // been performed and carries no reason yet, backfill the skip reason — a
  // performed action keeps its transitions and is reached regardless.
  if (input.skipReason) {
    db.prepare(
      `UPDATE actions SET skip_reason = ? WHERE id = ? AND skip_reason IS NULL
       AND NOT EXISTS (SELECT 1 FROM transitions WHERE action_id = actions.id)`,
    ).run(input.skipReason, row.id);
  }
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

export function createRun(
  db: Db,
  input: { targetUrl: string; agents: number; llmModels?: string },
): number {
  // machine info at run time — findings must stay interpretable against the
  // hardware they were found on (volunteer log comparability)
  const cpuList = cpus();
  const info = db
    .prepare(
      'INSERT INTO runs (started_at, target_url, agents, llm_models, cpu, cores, ram_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      new Date().toISOString(),
      input.targetUrl,
      input.agents,
      input.llmModels ?? null,
      cpuList[0]?.model ?? null,
      cpuList.length,
      Math.round(totalmem()),
    );
  return Number(info.lastInsertRowid);
}

export function finishRun(
  db: Db,
  input: {
    id: number;
    durationMs: number;
    llmCalls: number;
    coverage: number;
    disabledClasses?: string[];
    skippedActions?: Array<{ label: string; reason: string }>;
    /** the swarm's true agent count — the run row is created in the scout phase with agents=1 */
    agents?: number;
    /** ramp level at which the app degraded/collapsed under load, when recorded */
    agentsAtCollapse?: number;
  },
): void {
  db.prepare(
    `UPDATE runs SET duration_ms = ?, llm_calls = ?, coverage = ?, disabled_classes = ?, skipped_actions = ?,
     agents = COALESCE(?, agents), agents_at_collapse = COALESCE(?, agents_at_collapse) WHERE id = ?`,
  ).run(
    input.durationMs,
    input.llmCalls,
    input.coverage,
    input.disabledClasses?.join(',') ?? null,
    input.skippedActions?.length ? JSON.stringify(input.skippedActions) : null,
    input.agents ?? null,
    input.agentsAtCollapse ?? null,
    input.id,
  );
}

export type RunRow = {
  id: number;
  started_at: string;
  target_url: string;
  agents: number;
  duration_ms: number | null;
  llm_calls: number | null;
  coverage: number | null;
  llm_models: string | null;
  disabled_classes: string | null;
  skipped_actions: string | null;
  cpu: string | null;
  cores: number | null;
  ram_bytes: number | null;
  agents_at_collapse: number | null;
};

const RUN_COLS =
  'id, started_at, target_url, agents, duration_ms, llm_calls, coverage, llm_models, disabled_classes, skipped_actions, cpu, cores, ram_bytes, agents_at_collapse';

export function listRuns(db: Db): RunRow[] {
  return db.prepare(`SELECT ${RUN_COLS} FROM runs ORDER BY id`).all() as RunRow[];
}

export function getRun(db: Db, id: number): RunRow | null {
  return db.prepare(`SELECT ${RUN_COLS} FROM runs WHERE id = ?`).get(id) as RunRow | null;
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

export type FindingRow = {
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
};

export function listFindings(db: Db, runId: number): FindingRow[] {
  return db.prepare('SELECT * FROM findings WHERE run_id = ? ORDER BY id').all(runId) as FindingRow[];
}
