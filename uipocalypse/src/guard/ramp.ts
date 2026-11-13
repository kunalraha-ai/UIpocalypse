/**
 * Rate limiting and concurrency ramp (SAFETY.md G7):
 * start at 5 agents, ramp up while monitoring error rate and latency, stop on
 * degradation (p95 > 3× baseline or 5xx > 5%), and report the level reached.
 */

export function createRateLimiter(opts: { rps: number; burst?: number }) {
  const burst = opts.burst ?? opts.rps;
  let tokens = burst;
  let last = Date.now();
  return {
    tryAcquire(): boolean {
      const now = Date.now();
      tokens = Math.min(burst, tokens + ((now - last) / 1000) * opts.rps);
      last = now;
      if (tokens >= 1) {
        tokens -= 1;
        return true;
      }
      return false;
    },
  };
}

function p95of(samples: number[]): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)]!;
}

export type RampReport = {
  level: number;
  maxAgents: number;
  stopped: boolean;
  stopReason: string | null;
  currentErrorRate: number;
  p95LatencyMs: number;
};

export function createRampMonitor(opts: {
  startAgents?: number;
  maxAgents: number;
  p95Factor?: number;
  errorRatePct?: number;
  windowSize?: number;
}) {
  const start = opts.startAgents ?? 5;
  const p95Factor = opts.p95Factor ?? 3;
  const errorRatePct = opts.errorRatePct ?? 5;
  const windowSize = opts.windowSize ?? 50;

  let level = start;
  let stopped = false;
  let stopReason: string | null = null;

  const window: Array<{ latencyMs: number; error: boolean }> = [];
  let baselineP95: number | null = null;
  const baselineSamples: number[] = [];

  return {
    get level() {
      return level;
    },
    get shouldStop() {
      return stopped;
    },
    get stopReason() {
      return stopReason;
    },
    canStepUp() {
      return !stopped && level < opts.maxAgents;
    },
    stepUp() {
      if (this.canStepUp()) level += 1;
    },
    record(latencyMs: number, error: boolean) {
      window.push({ latencyMs, error });
      if (window.length > windowSize) window.shift();

      if (baselineP95 === null) {
        if (!error) baselineSamples.push(latencyMs);
        if (baselineSamples.length >= windowSize) baselineP95 = p95of(baselineSamples);
        return;
      }

      const errors = window.filter((s) => s.error).length;
      const errorRate = (errors / window.length) * 100;
      const p95 = p95of(window.map((s) => s.latencyMs));

      if (window.length >= windowSize && errorRate > errorRatePct) {
        stopped = true;
        stopReason = `degraded at ${level} agents: error rate ${errorRate.toFixed(1)}% > ${errorRatePct}% threshold`;
      } else if (window.length >= windowSize && p95 > p95Factor * baselineP95) {
        stopped = true;
        stopReason = `degraded at ${level} agents: p95 latency ${Math.round(p95)} ms > ${p95Factor}× baseline (${Math.round(baselineP95)} ms)`;
      }
    },
    report(): RampReport {
      const errors = window.filter((s) => s.error).length;
      return {
        level,
        maxAgents: opts.maxAgents,
        stopped,
        stopReason,
        currentErrorRate: window.length ? errors / window.length : 0,
        p95LatencyMs: window.length ? p95of(window.map((s) => s.latencyMs)) : 0,
      };
    },
  };
}
