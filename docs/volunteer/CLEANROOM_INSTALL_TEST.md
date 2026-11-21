# Clean-Room Install Test — 2026-11-21

Item 3 of volunteer readiness. Simulated a stranger's machine: fresh clone of
the repo into an empty temp dir (no node_modules, no `.env`, no config), an
empty Playwright browser cache, a tiny never-seen fixture app (one page, a
working form, a working button, one planted dead button), and a minimal
stdio MCP driver that speaks the same protocol as a real MCP host.

## Time-to-first-report

| Step | Time |
|---|---|
| `git clone` | < 1 s (local remote; a volunteer's network clone adds seconds) |
| `npm install` | 3 s — **warm npm cache on the test machine; a truly cold cache is realistically 1–3 min** |
| `npm run build` | 1 s |
| `npx playwright install chromium` | 45 s (cold, 700 MB) |
| MCP `initialize` | 0.6 s |
| `verify_deployment_safety` (no LLM key set) | 45 s |
| **Total, first keystroke to first report** | **~1.5 min on this machine; ~3–4 min realistic cold** |

The run **found the planted dead button** ("Archive completed"), with reproduction steps and a paste-ready fix prompt — in fully-local no-LLM mode (`llmCalls: 0`, `llmModels: "planner=none;scout=none"` recorded in the report).

## Gaps found and fixed

1. **`npx uipocalypse` was fiction.** The package is `private` and not
   published to npm — the command would fail for every volunteer. QUICKSTART.md
   rewritten around the real flow: clone → `npm install && npm run build` →
   MCP config pointing at `dist/index.cjs`.
2. **Node requirement was wrong.** Docs said "Node 20+"; the bundled
   better-sqlite3 v13 declares `engines: node >=22` — Node 20 hits a native
   build failure. Docs corrected to Node 22+ and an `engines` field added to
   package.json so npm fails with a readable message instead of a compiler
   error.
3. **The browser step was undocumented.** Without Playwright's Chromium the
   tool fails at scout launch. The Playwright error text is actionable
   (includes the install command), but `npx playwright install` pulls all
   three engines; the docs now say `npx playwright install chromium` (the
   only one the tool uses). Verified: cold install 45 s, then the run
   succeeds against the fresh browser.
4. **`verify_deployment_safety` inputs were undocumented.** The tool requires
   both `path` (repo root) and `url`; the README only said "scan this
   codebase". Documented in the README with a copy-paste prompt that names
   both. (The validation error — `Required at path` — is a zod artifact that
   reads as if "path" were missing; it now has a troubleshooting row too.)
5. **`.env` location was undocumented.** The server loads `.env` from the MCP
   client's working directory or `uipocalypse/.env` — now stated in the README
   and QUICKSTART.

## Verified error paths (no code changes needed)

- **Missing LLM key:** not an error — fully-local degraded mode works
  end-to-end, and the report records `llmModels: planner=none;scout=none`.
- **Model 410/deprecation:** the pre-run health check fails fast with a
  message that names the env vars to change (added during the phase-5 model
  deprecation on 2026-11-20).
- **Port in use:** the tool opens no ports (stdio MCP); not applicable.
