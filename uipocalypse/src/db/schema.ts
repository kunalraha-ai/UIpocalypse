/**
 * State graph + runs + findings schema (TRD §4).
 * Kept as a string constant so the bundled CJS CLI has no runtime file reads.
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS states (
  id INTEGER PRIMARY KEY,
  hash TEXT UNIQUE NOT NULL,
  route TEXT,
  signature_json TEXT,
  first_run INTEGER
);

CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY,
  state_id INTEGER NOT NULL REFERENCES states(id),
  locator TEXT NOT NULL,
  kind TEXT,
  label TEXT,
  risk_class TEXT,            -- safe | write | destructive | external
  skip_reason TEXT,           -- set when the Safety Guard refused this action — counted as UNREACHED, never dropped
  UNIQUE(state_id, locator)
);

-- per-run alive marks (repeat-activation suppression is RUN-SCOPED by design:
-- a control that was alive in an earlier run must never mask a regression in
-- this one — the fix-verify loop depends on it)
CREATE TABLE IF NOT EXISTS alive_actions (
  run_id INTEGER NOT NULL,
  locator TEXT NOT NULL,
  PRIMARY KEY(run_id, locator)
);

CREATE TABLE IF NOT EXISTS transitions (
  from_state INTEGER NOT NULL REFERENCES states(id),
  action_id INTEGER NOT NULL REFERENCES actions(id),
  to_state INTEGER NOT NULL REFERENCES states(id),
  count INTEGER NOT NULL DEFAULT 0,
  avg_ms REAL NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(from_state, action_id, to_state)
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  target_url TEXT NOT NULL,
  agents INTEGER NOT NULL,
  duration_ms INTEGER,
  llm_calls INTEGER,
  coverage REAL,
  llm_models TEXT,
  disabled_classes TEXT,
  skipped_actions TEXT,
  cpu TEXT,
  cores INTEGER,
  ram_bytes INTEGER,
  agents_at_collapse INTEGER
);

CREATE TABLE IF NOT EXISTS monitors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('hourly', 'daily', 'weekly', 'manual')),
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_run_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  type TEXT NOT NULL,
  severity TEXT,
  confidence TEXT,
  persona TEXT,
  state_id INTEGER REFERENCES states(id),
  action_id INTEGER REFERENCES actions(id),
  cluster_id TEXT,
  evidence_json TEXT,
  screenshot TEXT,
  trace TEXT
);

CREATE INDEX IF NOT EXISTS idx_actions_state ON actions(state_id);
CREATE INDEX IF NOT EXISTS idx_findings_run ON findings(run_id);
CREATE INDEX IF NOT EXISTS idx_transitions_from ON transitions(from_state);

-- acknowledged findings (the triage loop): issues the operator marked as
-- known/false, keyed by the cluster fingerprint so future runs of the same
-- site stay silenced. Filtered at report READ time — stored reports are never
-- rewritten, and un-ignore restores the issue instantly.
-- fix verification verdicts (the verified-fix loop): the latest replay
-- result per cluster, attached to reports at read time (cached report files
-- are never rewritten — same contract as acknowledged findings).
CREATE TABLE IF NOT EXISTS fix_verdicts (
  run_id INTEGER NOT NULL,
  cluster_key TEXT NOT NULL,
  verdict TEXT NOT NULL,
  note TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  PRIMARY KEY(run_id, cluster_key)
);

-- safe DB clones (verified write-mode testing): one throwaway Postgres copy
-- per source database. The clone URL stays on the machine that created it —
-- a local tool must not ship credentials anywhere.
CREATE TABLE IF NOT EXISTS db_clones (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  source_name TEXT NOT NULL,
  clone_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ignored_findings (
  id INTEGER PRIMARY KEY,
  cluster_key TEXT UNIQUE NOT NULL,
  title TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
