# Quickstart-prompt test — 2026-11-21 (fresh-context agent, no project knowledge)

The QUICKSTART_PROMPT.md block was pasted verbatim to a fresh subagent with
zero project context, a clean clone, and a never-seen fixture app (one page,
a working form, one planted dead button). It had to install, configure, and
run `verify_deployment_safety` on its own. Wall time: **5:00 flat**, and the
run **found the planted dead button** with a high-quality root cause and fix
prompt. The prompt works — but the test surfaced real gaps, recorded below.

## Where the agent got stuck or had to guess

1. **MCP config format had to be translated (guess).** The prompt's JSON is
   Claude Desktop / Cursor format. The agent's client (OpenCode) uses a
   different schema (`"mcp": {"servers": {...}}`, `command` as array). It
   translated correctly, but the prompt must say "translate to your client's
   MCP config format" instead of implying the snippet is universal.
2. **THE BIG ONE — the "fully local, no key" promise silently failed.** The
   volunteer's note said no LLM key was set. The MCP client spawned the
   server with cwd = the session directory, and the server loads `.env` from
   `$CWD/.env` and `$CWD/uipocalypse/.env` — it found a dev checkout's
   Cloudflare key and silently made **16 real LLM calls**. The agent only
   discovered this by diffing the report text against the template code: the
   report never states whether it was LLM-reviewed or mechanical. Fixes
   shipped after this test: the report header now states the review mode and
   the key's source; the prompt now warns about cwd-dependent `.env` pickup.
3. **Report observability bugs it hit (all real, all since fixed or filed):**
   - header said "Agents: 1" while 30 agents ran (the runs row is created in
     the scout phase and was never updated by the swarm)
   - header said "LLM calls: 0" while the tool result reported 16 (the row
     stores only the swarm-phase delta; the label implied it was the total)
   - internal LLM failures (planner JSON truncation, scout invalid actions)
     were visible only in `server.jsonl`, not the report
4. **npm audit noise:** `npm install` printed 11 audit flags (10 moderate,
   1 high) — harmless to the run but unexplained; the quickstart now notes
   it. Same for Playwright's "OS not officially supported" warning (benign
   fallback build).
5. **`staticIssues: 0` on a plain-HTML app** — the static analyzer only
   parses Next.js/Vite/Supabase code; for anything else it reports nothing
   and the report doesn't say why. Documented as a scope limit.
6. **Marketing vs default swarm size:** "a few dozen agents" is accurate
   (default 30, config-capped at 100); the prompt now mentions `agents` /
   `budgetSeconds` are optional tool parameters.
7. **No instruction on where results land** — the workspace is
   `.uipocalypse/` under the server's cwd (or `UIP_WORKSPACE`). The prompt
   now says where the report file is.

## Verdict

A competent agent with only the prompt produced a working install and a
bug-finding run in five minutes. The blockers were all observability and
expectation-setting, not the mechanics — each one is now addressed in
QUICKSTART_PROMPT.md or the report format.

---

# Prompt re-test 2 — tarball flow (2026-11-21, after env hardening)

The hardened QUICKSTART_PROMPT (tarball install, new env rules) was pasted to
a second fresh-context agent. Result: **~6 minutes total, found the planted
dead button ("Export data"), skipped "Reset preferences" by policy with the
full NOT TESTED section + opt-in path, coverage 80% (4/5) with the skip in
the denominator, llmCalls 0, Reviewed by: mechanical.** The tarball flow
itself worked first try.

**The mode line caught a live incident mid-test:** the agent saw
`LLM mode: on — provider api.cloudflare.com, key source: /home/eclipse/.uipocalypse/config`
while the volunteer prompt said no key was set — a developer config file
created minutes earlier. Per its instructions it flagged the mismatch, made
the run fully local, and restored the file exactly. That is precisely the
failure mode the mode line exists for; the previous prompt test's 16 silent
LLM calls would now be impossible to miss.

Stuck points found and fixed:

1. **The tarball shipped STALE docs** — it was packed before the env-hardening
   rewrite, so its README still described the old `.env` behavior and
   contradicted the prompt. Fixed: rebuilt as uipocalypse-0.0.2.tgz from the
   current tree (version also aligned — the server handshake said 0.0.2 while
   the package said 0.0.1).
2. **The mode line is invisible through MCP clients that hide stderr** — the
   agent had to write a stdio probe to see it. Fixed: every
   `verify_deployment_safety` result now carries an `llmMode` field with the
   exact line; QUICKSTART documents the report-header fallbacks.
3. **"Reviewed by: mechanical template (no key configured, no findings, or
   the reviewer call failed)" listed three causes without saying which** —
   the report now states the actual reason (e.g. "no LLM_API_KEY configured").
4. **Stale/conflicting MCP config entry** — the agent's client already had a
   `uipocalypse` entry from the earlier test pointing at a dead path; a naive
   volunteer would have tested the wrong binary. The prompt now says REPLACE
   an existing entry.
5. **Found-key protocol was undefined** — the prompt now has an explicit
   clause: flag it, don't use it, move it aside only if you must proceed,
   restore exactly after.
6. Minor prompt polish: which folder should own the results (sensible default
   stated), expected call duration (~1–2 min at defaults), and "show me the
   markdown report" instead of ambiguous "the report".
