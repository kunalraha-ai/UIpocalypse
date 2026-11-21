import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // default: everything runs in parallel
        test: {
          name: 'parallel',
          include: ['test/**/*.test.ts'],
          exclude: [
            // contention-sensitive real-browser tests run in the serial project below
            'test/scout-budget.test.ts',
            'test/explore-e2e.test.ts',
          ],
          environment: 'node',
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
      {
        // SERIAL, deliberately: these two drive a real Chromium through a
        // full explore phase with wall-clock assertions. Under default
        // file-parallel execution ~20 test files launch browsers at once,
        // and CPU contention inflates launch/step time 3–5× — the
        // scout-budget test's 1 s cap expired before a single scout step
        // (fixed at the source too: the cap no longer counts browser
        // launch), and explore-e2e's real-browser run overran its test
        // timeout despite passing in isolation and serially. This is
        // contention sensitivity, not a code defect; no assertion or
        // timeout was loosened to get these green.
        test: {
          name: 'serial-browser',
          include: ['test/scout-budget.test.ts', 'test/explore-e2e.test.ts'],
          fileParallelism: false,
          environment: 'node',
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
