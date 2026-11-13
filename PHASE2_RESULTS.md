# UIpocalypse: Phase 2 Results

**Status:** Complete · **Date:** 2026-11-13 · **Scope:** IMPLEMENTATION_PLAN.md Phase 2 (Code Analyzer + real-Supabase swap + held-out hash fixture)

## Verdict

All Phase 2 deliverables met, and two of the review-driven gates were cleared early:

| Item | Gate | Result |
|---|---|---|
| `scan_codebase` returns real issues on the sample app | ≤ 3 s (FR-A5) | **303 ms** on the 35-file sample app, all planted static bugs found ✅ |
| Static rules (first 10, TRD §8) | fixture positives + negatives | 10/10 rules, both directions covered ✅ |
| Real-Supabase swap; race detector proven | bugs #4/#5 re-verified on Postgres | race reproduces on real DB ✅ |
| Held-out hash validation (Phase 3 gate, cleared early) | ≥ 90% / ≥ 95% on a second app, no re-tuning | see below |

## Code Analyzer

- **Stack detection** (FR-A1): Next.js app/pages router, Vite+React, Supabase — from package.json + directory layout.
- **Extraction** (FR-A2): routes, JSX interactive elements + handler emptiness, fetch calls with methods, env-var reads, Supabase tables, import graph + `use client` roots, migrations. Syntactic-only (no type-check) → fast on big repos.
- **App map** (FR-A3): served back from the `scan_codebase` MCP tool with every scan.
- **Rules** (FR-A4, first 10): dead-handler, unwired-form, missing-endpoint, missing-rls, service-key-in-client, undefined-env, unverified-stripe-webhook, no-error-state, no-loading-state, exposed-secret.

### Sample-app scan (ground truth per `sample-app/README.md`)

Detected exactly the planted static bugs: **#1** dead-handler ("Save profile", and nothing else — decoy clean), **#2** unwired-form (newsletter), **#3** missing-endpoint (`/api/promo`), **#9** missing-rls (`profiles` only — RLS was added to the other tables so the fixture matches the benchmark ground truth), **#10** unverified-stripe-webhook, plus the documented `undefined-env` (ORDERS_API_KEY) and `missing-submit-guard` (Buy credits) fixtures.

True extras found (all verifiable defects, none on decoys): no-loading-state on Checkout ×2, LoginForm, SettingsPanel (double-click "Delete forever" double-fires the delete POST); no-error-state on Recommendations (try/finally without catch) and SettingsPanel (bare await). False-positive gates: **exposed-secret 0, service-key-in-client 0** on the sample app.

### Analyzer bugs found by its own tests (why tests-first matters)

1. SQL comments can contain the very statement being checked — the `profiles` RLS bug was hidden by the explanatory comment mentioning `alter table profiles enable row level security`. Comments are now stripped before matching.
2. `JsxElement` keeps tag names/attributes on its *opening element* — naive walks report every button as outside every form.
3. A rule name in a fixture *comment* suppressed the rule (the word "loading" matched the file-text scan).
4. `service-key-in-client` initially flagged any non-route file; it now computes **client-bundle reachability** (BFS from `use client` entries over project imports) so server-only stores using the service-role key are not false positives.

## Real-Supabase swap (race detector no longer unproven)

The Phase 0 in-memory mock was replaced with real local Supabase (`supabase start -x logflare,vector`, Docker). The planted bugs survived the swap, and the real database made bug #4 *worse* (more realistic):

- **Bug #4 (double-submit)**: a double-click produced **2 transaction rows AND a lost update** — alice's balance went 500 → **1000**, not 1500. Two concurrent read-modify-write round trips dropped one increment. The mock could only ever show the duplicate row; Postgres showed duplicate *and* lost money.
- **Bug #5 (coupon race)**: 20 concurrent redeems → **2 succeeded** on a single-use coupon (genuine TOCTOU window between the REST read and the write; narrower than the mock's artificial 90 ms window, as expected). `coupon_redemptions` = 2 rows vs. the invariant's allowed 1.

The `invariants` config design (TRD §7 SQL checks) catches exactly this shape.

## Held-out hash validation (Messy Mart)

A second, structurally different app — **Messy Mart** (`held-out-app/`): Vite + React Router SPA (vs the Next.js sample), divs-as-buttons, emoji-heavy labels, native `<dialog>`, fake loading state, dynamic `/item/:id`. The normalization pipeline (`spikes/src/lib/statehash.ts`) was **not modified for this app**; it is kept as a permanent fixture.

**The first held-out run failed — which is exactly what held-out validation is for.** Three findings:

1. **Test-design bug (mine):** `home1` was compared against `homeGadgets` as "different screens" — but home1 *is* the gadgets home (default category). They must collide.
2. **Real extractor bug:** the DOM extractor marked any `<dialog>` tag as "dialog open" — closed dialogs carry no `open` attribute in DOMSnapshot. Fixed in the shared pipeline (checks `open`); benefits both apps.
3. **Bucket-boundary semantics surfaced:** "Show more" appended cards *containing links*, crossing the 2-5 → 6+ count bucket, which separates hashes. Per TRD §4 that is **intended** behavior (list-size volatility is bounded to at most one new state per bucket tier) — so the fixture's extras were made text-only to test what the pair was meant to test (non-interactive content growth), and the boundary behavior is recorded here as a known property.

After the extractor fix and pair corrections (no changes to masking/bucketing/hashing):

| Method | Same-screen collision | Diff-screen separation |
|---|---|---|
| **ariaSnapshot** | **100%** (6/6) | **100%** (15/15) |
| DOMSnapshot | **100%** (6/6) | **100%** (15/15) |

Same-screen pairs included: reload stability, category switch with different item lists, dynamic-route detail pages (ids 101 vs 202), user switcher, mid-loading captures, and non-interactive list growth. Different-screen set: home vs item detail vs about vs settings vs settings-loading vs dialog-open.

**The Phase 3 hash gate is cleared early.** Raw numbers: `spikes/results/s2-heldout.json` (and `s2-state-hash.json` for the tuned sample app, still 100%/100% after the shared-pipeline refactor).
