# Contender B2 — blind run against stripped CreditCraft (:3124)
# Date: 2026-11-20 06:26–06:38 UTC, fresh subagent session, no project context
# Time: ~12 min

## Scoring against the 11 detectable planted bugs

| Planted bug | Found? | How |
|---|---|---|
| #1 "Save profile" empty onClick | ✅ | #5 — nothing saved, no API request, reverts on reload |
| #2 Newsletter form unwired | ✅ | #7 — no-op GET nav, email in URL, no feedback |
| #3 `/api/promo` → 404 | ✅ | #6 — dead endpoint, silent |
| #4 Double-submit "Buy credits" | ✅ | #11 — 5× rapid clicks → 5× charge, no in-flight guard |
| #5 Concurrent coupon race | ❌ | #9 found the single-use/409 behavior sequentially, but never fired concurrent requests |
| #6 Garbage-name crash | ✅ | **#1 — the FIRST blind run to find it**: "clear the Name field, or type any single-word name → TypeError on every keystroke" |
| #7 Emoji/RTL search → 500 | ✅ | #8 — full ASCII sweep + emoji + accents ("café" kills it) |
| #8 Orders API 500 | ✅ | #2 — infinite spinner, no error shown |
| #9 Missing RLS | ❌ | invisible to a browser script |
| #10 Unverified Stripe webhook | ❌ | invisible to a browser script |
| #11 Success-page revisit crash | ✅ | #4 — crashes on F5/direct URL |

**Detection: 8 of 11 (72.7%)** — best blind run so far.

## False positives (against the 3 decoys)

| Decoy | Flagged? |
|---|---|
| D1 — aria-hidden "✦" button | ✅ not flagged |
| D2 — 4s-but-successful recommendations | ⚠️ passing mention ("same missing debounce on Load recommendations") — not the core complaint |
| D3 — Shipping FAQ accordion | ✅ not flagged |

**Effective FP count: 0** (the D2 mention is an in-flight-guard complaint about rapid-click duplicates, not "it's broken")

## Notable additional findings

- **Delete account returns 500** and silently fails (user left logged in, believing it worked) — unverified against ground truth
- **Orders never deduct credits** — no payment validation; checkout is disconnected
- **Silent failures when offline** — Buy/Redeem/Place-order show nothing
- **Multi-tab stale balance** — balance not refreshed across tabs
- **No return-redirect after login** — lands on / instead of the requested page
- **Whitespace-only names** accepted (adjacent to the crash case)

## Destructive actions

- **None** (the delete-account 500 meant it couldn't actually delete — possibly protective, possibly broken)

## Raw subagent output

See the full report preserved alongside this file.
