import type { Db } from '../db/index.js';

/**
 * Monitor scheduling helpers (extracted 2026-11-25 after a live bug: the
 * last_run_at stamp used datetime("now") — SQLite reads double quotes as an
 * identifier, the UPDATE threw on every tick, and a "daily" monitor re-fired
 * a full swarm every ~60s forever). Both the 60s scheduler tick and the
 * manual-run route go through here so the SQL can never drift again.
 */

export type MonitorRow = {
  id: number;
  name: string;
  url: string;
  frequency: string;
  enabled: number;
  last_run_at: string | null;
  last_run_id: number | null;
  created_at: string;
};

/** Monitors whose next run is due right now (enabled, non-manual, past due). */
export function findDueMonitors(db: Db): MonitorRow[] {
  return db
    .prepare(
      `SELECT * FROM monitors WHERE enabled = 1 AND frequency != 'manual' AND
       (last_run_at IS NULL OR last_run_at <= datetime('now', '-' ||
         CASE frequency WHEN 'hourly' THEN '1 hours'
                         WHEN 'daily'  THEN '1 days'
                         WHEN 'weekly' THEN '7 days' END))`,
    )
    .all() as MonitorRow[];
}

/**
 * Stamp that a run just launched. MUST use single quotes — datetime("now")
 * is an identifier in SQLite and throws, which left last_run_at NULL and
 * made every monitor fire again on each tick (the runaway-loop bug).
 */
export function stampMonitorLaunched(db: Db, id: number): void {
  db.prepare("UPDATE monitors SET last_run_at = datetime('now'), last_run_id = NULL WHERE id = ?").run(id);
}

/** Link the finished run to its monitor (the completion watcher). */
export function stampMonitorRunId(db: Db, id: number, runId: number): void {
  db.prepare('UPDATE monitors SET last_run_id = ? WHERE id = ?').run(runId, id);
}
