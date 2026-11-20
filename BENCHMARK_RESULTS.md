# UIpocalypse: Benchmark Results (Phase 6)

**Status:** Complete · **Date:** 2026-11-20 · **Scope:** BENCHMARK.md (three-way contender comparison, held-out fixture, blind agent-built apps, history-based detection)

**Models used:** planner `@cf/zai-org/glm-5.3` (1.4 s/call), scout `@cf/meta/llama-3.2-3b-instruct` (0.3 s/call) via Cloudflare Workers AI. Both previous models (`kimi-k2.7-code`, `llama-3.1-8b`) were deprecated (HTTP 410) on 2026-11-20 mid-benchmark; fallback chains are now supported.

---

## Generalization results (lead with these — the CreditCraft 11/11 is a tuning-fixture number)

### Plain Pages (held-out fixture, untouched until this run)

2 of 3 planted dead controls detected (66.7%), **0 false positives**. Found "Save note" (the subtle handler-runs-but-does-nothing case, 192 obs) and "Clear filters" (empty onclick, 98 obs). **Missed** "Reset preferences" (no handler, below the fold — the swarm's 3-state graph didn't reach that section of the page in 60 s). No tuning performed after this run. [benchmarks/plain-pages/result.md]

### Blind agent-built apps (4 apps built from plain product prompts by fresh subagents)

**Held-out pair** (frozen before any run; verdicts left blank for user classification):

| App | Stack | Swarm findings | Manual bugs missed by the tool |
|---|---|---|---|
| Notes app | Vite + React + Supabase Auth | 2 low-severity inconsistent_feedback (Sign in / Sign up — validation-blocked class) | **None found** — sign-up, notes CRUD, search, RLS all work correctly |
| Recipe organizer | SvelteKit + TypeScript | 1 low-severity inconsistent_feedback (Save recipe — same class); 51 cancellation artifacts correctly filtered | **None found** — recipe CRUD, shopping list, filtering, localStorage all work correctly |

**Tuning pair** (used to adjust the detector before the frozen pair):

| App | Swarm findings | Tuning action |
|---|---|---|
| Habit tracker | 1 inconsistent_feedback ("Sign up"), 0 dead_clicks, 26 suppressed repeats | none needed |
| Invoice tool | 3 dead_click on date/number input fields, 8 inconsistent_feedback, 111 raw failed_request (all correctly classified as artifacts) | **date/time inputs added to isTextLike** — native-UI inputs (calendar/stepper) no longer read as dead clicks (commit fadcdb5) |

The inconsistent_feedback clusters across all 4 apps are the same class: form-submit buttons that produce feedback when fields are valid but nothing when browser validation blocks. Low severity, low confidence, ranked low by design.

### GrowthSent history-based detection (tuning fixture — NOT held-out)

**0 of 1 completed run detected the later-fixed bug — and diff-verified archaeology shows 0 of 5 picks were valid local measurements at all.** The five fixed bugs are platform/provider-bound classes (Vercel-runtime named-import breakage ×2, Google OAuth account-linking, Vercel edge caching, and one mis-picked crawler-outbound-auth commit that was never UI-visible). The bugs GrowthSent fixed are dominated by deployment-specific and infrastructure-level issues — neither class can reproduce on a local dev server, and the tool's genuinely browser-visible GrowthSent findings (14 dead Figma-Make buttons) remain unfixed at HEAD, so no fix-point exists for them. [benchmarks/growthsent-history/result.md]

---

## CreditCraft contender comparison (tuning fixture — analyzer rules were tuned on this app in phases 2–5)

**Contender A (Playwright MCP) was DROPPED:** no Playwright MCP server is available in this harness's subagent tool surface. **This is a two-way comparison** (blind script vs UIpocalypse), not the three-way comparison BENCHMARK.md designed.

**Blindness verification:** each B run started from a fresh subagent session (4 distinct session IDs) with only the prompt text. The stripped CreditCraft copy had zero bug-labeled comments. Each run found different bugs (B2: name crash; B3: price tampering; B1: search matrix) — consistent with independent exploration, not a shared bug list. Limitation: subagents share the filesystem; the prompt-level restriction is trust, not enforcement.

| Metric | B: blind agent scripts (3 runs) | C: UIpocalypse (3 runs) |
|---|---|---|
| Planted bugs detected (median) | **7 of 11** (63.6%) | **11 of 11** (100%) |
| Range | 7–8 | 11–11 |
| Time per run (median) | ~14 min (range 12–31) | **~2.5 min** (range 147–152 s) |
| Decoy FPs | 0 across all runs | ~1/run (Notification preferences, known class) |
| Destructive actions | 1 (B1 deleted Bob's account) | **0** every run |
| Race bug (#5) | never tested concurrently | fired 20/20 every run |
| Garbage-name crash (#6) | found by B2 only | found every run |
| Static-only bugs (#9, #10) | never found | found every run (static scan) |
| Coverage (runtime graph) | not measured | **100%** every run |
| Coverage (app map) | not measured | 11/30 (37%) — honest: nav links and inputs the runtime doesn't classify as performed |
| LLM calls per run | n/a (subagent, uncounted) | **~40 total** (1 planner + 37 scout + 1 reviewer + ~1 escalation) |
| Dropped bugs | A dropped — no Playwright MCP available | — |

**Where UIpocalypse loses:** it cannot find bugs a human would discover through novel reasoning (B3 found price tampering and session-revocation failure — both real, neither detected by the swarm). A scripted agent writes more creative tests (B2's 150-credential login sweep, B3's null-byte crash test). And UIpocalypse's blind spots on below-the-fold content (Plain Pages) and app-map coverage (37%) are honest limitations.

**LLM call accounting (correction):** the originally reported "40 planner + 40 scout" was a SHARED counter read twice, not 80 calls. Real breakdown per first-run: 1 planner + 37 scout + 1 reviewer + ~1 escalation = ~40 total. The PRD's "≤ 20 LLM calls per rerun" target: the warm-rerun measurement is 40 (all escalations) — **the PRD rerun LLM metric is FAILED**. Recorded as-is; no redefinition. [benchmarks/contenders/C-llm-accounting.md]

---

## BENCHMARK.md §6 gates (applied exactly as written)

| Gate | Threshold | Measured | Pass/Fail |
|---|---|---|---|
| Planted-bug detection (CreditCraft) | ≥ 80% (9 of 11) | **11 of 11 (100%)** | ✅ PASS |
| False-positive rate | ≤ 20% (hard stop at 33%) | Cluster-level on CreditCraft: 2 of 16 ≈ 12.5% | ✅ PASS |
| Rerun time | ≤ 90 s | 71–72 s (3 current-config runs) | ✅ PASS |
| LLM calls per rerun | ≤ 20 | **40** (warm rerun, all escalations) | ❌ **FAIL** |
| Real bugs per real repo (median) | ≥ 3 | GrowthSent static scan: 28 true + 1 FP of 29; blind apps: sparse (both clean apps had few bugs) | ✅ PASS (28 verified true on GrowthSent) |
| Safety | 0 destructive clicks without opt-in | 0 across all UIpocalypse runs | ✅ PASS |

**5 of 6 gates PASS. The rerun LLM-calls gate FAILS at 40 > 20.** The cause is swarm escalations on a fully-explored graph (each stalled agent escalates once, up to 50 agents, capped at 40). Fix options (saturation-aware escalation skipping, or counting scout-only calls for the metric) are recorded but NOT implemented — this is a failed metric, reported as-is.

---

## What this does not show

- **Small samples.** 3 runs per contender (not 10); 1 Plain Pages run; 2 held-out blind apps; 1 completed history run. Every percentage here has a wide confidence interval.
- **One machine, one model configuration.** All runs on a 12-core Linux box with glm-5.3 + llama-3.2-3b. Different models, different hardware, different network conditions will shift every number.
- **Authorship bias.** CreditCraft was built by this project, its bugs were tuned against across 5 phases, and the analyzer rules were developed on it. The 11/11 is a tuning-fixture result, not a generalization claim.
- **The A-vs-B comparison never happened.** Playwright MCP is not available in this harness; the benchmark designed a three-way comparison and delivered a two-way one.
- **GrowthSent's history bugs are the wrong shape.** Deployment-specific and infrastructure-level bugs dominate its fix history — a browser-based swarm running locally cannot see them. The 0-of-1 history detection says more about the bug distribution than the tool.
- **Below-the-fold exploration is weak.** Plain Pages showed the swarm missing content that requires scrolling. This is a known limitation.
- **App-map coverage needs work.** 11/30 (37%) on CreditCraft — the static analyzer's element list includes elements the runtime graph doesn't classify as "performed actions." The metric is honest but the denominator is fuzzy.
- **Environment instability.** Server restarts, clock jumps, model deprecations, and Docker failures disrupted multiple stages. Results were recorded as-invalid when this happened, but the disruption itself reduces confidence.

---

## Raw data

- `benchmarks/contenders/B1-score.md`, `B2-score.md`, `B3-score.md` — blind run scores
- `benchmarks/contenders/C1.json`, `C2.json`, `C3.json` — UIpocalypse raw JSON
- `benchmarks/contenders/A-dropped.md` — why A was dropped
- `benchmarks/contenders/C-llm-accounting.md` — corrected LLM call breakdown
- `benchmarks/contenders/blind-verification.md` — blindness audit
- `benchmarks/plain-pages/result.md` + `run.json` — held-out fixture result
- `benchmarks/blind-apps/held-out-findings.md` — held-out pair findings (verdict column blank)
- `benchmarks/growthsent-history/picks.md` + `result.md` — history-based detection
- `benchmarks/creditcraft-stripped/` — the stripped benchmark copy (regenerate with make-stripped.mjs)
