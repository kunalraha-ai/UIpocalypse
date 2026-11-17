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

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest (includes the stdio end-to-end MCP test)
npm run build       # esbuild bundle to dist/index.cjs
```
