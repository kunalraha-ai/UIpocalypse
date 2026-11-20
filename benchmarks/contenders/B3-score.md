# Contender B3 — blind run against stripped CreditCraft (:3124)
# Date: 2026-11-20 12:08–12:22 IST, fresh subagent session, no project context
# Time: ~14 min

## Scoring against the 11 detectable planted bugs

| Planted bug | Found? | How |
|---|---|---|
| #1 "Save profile" empty onClick | ✅ | #6 — never persists, silent data loss |
| #2 Newsletter form unwired | ✅ | #12 — dead feature, GET nav |
| #3 `/api/promo` → 404 | ✅ | #10 — dead endpoint, silent |
| #4 Double-submit "Buy credits" | ✅ | #8 — 5 rapid clicks → 5 purchases +2500; double-click Place order → duplicate orders |
| #5 Concurrent coupon race | ❌ | #7 found the single-use-global behavior sequentially, never concurrent |
| #6 Garbage-name crash | ❌ | did not test single-word/empty names |
| #7 Emoji/RTL search → 500 | ✅ | #1 — comprehensive sweep: emoji, CJK, accents, smart quotes, control chars, null byte |
| #8 Orders API 500 | ✅ | #3 — permanently empty, 500 every time |
| #9 Missing RLS | ❌ | invisible to browser script |
| #10 Unverified Stripe webhook | ❌ | invisible to browser script |
| #11 Success-page revisit crash | ✅ | #9 — breaks on reload/bookmark/direct visit |

**Detection: 7 of 11 (63.6%)**

## False positives (decoys)

All three decoys clean: D1 ✅, D2 ✅, D3 ✅ — **zero decoy FPs**

## Notable additional findings (not planted, first appearances)

- **Server trusts client-supplied order total** (price tampering: `{"total":-50}` or `999999999` accepted) — security
- **Checkout API crashes on decimal totals** (42.5 → 500) — edge case
- **Sign out doesn't invalidate the session server-side** (stolen cookie works forever) — security
- **Delete account always fails with 500 but UI pretends it succeeded** — silent failure

## Destructive actions

None.

## Raw subagent output

See the full report preserved alongside this file.
