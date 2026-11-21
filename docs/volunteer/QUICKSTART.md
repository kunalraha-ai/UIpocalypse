# UIpocalypse Quickstart

**Find real bugs in your app in under 5 minutes.** No writing test code.

## What you need

- Node.js 20 or newer (`node --version`)
- Your app running on `localhost` (any port)
- 5 minutes

## Step 1: Install

```bash
npx uipocalypse
```

That's it. The first run installs Playwright's browser (~1 min).

**Optional — LLM key:** UIpocalypse works without one (free mode, finds crashes and dead buttons). To also get a written report with fix prompts, set these in a `.env` file:

```
LLM_API_KEY=your-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_SCOUT_MODEL=gpt-4o-mini
```

Any OpenAI-compatible API works (OpenAI, Cloudflare Workers AI, local Ollama, Groq). Without a key, you get the raw findings list but no LLM-written summary.

## Step 2: Add to Claude Code

Copy this into your Claude Code MCP config (`.claude/claude_desktop_config.json` or `claude mcp add`):

```json
{
  "mcpServers": {
    "uipocalypse": {
      "command": "npx",
      "args": ["-y", "uipocalypse"]
    }
  }
}
```

## Step 3: Ask Claude

Open Claude Code in your app's repo and say:

> "Use uipocalypse to verify deployment safety. My app is on localhost:3000."

Claude will call `verify_deployment_safety` which runs:
1. **Static scan** — reads your code for dead buttons, missing RLS, unwired forms, exposed secrets (~1 second)
2. **Swarm** — 30 test users click everything in a real browser, try garbage input, double-click money buttons, and race each other (~2 min)
3. **Report** — ranked bug list with reproduction steps and paste-ready fix prompts

## What you get

A report like:

```
1. Double-click "Buy credits" charges twice (HIGH)
   Fix: disable the button while the request is in flight.
2. "Save profile" does nothing (MEDIUM)
   Fix: wire the onClick handler.
3. Search crashes on emoji input (HIGH)
   Fix: add a try/catch in /api/search.
```

## Safety

- **Only targets localhost** (or hosts you explicitly allow in `uipocalypse.config.yaml`)
- **Never clicks delete/remove buttons** unless you explicitly opt in
- **Your code never leaves your machine** — only redacted summaries go to the LLM provider
- **No database writes** unless your DB is local and explicitly allow-listed

## Troubleshooting

| Problem | Fix |
|---|---|
| "No LLM configured" | Free mode works; add `LLM_API_KEY` to `.env` for the written report |
| "Safety Guard refused target" | Only localhost is allowed by default; add your host to `allowHosts` in `uipocalypse.config.yaml` |
| "Model returned 410" | Your LLM model was deprecated; set a current model name in `LLM_MODEL` / `LLM_SCOUT_MODEL` |
| "browserType.executable doesn't exist" | Run `npx playwright install chromium` |
| "Port already in use" | The tool doesn't need a port; your app must already be running on its own port |
