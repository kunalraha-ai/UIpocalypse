import { z } from 'zod';

/**
 * Plan schema (TRD §3.2 FR-P1): validated JSON out of LLM call #1.
 * `invariants` are PLANNER-DRAFTED `atMost` predicates (FR-P1, review
 * directive): single-use/unique/double-submit damage expressed over the DB
 * schema, preflight-validated against a clean DB before use.
 */

export const PlannedInvariantSchema = z.object({
  name: z.string(),
  sql: z.string(),
  atMost: z.number(),
});

/**
 * The full swarm roster. A plan WITHOUT explicit personas defaults to the full
 * set — never a lone wanderer: a wanderer-only swarm cannot double-submit
 * (no Double-Clicker), which silently blinded duplicate_request detection in
 * the phase 5 gate (0 findings across 4 runs; the phase 4 gate produced
 * 18–52 per run). Narrowing is an explicit choice, not a default.
 */
export const FULL_PERSONA_ROSTER = ['wanderer', 'double-clicker', 'garbage-paster', 'abandoner', 'race-runner'] as const;

export const PlanSchema = z.object({
  summary: z.string().default(''),
  personas: z.array(z.string()).default([...FULL_PERSONA_ROSTER]),
  goals: z
    .array(
      z.object({
        description: z.string(),
        inputs: z.record(z.string(), z.string()).optional(),
        expected: z.string().optional(),
      }),
    )
    .default([]),
  seedRoutes: z.array(z.string()).default([]),
  nastyInputs: z.record(z.string(), z.array(z.string())).default({}),
  invariants: z.array(PlannedInvariantSchema).default([]),
  notes: z.string().default(''),
});

export type Plan = z.infer<typeof PlanSchema>;

export const ScoutDecisionSchema = z.object({
  actionId: z.union([z.number(), z.string()]),
  input: z.string().optional(),
  reason: z.string().optional(),
  done: z.boolean().optional(),
});
export type ScoutDecision = z.infer<typeof ScoutDecisionSchema>;

export const DEFAULT_NASTY_INPUTS: Record<string, string[]> = {
  long: ['x'.repeat(10000)],
  emoji: ['🎉🎉 rtl مرحبا'],
  sql: ["' OR 1=1 --"],
  html: ['<img src=x onerror=alert(1)>'],
  whitespace: ['   '],
  empty: [''],
};
