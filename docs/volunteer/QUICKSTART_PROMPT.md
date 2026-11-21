# QUICKSTART — paste this into your coding agent

Done reading? Don't do the steps yourself — paste the block below into your coding agent (Claude Code, Cursor, etc.) and let it drive. It assumes the role of the installer; you just watch.

---

I want to run UIpocalypse, a local QA tool that swarms a web app with simulated users to find bugs. It's a local MCP server — not on npm. Set it up and run it on my app:

1. The repo is at `<PATH-TO-UIPOCALYPSE-REPO>` (copy or clone it somewhere you can build it).
2. In `uipocalypse/` inside the repo: `npm install && npm run build`. You need Node 22+ (`node --version`). Ignore `npm audit` warnings — they're the tool's own dependency flags, not a problem with my app. If Playwright prints "OS not officially supported", that's a benign fallback build.
3. Run `npx playwright install chromium` in that directory — one-time, it downloads the browser the tool drives.
4. Add the MCP server to your client config and connect. Translate to whatever format my client uses — the point is: run `node <ABSOLUTE-PATH-TO-REPO>/uipocalypse/dist/index.cjs` as an MCP server over stdio. **Set the server process's working directory** to a folder that should own the results (the tool writes `.uipocalypse/` — its SQLite DB, screenshots, and reports — under its cwd, or under `$UIP_WORKSPACE` if set). Beware: the server loads `.env` from its working directory — if your cwd has any `.env` with `LLM_API_KEY` (including one inside a `uipocalypse/` folder there), the tool will silently use it.

   Claude Desktop / Cursor shape for reference:

   ```json
   {
     "mcpServers": {
       "uipocalypse": {
         "command": "node",
         "args": ["<ABSOLUTE-PATH-TO-REPO>/uipocalypse/dist/index.cjs"]
       }
     }
   }
   ```

5. My app is running at `<YOUR-APP-URL>` and its code is at `<YOUR-APP-REPO-ROOT>`. Call the `verify_deployment_safety` tool with both `path` and `url` (optional: `agents` — default 30, max 100 — and `budgetSeconds`), then show me the report it produces.

Notes:
- I have NOT set an LLM key, so the run should be fully local — expect the mechanical report (findings + template fix prompts, no LLM-written review). The report header says which mode it ran in; if it says LLM-reviewed, a key was picked up from somewhere — tell me.
- If my app is plain HTML/JS with no build setup, the static scan will report 0 issues — it only parses Next.js/Vite/Supabase code. The browser swarm still runs.
- The tool only targets localhost and never clicks delete/reset-class buttons. If it lists actions it skipped by safety policy, that's by design — tell me which ones.
- If anything fails (install, browser, config, the tool call), tell me exactly what the error said and what you did about it.
