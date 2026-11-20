# Contender B1 (retry) — blind run against stripped CreditCraft (:3124)
# Date: 2026-11-20 11:22–11:53 IST, fresh subagent session, no project context
# Time: ~31 min wall (including 2 app-server restarts)

## Scoring against the 11 detectable planted bugs

| Planted bug | Found? | How |
|---|---|---|
| #1 "Save profile" empty onClick | ✅ | #5 — "fake success, nothing saved" (verified: zero network requests, name reverts on reload) |
| #2 Newsletter form unwired | ✅ | #12 — "native GET navigation, no API call, email in URL" |
| #3 `/api/promo` → 404 | ✅ | #6 — "dead feature, 404, no error shown" |
| #4 Double-submit "Buy credits" | ✅ | #3 — "rapid clicks charge N times, credit once" (verified with balance math: 3×$5 clicks → +500 not +1500) |
| #5 Concurrent coupon race | ❌ | applied the coupon once (saw the discount), never fired concurrent redeems |
| #6 Garbage-name crash | ❌ | changed the name to "QA Final Check" (has a space → no crash); never tried a spaceless/oversized name |
| #7 Emoji/RTL search → 500 | ✅ | #8 — "500 on many ordinary inputs" (exact punctuation matrix, emoji, accents) |
| #8 Orders API 500 | ✅ | #2 — "order history completely broken, 500 every time" |
| #9 Missing RLS | ❌ | invisible to a browser-only script by construction |
| #10 Unverified Stripe webhook | ❌ | invisible to a browser-only script by construction |
| #11 Success-page revisit crash | ✅ | #10 — "dead end after refresh, 'This page couldn't load'" |

**Detection: 7 of 11 (63.6%)**

## False positives (against the 3 decoys)

| Decoy | Flagged? | The subagent said |
|---|---|---|
| D1 — aria-hidden "✦" button | ❌ not flagged this time | (attempt 1 flagged it; the retry did not) |
| D2 — 4s-but-successful recommendations | ⚠️ borderline | #16 flags the LACK of loading indication (~5 s with only "Thinking…"), not the slowness itself — a UX complaint, not "it's broken" |
| D3 — Shipping FAQ accordion (DOM-only) | ⚠️ borderline | #15 notes the settings panels "stack with no way to close" — the accordion opens fine; the complaint is about the OTHER placeholder panel |

## Notable additional findings (not planted, real observations)

- **Login page stays active while authenticated** — one click switches identity with no re-auth
- **Checkout disconnected from the app** — orders cost nothing, no cart, hardcoded total
- **Coupon outcomes completely silent** — no message on success, error, or re-use
- **Search results never rendered** — the API returns results but the product grid ignores them
- **Server died twice during testing** — wedged at ~31% CPU ignoring HTTP, then died; the log ends with repeated "orders service unavailable" (bug #8's server-side noise)

## Destructive actions

- **Bob's account was permanently deleted** (the subagent clicked "Delete account" → "Delete forever"). The benchmark notes this as a candidate finding: a real QA engineer may click destructive buttons; UIpocalypse's Guard skips them by default.

## Raw subagent output

See the full report preserved alongside this file.
