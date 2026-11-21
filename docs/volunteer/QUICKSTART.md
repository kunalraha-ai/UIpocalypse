# UIpocalypse Quickstart

**Find real bugs in your app in under 5 minutes.** No writing test code.

## What you need

- The release tarball (`uipocalypse-0.0.1.tgz`) — the tool is not on npm
- Node.js 22 or newer (`node --version`) — the bundled SQLite driver requires it
- Your app running on `localhost` (any port)
- 5 minutes

## Step 1: Install

```bash
mkdir uipocalypse && tar -xzf uipocalypse-0.0.1.tgz -C uipocalypse --strip-components=1
cd uipocalypse
npm install --omit=dev          # dependencies only; ignore npm-audit noise
npx playwright install chromium # one-time: the browser the swarm drives
```

That's the whole install. The full volunteer kit (this file, WHAT_WE_SEE.md,
SAFE_TEST_COPY.md, FEEDBACK.md) is in `dist/docs/volunteer/`.

## Step 2: Add to Claude Code (or any MCP client)

Point your MCP client at the built server, with the **absolute path**:

```json
{
  "mcpServers": {
    "uipocalypse": {
      "command": "node",
      "args": ["/absolute/path/to/uipocalypse/dist/index.cjs"]
    }
  }
}
```

**Optional — LLM key.** Everything works without one: the swarm, all bug
detectors, and a mechanical report with template fix prompts. To add the
LLM-written review, put the key in the MCP config's `env` block (recommended —
it goes straight to the server process):

```json
{
  "mcpServers": {
    "uipocalypse": {
      "command": "node",
      "args": ["/absolute/path/to/uipocalypse/dist/index.cjs"],
      "env": {
        "LLM_API_KEY": "your-key",
        "LLM_BASE_URL": "https://api.openai.com/v1",
        "LLM_MODEL": "gpt-4o-mini",
        "LLM_SCOUT_MODEL": "gpt-4o-mini"
      }
    }
  }
}
```

…or in `~/.uipocalypse/config` (a plain `KEY=VALUE` file):

```
LLM_API_KEY=your-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_SCOUT_MODEL=gpt-4o-mini
```

**These are the only two places the tool reads a key from.** It deliberately
does NOT load `.env` files from the working directory — the directory your MCP
client runs in may be your app's repo, and your app's secrets (Stripe keys, DB
passwords) must never enter the tool's process. Only the four `LLM_*`
variables above are ever read.

**Supported providers:** anything with an OpenAI-compatible `/chat/completions`
endpoint — OpenAI, Cloudflare Workers AI, Groq, Together, OpenRouter, or a
local Ollama (`http://localhost:11434/v1`, set `LLM_API_KEY=ollama`).

**Never share the project owner's key.** Each volunteer uses their own key, or
none. Keys stay on your machine.

## Step 3: Check the mode line

Start the server (or ask your MCP client to connect) and look at its first
output line — before any run, before any LLM call:

```
LLM mode: off — no LLM_API_KEY configured (fully local run; mechanical report)
LLM mode: on — provider api.openai.com, key source: MCP config env block (process environment)
```

If this doesn't match what you expect — e.g. you set no key but it says
`on` — stop and check where the key is coming from. Every report also states
whether it was **Reviewed by: LLM** or **Reviewed by: mechanical template**.

## Step 4: Ask Claude

Open Claude Code in your app's repo and say:

> "Use uipocalypse to verify deployment safety: the repo is /path/to/my-app and the app is running at http://localhost:3000."

Claude needs to pass both the repo `path` and the app `url`. It runs:

1. **Static scan** — reads your code for dead buttons, missing RLS, unwired forms, exposed secrets (~1 second; Next.js/Vite/Supabase code only — plain HTML gets 0 static issues)
2. **Swarm** — a few dozen test users click everything in a real browser, try garbage input, double-click money buttons, race each other (~1–2 min)
3. **Report** — ranked bug list with reproduction steps and paste-ready fix prompts

Results land in `.uipocalypse/` under the server's working directory (or under
`$UIP_WORKSPACE` if you set it).

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
- **Never clicks delete/reset/remove-class buttons** unless you explicitly opt in — skipped controls are listed in the report with the opt-in path
- **Your code never leaves your machine** — only redacted summaries go to the LLM provider, and nothing goes anywhere without a key (see WHAT_WE_SEE.md)
- **No database writes** unless your DB is local and explicitly allow-listed; otherwise the run is read-only and the report says so up front

## Before running against a real app

If your app has a production database or live API keys, make a safe test copy first — see SAFE_TEST_COPY.md. It's a 5-minute setup you can paste into your own coding agent.

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm install` fails compiling `better-sqlite3` | Your Node is too old — the SQLite driver needs **Node 22+** (`node --version`) |
| `Executable doesn't exist ... chromium` | `npx playwright install chromium` in the uipocalypse directory |
| "No LLM configured" | Not an error — fully-local mode. Add a key via the MCP env block or `~/.uipocalypse/config` |
| Mode line says `on` but you set no key | A key exists in the MCP env block or `~/.uipocalypse/config` — check both |
| "Model returned 410 / health check failed" | Your LLM model was deprecated; set a current model in `LLM_MODEL` / `LLM_SCOUT_MODEL` |
| Auth rejected (HTTP 401) in the mode/health line | Wrong `LLM_API_KEY`, or `LLM_BASE_URL` points at the wrong provider/account |
| "Safety Guard refused target" | Only localhost is allowed by default; add your host to `allowHosts` in `uipocalypse.config.yaml` |
| Tool error "Required at path" | You passed the `url` but not the repo `path` — `verify_deployment_safety` needs both |
