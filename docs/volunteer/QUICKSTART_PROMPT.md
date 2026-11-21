# QUICKSTART — paste this into your coding agent

Done reading? Don't do the steps yourself — paste the block below into your coding agent (Claude Code, Cursor, etc.) and let it drive. It assumes the role of the installer; you just watch.

---

I want to run UIpocalypse, a local QA tool that swarms a web app with simulated users to find bugs. Set it up and run it on my app:

1. The release tarball is at `<PATH-TO>/uipocalypse-0.0.1.tgz` (the tool is not on npm). Install it:
   ```bash
   mkdir <somewhere>/uipocalypse && tar -xzf <PATH-TO>/uipocalypse-0.0.1.tgz -C <somewhere>/uipocalypse --strip-components=1
   cd <somewhere>/uipocalypse
   npm install --omit=dev          # ignore npm-audit warnings
   npx playwright install chromium  # one-time browser download; "OS not officially supported" is a benign fallback
   ```
   Node 22+ is required (`node --version`).
2. Add the MCP server to your client config and connect. Translate to whatever format my client uses — the point is: run `node <ABSOLUTE-PATH>/uipocalypse/dist/index.cjs` as an MCP server over stdio. **If a `uipocalypse` entry already exists in the config, REPLACE it** — a stale entry from an earlier install would test the wrong binary. **Set the server process's working directory** to a folder that should own the results (the tool writes `.uipocalypse/` — its SQLite DB, screenshots, and reports — under its cwd, or under `$UIP_WORKSPACE` if set in the server's env); a sensible default is the folder you extracted the tarball into.
3. I have NOT set an LLM key, so the run must be fully local — expect the mechanical report (findings + template fix prompts, no LLM-written review). The tool reads a key ONLY from the MCP config `env` block or `~/.uipocalypse/config`, and never from `.env` files in the working directory. The server's first output line states the mode (`LLM mode: off — …`); the same line appears in the `llmMode` field of every verify result, and the report header says **Reviewed by: LLM** or **Reviewed by: mechanical template**. **If the mode says `on`: a key is present in one of those two places — do NOT make any LLM calls with it; tell me, and if you must proceed, move the key source aside temporarily and restore it exactly afterward.**
4. My app is running at `<YOUR-APP-URL>` and its code is at `<YOUR-APP-REPO-ROOT>`. Call the `verify_deployment_safety` tool with both `path` and `url` (optional: `agents` — default 30, max 100 — and `budgetSeconds`). Expect the call to take **about 1–2 minutes at defaults**. Then show me the **markdown report** it produces (`reportMarkdown`).

Notes:
- If my app is plain HTML/JS with no build setup, the static scan will report 0 issues — it only parses Next.js/Vite/Supabase code. The browser swarm still runs.
- The tool only targets localhost and never clicks delete/reset-class buttons. If it lists actions it skipped by safety policy, that's by design — tell me which ones.
- If anything fails (install, browser, config, the tool call), tell me exactly what the error said and what you did about it.
