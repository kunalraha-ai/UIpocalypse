# Stage 4 results: GrowthSent history-based detection — locally unrunnable, by nature

**Date:** 2026-11-20 · **Verdict: 0/5 picks are valid local behavioral measurements.** This is a methodology finding, not a tool failure — each pick's actual bug (verified from the fix diffs, not just commit messages) is a platform/provider-bound class that cannot reproduce outside its platform.

## Code archaeology vs. the picks (corrections to `picks.md`)

| Pick | Fix commit | What the diff actually shows | Why it can't run locally |
|---|---|---|---|
| 1 | `103b0af` | `import { ObjectId } from "mongodb"` → namespace import (`import * as mongodbDriver`) | **Vercel-Runtime-only bug class.** Named CJS imports break in Vercel's runtime interop; in plain Node they work fine — the bug cannot reproduce outside Vercel, so a local swarm would see nothing |
| 2 | `cf1b816` | Same class: `new ObjectId()` → `new mongodbDriver.ObjectId()` in scan/audit services | Same — Vercel-runtime named-import breakage |
| 3 | `488a747` | `lib/auth/social.ts` +46: account-linking for Google-verified emails (concurrent-callback convergence); App.tsx change relocates the auth modal | Requires the **real Google OAuth round-trip** (provider credentials + callback) — not reproducible locally |
| 4 | `b27fb7c` | `vercel.json` +11: `Cache-Control: no-store` headers for shared audits | **Vercel edge-cache behavior** — the cross-user response caching exists only on Vercel's edge; a local server never caches. Also needs Mongo + two users |
| 5 | `9eb0e90` | `lib/crawler/fetcher.ts` +40: outbound `X-GrowthSent-Audit-Token` auth when crawling **first-party hosts** | **Mis-picked.** The commit authenticates the crawler's *outbound* requests; it is not an API auth fix. (Verified: pre-fix router already 401s website-scoped audit requests.) Not UI/request-visible to a UI swarm at all |

## What was still measured

- **Static layer, all 5 pre-fix worktrees** (`git worktree` at each parent, `scan_codebase`): 0/5 historical bugs detectable by the 15 static rules — expected: platform-runtime interop, OAuth, edge caching, and crawler-internal classes are out of the rules' scope by design, and no plausible static rule exists for them. The scans were internally consistent across history (12–14 dead handlers + 10–13 undefined-env in every era — those real bugs predate all five fixes).
- **Behavioral layer:** not attempted further — a local run cannot reproduce any of the five bugs (above), so a "no detection" result would measure nothing.

## Conclusions for the benchmark methodology

1. **History-based detection requires repos whose fixed bugs are runtime-agnostic** (UI logic, state handling, form flows). GrowthSent is a backend/infra project with a Figma-Make mock frontend — its UI bugs (14 dead buttons) are still unfixed at HEAD, so no fix-point exists for them either. A redo needs a different repo profile (e.g., an app repo with "fix: broken button/crash on empty input/loop reset" history).
2. **Commit messages are not ground truth.** Two of five picks were materially mis-described (P5 was not API auth; P3's App.tsx hunk was a modal relocation). Every future pick gets diff-verified before running.
3. The platform-bound classes (Vercel runtime interop, edge caching) are a real vibecoder pain class — but detecting them belongs to a *deployed* check (a future cloud runner), not the local swarm.

## Cleanup

- 5 pre-fix worktrees removed.
- `picks.md` retained as the methodology record with this file as the outcome.
