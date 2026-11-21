import { defineConfig } from 'vitest/config';

// Every test file that launches a real Chromium (directly or through a
// spawned server). Under default file-parallel execution, ~11 such files run
// at once and CPU contention inflates browser launch/step time 3–5×, which
// produces two observed flake classes (6+ parallel runs of evidence):
//   1. real-browser tests overrunning the 30 s testTimeout
//      (secret-leak run_swarm, explore-e2e, swarm, earlier scout-budget)
//   2. timing-sensitive verdicts firing under starvation — e.g. a live link
//      whose navigation lands after the runtime's 500 ms verdict window
//      reads as a dead click (swarm.test, run 4). That window is a detector
//      threshold and was NOT touched.
// These tests pass in isolation and serially; the flakes are contention, not
// code defects. No assertion or timeout was loosened to get them green.
const BROWSER_TESTS = [
  'test/env-loading.test.ts',
  'test/escalation-fix.test.ts',
  'test/explore-e2e.test.ts',
  'test/hang.test.ts',
  'test/no-safe-db.test.ts',
  'test/report-observability.test.ts',
  'test/runtime.test.ts',
  'test/scout-budget.test.ts',
  'test/secret-leak.test.ts',
  'test/skipped-actions.test.ts',
  'test/swarm.test.ts',
];

export default defineConfig({
  test: {
    projects: [
      {
        // pure-unit tests: fast, no browsers, safe under parallelism
        test: {
          name: 'parallel',
          include: ['test/**/*.test.ts'],
          exclude: BROWSER_TESTS,
          environment: 'node',
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
      {
        // real-browser tests: one file at a time (see the comment above)
        test: {
          name: 'serial-browser',
          include: BROWSER_TESTS,
          fileParallelism: false,
          environment: 'node',
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
