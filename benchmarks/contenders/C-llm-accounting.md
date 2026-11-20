# Contender C — LLM call accounting correction

The originally reported "40 planner + 40 scout" was WRONG. The planner and scout LLM instances share a single call counter (`createLlmSet` uses one `{ calls: 0 }` object for both), so both `.calls` getters return the same number: the TOTAL across all roles. "40+40" was actually 40 total, not 80.

## Actual per-role breakdown (from the C-run telemetry)

| Role | Calls | Evidence |
|---|---|---|
| Planner (plan creation) | 1 | `plan: cached=false` in every run log — one call |
| Scout (exploration steps) | 37 | `scouts: 37 calls` in every run log |
| Reviewer (report) | 1 | one `reviewRun` call per run |
| Swarm escalations | ~1 | remainder: 40 − 1 − 37 − 1 = ~1 |
| **Total** | **~40** | shared counter, max cap 40 |

## Against the PRD metric

The PRD target is "LLM calls per RERUN ≤ 20." The C runs were **first runs** (fresh workspace, fresh plan), not reruns. For first runs there is no explicit LLM-call target in the PRD — the implicit budget is TRD §10's "Planner 1 + Reviewer 1 + Scouts 3-5 × ≤30 steps."

However, the phase-5 gate measured a **warm rerun** (cached plan + graph) at 40 LLM calls — all of them swarm escalations (agents stall on a fully-explored graph → each escalates once, up to 50 agents, capped at 40). **40 > 20 = the PRD rerun LLM metric is FAILED.** This was already recorded as an open item in PHASE5_RESULTS.md ("Swarm escalations vs the ≤ 20 LLM-calls-per-rerun PRD metric").

The fix options (saturation-aware escalation skipping, or a metric that counts scout-only calls for reruns) are recorded but NOT implemented — this is a failed metric, reported as-is.
