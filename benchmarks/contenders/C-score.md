# Contender C — UIpocalypse verify_deployment_safety, 3 runs on stripped CreditCraft (:3124)
# Date: 2026-11-20, default config (30 agents, 60 s budget, glm-5.3 + llama-3.2-3b)
# Each run: fresh DB reset, same pipeline (static scan → plan → scouts → swarm → collect → review)

## Scoring against the 11 detectable planted bugs

The pipeline produces TWO layers: 19 static-scan issues (identical across runs) + dynamic swarm clusters (varies by run). A planted bug counts as found if EITHER layer flags it.

| Planted bug | Static? | C1 dynamic? | C2 dynamic? | C3 dynamic? | Found in all 3? |
|---|---|---|---|---|---|
| #1 "Save profile" dead click | ✅ dead-handler | ✅ act:Save profile | ✅ act:Save profile | ✅ act:Save profile | ✅ |
| #2 Newsletter form unwired | ✅ unwired-form | — (GET nav is not a detector trigger) | — | — | ✅ (static) |
| #3 `/api/promo` → 404 | ✅ missing-endpoint | ✅ ep:…promo:404 | ✅ | ✅ | ✅ |
| #4 Double-submit "Buy credits" | ✅ missing-submit-guard + no-loading-state | ✅ dup:table:transactions (effect) | ❌ | ✅ dup:table:transactions | ✅ 2 of 3 (effect-level; request-level dup:/api/credits/buy absent at 30 agents / 60 s) |
| #5 Concurrent coupon race | — | ✅ race_violation (dup:table:coupon_redemptions) | ✅ | ✅ | ✅ |
| #6 Garbage-name crash | — | ✅ ep:/profile:page:TypeError | ✅ | ✅ | ✅ |
| #7 Emoji/RTL search → 500 | — | ✅ ep:/api/search:req:500 | ✅ | ✅ | ✅ |
| #8 Orders API 500 | ✅ undefined-env (ORDERS_API_KEY) | ✅ ep:/api/orders:req:500 | ✅ | ✅ | ✅ |
| #9 Missing RLS | ✅ missing-rls | — (invisible dynamically) | — | — | ✅ (static) |
| #10 Unverified Stripe webhook | ✅ unverified-stripe-webhook | — (invisible dynamically) | — | — | ✅ (static) |
| #11 Success-page revisit crash | — | ✅ ep:/checkout/success:page:TypeError | ✅ | ✅ | ✅ |

**Detection: 11 of 11 (100%)** across static + dynamic layers, in every run.

## Per-run numbers

| Metric | C1 | C2 | C3 |
|---|---|---|---|
| Total wall (scan+plan+scouts+swarm+report) | 151.4 s | 152.0 s | 147.5 s |
| Static issues | 19 | 19 | 19 |
| LLM calls (planner + scout) | 40+40 | 40+40 | 40+40 |
| Coverage (runtime graph) | 107/107 (100%) | 101/101 (100%) | 101/101 (100%) |
| Coverage (app map) | 11/30 (37%) | 11/30 (37%) | 11/30 (37%) |
| Finding clusters | 23 | 21 | 24 |
| Correct rejections | 3 | 3 | 3 |
| Cancellation artifacts | 8 | 8 | 8 |
| Race fired | 20 | 20 | 20 |
| duplicate_effect confirmations | 2 | 1 | 2 |
| Destructive actions | 0 | 0 | 0 |

## False-positive analysis (finding clusters only, excluding corroborating console_error)

Non-planted, non-decoy finding clusters across the 3 runs:
- `act:Notification preferences` (C1, C2) — the known idempotent-repeat FP (SettingsPanel's "Nothing to see here." message); low-confidence `inconsistent_feedback` class, ranked low
- `ep:/checkout:page:Uncaught TypeError (reading 'id')` — the /checkout variant of the success-page crash (bug #11's neighbor; the crash fires on /checkout too when revisited, which is a true observation)
- Console_error clusters — corroborating signals for the 500s/404s/401s, not standalone findings

**Effective FP clusters per run: ~1 (Notification preferences), i.e., 1 of ~12-14 primary finding clusters ≈ 7-8%.**

The `coverage (app map)` figure of 11/30 (37%) is honest: the static analyzer sees 30 interactive elements in the code; the swarm's runtime graph matched 11 of them (the rest are nav links, form inputs, and decorative elements the runtime doesn't classify as "performed actions" — this metric needs work; it is NOT the same as the graph coverage of 100%).

## Raw JSON

See C1.json, C2.json, C3.json in this directory.
