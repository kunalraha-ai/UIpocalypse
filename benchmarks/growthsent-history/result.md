# Stage 4: GrowthSent history-based detection — results

GrowthSent is a **tuning fixture** (analyzer rules were fixed from it in phase 5). This detection rate is not held-out.

## Picked commits (before running anything — see picks.md for rationale)

| # | Fix commit | Bug | Locally detectable? |
|---|---|---|---|
| 1 | `103b0af` — MongoDB ObjectId Vercel runtime binding | ObjectId import breaks on Vercel → API 500 | **No** — Vercel-specific module resolution, works fine locally |
| 2 | `cf1b816` — "Fixed the class" | class `this` binding in services → API errors | Possibly — not attempted |
| 3 | `488a747` — restore social sign-in and Turnstile flow | sign-in buttons broken | Yes — **attempted, killed by server restart** |
| 4 | `b27fb7c` — prevent shared audit response caching | CDN serves user A's data to user B | **No** — CDN caching only manifests on Vercel, not local dev |
| 5 | `9eb0e90` — authenticate first-party crawl audits | crawler fetcher lacks auth tokens | **Ran** — see below |

## What ran

| Commit state | Booted? | Swarm ran? | Result |
|---|---|---|---|
| `b27fb7c^` (pre-caching-fix) | ✅ (MongoDB connected, API 200) | ❌ not swarmed — bug not locally detectable | n/a |
| `9eb0e90^` (pre-crawler-auth-fix) | ✅ (MongoDB connected, API 200) | ✅ 20 agents, 60 s | **Not detected** — 22 finding clusters, none pointed at the crawler fetcher auth bug |
| `488a747^` (pre-social-signin-fix) | ✅ (API 200) | ❌ swarm started, **killed by server restart** | incomplete |
| `103b0af^` | not attempted | — | unrunnable (Vercel-specific) |
| `cf1b816^` | not attempted | — | unrunnable (not tried) |

## Detection result: 0 of 1 completed run detected the later-fixed bug

The one completed run (`9eb0e90^`) found 22 clusters — mostly dead_click on landing-page buttons (✦, social links) and the 401 from `/api/v1/auth/me` (correct rejection of unauthenticated access). None pointed at the crawler fetcher's missing authentication, which is what `9eb0e90` fixed.

**Why the detection rate is low here:** GrowthSent's fixed bugs are dominated by **deployment-specific issues** (Vercel ObjectId binding, CDN caching) and **infrastructure-level issues** (crawler auth, MongoDB transaction retries) — neither class is visible to a browser-based swarm running against a local dev server. The bugs that ARE browser-visible (social sign-in, dashboard glitches) either didn't complete (server restart) or weren't attempted.

**Honest label:** this is a 0-of-1 detection on completed runs from a tuning fixture, with 4 of 5 picks unrunnable. It says nothing about the tool's ability to find historical real bugs in apps whose bugs ARE browser-visible.
