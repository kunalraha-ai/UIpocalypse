# Stage 4: GrowthSent history-based detection — commit picks (BEFORE running)

GrowthSent is a **tuning fixture** (analyzer rules were fixed from it in phase 5), so this detection rate is not held-out. It measures whether the swarm finds historical real bugs.

## Picked commits (fixed bugs, with the pre-fix state to test)

| # | Fix commit | Bug fixed | Why UI/request-visible | Pre-fix parent |
|---|---|---|---|---|
| 1 | `103b0af` "fix MongoDB ObjectId Vercel runtime binding" | `require('bson').ObjectId` breaks in the Vercel runtime → every API route that touches MongoDB returns 500 | Every request to any `/api/v1/*` endpoint that uses ObjectId fails | `103b0af^` |
| 2 | `cf1b816` "Fixed the class" | Class `this` binding lost in arrow functions in `lib/auth/user.ts`, `lib/services/audit.service.ts` → API routes throw `TypeError` on calls that use the unbound methods | API requests that go through these services 500 or return wrong data | `cf1b816^` |
| 3 | `488a747` "fix: restore social sign-in and Turnstile flow" | Social sign-in (Google OAuth) was broken — clicking the sign-in buttons produced errors | Clicking sign-in buttons in the UI errors instead of authenticating | `488a747^` |
| 4 | `b27fb7c` "fix: prevent shared audit response caching" | API responses cached across users (`vercel.json` had no cache headers) — user A could see user B's audit results | API requests return another user's data | `b27fb7c^` |
| 5 | `9eb0e90` "fix: authenticate first-party crawl audits" | Crawl audit API endpoints had no auth check — unauthenticated users could start crawls | API requests to audit endpoints succeed without authentication (should 401) | `9eb0e90^` |

**Detection rule:** "detected" = a UIpocalypse finding pointing at the same endpoint, action, or page as the later fix. A finding somewhere else on the app does not count.

**Expected build trouble:** GrowthSent is a MongoDB + Vite app, not Next.js + Supabase. The static analyzer doesn't know this stack (framework detection returns `vite-react` at best). Old commits may fail to `npm install` (lockfile drift) or boot (env changes, missing packages). Each unbootable state is counted as **unrunnable**, not as a miss.
