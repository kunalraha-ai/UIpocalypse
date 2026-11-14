# UIpocalypse: Implementation Plan

**Status:** Draft v0.1 · **Date:** 2026-11-13 · **Assumes:** one developer, ~6-7 weeks to a public beta. Adjust if you have help.

The plan front-loads the riskiest assumptions (state hashing, swarm speed, false positives) so you can kill or reshape the project cheaply.

---

## Phase 0: De-risk spikes (Days 1-4)

**Goal:** replace guesses with measurements.

| Spike | Question | Output |
|---|---|---|
| S1: Sample app | Build a small Next.js + Supabase app with ~10 planted bugs (BENCHMARK.md) | `sample-app/` repo |
| S2: State hash | Does a normalized accessibility signature give stable hashes for the same screen and distinct ones for different screens? (`ariaSnapshot` vs `DOMSnapshot`) | Collision/separation numbers, chosen approach |
| S3: Context scale | One Chromium, 50 contexts, scripted random clicking: time per step, RAM, CPU | Measured numbers replacing TRD §9 estimates |
| S4: Dead-click detector | Can MutationObserver + network wrapping reliably flag dead clicks with low FP? | FP rate on sample app |

**Exit criteria (go/no-go):** 50 agents × 100 steps ≤ 2 min; hash separation ≥ 90%/95%; dead-click FP < 20%. Otherwise revisit the architecture before writing more code.

## Phase 1: Foundations (Week 1)

- Repo scaffold, TypeScript, lint, CI, Vitest, esbuild bundling
- MCP server skeleton with `scan_codebase` stub; stdio transport; config loader (zod)
- SQLite schema + data-access layer
- Safety Guard v0: host allow-list, prod-like refusal, rate limiter (SAFETY.md §3)
- Logging, run IDs, `.uipocalypse/` workspace layout

**Deliverable:** MCP server connectable from Claude Code that returns a stub scan.

## Phase 2: Code Analyzer (Week 2)

- Stack detection (Next.js app/pages, Vite+React, Supabase)
- ts-morph extraction: routes, elements, handlers, API calls, env vars, tables
- App map JSON schema
- First 10 static rules (dead-handler, unwired-form, missing-endpoint, missing-rls, service-key-in-client, undefined-env, unverified-stripe-webhook, no-error-state, no-loading-state, exposed-secret)
- Rule test fixtures
- **Swap the sample app's mock store for real local Supabase (Docker); re-verify planted bugs #4/#5 against real transactions, row locks and pooling. The race detector is unproven until this lands (Phase 0 was mock-only).**

**Deliverable:** `scan_codebase` returns real issues on the sample app in ≤ 3 s. Detects its planted static bugs.

## Phase 3: In-page runtime + single agent (Week 3)

- Injected runtime: action enumeration, state signature, event capture, `perform()`
- Detectors: console/page errors, failed requests, dead clicks, spinners
- State graph reads/writes
- One code-policy agent (Wanderer) walking the graph in one context
- Planner (LLM call #1) + Scouts (LLM, accessibility-text based)

**Deliverable:** one scout + one wanderer explore the sample app and write a graph; findings recorded with evidence.
**Gate (kill criteria check):** Does run 2 need ≥ 50% fewer LLM calls than run 1? **PASS (Phase 3): 25 → 5 calls = 80% reduction on the real sample app with a real LLM** (PHASE3_RESULTS.md).
**Gate (hash validity, before Phase 3 relies on the graph):** the state hash must also pass ≥ 90% collision / ≥ 95% separation on a **second, structurally different held-out app** (different framework, messier UI — not the app the normalization was tuned on). Keep that app as a permanent fixture. Phase 0's 100%/100% was measured on one app and may be overfit. **CLEARED in Phase 2:** Messy Mart (`held-out-app/`, Vite SPA) passed 100%/100% with no normalization changes — after the held-out run itself exposed and fixed a DOM-extractor dialog bug. See PHASE2_RESULTS.md.

## Phase 4: Swarm + personas + race mode (Week 4)

- Orchestrator: N contexts, budgets, watchdog, crash isolation, health probe
- Personas: Double-Clicker, Garbage Pasting, Abandoner, Race Runner
- Barrier-synchronized race mode + invariant checks (config SQL)
- Escalation path with global LLM cap
- Concurrency ramp and "app collapsed at N" reporting

**Deliverable:** 30-50 agent run on the sample app in ≤ 120 s (post-scouting; Phase 0 measured 109.7-118.0 s at 50 × 100 — the old ≤ 60 s target was ~2× off, see PHASE0_RESULTS.md); detects double-submit and race bugs.
**Gate: PASS (Phase 4)** — 50 agents at the 105 s watchdog (seven gate executions, every one ≤ 120 s: 105.0 / 105.0 / 96.4 / 105.0 / 105.5 / 105.2 / 105.3 s; final run 6/6 — one intermediate run failed on two detector/config bugs that the re-runs caught and fixed, and the first suppression design was reworked on review to stay run-scoped so regressions are never masked); `duplicate_request` + `duplicate_effect` (invariant-confirmed) on Buy credits, `race_violation` (20 fired → 14 redemptions of a single-use coupon, baseline-attributed), the #6 garbage-name `page_error` and #7 emoji-search 500 all detected live, 19/19 dead_clicks on the planted dead control, zero destructive clicks. See PHASE4_RESULTS.md.

## Phase 5: Collector, reviewer, report (Week 5)

Build in this order (review-directed; the fingerprint key is already decided in TRD §3.7 FR-C1):

1. **Collector and clustering** on the decided cluster key — the acceptance case is the gate run's 52 duplicate observations collapsing to one issue per flawed endpoint. The two classification rules land in the same step: a 401/400 on a route that exists in the app map is a *correct rejection* (downgrade), and `net::ERR_ABORTED` is a cancellation artifact (filter) — **then re-measure the FP rate over the clustered set** (Phase 4's 4-of-17 was pre-classifier and a projection afterwards; publish counts with the percentage — the denominators are small).
2. **Reviewer (LLM call #2)** → markdown/JSON report with fix prompts mapped to file/line through the app map; ranks `inconsistent_feedback` findings; coverage computation and unreached-action reasons.
3. **Planner-drafted invariants** (TRD FR-P1): `atMost` predicates drafted from the DB schema + app map, preflight-validated against a clean DB; `duplicate_request` remains the standalone signal for apps without a reachable DB.
4. **Screenshots on failure; Playwright traces for replay.**
5. **`diff_runs`** (fixed / new / still failing) — the regression loop the run-scoped suppression protects.
6. **Remaining static rules** (to ~15-20).
7. **`get_report`, `list_runs`, `verify_deployment_safety`** convenience tool.
8. **Timing record:** several full-pipeline first runs and reruns; publish medians + ranges for the PRD G1 numbers.

**Deliverable:** end-to-end "verify deployment safety" from Claude Code on the sample app.

## Phase 6: Benchmark + hardening (Week 6)

- Run BENCHMARK.md: UIpocalypse vs Playwright MCP vs Claude-written script on planted bugs; record time, detection rate, FP rate, tokens
- Tune detectors for FP; fix flaky behaviors
- Safety tests (guard refuses prod hosts, skips destructive actions)
- Run on **5-10 real vibecoded repos with owners' permission**; log real findings and FP
- Docs: README, quickstart, MCP config snippet, safety page

**Gate:** ≥ 80% planted-bug detection, ≤ 20% FP, ≥ 3 median real bugs per repo, rerun ≤ 90 s.

## Phase 7: Beta launch (Week 7)

- Publish npm package, license, `npx uipocalypse` quickstart
- Launch post using benchmark table: "I ran 50 chaotic bots on N vibecoded apps. Here's what broke." (aggregate/anonymized only; notify owners privately first)
- Demo video: one prompt → report
- Collect feedback channel (GitHub issues/Discord), telemetry opt-in only

## After beta (not scheduled)

- Auth/payments goal agents and test-mode helpers
- Network chaos, mobile/3G personas
- `data-testid` auto-injection (opt-in)
- Hosted dashboard/history, CI integration, badge
- Additional stacks (SvelteKit, Firebase, Nuxt)
- k6 handoff for true load tests
- Lightpanda fast pre-pass; UX-judgment LLM mode
- Swarm transport optimizations if the ~2-min capacity becomes a bottleneck: independent (non-lockstep) agent stepping, sharding across multiple Chromium processes

---

## Milestones at a glance

| Week | Milestone | Gate |
|---|---|---|
| 0 (Days 1-4) | Spikes done, real numbers | Go/no-go on speed + hashing |
| 1 | MCP + safety skeleton | |
| 2 | Real static scan | ≤ 3 s |
| 3 | Single agent + graph | Run-2 LLM calls ≤ 50% of run 1 |
| 4 | 50-agent swarm + races | ≤ 120 s swarm phase |
| 5 | Full report | End-to-end demo |
| 6 | Benchmark + real repos | ≥ 80% detection, ≤ 20% FP |
| 7 | Public beta | |

## Dependencies and resourcing

- Anthropic API key (or other LLM) for dev; budget ~$50-150 for development runs
- A machine with ≥ 8 cores / 16 GB for swarm tests
- 5-10 volunteer vibecoders for real-repo testing (recruit in Phase 4)
- Legal check: name/trademark, license choice (MIT/Apache-2.0), avoid AGPL code reuse

## Biggest schedule risks

1. State hashing needs more tuning than expected (add up to 1 week).
2. Auth flows in real apps block coverage (scope: user-supplied storage state in v1).
3. FP tuning drags on (cap the detector set at MVP and measure).
4. Target apps collapse under 50 sessions, so concurrency ramp and honest reporting matter.
