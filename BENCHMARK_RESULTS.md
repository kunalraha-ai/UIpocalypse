# UIpocalypse: Benchmark Results (Phase 6)

**Status:** Complete · **Date:** 2026-11-20 (cleanup pass 2026-11-21) · **Scope:** BENCHMARK.md (contender comparison, held-out fixture, blind agent-built apps, history-based detection)

**Models used:** planner `@cf/zai-org/glm-5.3` (1.4 s/call), scout `@cf/meta/llama-3.2-3b-instruct` (0.3 s/call) via Cloudflare Workers AI. Both previous models (`kimi-k2.7-code`, `llama-3.1-8b`) were deprecated (HTTP 410) on 2026-11-20 mid-benchmark; fallback chains are now supported.

---

## Generalization results (held-out and never-tuned apps — read these first)

### Plain Pages (held-out fixture, untouched until this run)

**2 of 2 REACHABLE planted dead controls detected. 0 false positives. 1 control was skipped by safety policy, not tested.** Found "Save note" (the subtle handler-runs-but-does-nothing case, 192 obs) and "Clear filters" (empty onclick, 98 obs). The third planted control, "Reset preferences", was never clicked: its label matches the Safety Guard's destructive-word regex (`reset`), so every attempt was refused. That is a coverage limitation of the safety-first design — dead buttons labeled reset/delete/remove are invisible to the swarm without opt-in — not a detector miss. (At run time this was misdiagnosed as "below the fold"; disproven 2026-11-21 — the fixture has no lazy rendering, and the runtime's `isVisible` doesn't check viewport position. Proof and correction: [benchmarks/plain-pages/result.md].)

**Coverage correction (skip-visibility fix, 2026-11-21):** the run recorded 100% graph coverage because the two Guard-skipped actions ("Reset preferences", "Delete account") were silently dropped from the denominator. Recomputed: **87.5% (14/16)** — 14 reached + 2 skipped-by-policy = 16 discovered. Old value: 100%. The fix (commit 9c3e2c8) makes every future run count skipped actions as unreached and list them in the report.

No tuning was performed on this app before or after the run.

### Blind agent-built apps — held-out pair (frozen before any run; verdicts left blank for user classification)

| App | Stack | Swarm findings | Manual bugs missed by the tool |
|---|---|---|---|
| Notes app | Vite + React + Supabase Auth | 2 low-severity inconsistent_feedback (Sign in / Sign up — validation-blocked class) | **None found** — sign-up, notes CRUD, search, RLS all work correctly |
| Recipe organizer | SvelteKit + TypeScript | 1 low-severity inconsistent_feedback (Save recipe — same class); 51 cancellation artifacts correctly filtered | **None found** — recipe CRUD, shopping list, filtering, localStorage all work correctly |

Both apps were well-built and contained no real bugs — so this pair proves the tool does not hallucinate problems in a clean app (0 false positives), but it cannot prove detection: there was nothing to detect. A clean-app check is a necessary, weak signal.

**Tuning pair** (used to adjust the detector before the frozen pair; not generalization evidence):

| App | Swarm findings | Tuning action |
|---|---|---|
| Habit tracker | 1 inconsistent_feedback ("Sign up"), 0 dead_clicks, 26 suppressed repeats | none needed |
| Invoice tool | 3 dead_click on date/number input fields, 8 inconsistent_feedback, 111 raw failed_request (all correctly classified as artifacts) | **date/time inputs added to isTextLike** — native-UI inputs (calendar/stepper) no longer read as dead clicks (commit fadcdb5) |

The inconsistent_feedback clusters across all 4 apps are the same class: form-submit buttons that produce feedback when fields are valid but nothing when browser validation blocks. Low severity, low confidence, ranked low by design.

### GrowthSent history-based detection (analyzer tuning fixture; history methodology new)

**0 of 1 completed runs detected the later-fixed bug — and diff-verified archaeology shows 0 of 5 picks were valid local measurements at all.**

| Stage | Count |
|---|---|
| Commits picked (before running) | 5 |
| Pre-fix states that installed and booted | 3 |
| Swarm runs completed | 1 |
| Swarm runs interrupted (server restart) | 1 |
| Booted but not swarmed (bug not locally detectable) | 1 |
| Not attempted (Vercel-specific / never tried) | 2 |
| Unrunnable locally by design (deployment-specific) | 2 of 5 |
| Wrong shape for a browser swarm (infrastructure-level) | 1 of 5 |
| Potentially browser-visible | 2 of 5 — one interrupted, one never attempted |

The five fixed bugs are platform/provider-bound classes (Vercel-runtime named-import breakage ×2, Google OAuth account-linking, Vercel edge caching, and one mis-picked crawler-outbound-auth commit that was never UI-visible). Neither class can reproduce on a local dev server, and the tool's genuinely browser-visible GrowthSent findings (14 dead Figma-Make buttons) remain unfixed at HEAD, so no fix-point exists for them. [benchmarks/growthsent-history/result.md]

---

## CreditCraft contender comparison (TUNING FIXTURE — analyzer rules were tuned on this app in phases 2–5)

**Contender A (Playwright MCP) was DROPPED:** no Playwright MCP server is available in this harness's subagent tool surface. **This is a two-way comparison** (blind script vs UIpocalypse), not the three-way comparison BENCHMARK.md designed.

**Blindness verification:** each B run started from a fresh subagent session (4 distinct session IDs) with only the prompt text. The stripped CreditCraft copy had zero bug-labeled comments. Each run found different bugs (B2: name crash; B3: price tampering; B1: search matrix) — consistent with independent exploration, not a shared bug list. Limitation: subagents share the filesystem; the prompt-level restriction is trust, not enforcement.

| Metric | B: blind agent scripts (3 runs) | C: UIpocalypse (3 runs) |
|---|---|---|
| Planted bugs detected (median) | **7 of 11** (63.6%) | **11 of 11** (100%) pre-fix; **10 of 11** (90.9%) post-fix |
| Range | 7–8 | 10–11 |
| Time per run (median) | ~14 min (range 12–31) | **~2.5 min** (range 147–152 s first-run) |
| Decoy FPs | 0 across all runs | ~1/run (Notification preferences, known class) |
| Destructive actions | 1 (B1 deleted Bob's account) | **0** every run |
| Race bug (#5) | never tested concurrently | fired 20/20 every run |
| Garbage-name crash (#6) | found by B2 only | found every run |
| Static-only bugs (#9, #10) | never found | found every run (static scan) |
| Coverage (runtime graph) | not measured | recorded as 100% every run pre-fix (skipped actions silently dropped from the denominator); **recomputed with skip-visibility (2026-11-21): 95% / 94% / 95%** across the three first-runs of the valid gate execution, with the 2 Guard-skipped actions ("Email" — external-class, "Delete account" — destructive-class) listed and counted as unreached |
| Coverage (app map) | not measured | 11/30 (37%) — honest: nav links and inputs the runtime doesn't classify as performed; unchanged by the skip-visibility fix (that figure already counted skipped actions as unreached) |
| LLM calls per run | n/a (subagent, uncounted) | **~40 total** (1 planner + 37 scout + 1 reviewer + ~1 escalation) |

**Where UIpocalypse loses:** it cannot find bugs a human would discover through novel reasoning (B3 found price tampering and session-revocation failure — both real, neither detected by the swarm). A scripted agent writes more creative tests (B2's 150-credential login sweep, B3's null-byte crash test).

**LLM call accounting (correction):** the originally reported "40 planner + 40 scout" was a SHARED counter read twice, not 80 calls. Real breakdown per first-run: 1 planner + 37 scout + 1 reviewer + ~1 escalation = ~40 total. Post-escalation-fix rerun: **1 call** (the reviewer). [benchmarks/contenders/C-llm-accounting.md]

---

## BENCHMARK.md §6 gates (applied exactly as written)

| Gate | Threshold | Measured | Pass/Fail |
|---|---|---|---|
| Planted-bug detection (CreditCraft) | ≥ 80% (9 of 11) | **10 of 11 (90.9%)** post-fix (11/11 pre-fix) | ✅ PASS — tuning fixture |
| False-positive rate | ≤ 20% (hard stop at 33%) | Cluster-level on CreditCraft: ~1 of ~14 primary clusters | ✅ PASS — tuning fixture |
| Rerun time | ≤ 90 s | 85/86/93 s (exec 3) · 88 s (clean exec, 2026-11-21) | ✅ PASS 3-of-4 post-fix runs (one 3 s over — LLM reviewer latency variance) — tuning fixture |
| LLM calls per rerun | ≤ 20 | **1** (was 40 pre-fix; the escalation fix eliminated stall-path LLM calls) | ✅ PASS |
| Real bugs per real repo (median, on 10 test repos) | ≥ 3 | **Not evaluated.** No real vibecoded repos were tested: GrowthSent is a tuning fixture, and the held-out blind apps had no real bugs. | ❌ **FAIL (not evaluated — no real-repo sample)** |
| Safety | 0 destructive clicks without opt-in | 0 across all UIpocalypse runs | ✅ PASS |

**The bug #11 regression (reported plainly, updated 2026-11-21):** planted bug #11 (success-page revisit crash) was detected in 2 of 3 pre-fix gate runs, **0 of 3** in the first post-fix execution, and **1 of 3** in the clean post-fix execution (2026-11-21, 1 obs in first-run 3) — so 1 of 6 post-fix first-runs. The regression is real but not absolute: the escalation fix (stalled agents take policy actions instead of one LLM-directed restart) made the checkout→success→revisit trajectory rare rather than impossible. The exact pre-fix trajectory was never identified. The ≥80% gate passes at 10/11 = 90.9% and this specific detection is **intermittent** post-fix. Recorded in the README "Scope and limits"; no threshold was changed to hide it.

**Post-fix gate summary: the clean 2026-11-21 execution PASSES 8/8** (first-run median 162 s, rerun 88 s, rerun LLM 1). The 2026-11-20 execution 3 failed on rerun time (93 s vs 90 s) and the collector-acceptance check — the latter because the old check asserted a 2–4 band on RAW duplicate-request counts, which vary with app state (identical seeds, DB reset, and plan still produced 16/13/34 — and now 26/38/19 — raw dupObs across executions). The collapse itself was correct in every run. The check was rewritten (test change only, commit c1eaca7) to assert on the collapsed result: no singleton duplicate clusters in first-runs, and invariant-confirmed duplicate_effect damage present — the clean execution passes it with dup_effect 2/2/2 and 0 singletons while raw dupObs ranged 19–38.

**Gate-scoring corrections (2026-11-20/21):**
- **"Real bugs per real repo ≥ 3"** — originally scored PASS on GrowthSent's 28 verified static findings. That was WRONG: GrowthSent is a tuning fixture and the gate demands real repos. No real vibecoded repos were tested. Marked FAIL (not evaluated).
- **"Planted-bug detection ≥ 80%"** — CreditCraft is a tuning fixture; 10/11 post-fix passes, 11/11 pre-fix. Not a generalization claim.
- **"False-positive rate ≤ 20%"** — measured on CreditCraft (tuning fixture). The held-out fixtures produced 0 FPs but had almost nothing to flag.
- **"Rerun time ≤ 90 s"** — tuning fixture; passes 2 of 3 post-fix runs.

---

## What this does not show

- **Small samples.** 3 runs per contender (not 10); 1 Plain Pages run; 2 held-out blind apps; 1 completed history run. Every percentage here has a wide confidence interval.
- **One machine, one model configuration.** All runs on a 12-core Linux box with glm-5.3 + llama-3.2-3b. Different models, hardware, and network conditions will shift every number.
- **Authorship bias.** CreditCraft was built by this project and its analyzer rules were tuned on it across 5 phases. The 11/11 (and post-fix 10/11) are tuning-fixture results, not generalization claims.
- **The A-vs-B comparison never happened.** Playwright MCP is not available in this harness; the benchmark designed a three-way comparison and delivered a two-way one.
- **GrowthSent's history bugs are the wrong shape.** Deployment-specific and infrastructure-level bugs dominate its fix history — a browser-based swarm running locally cannot see them. The 0-of-1 history detection says more about the bug distribution than the tool.
- **Safety-skipped controls are untestable without opt-in.** Any control whose label matches delete/remove/reset/purge/destroy/unsubscribe/deactivate is never clicked — a dead button among them is invisible (the Plain Pages case). The report now lists these explicitly; opt in only against a safe test copy.
- **No scrolling.** The runtime never scrolls; controls that only render when scrolled into view (lazy DOM, IntersectionObserver) are never enumerated. Plainly-present below-the-fold elements ARE enumerated and clicked.
- **App-map coverage needs work.** 11/30 (37%) on CreditCraft — the static analyzer's element list includes elements the runtime graph doesn't classify as "performed actions." The metric is honest but the denominator is fuzzy.
- **Environment instability.** Server restarts, clock jumps, model deprecations, and Docker failures disrupted multiple stages. Results were recorded as-invalid when this happened, but the disruption itself reduces confidence. One full gate re-run attempt was invalid because the target app was down (recorded, not deleted).

---

## Raw data

- `benchmarks/contenders/B1-score.md`, `B2-score.md`, `B3-score.md` — blind run scores
- `benchmarks/contenders/C1.json`, `C2.json`, `C3.json` — UIpocalypse raw JSON
- `benchmarks/contenders/A-dropped.md` — why Contender A was dropped
- `benchmarks/contenders/C-llm-accounting.md` — corrected LLM call breakdown
- `benchmarks/contenders/blind-verification.md` — blindness audit
- `benchmarks/contenders/gate-rerun1-invalid.md` — the invalid post-fix attempt (app down)
- `benchmarks/plain-pages/result.md` + `run.json` — held-out fixture result (with the 2026-11-21 correction)
- `benchmarks/blind-apps/held-out-findings.md` — held-out pair findings (verdict column blank)
- `benchmarks/growthsent-history/picks.md` + `result.md` — history-based detection scope and results
- `benchmarks/creditcraft-stripped/` — the stripped benchmark copy (regenerate with make-stripped.mjs)
