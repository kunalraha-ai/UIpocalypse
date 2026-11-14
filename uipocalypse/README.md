# uipocalypse

Local MCP server + CLI: chaotic-user QA for vibecoded apps. Status: **Phase 4** — scan_codebase (10 static rules), in-page runtime + detectors, state graph, Planner/Scouts, and the 50-agent swarm (personas, race mode, Ctrl-C partial report) are live; the report/collector lands in Phase 5. See the repo-root docs (`PRD.md`, `TRD.md`, `ARCHITECTURE.md`, `SAFETY.md`, `IMPLEMENTATION_PLAN.md`, `PHASE0-4_RESULTS.md`).

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

Ask: *"scan this codebase with uipocalypse"* — `scan_codebase` runs the real static rules (Phase 2); `plan_swarm`/`run_swarm` run scouts + the swarm (Phases 3-4); the clustered report lands in Phase 5.

## Safety (v0)

Defaults are safe: localhost/staging only, destructive actions skipped, writes gated on an allow-listed DB, live Stripe keys hard-refused. Acceptance tests for all of this live in `test/guard-acceptance.test.ts` — written first, from `SAFETY.md` §6.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest (includes the stdio end-to-end MCP test)
npm run build       # esbuild bundle to dist/index.cjs
```
