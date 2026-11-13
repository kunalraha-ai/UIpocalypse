import { describe, expect, it } from 'vitest';
import { Wanderer, mulberry32 } from '../src/agent/wanderer.js';
import type { WandererAction } from '../src/agent/wanderer.js';

const action = (over: Partial<WandererAction>): WandererAction => ({
  runtimeId: 1,
  graphId: 1,
  label: 'x',
  visits: 0,
  textLike: false,
  risky: false,
  ...over,
});

describe('Wanderer persona (TRD §5): pure, seeded, coverage-guided', () => {
  it('is deterministic for a given seed', () => {
    const ctx = {
      step: 0,
      maxSteps: 10,
      actions: [action({ runtimeId: 1, label: 'a' }), action({ runtimeId: 2, label: 'b' })],
      nastyInputs: [],
    };
    const a = new Wanderer(42).decide(ctx);
    const b = new Wanderer(42).decide(ctx);
    expect(a).toEqual(b);
  });

  it('prefers least-visited actions', () => {
    const unvisited = action({ runtimeId: 1, label: 'fresh', visits: 0 });
    const exhausted = action({ runtimeId: 2, label: 'stale', visits: 9 });
    let fresh = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const choice = new Wanderer(seed).decide({
        step: 0,
        maxSteps: 10,
        actions: [unvisited, exhausted],
        nastyInputs: [],
      });
      if (choice.kind === 'action' && choice.runtimeId === 1) fresh++;
    }
    expect(fresh).toBeGreaterThan(160); // weight 1 vs 1/10 → ~91%
  });

  it('never picks risky actions and abandons when none remain', () => {
    const wanderer = new Wanderer(7);
    const choice = wanderer.decide({
      step: 0,
      maxSteps: 10,
      actions: [action({ runtimeId: 1, label: 'Delete account', risky: true })],
      nastyInputs: [],
    });
    expect(choice.kind).toBe('abandon');
  });

  it('abandons at the step budget', () => {
    const wanderer = new Wanderer(7);
    const choice = wanderer.decide({
      step: 10,
      maxSteps: 10,
      actions: [action({ runtimeId: 1 })],
      nastyInputs: [],
    });
    expect(choice.kind).toBe('abandon');
  });

  it('feeds nasty inputs to text-like actions', () => {
    const wanderer = new Wanderer(3);
    const choice = wanderer.decide({
      step: 0,
      maxSteps: 10,
      actions: [action({ runtimeId: 4, textLike: true, visits: 5 })],
      nastyInputs: ['x'.repeat(50)],
    });
    expect(choice.kind).toBe('action');
    if (choice.kind === 'action') {
      expect(choice.input).toBe('x'.repeat(50));
      expect(choice.runtimeId).toBe(4);
    }
  });

  it('mulberry32 produces stable output', () => {
    const rng = mulberry32(123);
    expect(rng()).toBeCloseTo(mulberry32(123)(), 12);
  });
});
