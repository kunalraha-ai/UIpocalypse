import type { UiConfig } from '../config.js';

/**
 * Action risk classification (SAFETY.md G5).
 * Signals: label text, HTTP method, config skipActions. Unknown submit-like
 * actions default to `write` and only run in an allowed DB environment.
 * Fail closed: anything we cannot classify as safe is at least a write.
 */

export type RiskClass = 'safe' | 'write' | 'destructive' | 'external';

export type ActionLike = {
  id: string | number;
  label: string;
  /** HTTP method the action would trigger, when known (from the code map or network layer). */
  method?: string;
  kind?: string;
};

// SAFETY.md G5 label signals
const DESTRUCTIVE_RE = /\b(delete|remove|cancel\s+subscription|unsubscribe|deactivate|destroy|purge|reset)\b/i;
const EXTERNAL_RE = /\b(send|invite|pay|purchase|publish|charge|ship|tweet|email)\b/i;

export function classifyAction(action: ActionLike): RiskClass {
  const label = (action.label ?? '').trim();
  const method = (action.method ?? '').toUpperCase();
  if (DESTRUCTIVE_RE.test(label) || method === 'DELETE') return 'destructive';
  if (EXTERNAL_RE.test(label)) return 'external';
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') return 'write';
  return 'safe';
}

export type SkippedAction<T> = { action: T; reason: string };

export type FilterOptions = {
  /**
   * Whether the app's database is allow-listed (SAFETY.md G5: unknown write-like
   * actions run only in an allowed DB environment). Defaults to false (fail closed).
   */
  dbOk?: boolean;
};

export function filterActions<T extends ActionLike>(
  actions: T[],
  config: UiConfig,
  opts: FilterOptions = {},
): { allowed: T[]; skipped: SkippedAction<T>[] } {
  const dbOk = opts.dbOk ?? false;
  const allowed: T[] = [];
  const skipped: SkippedAction<T>[] = [];

  for (const action of actions) {
    const label = (action.label ?? '').trim();
    if (config.skipActions.some((s) => s.trim().toLowerCase() === label.toLowerCase())) {
      skipped.push({ action, reason: `config skipActions: "${label}"` });
      continue;
    }
    const risk = classifyAction(action);
    if (risk === 'destructive' && !config.destructiveOptIn) {
      skipped.push({
        action,
        reason: `destructive action "${label}" — requires opt-in (destructiveOptIn) (SAFETY.md G5)`,
      });
      continue;
    }
    if (risk === 'external' && !config.externalOptIn) {
      skipped.push({
        action,
        reason: `external side effects "${label}" — requires opt-in (externalOptIn) (SAFETY.md G5)`,
      });
      continue;
    }
    if (risk === 'write' && !dbOk) {
      skipped.push({
        action,
        reason: `write action "${label}" — database host not allow-listed (SAFETY.md G5)`,
      });
      continue;
    }
    allowed.push(action);
  }
  return { allowed, skipped };
}
