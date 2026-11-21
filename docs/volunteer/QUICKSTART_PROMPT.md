# QUICKSTART — paste this into your coding agent

Done reading? Don't do the steps yourself — paste the block below into your coding agent (Claude Code, Cursor, etc.) and let it drive. It assumes the role of the installer; you just watch.

---

I want to run UIpocalypse, a local QA tool that swarms a web app with simulated users to find bugs. It's a local MCP server — not on npm. Set it up and run it on my app:

1. The repo is at `<PATH-TO-UIPOCALYPSE-REPO>` (copy or clone it somewhere you can build it).
2. In `uipocalypse/` inside the repo: `npm install && npm run build`. You need Node 22+ (`node --version`).
3. Run `npx playwright install chromium` in that directory — one-time, it downloads the browser the tool drives.
4. Add the MCP server to your client config and connect:

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

5. My app is running at `<YOUR-APP-URL>` and its code is at `<YOUR-APP-REPO-ROOT>`. Call the `verify_deployment_safety` tool with both `path` and `url`, then show me the report it produces.

Notes:
- I have NOT set an LLM key, so the run is fully local — expect the mechanical report (findings + template fix prompts, no LLM-written review). If it complains about a missing key, that mode is fine and expected.
- The tool only targets localhost and never clicks delete/reset-class buttons. If it lists actions it skipped by safety policy, that's by design — tell me which ones.
- If anything fails (install, browser, config, the tool call), tell me exactly what the error said and what you did about it.
