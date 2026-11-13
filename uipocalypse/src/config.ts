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
  auth: z
    .object({
      storageState: z.string().optional(),
      loginScript: z.string().optional(),
    })
    .optional(),
  skipActions: z.array(z.string()).default([]),
  destructiveOptIn: z.boolean().default(false),
  externalOptIn: z.boolean().default(false),
  /** Loud, explicit override for prod-like targets. Still requires the ownership token. */
  prodOverride: z.boolean().default(false),
  /** Expected value of /.well-known/uipocalypse.txt on non-local targets (SAFETY.md G2). */
  ownershipToken: z.string().optional(),
  db: z
    .object({ allowedHosts: z.array(z.string()).default(DEFAULT_DB_HOSTS) })
    .default({ allowedHosts: DEFAULT_DB_HOSTS }),
  invariants: z
    .array(z.object({ name: z.string(), sql: z.string(), expect: z.number() }))
    .default([]),
  /** Per-host request ceiling (SAFETY.md G7). */
  maxRps: z.number().int().min(1).default(50),
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
