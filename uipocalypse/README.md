# uipocalypse

Local MCP server + CLI: chaotic-user QA for vibecoded apps. Status: **Phase 5** — 15 static rules, in-page runtime + detectors, state graph, Planner/Scouts, the 50-agent swarm (personas, race mode, Ctrl-C partial report), and the Phase 5 collector/reviewer: clustered reports with fix prompts, `get_report`/`list_runs`/`diff_runs`/`verify_deployment_safety`. (Development history docs — `PRD.md`, `TRD.md`, `ARCHITECTURE.md`, `SAFETY.md`, benchmark results — live in the source repository, not in this release tarball. The volunteer kit ships in `dist/docs/volunteer/`.)

## Requirements

- **Node.js 22 or newer** (`node --version`) — the bundled SQLite driver (better-sqlite3 v13) requires it
- A Chromium for Playwright — installed by the step below (one-time, ~120 MB)

## Install and connect (from the release tarball)

Extract the tarball you were given (e.g. `uipocalypse-0.0.4.tgz`):

```bash
mkdir uipocalypse && tar -xzf uipocalypse-<the-file-you-were-given>.tgz -C uipocalypse --strip-components=1
cd uipocalypse
npm install --omit=dev
npx playwright install chromium   # one-time: the browser the swarm drives
```

(From a source checkout instead? `npm install && npm run build` — same result.)

Then add to your MCP client config. Config shapes vary by client (Claude Code/Cursor use `command`/`args`/`env`; others differ — check your client's MCP docs): the universal parts are the command `node`, the **absolute path** to `dist/index.cjs`, and the `env` block. **Set `UIP_WORKSPACE`** so the results (`.uipocalypse/` — SQLite DB, screenshots, reports) land where you want them, not wherever the client happened to spawn the server:

```json
{
  "mcpServers": {
    "uipocalypse": {
      "command": "node",
      "args": ["/absolute/path/to/uipocalypse/dist/index.cjs"],
      "env": { "UIP_WORKSPACE": "/absolute/path/to/uipocalypse" }
    }
  }
}
```

Ask: *"use uipocalypse to verify deployment safety: the repo is /path/to/my-app and the app is running at http://localhost:3000"*. `verify_deployment_safety` needs both inputs — `path` (the repo root to scan) and `url` (where the app is served). It chains static scan → plan → scouts → swarm → clustered report in one call. The other tools: `scan_codebase` runs the 15 static rules alone; `plan_swarm`/`run_swarm` run scouts + the swarm; `get_report` returns the report; `diff_runs` is the fix-verify loop.

**Optional LLM key.** Without one, everything runs fully local: the swarm, all detectors, and a mechanical report with template fix prompts. With one, you additionally get the LLM-written review. The key is read **only** from these two places — never from `.env` files in the working directory (that may be your app's repo):

1. the MCP config `env` block: `"env": { "LLM_API_KEY": "...", "LLM_BASE_URL": "https://api.openai.com/v1", "LLM_MODEL": "gpt-4o-mini", "LLM_SCOUT_MODEL": "gpt-4o-mini" }` — any OpenAI-compatible provider works (OpenAI, Cloudflare Workers AI, Groq, Together, OpenRouter, local Ollama)
2. `~/.uipocalypse/config` — a plain `KEY=VALUE` file with the same four variables

Only the four `LLM_*` variables are ever read. On startup, and before every run, the server prints its first output line — `LLM mode: off — no LLM_API_KEY configured…` or `LLM mode: on — provider <host>, key source: …` — so a run's LLM status is never ambiguous. Every report also states whether it was **Reviewed by: LLM** or **Reviewed by: mechanical template**.

The volunteer kit (QUICKSTART, WHAT_WE_SEE, SAFE_TEST_COPY, FEEDBACK) ships in `dist/docs/volunteer/`.

## Safety (v0)

Defaults are safe: localhost/staging only, destructive actions skipped, writes gated on an allow-listed DB, live Stripe keys hard-refused. Acceptance tests for all of this live in `test/guard-acceptance.test.ts` — written first, from `SAFETY.md` §6.

## Scope and limits

Read this before trusting a clean report. The benchmark evidence for every claim below is in `../BENCHMARK_RESULTS.md` (source repository — not in the release tarball).

**Detection blind spots (known, deliberate, unchanged):**

- **Destructive-labeled controls are never clicked without opt-in.** The Safety Guard skips any action whose label matches `delete|remove|reset|purge|destroy|unsubscribe|deactivate|cancel subscription` (and any `DELETE` request). That is safety-first by design — but it means **a dead "Reset…" or "Delete…" button is invisible to the swarm**. This is exactly how the one missed planted bug on the held-out Plain Pages app escaped (misdiagnosed at the time as "below the fold"; corrected in `../benchmarks/plain-pages/result.md` after the volunteer-readiness audit proved the regex skip). **Skipped actions are never silent:** every run lists them in a "Skipped by safety policy" section with the reason and the opt-in path, and counts them as UNREACHED in the graph coverage denominator (a run with skipped actions cannot read 100%). The static dead-handler rule can still catch such buttons — but only for apps the analyzer can scan.
- **Post-escalation-fix regression: bug #11 (success-page revisit crash) is unreliable.** The phase-6 escalation fix (LLM-directed restarts → policy restarts) changed how stalled agents spend their steps, and the checkout → success-page → revisit chain became rare: detection went from 2-of-3 runs (pre-fix) to **1 of 6 post-fix first-runs**, with the one hit at 1 observation. The exact pre-fix trajectory that reliably reached it was never identified. Planted-bug detection is stated as **10 of 11 with #11 unreliable**; the ≥80% gate passes at 10/11, but this bug class (crash on revisiting a post-transaction success page) is currently unreliable rather than dependably found.
- **No scrolling.** The runtime never scrolls a page. Controls that only render when scrolled into view (lazy DOM via IntersectionObserver, infinite lists) are never enumerated and never clicked. (Plainly-visible below-the-fold elements ARE enumerated and clicked — `isVisible` doesn't check viewport position; the Plain Pages "below the fold" story was a misdiagnosis, see above.)
- **Chromium only, Linux only, local behavior only.** One browser engine; anything that only manifests in Safari/Firefox, in production infrastructure, or under real load is out of scope. **Developed and tested on Linux only — Windows and other non-Linux setups are untested** (Playwright prints a benign "OS not officially supported" fallback notice on some distros).
- **Apps with only a production database get a read-only run.** When the Guard cannot confirm a safe (local, allow-listed) database, writes and form submits are skipped and the duplicate-write/race detectors are disabled. The report's first lines say exactly which detection classes were NOT run — a clean read-only report is never a clean bill of health.

**Bug classes this tool cannot see (evidence: GrowthSent history run, in the source repository):**

- **Deployment/platform-specific bugs** — e.g., a Vercel runtime module-resolution failure or CDN response caching that serves user A's data to user B. These don't reproduce on a local dev server.
- **Infrastructure-level bugs** — outbound-service auth (a crawler missing its auth tokens), database retry/binding logic, queue/cron failures. Not browser-visible.
- Of GrowthSent's 5 picked historical bugs, 2 were deployment-specific, 1 infrastructure-level, and only 2 were even potentially browser-visible — a browser swarm would have needed those 2 to score anything. A clean run on an app whose bugs live outside the browser proves little.

**Known measurement variance:**

- **Duplicate-write counts are stochastic, not a collector bug.** The phase-5 gate run 3 failed its collector-acceptance check (duplicate clusters per first-run: 1 and 1, expected 2–4). Cause found in the volunteer-readiness audit: whether a double-click actually issues two POSTs depends on the shared app state at that instant — 50 agents share one app and one database, coupons get consumed, navigation-style submits destroy the page after the first click, fetch-based submits fire both. With identical seeds, identical DB reset, and identical cached plan, the three gate executions' first runs produced 16, 13, and 34 duplicate observations. The per-endpoint collapse itself was correct in every run (16→3, 34→3, 8→1 — the 8→1 run had all 8 observations on one endpoint, `/api/coupon/redeem`). The acceptance band treated a random variable as a constant; the check now asserts on the collapsed result (no singleton clusters + invariant-confirmed damage) instead of raw counts.

**What a clean report does NOT mean:**

- Read-only runs (no safe database) do not test writes, form submits, races, or duplicate-write damage — the report says so in its first lines.
- No run against a real vibecoded repo has been verified yet: the "real bugs per real repo ≥ 3" gate is **FAIL (unevaluated)** — GrowthSent is a tuning fixture, and the held-out blind apps had no real bugs to find.


## Development

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest (includes the stdio end-to-end MCP test)
npm run build       # esbuild bundle to dist/index.cjs
```
