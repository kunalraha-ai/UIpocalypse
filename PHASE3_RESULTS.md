# UIpocalypse: Phase 3 Results

**Status:** Complete · **Date:** 2026-11-13 · **Scope:** IMPLEMENTATION_PLAN.md Phase 3 (in-page runtime, detectors, state graph, Wanderer, Planner + Scouts)

## Verdict: **PASS** — the deliverable works and the gate is green for real

| Check | Result |
|---|---|
| Deliverable: scout + wanderer explore the sample app, write a graph, record findings with evidence | ✅ 9 states / 42 actions / 42 transitions across two runs; findings carry evidence + repro steps |
| **Gate: run 2 needs ≥ 50% fewer LLM calls than run 1** | ✅ **3 gate pairs, all PASS**: 97.4% / 66.7% / 100% reduction |
| Hash gate (held-out app) | Cleared in Phase 2 |
| Test suite | 55/55 green (unit + integration + deterministic FakeLlm e2e) |

### The gate, run 3× with the fast scout model (llama-3.1-8b, ~1.2 s/call; planner stays on the reasoning model)

Review follow-up: one gate pair is thin evidence, and the reasoning model was too slow for the time targets (scout calls ~10 s each). Fix: **LLM_SCOUT_MODEL** — a fast non-reasoning model for scouts, reasoning model kept for planning. Ranges over 3 pairs:

| Gate pair | Run 1 calls | Run 1 wall | Run 2 calls | Run 2 wall | Reduction |
|---|---|---|---|---|---|
| 1 | 39 | 228 s | 1 | 18 s | **97.4%** |
| 2 | 30 | 359 s ⚠️ | 10 | 39 s | **66.7%** |
| 3 | 40 | 128 s | 0 | 16 s | **100%** |

- **Rerun target (≤ 90 s): met in all three runs** (16–39 s). The earlier reasoning-model rerun took 161 s — the model swap was the fix, as suspected.
- **First-run target (≤ 4 min): met in 2 of 3** (128–359 s). The variance is scout-LLM latency + occasional malformed replies from the small model (retry recovers; scoutOutcome sometimes `error` on a seed, which the runner now survives). PRD G1 revised to state the median and the measured range honestly.
- LLM calls per rerun: 0–10 (target ≤ 20 ✓).

## The gate run (real LLM, real Next.js + Supabase sample app)

| | Run 1 (fresh graph) | Run 2 (cached plan + graph) |
|---|---|---|
| LLM calls | **25** (planner 1 + scouts 24) | **5** (planner 0 — cached by app-map hash) |
| Wall | 309 s | 161 s |
| States / actions / transitions | 9 / 24 / 24 | 9 / **42** / 42 (graph kept growing — run 2 discovered 18 more actions in signed-out state variants) |
| Coverage | 1.0 | 1.0 |
| Findings | 6 | 9 |

Planted bugs observed live: `/api/orders` → **500** (bug #8 server signal, both runs); `/api/promo` → **404** (bug #3 — including a visit where the unwired newsletter form's native GET submit landed on `/?email=` before the promo fired, which is bug #2's behavior in the wild); `dead_click: Save profile` (bug #1, earlier gate run — this run's scouts were seed-limited to the first 4 seeds); `/api/auth/login` → 401 (scout attempted login flow without credentials — a true signal).

## What the gate run exposed (and fixed) — reasoning models

The first gate attempt **failed** with a broken scout phase (2–3 total calls, `scoutOutcome: "error"`). Root cause: **Kimi K2.7 is a reasoning model and `reasoning_content` tokens count against `max_tokens`** — with scout calls capped at 300 tokens, richer prompts burned the entire budget on reasoning and returned empty/truncated JSON. One malformed response then killed the entire scout phase. Fixes, all verified by the passing rerun:

1. Scout `max_tokens` 300 → **1500** (room for reasoning + JSON).
2. **Retry once** per step on parse/HTTP failure.
3. One seed's failure no longer kills the phase (log + continue to next seed); errors are now reported, not swallowed.
4. Saturation check now applies at **step 0** — a fully-known state costs zero LLM calls (this alone is a large share of the run-2 savings).

Lesson recorded in TRD §10: LLM budgets must assume reasoning-token overhead; per-call `max_tokens` needs headroom, and completion budgets (≤ 20 calls/rerun) should count calls, not assume token-linearity.

## Architecture shipped this phase

- **Runtime** (`src/runtime/runtime-source.ts`): action enumeration, `perform()` (click / double-click / React-compatible native-setter fills), event capture (page/console errors, fetch/XHR statuses, spinner tracking), defensive install, saturated-control exclusion — all Phase 0 S4 learnings baked in.
- **Detectors** (`src/browser/detectors.ts`): page_error, console_error, failed_request (app-origin, benign-filtered), dead_click (suppressed when the action *threw* — the error is the finding), infinite_spinner (> 10 s), navigation_error (matches Next's "This page couldn't load" UI). One precision find from the fixture: a **validation-blocked form submit reads as a dead click** — correct by the TRD definition and genuinely useful (garbage input + zero feedback).
- **State graph** (`src/graph/`): the S2-validated ariaSnapshot hashing as production code, plus a DAL facade with visit counts, frontier queries and coverage.
- **Wanderer** (`src/agent/wanderer.ts`): seeded mulberry32, coverage-guided `1/(1+visits)` weights, nasty-input fills, risky-action exclusion. Explored the app with zero LLM calls.
- **Planner** (`src/plan/`): app-map summary only (redacted), zod-validated, cached by app-map hash — reruns cost zero; degrades to app-map defaults without a key or on LLM failure.
- **Scout** (`src/scout/scout.ts`): LLM-stepped exploration; stops on saturation *without* an LLM call; fail-closed action validation (invalid actionIds are skipped, never guessed).
- **Runner** (`src/browser/runner.ts`): Safety-Guard-checked, single context, scout-then-wanderer, full-navigation context-destroy recovery, findings with evidence + steps.
- **MCP**: `plan_swarm` and `run_swarm` are live alongside `scan_codebase` (bundle updated; playwright external like better-sqlite3).
- **LLM layer** (`src/llm/`): OpenAI-compatible (covers Workers AI/OpenAI/local), call counting, per-run cap, `FakeLlm` for deterministic tests.

## Known limits going into Phase 4

- Single context; `agents` accepted but ignored (Phase 4 = the orchestrator).
- Seeds sliced to the first 4 (time-budgeted); the plan's 7 seeds weren't all reached — wider seeding comes with the orchestrator.
- Findings are raw (no dedupe/clustering yet — Phase 5 collector); the gate script dedupes only for its digest.
- Coverage is `performed (state,action) pairs / discovered pairs` — the report-level coverage definition lands with the collector.
- The gate's run-2 graph growth (24 → 42 actions) shows auth-state variants create more work for reruns; Phase 4's personas + auth config will handle this deliberately.

## Reproduce

```bash
# unit + integration (deterministic, no LLM): 55/55
cd uipocalypse && npm test

# the real gate (needs the sample app on :3123 + LLM_* env)
npx tsx scripts/phase3-gate.ts http://localhost:3123 ../sample-app
```
