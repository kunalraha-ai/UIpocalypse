# UIpocalypse Quickstart

**Find real bugs in your app in under 5 minutes.** No writing test code.

## What you need

- Node.js 22 or newer (`node --version`) — the bundled SQLite driver requires it
- Your app running on `localhost` (any port)
- 5 minutes

## Step 1: Install

Get the repo, build it, and install the browser the swarm drives (one-time, ~120 MB):

```bash
git clone <the repo you were given>
cd UIpocalypse/uipocalypse
npm install && npm run build
npx playwright install chromium
```

That's the whole install. Nothing is published to npm — you run it from this checkout.

**Optional — LLM key.** Everything works without one: the swarm, all bug detectors, and a mechanical report with fix prompts. To add the LLM-written review, create a `.env` file in `uipocalypse/` (or the directory you run your MCP client from):

```
LLM_API_KEY=your-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_SCOUT_MODEL=gpt-4o-mini
```

Any OpenAI-compatible API works (OpenAI, Cloudflare Workers AI, local Ollama, Groq).

## Step 2: Add to Claude Code

Copy this into your Claude Code MCP config (`.claude/claude_desktop_config.json` or `claude mcp add`), with the **absolute path** to your checkout:

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

## Step 3: Ask Claude

Open Claude Code in your app's repo and say:

> "Use uipocalypse to verify deployment safety: the repo is /path/to/my-app and the app is running at http://localhost:3000."

Claude needs to pass both the repo `path` and the app `url`. It runs:

1. **Static scan** — reads your code for dead buttons, missing RLS, unwired forms, exposed secrets (~1 second)
2. **Swarm** — a few dozen test users click everything in a real browser, try garbage input, double-click money buttons, race each other (~1–2 min)
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
- **Never clicks delete/reset/remove-class buttons** unless you explicitly opt in — this also means dead buttons with those labels are invisible to the swarm (see the README "Scope and limits")
- **Your code never leaves your machine** — only redacted summaries go to the LLM provider, and nothing goes anywhere if you set no LLM key (see WHAT_WE_SEE.md)
- **No database writes** unless your DB is local and explicitly allow-listed; otherwise the run is read-only and the report says so up front

## Before running against a real app

If your app has a production database or live API keys, make a safe test copy first — see SAFE_TEST_COPY.md. It's a 5-minute setup you can paste into your own coding agent.

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm install` fails compiling `better-sqlite3` | Your Node is too old — the SQLite driver needs **Node 22+** (`node --version`) |
| `Executable doesn't exist ... chromium` | `npx playwright install chromium` in `uipocalypse/` |
| "No LLM configured" | Not an error — you're in fully-local mode. Add `LLM_API_KEY` to `.env` for the LLM-written review |
| "Model returned 410 / health check failed" | Your LLM model was deprecated; set a current model in `LLM_MODEL` / `LLM_SCOUT_MODEL` |
| "Safety Guard refused target" | Only localhost is allowed by default; add your host to `allowHosts` in `uipocalypse.config.yaml` |
| Tool error "Required at path" | You passed the `url` but not the repo `path` — `verify_deployment_safety` needs both |
| "Port already in use" | The tool opens no ports; your app must already be running on its own port |
