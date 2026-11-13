# UIpocalypse: Phase 0 Results

**Status:** Complete · **Date:** 2026-11-13 · **Scope:** IMPLEMENTATION_PLAN.md Phase 0 (S1–S4 spikes + go/no-go)

## Verdict: **GO** — all three exit criteria pass

| Exit criterion (IMPLEMENTATION_PLAN.md) | Gate | Measured | Result |
|---|---|---|---|
| 50 agents × 100 steps in one Chromium | ≤ 2 min | **109.7 s** (3 runs: 109.7 / 114.6 / 118.0 s — the gate has < 10% headroom) | ✅ PASS |
| State-hash separation (same-screen collide / diff-screen separate) | ≥ 90% / ≥ 95% | **100% / 100%** (ariaSnapshot) | ✅ PASS |
| Dead-click false-positive rate | < 20% | **0%** (1 TP, 0 FP) after one detector fix | ✅ PASS |

Recommendation: proceed to Phase 1 (foundations) with **ariaSnapshot** as the state-extraction method and the measured numbers below replacing the TRD §9 estimates.

---

## Environment

| | |
|---|---|
| Machine | 12 cores, 15 GB RAM, Linux |
| Node | v22.23.1, npm 10.9.8 |
| Target app | Next.js 16.4.6 (App Router, React 19), production build, port 3123 |
| Browser | Playwright 1.65.0, bundled Chromium 1254 (headless), one process for all contexts |

## S1 — Sample app (`sample-app/`)

CreditCraft: store/credits app with auth, profile, buy-credits, coupon/checkout, orders, settings — **12 planted bugs + 3 decoys** per BENCHMARK.md §2, documented in `sample-app/README.md`.

**Deviation from the plan:** the Docker daemon was not running in this environment, so a local Supabase stack was not available. The app runs against an **in-memory mock of the data layer** (`sample-app/lib/store.ts`) with realistic latency (40–80 ms round trips) and real race windows. The Supabase artifacts are kept for the static rules (`supabase/migrations/0001_init.sql` with the planted missing-RLS bug, `supabase/config.toml`, `lib/supabase.ts`). Swapping in real Supabase later only touches `lib/store.ts`. The dynamic spikes (S2/S3/S4) are unaffected.

All 12 bugs verified to behave as planted (`sample-app/scripts/smoke.sh` + `spikes/src/verify-bugs.ts`):

| # | Bug | Verified how | Result |
|---|---|---|---|
| 1 | "Save profile" empty onClick | S4 dead-click sweep | flagged as the only dead click |
| 2 | Newsletter form unwired | code + static-rule fixture | present |
| 3 | `fetch('/api/promo')` → 404 | smoke + S4 network wrap | 404 detected |
| 4 | Double-submit "Buy credits" | 2 rapid POSTs | balance 500 → **1500** (double charge) |
| 5 | Single-use coupon race | 20 concurrent redeems | **9 × 200** (only later ones 409) — race violated |
| 6 | 10k-char name crashes page | Playwright fill | unhandled `TypeError` + broken UI |
| 7 | Emoji/RTL search → 500 | smoke | 500 |
| 8 | Orders API down + swallowed catch | smoke + S4 | 500 + spinner persists > 10.5 s |
| 9 | `profiles` table no RLS | migration file | static-rule fixture |
| 10 | Stripe webhook no signature check | route file | static-rule fixture |
| 11 | Revisit of `/checkout/success` crashes | Playwright reload | first view OK, revisit `TypeError` + broken UI |
| 12 | "Delete account" must never be clicked | S3 picker + S4 skip list | never clicked in any spike |
| D1 | aria-hidden "✦" button | ariaSnapshot | absent from a11y tree |
| D2 | 4s-but-successful recommendations | S2/S4 | never flagged |
| D3 | Accordion (DOM-only toggle) | S4 | correctly detected alive |

## S2 — State hashing (`spikes/src/s2-state-hash.ts`, results in `spikes/results/s2-state-hash.json`)

Normalization per TRD §4 (mask digits/UUIDs/emails/dates in names, interactive elements only, collapse repeats into buckets 0/1/2-5/6+, coarse flags for dialog/loading/auth, SHA-1 of the sorted set). 10 same-screen pairs × 36 different-screen pairs, captured over 11 flows (per-user variants, reloads, pre/post coupon, spinner page, dialog open/closed, two different orders, etc.).

| Method | Same-screen collision | Diff-screen separation | Capture avg | Payload avg |
|---|---|---|---|---|
| **ariaSnapshot (chosen)** | **100%** (10/10) | **100%** (36/36) | 73 ms | **0.9 KB** |
| CDP DOMSnapshot | 100% (10/10) | 97.2% (35/36) | 12 ms | 15.8 KB |

**Decision: ariaSnapshot.** The single DOM failure (`settingsClosed == settingsDialog`) is structural: DOMSnapshot captures the DOM **regardless of visibility** — a closed `<dialog>`'s buttons are still in the tree, so separating it requires joining the snapshot's `layout` data as well. DOMSnapshot is 6× faster to capture but needs extra work for visibility semantics, and costs 17× the payload. ariaSnapshot is correct out of the box and comfortably within the 150 ms step budget.

Notes for implementation:
- CDP `DOMSnapshot.captureSnapshot` wire format: `nodes.attributes` is a **per-node array** of string indices (with `-1` = valueless attribute), and element text must be rebuilt from text-node `nodeValue` indices — not the flat-array layout the protocol types suggest.
- The flags matter: dialog-open, loading-present, and auth-state each separated screens that the element set alone would not.

## S3 — Context scale (`spikes/src/s3-context-scale.ts`, results in `spikes/results/s3-context-scale.json`)

One Chromium, 50 isolated contexts, one CDP round trip per step (in-page random clicker with a minimal safety filter — destructive labels never clicked). Ramp phase (10 steps/agent at 5/10/25/50) + main phase (50 × 100 = 5,000 steps).

| Metric | TRD §9 target | Measured | Note |
|---|---|---|---|
| 50 agents × 100 steps | ≤ 2 min | **109.7 s** | gate pass |
| Throughput | — | 53.8 steps/s | |
| Step latency | ≤ 150 ms median | **p50 167 ms** / p95 501 ms / p99 1.6 s | slightly over; includes 50-way CDP contention + app latency; optimize later (shard Chromium processes, TRD §8) |
| Context spin-up | ≤ 100 ms | **95 ms avg** | pass |
| Memory per context | ≤ 150 MB | **~160 MB** | includes shared browser/GPU overhead; renderers alone are lower |
| Chromium total | — | 8.3 GB at 50 contexts | matches TRD §8 "beyond ~50, more cores/RAM or multiple processes" |
| App (next start) | — | 425 MB | |
| CPU | — | 5.6 of 12 cores (47%) | headroom available |
| Crash isolation | — | 31 noop steps auto-recovered, **0 hard respawns** | agents crashed into the broken success page and recovered via re-navigation |

Ramp: 13.6 → 36.3 → 31.9 → 37.6 steps/s at 5/10/25/50 agents (a cold-start dip at 5 agents, then contention-bound). No app collapse: the Next.js prod server absorbed 50 concurrent sessions.

### S3 follow-up: where the time went (post-review)

The review asked whether the app (not the swarm) was the bottleneck, and whether a production build changes the number. The app **was already a production build** in all runs (`next build` + `next start`; `next start` refuses to boot without `.next/BUILD_ID`), so the number did not drop — the rerun with per-step telemetry showed the cost lives in the swarm's transport layer, not the app:

| Measurement (50 × 100, prod build) | Value |
|---|---|
| Avg **concurrently active agents** | **10.8 of 50** — the single Chromium's CDP channel serializes evaluate calls |
| Per-step transport cost | ~160 ms average *regardless of action type* (bare evaluate on an idle browser: ~1–5 ms) |
| Nav-link clicks (no DB, client router) vs DB actions | 178–193 ms vs ~160–190 ms — **statistically indistinguishable**: app speed is not the driver |
| Lockstep rounds | p50 1.05 s, p95 2.67 s; 43/100 rounds > 1.5 s — one straggler gates 49 other agents |
| Straggler source | post-navigation recovery steps (full page loads from form submits like "Subscribe"/"Sign out") average **1.53 s**, p95 2.55 s — 236 such steps |
| Chromium CPU | ~5.7 of 12 cores; app 413 MB RSS, no degradation |

Implications:
- The original TRD §9 estimate ("50 × 100 ≤ 30 s") was ~4× off because it assumed near-zero per-step transport. Corrected in TRD §9.
- Capacity claim is "**a couple of minutes**" at 50×100 uncapped, with < 10% headroom on the 2-min gate. Real runs are bounded by `budgetSeconds` (default 60 s), so time-to-report targets are governed by the budget, not this ceiling.
- Optimization backlog (not needed for the gate, but the known levers): (a) step agents independently instead of in lockstep rounds — removes straggler gating; (b) shard across multiple Chromium processes (TRD §8 anticipated this for > 50 agents); (c) keep per-step CDP round trips at one (already the case).

### Caveats and follow-up tasks (post-review)

1. **The race results come from a mock.** The 9-of-20 coupon race demonstrates the *detector and persona mechanics* work, but an in-memory store with an injected latency window is not Postgres — real transactions, row locks and pooling change which races occur. **The race detector is unproven until it runs against a real DB.** Swapping `sample-app/lib/store.ts` for real local Supabase (Docker) is scheduled as an early Phase 2 task, with bugs #4/#5 re-verified against it.
2. **Sample sizes are small and possibly overfit.** 100%/100% hash separation was measured on the one app the normalization was tuned on; 0% FP rests on a single true positive. Before Phase 3 relies on the state graph, the hash must pass ≥ 90%/95% on a **second, structurally different held-out app** (different framework, messier UI) — added as a Phase 3 gate in the implementation plan.
3. Spike findings have been folded into the specs: TRD §3.5 (deferred MutationObserver), §3.6 (Next.js error-UI matching, state-saturated controls), §4/§13 (ariaSnapshot chosen, open question 1 closed), §9 (measured numbers replace estimates).

## S4 — Dead-click detector (`spikes/src/s4-dead-click.ts`, runtime in `spikes/src/runtime/deadclick-runtime.js`, results in `spikes/results/s4-dead-click.json`)

Injected runtime (addInitScript): MutationObserver counting mutations, fetch/XHR wrapping counting requests + logging statuses, `perform()` = interact → wait 500 ms → diff (mutations, requests, URL, focus, ARIA state, dialog open). 53 actions across 6 pages as a logged-in user.

| | |
|---|---|
| True positives | 1 — "Save profile" (the planted dead click) |
| False positives | 0 → **FP rate 0%** (gate < 20%) ✅ |
| Safety | "Delete account" and "Delete forever" never clicked; skipped and listed |
| Bonus detectors | promo **404** ✓, orders **500** ✓, spinner persisting **> 10.5 s** ✓ |

**FP class found and fixed during the spike (exactly what Phase 0 is for):** clicking an **already-selected radio** produces zero feedback by design — a naive detector flags it dead (first run: FP rate 50%). Fix: state-saturated controls are reported as `saturated` and excluded. The production detector must carry this rule.

## Learnings carried into Phase 1+

1. **`addInitScript` runs before `document.documentElement` exists** — the in-page runtime must defer MutationObserver installation via `readystatechange` (or the whole init script dies silently; init-script errors do not surface as page errors).
2. **Next.js 16 prod renders a "This page couldn't load" recovery UI** on unhandled client errors instead of a blank page. The `navigation_error` detector must match this text + the `pageerror` signal, not just blank pages.
3. JavaScript `$` (no `m` flag) does not match before a trailing newline — bit us parsing `/proc/*/stat`; parse after `lastIndexOf(')')` instead.
4. Random-clicking swarms **will** reach broken states (revisits of order confirmations, form GET reloads). Single-step recovery (re-navigate home) handled all of them — keep that in the orchestrator.
5. Process metrics must filter **our** Chromium (`chrome-headless` comm) from the user's desktop browser, or RAM/CPU numbers are meaningless on dev machines.
6. The dead-click verdict window of 500 ms worked with no timing flakiness at 50-way contention, but S4 ran single-context; re-check under swarm load in Phase 4.

## Numbers replacing TRD §9 estimates

| Metric | Old estimate | Measured |
|---|---|---|
| Context spin-up | ≤ 100 ms | 95 ms avg ✅ |
| Swarm step time (p50, 50 agents) | ≤ 150 ms | 167 ms ⚠️ (within 12% of target; optimization paths exist) |
| 50 agents × 100 steps | ≤ 30 s | 109.7 s ❌ — the 30 s estimate assumed no app latency + no CDP contention; the *gate* (≤ 2 min) passes, but the swarm phase must budget ~2 min at 50 agents on this class of machine |
| Memory per context | ≤ 150 MB | ~160 MB incl. shared overhead ⚠️ |
| Race-window demonstration | — | 9/20 concurrent redeems succeed on a single-use coupon |

## How to reproduce

```bash
# terminal 1 — target app (prod build)
cd sample-app && npm install && npm run build && npm start   # :3123
bash scripts/smoke.sh                                        # verify planted bugs

# terminal 2 — spikes
cd spikes && npm install && npx playwright install chromium
npx tsx src/s2-state-hash.ts     # state hashing, writes spikes/results/s2-state-hash.json
npx tsx src/s3-context-scale.ts   # 50 × 100, writes spikes/results/s3-context-scale.json
npx tsx src/s4-dead-click.ts      # dead clicks, writes spikes/results/s4-dead-click.json
```
