# Stage 4: GrowthSent history-based detection — results

GrowthSent is a **tuning fixture** (analyzer rules were fixed from it in phase 5). This detection rate is not held-out.

### Scope

| Category | Count | Detail |
|---|---|---|
| Commits picked (before running) | 5 | listed in picks.md — all UI- or request-visible bug fixes |
| Pre-fix states that installed and booted | 3 | `b27fb7c^`, `9eb0e90^`, `488a747^` (npm install + vite dev + MongoDB connected) |
| Swarm runs completed | 1 | `9eb0e90^` (20 agents, 60 s) |
| Swarm runs interrupted by server restart | 1 | `488a747^` (killed mid-run) |
| States booted but not swarmed | 1 | `b27fb7c^` (bug not locally detectable — CDN caching) |
| States not attempted | 2 | `103b0af^` (Vercel-specific), `cf1b816^` (not tried) |
| **Bugs the tool cannot see by design** | 2 of 5 | `103b0af` (Vercel runtime ObjectId binding — deployment-specific), `b27fb7c` (CDN response caching — only manifests on Vercel) |
| **Bugs in the wrong shape for a browser swarm** | 1 of 5 | `9eb0e90` (crawler fetcher auth — infrastructure-level, not browser-visible) |
| **Potentially browser-visible bugs** | 2 of 5 | `488a747` (social sign-in UI), `cf1b816` (API service errors) — one interrupted, one not tried |

### Detection result: 0 of 1 completed run

The one completed run (`9eb0e90^`) found 22 clusters — mostly dead_click on landing-page buttons and the 401 from `/api/v1/auth/me` (correct rejection). None pointed at the crawler fetcher's missing authentication, which is what `9eb0e90` fixed.

**Why the detection rate is low here:** GrowthSent's fixed bugs are dominated by deployment-specific and infrastructure-level issues — neither class is visible to a browser-based swarm running against a local dev server. The bugs that ARE browser-visible either didn't complete (server restart) or weren't attempted.

**Honest label:** this is a 0-of-1 detection on completed runs from a tuning fixture, with 4 of 5 picks unrunnable or not locally detectable. It says nothing about the tool's ability to find historical real bugs in apps whose bugs ARE browser-visible.
