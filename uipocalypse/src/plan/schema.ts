import { z } from 'zod';

/**
 * Plan schema (TRD §3.2 FR-P1): validated JSON out of LLM call #1.
 */

export const PlanSchema = z.object({
  summary: z.string().default(''),
  personas: z.array(z.string()).default(['wanderer']),
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
