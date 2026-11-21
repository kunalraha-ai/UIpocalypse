import type { Db } from '../db/index.js';
import {
  getOrCreateAction,
  getOrCreateState,
  recordTransition,
  type getTransition,
} from '../db/index.js';

/**
 * State graph facade (TRD §4): states/actions/transitions with visit counts,
 * plus the coverage queries the Wanderer and reports need.
 */

export class StateGraph {
  constructor(
    private readonly db: Db,
    private readonly routes: string[] = [],
  ) {}

  getOrCreateState(input: { hash: string; url: string; signature: string }): { id: number; isNew: boolean } {
    const existing = this.db
      .prepare('SELECT id FROM states WHERE hash = ?')
      .get(input.hash) as { id: number } | undefined;
    if (existing) return { id: existing.id, isNew: false };
    const { id } = getOrCreateState(this.db, {
      hash: input.hash,
      route: input.url,
      signatureJson: input.signature.slice(0, 10_000),
    });
    return { id, isNew: true };
  }

  knownStateId(hash: string): number | null {
    const row = this.db.prepare('SELECT id FROM states WHERE hash = ?').get(hash) as
      | { id: number }
      | undefined;
    return row?.id ?? null;
  }

  getOrCreateAction(input: {
    stateId: number;
    locator: string;
    kind: string;
    label: string;
    riskClass: string;
    /** Safety Guard refusal reason — records the action as discovered-but-not-tested */
    skipReason?: string;
  }): { id: number } {
    return getOrCreateAction(this.db, input);
  }

  recordTransition(input: {
    fromState: number;
    actionId: number;
    toState: number;
    ms: number;
    error: boolean;
  }): void {
    recordTransition(this.db, input);
  }

  /** Total recorded transitions out of (state, action) — the visit count for coverage-guided choice. */
  visitsFrom(stateId: number, actionId: number): number {
    const row = this.db
      .prepare(
        'SELECT COALESCE(SUM(count), 0) AS v FROM transitions WHERE from_state = ? AND action_id = ?',
      )
      .get(stateId, actionId) as { v: number };
    return row.v;
  }

  /** Actions discovered at a state, with their out-transition visit counts. */
  actionsWithVisits(stateId: number): Array<{
    id: number;
    locator: string;
    kind: string | null;
    label: string | null;
    riskClass: string | null;
    visits: number;
  }> {
    return this.db
      .prepare(
        `SELECT a.id, a.locator, a.kind, a.label, a.risk_class,
                COALESCE((SELECT SUM(t.count) FROM transitions t WHERE t.from_state = a.state_id AND t.action_id = a.id), 0) AS visits
         FROM actions a WHERE a.state_id = ?`,
      )
      .all(stateId) as Array<{
      id: number;
      locator: string;
      kind: string | null;
      label: string | null;
      riskClass: string | null;
      visits: number;
    }>;
  }

  /**
   * Repeat-activation suppression (held-out finding), RUN-SCOPED by design:
   * mark this action locator as having produced REAL feedback (mutation/
   * request/nav/aria/dialog) during THIS run. Prior runs never suppress —
   * a control that was alive in run N must not mask a regression in run N+1.
   */
  markAliveThisRun(runId: number, locator: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO alive_actions (run_id, locator) VALUES (?, ?)')
      .run(runId, locator);
  }

  /** Did this action locator produce real feedback during THIS run? */
  aliveThisRun(runId: number, locator: string): boolean {
    const row = this.db
      .prepare('SELECT EXISTS(SELECT 1 FROM alive_actions WHERE run_id = ? AND locator = ?) AS e')
      .get(runId, locator) as { e: number };
    return row.e === 1;
  }

  hasUnvisitedActions(stateId: number): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM actions a
         WHERE a.state_id = ?
           AND NOT EXISTS (SELECT 1 FROM transitions t WHERE t.from_state = a.state_id AND t.action_id = a.id)`,
      )
      .get(stateId) as { n: number };
    return row.n > 0;
  }

  /** States that still have never-taken actions — the exploration frontier. */
  frontierStates(limit = 50): number[] {
    return (
      this.db
        .prepare(
          `SELECT a.state_id AS id FROM actions a
           WHERE NOT EXISTS (SELECT 1 FROM transitions t WHERE t.from_state = a.state_id AND t.action_id = a.id)
           GROUP BY a.state_id LIMIT ?`,
        )
        .all(limit) as Array<{ id: number }>
    ).map((r) => r.id);
  }

  stateUrl(stateId: number): string | null {
    const row = this.db.prepare('SELECT route FROM states WHERE id = ?').get(stateId) as
      | { route: string | null }
      | undefined;
    return row?.route ?? null;
  }

  stats(): { states: number; actions: number; transitions: number; coverage: number } {
    const count = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    const states = count('SELECT COUNT(*) AS n FROM states');
    const actions = count('SELECT COUNT(*) AS n FROM actions');
    const transitions = count('SELECT COUNT(*) AS n FROM transitions');
    const performed = count("SELECT COUNT(DISTINCT from_state || '-' || action_id) AS n FROM transitions");
    const coverage = actions === 0 ? 0 : performed / actions;
    return { states, actions, transitions, coverage };
  }
}

export type { getTransition };
