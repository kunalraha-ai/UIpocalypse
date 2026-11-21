# uipocalypse

Local MCP server + CLI: chaotic-user QA for vibecoded apps. Status: **Phase 5** — 15 static rules, in-page runtime + detectors, state graph, Planner/Scouts, the 50-agent swarm (personas, race mode, Ctrl-C partial report), and the Phase 5 collector/reviewer: clustered reports with fix prompts, `get_report`/`list_runs`/`diff_runs`/`verify_deployment_safety`. See the repo-root docs (`PRD.md`, `TRD.md`, `ARCHITECTURE.md`, `SAFETY.md`, `IMPLEMENTATION_PLAN.md`, `PHASE0-5_RESULTS.md`).

## Connect from Claude Code (or any MCP client)

```bash
cd uipocalypse
npm install && npm run build
```

Then add to your MCP client config:

```json
{
  "mcpServers": {
    "uipocalypse": {
      "command": "node",
      "args": ["/absolute/path/to/UIpocalypse/uipocalypse/dist/index.cjs"]
    }
  }
}
```

Ask: *"scan this codebase with uipocalypse"* — `scan_codebase` runs the 15 static rules; `plan_swarm`/`run_swarm` run scouts + the swarm; `get_report` returns the clustered report with fix prompts; `diff_runs` is the fix-verify loop; `verify_deployment_safety` chains all of it in one call.

## Safety (v0)

Defaults are safe: localhost/staging only, destructive actions skipped, writes gated on an allow-listed DB, live Stripe keys hard-refused. Acceptance tests for all of this live in `test/guard-acceptance.test.ts` — written first, from `SAFETY.md` §6.

## Scope and limits

Read this before trusting a clean report. The benchmark evidence for every claim below is in `../BENCHMARK_RESULTS.md`.

**Detection blind spots (known, deliberate, unchanged):**

- **Destructive-labeled controls are never clicked without opt-in.** The Safety Guard skips any action whose label matches `delete|remove|reset|purge|destroy|unsubscribe|deactivate|cancel subscription` (and any `DELETE` request). That is safety-first by design — but it means **a dead "Reset…" or "Delete…" button is invisible to the swarm**. This is exactly how the one missed planted bug on the held-out Plain Pages app escaped (misdiagnosed at the time as "below the fold"; corrected in `../benchmarks/plain-pages/result.md` after the volunteer-readiness audit proved the regex skip). The static dead-handler rule can still catch such buttons — but only for apps the analyzer can scan.
- **Post-escalation-fix regression: success-page revisit crash no longer found.** The phase-6 escalation fix (LLM-directed restarts → policy restarts) changed how stalled agents spend their steps, and the checkout → success-page → revisit chain stopped being walked: detection of planted bug #11 went from 2-of-3 runs (pre-fix) to 0-of-3 (post-fix). The exact pre-fix trajectory that reached it was never identified. The ≥80% planted-detection gate still passes at 10/11, but this specific bug class (crash on revisiting a post-transaction success page) is currently dark.
- **No scrolling.** The runtime never scrolls a page. Controls that only render when scrolled into view (lazy DOM via IntersectionObserver, infinite lists) are never enumerated and never clicked. (Plain-visible below-the-fold elements ARE enumerated and clicked — `isVisible` doesn't check viewport position.)
- **Chromium only, local behavior only.** One browser engine; anything that only manifests in Safari/Firefox, in production infrastructure, or under real load is out of scope.

**Bug classes this tool cannot see (evidence: GrowthSent history run, `../benchmarks/growthsent-history/result.md`):**

- **Deployment/platform-specific bugs** — e.g., a Vercel runtime module-resolution failure or CDN response caching that serves user A's data to user B. These don't reproduce on a local dev server.
- **Infrastructure-level bugs** — outbound-service auth (a crawler missing its auth tokens), database retry/binding logic, queue/cron failures. Not browser-visible.
- Of GrowthSent's 5 picked historical bugs, 2 were deployment-specific, 1 infrastructure-level, and only 2 were even potentially browser-visible — a browser swarm would have needed those 2 to score anything. A clean run on an app whose bugs live outside the browser proves little.

**Known measurement variance:**

- **Duplicate-write counts are stochastic, not a collector bug.** The phase-5 gate run 3 failed its collector-acceptance check (duplicate clusters per first-run: 1 and 1, expected 2–4). Cause found in the volunteer-readiness audit: whether a double-click actually issues two POSTs depends on the shared app state at that instant — 50 agents share one app and one database, coupons get consumed, navigation-style submits destroy the page after the first click, fetch-based submits fire both. With identical seeds, identical DB reset, and identical cached plan, the three gate executions' first runs produced 16, 13, and 34 duplicate observations. The per-endpoint collapse itself was correct in every run (16→3, 34→3, 8→1 — the 8→1 run had all 8 observations on one endpoint, `/api/coupon/redeem`). The acceptance band treats a random variable as a constant; it was not changed (no threshold changes).

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
