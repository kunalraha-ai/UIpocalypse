# UIpocalypse: Phase 5 Results

**Status:** Complete — gate PASS on the current config (3 executions, 8/8 each) · **Date:** 2026-11-16 → 2026-11-20 · **Scope:** IMPLEMENTATION_PLAN.md Phase 5 (collector, reviewer, report, diff_runs) + the review-directed regression hunt + model-deprecation resilience + Contender B

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

**Fixes (commit 8a1e820 + 3c3d426).**
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

## Close criteria (written 2026-11-20, before the current-config executions land)

The verdict follows the rule below, not the numbers:

1. **Executions 1–2 (Kimi K2.7 planner + llama-3.1-8b scout) are reported as "passed on the since-deprecated models"** — both models returned HTTP 410 on 2026-11-20, so those results cannot be reproduced. The 8/8 pass stands as history, not as a current claim.
2. **The current-config verdict comes from ≥ 3 executions on glm-5.3 + llama-3.2-3b.** Phase 5 closes as PASS only if every gate check passes on the current config across those executions, **or** every failure is named with its cause and the cause is an environment fact (LLM latency variance, suspend, deprecation) rather than a product defect.
3. **The 3B scout must not silently lose quality:** each current-config execution is compared to execution 2 on discovered actions, coverage %, malformed-JSON retries, and finding counts. If coverage drops materially, the speed gain is recorded as hollow and the scout model choice is called out as an open risk, not buried.
4. First-run/rerun timing figures from the old models (200 s / 87 s) do **not** carry over; the current-config range is the published number.
5. `IMPLEMENTATION_PLAN.md` is updated only on a real pass under rule 2.

## Model deprecations (2026-11-20) — a product risk, treated as Phase 5 scope

**Execution 3's original models** (`@cf/moonshotai/kimi-k2.7-code` planner, `@cf/meta/llama-3.1-8b-instruct-fp8` scout) were both **deprecated the same day** — HTTP 410. Swapped to current-catalog successors and re-verified: planner → `@cf/zai-org/glm-5.3` (1.4 s/call), scout → `@cf/meta/llama-3.2-3b-instruct` (0.3 s/call; smaller than the old 8b — the phase-3 fail-closed action validation is the protection). This is exactly what users will hit, so the following shipped as Phase 5 scope:

- **Model IDs live in config only** (`.env` / `LLM_MODEL` / `LLM_SCOUT_MODEL`), never hard-coded per-account.
- **Per-role fallback lists** (`LLM_MODEL` and `LLM_SCOUT_MODEL` accept comma-separated chains; a 410/404 model failure walks to the next candidate).
- **A startup health check** that fails with a clear, actionable message (`model X returned 410 — set LLM_MODEL / LLM_SCOUT_MODEL`) instead of a stack trace mid-run.
- **Model IDs recorded in every run row and printed in every report**, so old results stay interpretable after a model disappears.
- **Monotonic budgets** (`performance.now()` for budget/deadline checks — `Date.now()` jumps with clock changes and suspends) plus **suspend/time-jump detection in the gate** (a run whose wall-clock delta exceeds its monotonic delta by minutes is flagged invalid, not averaged in).
- **PRD documents that results depend on the LLM** and names the models each phase was validated on.

Current-config execution results appear at the end of this document — the runs below were in flight when this section was written.

### Current-config executions (glm-5.3 planner + llama-3.2-3b scout, 2026-11-20)

**Three executions on the current config, all GATE: PASS — 8/8 each.** The close-criteria verdict is a real pass: every gate check passed across all three, with zero product-defect failures.

| Check | Execution 3 | Execution 4 | Execution 5 |
|---|---|---|---|
| first-run median (≤ 240 s) | ✅ 136 s (127–138) | ✅ 153 s (143–158) | ✅ 147 s (145–157) |
| rerun (≤ 90 s) | ✅ 72 s | ✅ 71 s | ✅ 71 s |
| collector acceptance | ✅ 17→2, 21→2, 26→2 | ✅ 19→2, 21→2, 18→2 | ✅ 22→2, 28→3, 9→2 |
| classification rules | ✅ 3/3/3 rej, 10/8/8 art | ✅ 3/3/3 rej, 8/9/8 art | ✅ 3/3/3 rej, 8/9/8 art |
| duplicate detection restored | ✅ 17, 21, 26, 30 | ✅ 19, 21, 18, 35 | ✅ 22, 28, 9, 41 |
| diff over identical runs | ✅ 0 phantoms (still=15, int=5) | ✅ 0 phantoms (still=16, int=7) | ✅ 0 phantoms (still=16, int=7) |
| screenshots / fix prompts | ✅ 21 / 17 | ✅ 21 / 21 | ✅ 29 / 18 |

**Published current-config range (9 first-run pipelines): 127–158 s, median 147 s; rerun 71–72 s.** All under the PRD targets (≤ 240 s / ≤ 90 s). Executions 4–5 additionally ran the resilience code (startup health check, monotonic budgets, suspend detection) — no behavior change on a healthy machine, as intended.

**3B-scout quality comparison vs execution 2 (old models)** — the speed gain is *not* hollow:

| Metric | Execution 2 (llama-3.1-8b) | Execution 3 (llama-3.2-3b) |
|---|---|---|
| Coverage | 100% (97/97 actions, 1st-run-1) | **100%** (96/96, 1st-run-1) |
| Actions discovered | 97 | 96 (−1, within noise) |
| Scout LLM calls (fresh graph) | 26–32 | 38–39 (the 3B explores more steps before saturating — more calls at 0.3 s each, still 3× less wall time) |
| duplicate_request findings/run | 22, 28, 14 (+23 rerun) | 17, 21, 26 (+30 rerun) — comparable band |
| page_error findings/run | 6, 18, 14 | 10, 21, 14 — comparable |
| dead_click findings | 18, 13, 18 | 8, 9, 13 — comparable |
| Plan quality | same plan shape (personas full, seeds hit) | same |
| Malformed-JSON retries | not observable in gate output (the scout retry exists; no scoutOutcome 'error' in either execution — both models' replies validated) |

The 3B scout discovered the same graph (96 vs 97 actions), hit 100% coverage in every run, and the finding profile is equivalent — with the whole first-run wall dropping from ~200 s to ~136 s. The smaller model costs more calls (38 vs ~26) but at 0.3 s each the phase is 4× faster anyway. **Quality held; the speed gain is real.** One honest caveat: the 3B scout's `scoutOutcome` was never 'error' in these runs, but a 3B is weaker at genuinely novel UIs — the phase-3 fail-closed action validation (invalid actionIds skipped, never guessed) is the protection, and real-repo Phase 6 testing will be the true test.

## Real-app eval: a production vibecoded app (2026-11-17; app identity withheld at the owner's request)

A real vibecoded app (a generator-built production app, gitignored, never product code of this project — identity withheld) was scanned live via a stdio MCP-client driver. It surfaced **two analyzer convention gaps, both fixed with locked regression fixtures**:

1. **Serverless catch-all routes were invisible route sources.** The app's entire backend is a single catch-all serverless route — the analyzer only knew Next routers, so all 29 of its API fetches fired `missing-endpoint` as FPs. Fix: framework-agnostic `api/**/*.ts` route extraction with catch-all matching (29 → 0).
2. **Platform-injected env vars.** Bare platform flags and generator-injected names all fired `undefined-env` as FPs. Fix: allowlist extended.

Final scan (0.7 s, 330 files): **29 issues — 28 verified true, 1 false positive** (corrected 2026-11-20 on re-inspection; the earlier "every one verified true" claim was wrong for the missing-submit-guard finding):

| Rule | Count | Verdict |
|---|---|---|
| dead-handler | 14 | ✅ all TRUE — generator-emitted action buttons with literally no onClick (spot-checked in source); the exact bug class the product exists for. Three are unwired inputs |
| undefined-env | 14 | ✅ all TRUE — app-specific ops flags genuinely absent from every .env file |
| missing-submit-guard | 1 | ❌ **FALSE POSITIVE** — a DELETE write whose guard EXISTS but uses a naming convention the heuristic's pending-signal words don't match. Open item: the rule needs naming-convention breadth (or app-map-level handler analysis) |

**Real-repo FP rate: 1 of 29 ≈ 3.4%** after the convention fixes (the third consecutive external validation to land near zero — after vercel/commerce, shadcn/taxonomy, supabase user-management in the phase-4 pre-work — but not zero, and the earlier zero claim is corrected above). **The app is now a tuning fixture** (like Messy Mart): the analyzer fixes it forced (serverless route extraction, platform env allowlist) landed in `08f64dc`, so it no longer counts as unseen. **Plain Pages (`held-out-app-2/`) remains untouched for Phase 6.**

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
- **3B scout on novel UIs:** the quality comparison is on CreditCraft (100% coverage, comparable findings). A 3B is weaker on genuinely unfamiliar UIs; the phase-3 fail-closed validation is the protection, but real-repo Phase 6 testing is the real test.

## Contender B: Claude Code writing its own Playwright script (BENCHMARK.md §1)

**Method.** Careful-QA sweep in one script (`spikes/src/contender-b.ts`): anonymous crawl of all 7 routes clicking every control with console/pageerror/network capture; logged-in garbage-input passes (10k-char and single-word name, emoji/RTL search); double-click on both money buttons; 10-session concurrent coupon redemption; success-page reload/back; login edge cases. Fresh DB, prod build.

**Measured: 623 s wall (≈10 min) from prompt to report** — of which ~7 min was waiting for another job to release the machine; the sweep itself runs in ~90 s. Caveats recorded honestly: the environment was warm (app built and running, DB seeded, Playwright installed — a cold start adds minutes), the author has deep prior knowledge of this app (it is the benchmark fixture of the tool this session built), and the app's source comments literally label their planted bugs (`// Planted bug #6…`) — any code-reading contender reads the ground truth for free. Both biases favor Contender B; the numbers below still show what a scripted sweep catches and what it structurally misses.

**Bugs found (8, all dynamically verified):**

| # | Bug | Repro |
|---|---|---|
| 1 | Profile page **crashes** (`TypeError: reading '0'`) on a name with no space — including 10k-char garbage *and* the ordinary single-word name | log in → /profile → type `singleword` |
| 2 | Search **500** on emoji/RTL input | home → search → paste `🎉 مرحبا` → Search |
| 3 | Promo button hits a **missing endpoint** (404 `/api/promo`) | home → click the promo button |
| 4 | Double-click **Buy credits double-charges**: balance 500 → 1000 | log in → /credits → double-click Buy credits |
| 5 | Double-click **Redeem coupon double-applies** the single-use coupon | checkout → WELCOME10 → double-click Redeem |
| 6 | **Reloading /checkout/success crashes** (`TypeError: reading 'id'`); Back from the reloaded page throws again | place an order → reload the success page |
| 7 | **"Save profile" does nothing** — verified manually: no URL change, no network, no error | log in → /profile → click Save profile |
| 8 | **GET /api/orders → 500 on every visit** (network-observed; source shows the client swallows the error and the spinner never resolves) | log in → /orders → network tab |

**Not found (5):** the newsletter form being unwired (#2 — an empty-field click is blocked by HTML validation and the script never filled it); the concurrent coupon race (#5 — the script's own double-click test spent the coupon before the concurrency section ran, a test-ordering mistake); missing RLS (#9) and the unsigned Stripe webhook (#10) — invisible to a browser-only script by construction; and the app-destroying button (#12, correctly skipped on purpose). The dead-control heuristic produced 16 raw candidates; manual triage kept 1 real one (Save profile) — the rest were same-page nav links, the aria-hidden decorative ✦, and validation-blocked submits.

**The benchmark's expected table row confirmed (BENCHMARK.md §4):** a scripted sweep catches the crash/500/double-submit classes when prompted for them, finds ~2/3 of the dynamic bugs, structurally misses static-safety and race classes, and needs ~10 warm minutes. What UIpocalypse adds over it: the race it missed by ordering, the coverage accounting, 50 simultaneous users, and the same report in one call without writing any code.
