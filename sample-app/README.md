# CreditCraft — UIpocalypse sample app (Phase 0, Spike S1)

Small Next.js (App Router) store/credits app used to benchmark UIpocalypse
(BENCHMARK.md §1). Phase 0 runs it against a **mock** of the Supabase data
layer (`lib/store.ts`) because the local Supabase stack (Docker) is not
available in this environment. The SQL schema still lives in
`supabase/migrations/` so static rules (`missing-rls`, …) can be tested
against a realistic layout. Swapping in real Supabase later only touches
`lib/store.ts`.

## Run

```bash
npm install
npm run build
npm start   # http://localhost:3123 (prod build — spikes must not run against dev)
```

## Seeded data (in-memory, resets on server restart)

- `alice@example.com` / `secret123` — Alice Anderson, 500 credits
- `bob@example.com` / `secret123` — Bob Brown, 300 credits
- Coupon: `WELCOME10` — single use, −$5

## Planted bugs (ground truth, BENCHMARK.md §2)

| # | Bug | Where | Expected detector |
|---|-----|-------|-------------------|
| 1 | "Save profile" button has an empty onClick | `components/ProfileForm.tsx` | static `dead-handler`, dynamic `dead_click` |
| 2 | Newsletter form has no submit handler/action | `app/page.tsx` | static `unwired-form` |
| 3 | `fetch('/api/promo')` — route does not exist | `components/PromoButton.tsx` | static `missing-endpoint`, dynamic `failed_request` (404) |
| 4 | Double-click "Buy credits" double-charges (no guard/idempotency) | `components/BuyCredits.tsx`, `app/api/credits/buy/route.ts`, `lib/store.ts` | `duplicate_write` |
| 5 | Concurrent "Redeem coupon" all succeed (check-then-write race, no transaction) | `app/api/coupon/redeem/route.ts`, `lib/store.ts` | `race_violation` |
| 6 | Garbage name without spaces crashes the page (assumes two-word names) | `components/NameTag.tsx` | `page_error` |
| 7 | Non-ASCII search input throws → 500 | `app/api/search/route.ts` | `failed_request` |
| 8 | Orders API throws → 500 HTML; client swallows the error → spinner forever | `app/api/orders/route.ts`, `components/OrdersList.tsx` | `infinite_spinner` |
| 9 | `profiles` table has no RLS | `supabase/migrations/0001_init.sql` | static `missing-rls` |
| 10 | Stripe webhook route never verifies the signature | `app/api/stripe/webhook/route.ts` | static `unverified-stripe-webhook` |
| 11 | Revisit/refresh of `/checkout/success` crashes (one-time sessionStorage read) | `app/checkout/success/page.tsx` | `navigation_error` / `page_error` |
| 12 | "Delete account" + confirm dialog — must NEVER be clicked by the swarm | `components/SettingsPanel.tsx` | safety-guard skip |

## Decoys (must NOT be reported as findings)

| Decoy | Where | Why it is fine |
|---|---|---|
| D1 — inert decorative "✦" button with `aria-hidden` | `app/layout.tsx` (footer) | hidden from the accessibility tree |
| D2 — "Load recommendations": 4s request that succeeds | `components/Recommendations.tsx`, `app/api/recommendations/route.ts` | slow ≠ broken |
| D3 — "Shipping FAQ" accordion (DOM-only toggle, no network) | `components/Accordion.tsx` | aria-expanded change + DOM mutation present |

## Additional known quirks (extra static-rule fixtures, not in the 12)

- `app/api/orders/route.ts` reads `process.env.ORDERS_API_KEY`, defined nowhere (`undefined-env` fixture)
- "Buy credits" has no in-flight disable (`missing-submit-guard` fixture)
- `lib/supabase.ts` is a placeholder Supabase client (stack-detection fixture)
