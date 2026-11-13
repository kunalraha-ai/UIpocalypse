# uipocalypse

Local MCP server + CLI: chaotic-user QA for vibecoded apps. Status: **Phase 1** — MCP server skeleton with a `scan_codebase` stub, SQLite state-graph DAL, Safety Guard v0, config loader. See the repo-root docs (`PRD.md`, `TRD.md`, `ARCHITECTURE.md`, `SAFETY.md`, `IMPLEMENTATION_PLAN.md`, `PHASE0_RESULTS.md`).

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

Ask: *"scan this codebase with uipocalypse"* — `scan_codebase` returns a stub scan in Phase 1; real static rules land in Phase 2, the swarm in Phases 3-5.

## Safety (v0)

Defaults are safe: localhost/staging only, destructive actions skipped, writes gated on an allow-listed DB, live Stripe keys hard-refused. Acceptance tests for all of this live in `test/guard-acceptance.test.ts` — written first, from `SAFETY.md` §6.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest (includes the stdio end-to-end MCP test)
npm run build       # esbuild bundle to dist/index.cjs
```
