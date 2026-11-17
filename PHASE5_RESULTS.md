# UIpocalypse: Phase 5 Results

**Status:** In progress · **Date:** 2026-11-16 · **Scope:** IMPLEMENTATION_PLAN.md Phase 5 (collector, reviewer, report, diff_runs) + the review-directed regression hunt

## What shipped (Phase 5 build)

- **Collector** (`src/collect/collector.ts`): findings cluster on the FR-C1 fingerprint (`type-family + normalized endpoint + masked action label`); the two classification rules land in the collector — a 4xx on a route that exists in the app map is a *correct rejection* (downgraded), `net::ERR_ABORTED` is a cancellation artifact (filtered); coverage reports unreached actions with honest reasons (destructive-skipped, requires-input, auth wall, budget); `cluster_id` backfilled on raw rows.
- **Reviewer + report** (`src/report/reviewer.ts`): LLM call #2 over clusters only (zod-validated, mechanical fallback for `--no-llm`), root causes + paste-ready fix prompts mapped to file/line via the app map; markdown + JSON output; reports cached per run.
- **MCP tools**: `get_report` / `list_runs` / `diff_runs` / `verify_deployment_safety` (one-call pipeline), all exercised over stdio in the test suite.
- **Planner-drafted invariants** (FR-P1): the planner drafts `atMost` damage predicates from the schema + write endpoints; each is preflight-validated against the DB before use (one already violated on a clean DB is dropped, not reported); without a reachable allow-listed DB the drafted invariants are skipped and `duplicate_request` stays the standalone signal.
- **Screenshots on failure** (dead_click / inconsistent_feedback carry real files) and opt-in scout-phase Playwright tracing (`config.trace`).
- **Five new static rules** (15 total): permissive-rls, unauth-write-route, no-rate-limit-auth, missing-submit-guard, missing-meta — fixture-tested both directions.
- **Scout hard cap** (`config.scoutBudgetSeconds`, default 90): the scouting phase stops at a wall-clock deadline checked per step, so a slow LLM cannot make run time unpredictable; the shortfall shows up as unreached actions with the budget reason. Red→green with a deliberately slow never-saturating fake LLM (22.6 s uncapped → bounded with a 1 s cap).

## The regression: duplicate_request fired 0 times across 4 gate runs

**Symptom.** The first phase 5 gate execution (2026-11-15) produced `duplicate_request: 0` in all four runs, where every phase 4 gate run had produced 18–52.

**Diagnosis.** Not a product regression between commits — a gate-script bug that exposed a real product trap:

1. `phase5-gate.ts` (uncommitted at the time) omitted the `personas` option in its swarm call.
2. `swarm()` therefore honored `plan.personas`, and the planner returns `['wanderer']` (printed in every gate log: `personas=wanderer`).
3. A wanderer-only swarm has no Double-Clicker, and only the Double-Clicker double-fires writes → `duplicate_request` can never fire. Agents were logged in and reaching the write endpoints — that was never the problem (the healthy comparison run shows duplicate writes from `/checkout` and `/checkout/success` and DB-confirmed effects).

**Empirical confirmation.** The phase 4 gate — committed, unchanged in substance since 4dde5df, explicit full persona roster — run at HEAD on the same machine: **6/6 PASS, duplicate_request = 35** (historical band 18–52), duplicate_effect CONFIRMED (8 transaction pairs + 21 order pairs), race 1→15 redemptions. The product was healthy at HEAD; there was nothing to `git bisect` — the regression lived in uncommitted gate-script code and never shipped in a commit.

**Fixes (commit cf30396 + c9202db).**
- `PlanSchema.personas` now defaults to the **full roster** — the real root cause. Any swarm honoring a plan without explicit personas (including the MCP `run_swarm` path) previously ran wanderer-only and was structurally blind to double-submits. The planner prompt now instructs the full roster unless the user narrows; degraded and CLI plans use it too.
- The gate passes the roster explicitly and runs at the **default 60 s budget** (the 105 s budget alone made the 90 s rerun target unreachable).

**Regression tests.** (a) `PlanSchema` default test — red on the old `['wanderer']` default; (b) an end-to-end capability guard: a Double-Clicker swarm against a real POST fixture must produce `duplicate_request` findings. The first version of that guard used a native form POST — which navigates away on the first click and races the second click's request away — so the fixture now fires its POST via `fetch` (like the write paths we actually hunt) and the guard is deterministic (verified 3× isolated + full suite).

## Gate results (3 executions at defaults)

**Execution 1** (2026-11-16, first attempt — before the watchdog + step-0 saturation fixes): 6 PASS / 2 FAIL.

| Check | Result |
|---|---|
| collector acceptance: dup obs collapse per endpoint | ✅ `18→2, 21→2, 6→2` |
| classification (rejections / artifacts) | ✅ `3/2/2` rejections, `8/8/9` artifacts |
| **duplicate detection restored (the regression)** | ✅ **dupObs per run: 18, 21, 6, 4** — after the persona fix, every run detects double-submits again |
| diff_runs over 4 identical runs | ✅ **fixed=0, new=0, still=14, intermittent=7 — zero phantoms**; all detection variance landed in `intermittent` |
| screenshots on failure | ✅ 17 findings with files |
| every issue has root cause + fix prompt | ✅ 18 issues |
| first-run ≤ 4 min (median) | ❌ median 265 s, range 161–**15,079 s** (see the hang below) |
| rerun ≤ 90 s | ❌ 194 s — scouts 80 s of it (see step-0 saturation below) |

Two root causes found in execution 1, both fixed red→green (commits `045f273`, `fd29a2e`):

1. **The 15,079-second run — a wedged-renderer hang, and no real watchdog.** `page.evaluate`/`ariaSnapshot` have no Playwright timeout; one wedged renderer stalled a scout op forever, and every budget check is cooperative, so TRD §11's "global watchdog" turned out not to exist. Fix: every browser op races a 30 s `withTimeout` (a throw feeds the existing crash-isolation/seed-skip paths), and each phase arms a watchdog that force-closes the browser at budget + bounded overshoot — the run always finishes and emits its partial report. A deterministic wedged-page fixture (`getActions` loops forever) proved it: explore resolves in ~65 s (5 s budget + 60 s watchdog slack, measured), the swarm in ~100 s; the old code never returns.
2. **Step-0 saturation was documented but never delivered.** PHASE3_RESULTS claimed "a fully-known state costs zero LLM calls", but the code required `steps > 0`, so every saturated seed burned one call — invisible at nominal latency, ~80 s of scout time on a warm rerun at today's 10–20 s/call. Fix: the guard is gone (empty graphs cannot trip it). Red→green: a fully-explored fixture rerun made 4 calls before, 0 after.

**Execution 2** (2026-11-16, after both fixes): **GATE: PASS — 8/8.**

| Check | Result |
|---|---|
| first-run pipeline ≤ 4 min (median, PRD G1) | ✅ **median 200 s**, range 200–248 s (excl. db reset; 233–282 s with) |
| rerun ≤ 90 s (PRD G1) | ✅ **87 s** — scouts 10 s (step-0 saturation: zero LLM calls on the warm graph) + swarm 78 s |
| collector acceptance | ✅ `22→2, 28→2, 14→2` |
| classification rules | ✅ rejections `2/2/3`, artifacts `8/8/10` |
| duplicate detection restored | ✅ dupObs per run: **22, 28, 14, 23** |
| diff_runs over 4 identical runs | ✅ fixed=0, new=0, still=14, intermittent=9 — **zero phantoms** |
| screenshots / fix prompts | ✅ 20 findings with files; 15 issues with root cause + fix prompt |

**Execution 3** (2026-11-16 night): **invalid measurement — the machine was suspended mid-run** (~23.6 h, session date Nov 16→17). Its first-run "took" 85,000 s (`scouts: 6971 s`, `swarm: 77,970 s`): timers don't fire while suspended, so the watchdog closed everything only on resume; every wall measurement inflated and the LLM sockets died (the rerun's reviewer hit its 60 s cap → mechanical fallback; dup collapsed to 2/3/2/0). Recorded as what happened to the tool in a suspended environment — not as a tool measurement — and re-run below.

**Execution 3 (re-run)** — recorded below when complete.

### False-positive rate over the clustered set (execution 2, first-run 3)

The classification rules now do real work — correct rejections (login 401 ×58, coupon 400 ×26, coupon 404 ×2) and cancellation artifacts (ERR_ABORTED ×~50 obs across 9 clusters) never enter the findings bucket. Over the 16 finding clusters (counts with percentages; n is small):

| Verdict | Clusters | Which |
|---|---|---|
| True positives | 14 | orders 500 (#8), search 500 (#7), profile NameTag crash ×2 (#6 — one bug split by the "Uncaught " message prefix), dup:orders + dup:/api/coupon/redeem + dup:/api/checkout (double-submit effects/requests, #4 family), promo 404 (#3), Save profile (#1), + 6 console_error clusters corroborating those same endpoints |
| False positives | **2 of 16 ≈ 12.5%** | `console 404 on /checkout` ×2 obs (cancellation noise leaking into console logs) and `console Unauthorized on /login` ×58 obs (corroborating what the classifier already knows is a correct rejection) |

Phase 4's pre-classifier figure was 4 of 17 ≈ 24%; the measured post-classifier rate is 2 of 16 ≈ 12.5% — under the 20% gate. Open item: console_error clusters whose endpoint+status match a correct-rejection request cluster should be downgraded the same way their request was.

## Open items (honest)

- **Rerun wall vs the 90 s target:** the structural blockers (one LLM call per saturated seed, no watchdog) are fixed; the remaining variables are swarm overshoot after the 60 s budget (bounded by the watchdog at +90 s) and the single reviewer LLM call (60 s HTTP cap). Executions 2–3 below measure where reruns actually land; no target was retuned.
- **Swarm escalations vs the ≤ 20 LLM-calls-per-rerun PRD metric:** a fully-explored graph stalls agents into one escalation each (~up to 50, capped at 40) — the cap holds cost, but the PRD metric as written (Phase 3-era, scout-only) needs a decision: saturation-aware escalation skipping, or a metric that counts them. Execution 1's rerun: 40 calls (scouts ~0 + escalations to cap).
- **Inconsistent-feedback noise under load:** the healthy comparison run marked the (genuinely dead) "Save profile" alive once (`inconsistent_feedback` ×1 alongside `dead_click` ×17) — a late render landing inside a click's verdict window. Known, low-severity, ranked low by design.
- **Ramp error-rate vs crash-y apps:** the ramp froze at 50 reporting "error rate 7.5% > 5%" — bug #11's page-errors read as degradation. Arguably correct (the app IS failing under load), but worth a note in the report when it happens.
- **MCP tool gap:** `run_swarm` does not expose a `personas` input (TRD §6 says `plan_swarm` should) — the plan is the only persona source today.
- **Console clusters vs correct rejections:** a `console_error` cluster whose endpoint+status matches a correct-rejection request (e.g. the "Unauthorized" console line on /login, 58 obs in execution 2) stays a finding while its request is downgraded — 1 of the 2 measured FP clusters. The collector should downgrade matching console clusters the same way.
- **One unexplained flake:** a single full-suite run showed 2 failures whose output was swallowed by a logging mistake; three consecutive reruns were 100/100. Not identified, not forgotten.
