import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * Config loader (TRD §7). Everything a user can tune lives in
 * uipocalypse.config.yaml; everything else is a safe default.
 * Defaults are chosen so that zero config works for localhost only.
 */

const DEFAULT_DB_HOSTS = ['localhost', '127.0.0.1'];

export const ConfigSchema = z.object({
  target: z.string().default('http://localhost:3000'),
  allowHosts: z
    .array(z.string())
    .default(['localhost', '127.0.0.1', '*.local', '*.vercel.app', '*.netlify.app']),
  agents: z.number().int().min(1).max(100).default(30), // hard cap 100 (SAFETY.md G7)
  budgetSeconds: z.number().int().min(1).default(60),
  /**
   * HARD wall-clock cap on the scouting phase (default 90 s). When it trips,
   * scouting stops and the swarm proceeds; the report shows the coverage
   * shortfall. Keeps total run time predictable when the LLM is slow.
   */
  scoutBudgetSeconds: z.number().int().min(1).default(90),
  auth: z
    .object({
      storageState: z.string().optional(),
      loginScript: z.string().optional(),
    })
    .optional(),
  skipActions: z.array(z.string()).default([]),
  destructiveOptIn: z.boolean().default(false),
  externalOptIn: z.boolean().default(false),
  /**
   * Fix 8 opt-in: when a duplicate submit is detected, replay the write ONCE
   * to check whether the endpoint is idempotent (server rejects or absorbs
   * the repeat). Off by default — it makes one additional write request per
   * duplicate found. Destructive-looking URLs additionally require
   * destructiveOptIn. Also available per-run via optIn.idempotencyReplay
   * (web UI / API / MCP), which takes precedence over this flag.
   */
  idempotencyOptIn: z.boolean().default(false),
  /** Loud, explicit override for prod-like targets. Still requires the ownership token. */
  prodOverride: z.boolean().default(false),
  /** Expected value of /.well-known/uipocalypse.txt on non-local targets (SAFETY.md G2). */
  ownershipToken: z.string().optional(),
  /**
   * Operator attests ownership at run time (the web UI's one-click "I own this
   * target" confirmation). Skips the G2 token fetch and satisfies the G3
   * prod-look gate for that run. The strict token path (ownershipToken +
   * /.well-known/uipocalypse.txt) remains for those who want proof, and is
   * what the MCP/config path still uses by default.
   */
  ownershipAttested: z.boolean().default(false),
  db: z
    .object({ allowedHosts: z.array(z.string()).default(DEFAULT_DB_HOSTS) })
    .default({ allowedHosts: DEFAULT_DB_HOSTS }),
  invariants: z
    .array(
      z
        .object({
          name: z.string(),
          sql: z.string(),
          /** exact end-state check — meaningful only after the run (not evaluated mid-run) */
          expect: z.number().optional(),
          /** point-in-time damage predicate — the only kind race mode and the duplicate_effect sweep evaluate */
          atMost: z.number().optional(),
        })
        .refine((v) => v.expect !== undefined || v.atMost !== undefined, {
          message: 'invariant needs expect (end-state) or atMost (point-in-time)',
        }),
    )
    .default([]),
  /** Per-host request ceiling (SAFETY.md G7). */
  maxRps: z.number().int().min(1).default(50),
  /** Record a Playwright trace of the scout phase for replay (off by default). */
  trace: z.boolean().default(false),
  llm: z
    .object({
      baseURL: z.string().optional(),
      model: z.string().optional(),
      /** Global cap on LLM calls per run (TRD §10). */
      maxCallsPerRun: z.number().int().min(1).default(40),
    })
    .default({ maxCallsPerRun: 40 }),
});

export type UiConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(explicitPath?: string): {
  config: UiConfig;
  source: 'file' | 'defaults';
  path?: string;
} {
  const candidates = explicitPath
    ? [explicitPath]
    : ['uipocalypse.config.yaml', 'uipocalypse.config.yml'];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const raw = parseYaml(readFileSync(candidate, 'utf8')) as unknown;
      const config = ConfigSchema.parse(raw ?? {});
      return { config, source: 'file', path: candidate };
    }
  }
  if (explicitPath && !existsSync(explicitPath)) {
    // an explicitly requested config file must exist
    throw new Error(`Config file not found: ${explicitPath}`);
  }
  return { config: ConfigSchema.parse({}), source: 'defaults' };
}
