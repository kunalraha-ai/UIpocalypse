import { describe, expect, it } from 'vitest';
import {
  DoubleClickerPersona,
  GarbagePasterPersona,
  AbandonerPersona,
  WandererPersona,
} from '../src/agent/personas.js';
import type { PersonaContext } from '../src/agent/personas.js';
import { mulberry32 } from '../src/agent/wanderer.js';

const ctx = (over: Partial<PersonaContext> = {}): PersonaContext => ({
  step: 0,
  maxSteps: 10,
  actions: [
    { runtimeId: 0, graphId: 0, label: 'Store', visits: 3, textLike: false, risky: false },
    { runtimeId: 1, graphId: 1, label: 'Buy credits', visits: 0, textLike: false, risky: false },
    { runtimeId: 2, graphId: 2, label: 'Redeem coupon', visits: 1, textLike: false, risky: false },
    { runtimeId: 3, graphId: 3, label: 'Coupon code', visits: 0, textLike: true, risky: false },
    { runtimeId: 4, graphId: 4, label: 'Delete account', visits: 0, textLike: false, risky: true },
  ],
  nastyInputs: ['x'.repeat(100), '🎉'],
  seedUrls: ['http://x/', 'http://x/page2'],
  history: [],
  url: 'http://x/',
  ...over,
});

describe('Phase 4 personas (TRD §5): pure, seeded, safe', () => {
  it('DoubleClicker prefers submit-like actions and double-fires them', () => {
    const p = new DoubleClickerPersona(() => 0.5);
    const decision = p.decide(ctx());
    expect(decision.kind).toBe('action');
    if (decision.kind === 'action') {
      expect(['Buy credits', 'Redeem coupon', 'Store']).toContain(
        ctx().actions.find((a) => a.runtimeId === decision.runtimeId)!.label,
      );
    }
    // seeded determinism
    const p2 = new DoubleClickerPersona(() => 0.5);
    expect(p2.decide(ctx())).toEqual(decision);
  });

  it('DoubleClicker never picks risky actions', () => {
    const p = new DoubleClickerPersona(() => 0.99);
    for (let i = 0; i < 20; i++) {
      const d = p.decide(ctx());
      if (d.kind === 'action') expect(d.runtimeId).not.toBe(4);
    }
  });

  it('GarbagePaster targets text inputs and pastes nasty values', () => {
    const p = new GarbagePasterPersona(() => 0.1); // 0.1 < 0.8 → textLike branch
    const d = p.decide(ctx());
    expect(d.kind).toBe('action');
    if (d.kind === 'action') {
      expect(d.runtimeId).toBe(3);
      expect(d.input).toBeTruthy();
      expect((d.input ?? '').length).toBeGreaterThan(10);
    }
  });

  it('Abandoner leaves mid-flow (back/reload/seed) on schedule', () => {
    const outcomes = new Set<string>();
    for (let r = 0; r < 1; r += 0.01) {
      const p = new AbandonerPersona(() => r);
      const d = p.decide(ctx());
      outcomes.add(d.kind);
      if (outcomes.size >= 4) break;
    }
    expect(outcomes).toContain('back');
    expect(outcomes).toContain('reload');
    expect(outcomes).toContain('gotoSeed');
  });

  it('Wanderer persona adapter still prefers least-visited', () => {
    let fresh = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const p = new WandererPersona(mulberry32(seed));
      const d = p.decide(ctx());
      // runtimeId 1 ("Buy credits", visits 0) has the joint-highest weight;
      // with rng=0 the first element always wins, so assert statistically
      if (d.kind === 'action' && d.runtimeId === 1) fresh++;
    }
    expect(fresh).toBeGreaterThan(25); // ~34% expected; visited Store gets ~9%
  });

  it('all personas abandon at the step budget and never pick risky actions', () => {
    const personas = [
      new DoubleClickerPersona(() => 0.4),
      new GarbagePasterPersona(() => 0.4),
      new AbandonerPersona(() => 0.4),
      new WandererPersona(() => 0.4),
    ];
    for (const p of personas) {
      expect(p.decide(ctx({ step: 10, maxSteps: 10 })).kind).toBe('abandon');
      const noSafe = p.decide(ctx({ actions: [ctx().actions[4]!] })); // only the risky one
      expect(noSafe.kind).not.toBe('action');
    }
  });
});
