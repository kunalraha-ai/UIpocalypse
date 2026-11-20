# Contender A — DROPPED, with reason

**Contender A (Playwright MCP in Claude Code) was dropped.** This harness's subagent tool surface provides `shell`, `read`, `glob`, and `grep` — there is no Playwright MCP server (`browser_navigate`, `browser_click`, etc.) available to subagents. Running A faithfully would require an MCP client with the Playwright MCP server configured, which this environment does not have.

All 6 blind runs therefore collapsed into Contender B (agent writes and runs its own Playwright code); I ran 3 (B1–B3) rather than 6, since A and B are indistinguishable here. **The three-way comparison is effectively a two-way comparison.** If a Playwright MCP environment becomes available, A should be re-run to complete the benchmark table.
