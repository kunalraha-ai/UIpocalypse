# Post-fix gate execution logs (raw)

The three valid post-escalation-fix gate executions (2026-11-20) that the
BENCHMARK_RESULTS.md gate table is scored from, plus the invalid first
attempt (target app was down on :3123 — the tool ran against a dead port;
recorded in gate-rerun1-invalid.md). These are verbatim console logs: gate
check lines, per-run timing, cluster counts, coverage, and LLM accounting.

## Files

- run1/2/3.log — the 3 valid post-fix executions (2026-11-20)
- invalid-app-down-run1.log — the first invalid attempt (app down)
- cleanup-gate-exec1-invalid.log + .md — the 2026-11-21 execution invalidated
  when the target app died mid-run 2 (concurrent prompt-test recorded as a
  confound; run 1 valid in isolation)
- cleanup-gate-exec2-valid.log — the clean 2026-11-21 execution: GATE PASS
  8/8 with the rewritten collapsed-result acceptance check (dup_effect
  2/2/2, 0 singletons, raw dupObs 19–38), first-run median 162 s, rerun
  88 s, rerun LLM 1 call, graph coverage 95%/94%/95% with 2 skipped-by-
  policy actions listed ("Email", "Delete account"), and planted bug #11
  detected once (1 obs) — intermittent post-fix, not gone.
