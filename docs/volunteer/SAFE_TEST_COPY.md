# Making a Safe Test Copy of Your App

UIpocalypse clicks everything in your app — including buttons you don't want clicked in production. Before running it, make a **safe copy** of your app. This page is written as a prompt you can paste into your own coding agent (Claude Code, Cursor, etc.) to set this up for you.

## Prompt for your coding agent

> I want to create a safe test copy of my app so I can run a QA testing tool against it without affecting my production data. Please help me set up:
>
> 1. **A separate local database**: If I use Supabase, create a new free local Supabase project (NOT my production one). If I use another database, set up a local Docker container for it. My production database must NOT be accessible from the test copy.
>
> 2. **Test API keys**: Replace any live Stripe keys (`sk_live_...`, `pk_live_...`) with test keys (`sk_test_...`, `pk_test_...`). Replace any real email/SMS provider credentials with test/local alternatives (like Mailpit for email). Remove any production analytics/tracking IDs.
>
> 3. **A `.env.local` file** for the test copy that points to the LOCAL database and TEST keys. My production `.env` must remain untouched.
>
> 4. **Run my database migrations** against the local database so it has the same schema.
>
> 5. **Verify**: Start the test copy on a localhost port, create a test account, add some test data, and confirm that:
>    - My production database is unreachable from this copy
>    - No live API keys are in use
>    - The app renders and basic flows work
>
> Tell me the URL of the test copy when done.

## Manual checklist (if you prefer to do it yourself)

- [ ] Local database running (Docker Supabase, local Postgres, or SQLite)
- [ ] `.env.local` in the test copy points to the LOCAL database
- [ ] All Stripe keys are `sk_test_` / `pk_test_` (never `sk_live_` / `pk_live_`)
- [ ] No real email/SMS credentials
- [ ] No production analytics/tracking
- [ ] Database migrations applied to the local database
- [ ] App starts and basic flows work on localhost
- [ ] Production database is NOT reachable from the test copy

## Why this matters

The testing tool (UIpocalypse) releases 30+ simulated users who click every button in your app. If "Delete account" works and they can reach your production database, they could delete real data. The tool has safety guards (it skips destructive-labeled buttons by default), but guards are heuristics — a safe test copy is the reliable protection.
