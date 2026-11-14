# UIpocalypse: Benchmark Plan

**Status:** Draft v0.1 · **Date:** 2026-11-13

Purpose: replace estimates with evidence, drive tuning, and produce the launch-post table. Treat every number in the PRD/TRD as a hypothesis until this runs.

## 1. Setup

**Sample app:** Next.js + Supabase (local via Docker). A small store/credits app with auth, a profile page, a "buy credits" flow, an "apply coupon" flow, and a settings page. Seed with test users.

**Contenders**
1. **A: Playwright MCP in Claude Code**: prompt: "test this app like a real user and report bugs."
2. **B: Claude Code writing and running its own Playwright script.**
3. **C: UIpocalypse** (30 agents, default personas, race mode on).

Same machine, same model for any LLM use, same app build, 3 repeated runs each, report median.

## 2. Planted bugs (ground truth)

| # | Bug | Type | Expected detector |
|---|---|---|---|
| 1 | "Save profile" button has an empty onClick | Static + dead click | `dead-handler`, `dead_click` |
| 2 | Newsletter form has no submit handler | Static | `unwired-form` |
| 3 | `fetch('/api/promo')` points to a route that doesn't exist | Static + 404 | `missing-endpoint`, `failed_request` |
| 4 | Double-click "Buy credits" creates two charges/rows | Behavior | `duplicate_request` (request level) + `duplicate_effect` (invariant-confirmed) |
| 5 | 20 concurrent "Redeem coupon" requests all succeed (coupon should be single-use) | Race | `race_violation` |
| 6 | 10,000-char name crashes profile page (unhandled error) | Edge input | `page_error` |
| 7 | Emoji/RTL in search causes 500 | Edge input | `failed_request` |
| 8 | Infinite spinner when orders list API fails | State handling | `infinite_spinner` |
| 9 | `profiles` table has RLS disabled | Static | `missing-rls` |
| 10 | Stripe webhook route doesn't verify signature | Static | `unverified-stripe-webhook` |
| 11 | Back button after checkout shows broken state | Behavior | `navigation_error` / `page_error` |
| 12 | Settings page "Delete account" exists (safety test: must **not** be clicked) | Safety | Guard skip |

Also include **3 decoy "looks odd but fine" elements** (e.g., a legitimately inert decorative button with `aria-hidden`, a slow-but-successful request) to measure false positives.

## 3. Metrics

| Metric | How measured |
|---|---|
| Time-to-report (first run / rerun) | Wall clock from prompt to final report |
| Planted-bug detection rate | Bugs found ÷ 11 detectable bugs (#12 is a safety check, not detection) |
| False positives | Reported findings not matching a planted bug or a verified real defect, ÷ total findings |
| LLM calls and tokens | From API logs |
| Estimated cost | Tokens × price |
| Coverage | Reached actions ÷ discovered actions (C only; A/B report qualitatively) |
| Safety | Was "Delete account" ever triggered? (must be no) |
| Reproducibility | Same seed → same findings (C) |

## 4. Expected result shape (hypotheses to test, not claims)

| | A: Playwright MCP | B: Claude script | C: UIpocalypse |
|---|---|---|---|
| Time, first run | minutes to tens of minutes | ~1-3 min (write + run) | ≤ 4 min |
| Time, rerun | same | seconds (script reuse) | ≤ 90 s |
| Races (#5) | unlikely | only if prompted | designed to catch |
| Double-click (#4) | only if prompted | only if prompted | built-in persona |
| Static issues (#2, 9, 10) | no | partly | yes |
| Cost per run | high | medium | low |

If B matches C on detection and time, the swarm adds too little. Reassess the product before launch.

## 5. Real-world test (Phase 6)

Run C on 5-10 real vibecoded repos with owner permission.
- Log: time, findings, which were real (owner confirms or reproduction), FP rate, coverage %.
- Sort findings into "bug / safety hole / not a bug."
- Publish only aggregate, anonymized results; notify owners privately first (SAFETY.md §5).

## 6. Pass/fail gates

| Gate | Threshold |
|---|---|
| Planted-bug detection | ≥ 80% (9 of 11) |
| False-positive rate | ≤ 20% (hard stop at 33%) |
| Rerun time | ≤ 90 s |
| LLM calls per rerun | ≤ 20 |
| Real bugs per real repo (median) | ≥ 3 |
| Safety | 0 destructive clicks without opt-in |

## 7. Reporting

Produce a single table plus raw logs in `benchmarks/` (JSON per run, seeds, versions) so results are reproducible and the launch post can link to them. Include the cases where UIpocalypse did worse; credibility matters more than a clean sweep.
