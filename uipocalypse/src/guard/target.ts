import type { UiConfig } from '../config.js';
import { filterActions, type ActionLike, type FilterOptions, type SkippedAction } from './actions.js';

/**
 * Target admission (SAFETY.md G1–G3, G6) and write-mode gating (G4).
 * Default deny; fail closed; localhost stays zero-config.
 */

export type TargetDecision = {
  allowed: boolean;
  reasons: string[];
  warnings: string[];
  host: string;
  isLocal: boolean;
};

export type SwarmMode = 'swarm' | 'race' | 'fuzz';

export type ModeDecision = { allowed: boolean; reasons: string[] };

export type GuardOptions = {
  /** Environment snapshot to inspect for prod signals (defaults to a sandboxed {} — the caller decides what to pass). */
  env?: Record<string, string | undefined>;
  /** Ownership-token fetcher; defaults to a real HTTP fetch of /.well-known/uipocalypse.txt. */
  fetchToken?: (origin: string) => Promise<string | null>;
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  if (LOCAL_HOSTS.has(h) || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  const parts = h.split('.');
  if (parts.length !== 4) return false; // not an IPv4 literal
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function hostMatches(host: string, patterns: string[]): boolean {
  const h = host.toLowerCase();
  return patterns.some((raw) => {
    const pattern = raw.toLowerCase();
    if (pattern === h) return true;
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1); // ".example.com"
      return h.endsWith(suffix) && h.length > suffix.length;
    }
    if (pattern.includes('*')) {
      const re = new RegExp(
        '^' +
          pattern
            .split('.')
            .map((seg) => (seg === '*' ? '[^.]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
            .join('\\.') +
          '$',
      );
      return re.test(h);
    }
    return false;
  });
}

const PREVIEW_PATTERNS = ['*.vercel.app', '*.netlify.app'];
const STAGING_LIKE = /^(staging|stage|stg|dev|test|qa|demo|preview|beta|uat|preprod)([.-]|$)/;

export function looksLikeProduction(host: string): boolean {
  const h = host.toLowerCase();
  if (isLocalHost(h)) return false;
  if (hostMatches(h, PREVIEW_PATTERNS)) return false;
  const firstLabel = h.split('.')[0]!;
  return !STAGING_LIKE.test(firstLabel);
}

async function defaultFetchToken(origin: string): Promise<string | null> {
  try {
    const res = await fetch(`${origin}/.well-known/uipocalypse.txt`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    return null;
  }
}

export function createGuard(config: UiConfig, opts: GuardOptions = {}) {
  const env = opts.env ?? {};
  const fetchToken = opts.fetchToken ?? defaultFetchToken;

  return {
    /** SAFETY.md G1 (allow-list), G2 (ownership token), G3 (prod-look), G6 (live Stripe). */
    async checkTarget(url: string): Promise<TargetDecision> {
      const reasons: string[] = [];
      const warnings: string[] = [];
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        return { allowed: false, reasons: ['Target is not a valid URL'], warnings, host: '', isLocal: false };
      }
      const host = u.hostname;
      const isLocal = isLocalHost(host);

      // G1 — host allow-list (default deny)
      if (!hostMatches(host, config.allowHosts)) {
        reasons.push(
          `Host "${host}" is not in the allow-list (allowHosts in uipocalypse.config.yaml). Add it there if you own it (SAFETY.md G1).`,
        );
        return { allowed: false, reasons, warnings, host, isLocal };
      }

      // G6 — live Stripe keys are never allowed, overrides don't apply
      const liveKeys = Object.entries(env).filter(([, v]) => v && /(?:sk|pk)_live_/.test(v));
      if (liveKeys.length) {
        reasons.push(
          `Live Stripe keys detected in the target environment (${liveKeys
            .map(([k]) => k)
            .join(', ')}). Live payments are never allowed — use test keys (SAFETY.md G6).`,
        );
        return { allowed: false, reasons, warnings, host, isLocal };
      }

      // G3 — prod-look signals (only meaningful for non-local targets)
      const prodSignals: string[] = [];
      if (!isLocal && looksLikeProduction(host)) {
        prodSignals.push(`"${host}" looks like a production domain (custom host, no staging-like subdomain)`);
      }
      if (!isLocal && env.NODE_ENV === 'production') {
        prodSignals.push('NODE_ENV=production is set for the target');
      }

      // G2 — ownership proof for every non-local target. Two paths:
      //   strict: ownershipToken in config must match /.well-known/uipocalypse.txt
      //           on the target (default; what config/MCP users get)
      //   attested: the operator confirmed ownership at run time (the web UI's
      //           one-click checkbox) — no token fetch, recorded as a warning
      let tokenOk = true;
      if (!isLocal) {
        if (config.ownershipAttested) {
          warnings.push(
            'ownership ATTESTED by the operator at run time (no token check performed) — the operator confirmed they own this target or have permission to test it.',
          );
        } else {
          const expected = config.ownershipToken;
          if (!expected) {
            reasons.push(
              'Non-local targets require an ownership token: set `ownershipToken` in uipocalypse.config.yaml and place the same value at /.well-known/uipocalypse.txt on the target (SAFETY.md G2).',
            );
            tokenOk = false;
          } else {
            const actual = await fetchToken(u.origin);
            if (!actual || actual !== expected.trim()) {
              reasons.push(
                `Ownership token check failed: expected \`ownershipToken\` at ${u.origin}/.well-known/uipocalypse.txt (SAFETY.md G2).`,
              );
              tokenOk = false;
            }
          }
        }
      }

      if (prodSignals.length) {
        if (!config.prodOverride && !config.ownershipAttested) {
          reasons.push(...prodSignals);
          reasons.push(
            'This looks like production. If (and only if) you are sure, set `prodOverride: true` and provide the ownership token (SAFETY.md G3).',
          );
          return { allowed: false, reasons, warnings, host, isLocal };
        }
        if (!tokenOk) {
          return { allowed: false, reasons, warnings, host, isLocal };
        }
        warnings.push(
          config.ownershipAttested
            ? 'OVERRIDE: prod-like target accepted on the operator\'s ownership attestation. Destructive actions still require separate opt-in; watch the run.'
            : 'OVERRIDE: prod-like target accepted because prodOverride is set. Destructive actions still require separate opt-in; watch the run.',
        );
      }

      return { allowed: reasons.length === 0, reasons, warnings, host, isLocal };
    },

    /** SAFETY.md G4 — write-heavy modes require an allow-listed DB host. */
    checkModes(input: { dbHost?: string | null; modes: SwarmMode[] }): ModeDecision {
      const risky = input.modes.filter((m) => m !== 'swarm');
      if (risky.length === 0) return { allowed: true, reasons: [] };
      if (!input.dbHost) {
        return {
          allowed: false,
          reasons: [
            `${risky.join('/')} modes require knowing the app's database host — none was resolved from the repo env (SAFETY.md G4).`,
          ],
        };
      }
      const ok = isLocalHost(input.dbHost) || hostMatches(input.dbHost, config.db.allowedHosts);
      if (!ok) {
        return {
          allowed: false,
          reasons: [
            `Database host "${input.dbHost}" is not in db.allowedHosts — ${risky.join('/')} modes refused (SAFETY.md G4).`,
          ],
        };
      }
      return { allowed: true, reasons: [] };
    },

    /** SAFETY.md G5 — risk-class filtering; destructive/external require opt-in, writes need an allow-listed DB. */
    filterActions<T extends ActionLike>(
      actions: T[],
      opts: FilterOptions = {},
    ): { allowed: T[]; skipped: SkippedAction<T>[] } {
      return filterActions(actions, config, opts);
    },
  };
}

export type Guard = ReturnType<typeof createGuard>;
