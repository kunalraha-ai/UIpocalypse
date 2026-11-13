/**
 * Wanderer persona (TRD §5): a pure code policy — no LLM. Weighted random
 * choice that prefers least-visited transitions (coverage-guided), seeded for
 * reproducibility. This is the shape every Phase 4 persona must fit.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type WandererAction = {
  /** runtime action id */
  runtimeId: number;
  /** graph action id (DB) */
  graphId: number;
  label: string;
  visits: number;
  textLike: boolean;
  risky: boolean;
};

export type WandererDecision =
  | { kind: 'action'; runtimeId: number; graphId: number; input?: string }
  | { kind: 'abandon'; reason: string };

export class Wanderer {
  private readonly rng: () => number;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }

  decide(ctx: {
    step: number;
    maxSteps: number;
    actions: WandererAction[];
    nastyInputs: string[];
  }): WandererDecision {
    if (ctx.step >= ctx.maxSteps) return { kind: 'abandon', reason: 'step budget' };
    const safe = ctx.actions.filter((a) => !a.risky);
    if (!safe.length) return { kind: 'abandon', reason: 'no safe actions' };

    // coverage-guided weights: rarely-visited actions are more attractive
    const weights = safe.map((a) => 1 / (1 + a.visits));
    const total = weights.reduce((s, w) => s + w, 0);
    let roll = this.rng() * total;
    let chosen = safe[safe.length - 1]!;
    for (let i = 0; i < safe.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) {
        chosen = safe[i]!;
        break;
      }
    }

    const decision: WandererAction = chosen;
    const input = decision.textLike && ctx.nastyInputs.length
      ? ctx.nastyInputs[Math.floor(this.rng() * ctx.nastyInputs.length)]
      : undefined;
    return { kind: 'action', runtimeId: decision.runtimeId, graphId: decision.graphId, input };
  }
}
