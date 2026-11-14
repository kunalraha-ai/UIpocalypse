import type { WandererAction } from './wanderer.js';
import { mulberry32 } from './wanderer.js';

/**
 * Persona policies (TRD §5): pure functions (state, history, rng) → decision.
 * No LLM in the hot loop. All randomness is seeded per agent.
 *
 * Wanderer lives in wanderer.ts; these are the Phase 4 additions:
 * Double-Clicker, Garbage Paster, Abandoner. Race Runner is implemented by
 * the orchestrator's barrier phase (browser/race.ts), not the step loop.
 */

export type PersonaDecision =
  | { kind: 'action'; runtimeId: number; input?: string; doubleClick?: boolean; interClickDelayMs?: number; waitMs?: number }
  | { kind: 'back' }
  | { kind: 'reload' }
  | { kind: 'gotoSeed'; url: string }
  | { kind: 'idle'; ms: number }
  | { kind: 'abandon' };

export type PersonaContext = {
  step: number;
  maxSteps: number;
  actions: WandererAction[];
  nastyInputs: string[];
  seedUrls: string[];
  history: string[];
  /** URL the agent is currently on */
  url: string;
};

export interface Persona {
  id: string;
  decide(ctx: PersonaContext): PersonaDecision;
}

const SUBMIT_LIKE = /submit|buy|place order|redeem|apply|save|send|checkout|pay|confirm|book|order|search|subscribe/i;

// ------------------------------------------------------------------ Wanderer (adapter)

export class WandererPersona implements Persona {
  id = 'wanderer';
  constructor(private readonly rng: () => number) {}
  decide(ctx: PersonaContext): PersonaDecision {
    const safe = ctx.actions.filter((a) => !a.risky);
    if (!safe.length || ctx.step >= ctx.maxSteps) return { kind: 'abandon' };
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
    const input = chosen.textLike && ctx.nastyInputs.length
      ? ctx.nastyInputs[Math.floor(this.rng() * ctx.nastyInputs.length)]
      : undefined;
    return { kind: 'action', runtimeId: chosen.runtimeId, input };
  }
}

// ------------------------------------------------------------------ Double-Clicker

export class DoubleClickerPersona implements Persona {
  id = 'double-clicker';
  constructor(private readonly rng: () => number) {}
  decide(ctx: PersonaContext): PersonaDecision {
    if (ctx.step >= ctx.maxSteps) return { kind: 'abandon' };
    const safe = ctx.actions.filter((a) => !a.risky);
    if (!safe.length) return { kind: 'gotoSeed', url: pick(ctx.seedUrls, this.rng) };
    const submits = safe.filter((a) => SUBMIT_LIKE.test(a.label));
    const pool = submits.length && this.rng() < 0.7 ? submits : safe;
    const chosen = pool[Math.floor(this.rng() * pool.length)]!;
    // fire submit-like actions 2-3× within ~50 ms — the duplicate-write hunt
    const doubleClick = submits.includes(chosen);
    return {
      kind: 'action',
      runtimeId: chosen.runtimeId,
      doubleClick,
      interClickDelayMs: doubleClick ? 40 + Math.floor(this.rng() * 20) : undefined,
      input: chosen.textLike ? 'a' : undefined,
    };
  }
}

// ------------------------------------------------------------------ Garbage Paster

export class GarbagePasterPersona implements Persona {
  id = 'garbage-paster';
  constructor(private readonly rng: () => number) {}
  decide(ctx: PersonaContext): PersonaDecision {
    if (ctx.step >= ctx.maxSteps) return { kind: 'abandon' };
    const safe = ctx.actions.filter((a) => !a.risky);
    if (!safe.length) return { kind: 'gotoSeed', url: pick(ctx.seedUrls, this.rng) };
    const textLike = safe.filter((a) => a.textLike);
    if (textLike.length && this.rng() < 0.8) {
      // paste garbage, then submit the form if one is around
      const target = textLike[Math.floor(this.rng() * textLike.length)]!;
      const input = ctx.nastyInputs[Math.floor(this.rng() * ctx.nastyInputs.length)] ?? 'x'.repeat(100);
      return { kind: 'action', runtimeId: target.runtimeId, input, waitMs: 200 };
    }
    const submits = safe.filter((a) => SUBMIT_LIKE.test(a.label));
    const pool = submits.length ? submits : safe;
    const chosen = pool[Math.floor(this.rng() * pool.length)]!;
    return { kind: 'action', runtimeId: chosen.runtimeId };
  }
}

// ------------------------------------------------------------------ Abandoner

export class AbandonerPersona implements Persona {
  id = 'abandoner';
  constructor(private readonly rng: () => number) {}
  decide(ctx: PersonaContext): PersonaDecision {
    if (ctx.step >= ctx.maxSteps) return { kind: 'abandon' };
    const safe = ctx.actions.filter((a) => !a.risky);
    if (!safe.length) return { kind: 'gotoSeed', url: pick(ctx.seedUrls, this.rng) };
    // leave mid-flow every few steps, then come back
    const roll = this.rng();
    if (roll < 0.2) return { kind: 'back' };
    if (roll < 0.3) return { kind: 'reload' };
    if (roll < 0.35) return { kind: 'gotoSeed', url: pick(ctx.seedUrls, this.rng) };
    const chosen = safe[Math.floor(this.rng() * safe.length)]!;
    return { kind: 'action', runtimeId: chosen.runtimeId };
  }
}

// ------------------------------------------------------------------ factory

export function createPersona(id: string, seed: number): Persona {
  const rng = mulberry32(seed);
  switch (id) {
    case 'double-clicker': return new DoubleClickerPersona(rng);
    case 'garbage-paster': return new GarbagePasterPersona(rng);
    case 'abandoner': return new AbandonerPersona(rng);
    case 'race-runner': return new WandererPersona(rng); // in-loop behaves as wanderer; barrier duty in race.ts
    default: return new WandererPersona(rng);
  }
}

export const ALL_PERSONAS = ['wanderer', 'double-clicker', 'garbage-paster', 'abandoner', 'race-runner'];

function pick(list: string[], rng: () => number): string {
  return list[Math.floor(rng() * list.length)] ?? 'about:blank';
}
