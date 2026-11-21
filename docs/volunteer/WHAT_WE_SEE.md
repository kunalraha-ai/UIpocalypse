# What UIpocalypse Reads and What Leaves Your Machine

Plain answers, no fine print. If anything here turns out to be wrong, that's a bug — report it.

## What the tool reads on your machine

**Static scan (before any browser opens):**

| Reads | Why | Notes |
|---|---|---|
| Your `.ts` / `.tsx` / `.js` / `.jsx` source files | Builds a map of routes, buttons, forms, and API calls | Skips `node_modules`, `.next`, `.git`, `dist`, `build` and similar. Max 3000 files, depth 10 |
| `.env`, `.env.local`, `.env.example`, `.env.development`, `.env.production` | Only to list **variable NAMES** — so it can warn when code reads an env var you never defined | **Values are never recorded.** The name `STRIPE_SECRET_KEY` may appear in output; its value never will |
| `supabase/migrations/*.sql` | Table shapes, for duplicate-write detection | Only that folder |

**In the browser (during the swarm):**

- Loads your pages, clicks your buttons, types into your fields
- Watches **your app's** network requests (other origins are ignored), console errors, uncaught page errors, and DOM changes
- Takes screenshots when it finds a problem
- Never reads your cookies, localStorage secrets, or downloads your data — agents don't exfiltrate anything; they interact like a user would

## What leaves your machine

**Nothing leaves your machine unless you set an LLM API key.** All findings, screenshots, the SQLite database, and reports stay in `.uipocalypse/` inside your project. Delete that folder and every trace is gone.

**If you do set an LLM key** (needed for the written report with fix prompts), exactly three kinds of **redacted summaries** go to the LLM provider — never your source code, never file contents, never screenshots, never database rows:

1. **Planner**: a summary of the app map — route paths, button labels, form names
2. **Scouts**: current URL, the names of buttons on the page, the last few clicks
3. **Reviewer**: finding clusters — error messages, endpoint paths, click sequences

The key is read **only** from two explicit places — the MCP config `env` block, or `~/.uipocalypse/config` — and only the four `LLM_*` variables are ever read. The tool deliberately does **not** load `.env` files from its working directory: that directory may be your app's repo, and your app's secrets must never enter the tool's process. The server prints its mode on startup (`LLM mode: off — …` / `LLM mode: on — provider …, key source: …`) before any LLM call, so a run's LLM status is never ambiguous, and every report states whether it was **Reviewed by: LLM** or **Reviewed by: mechanical template**.

Every one of these payloads passes through a redaction filter (`redactForLlm`) that strips:

- Stripe-style keys (`sk_live_...`, `pk_live_...`, `rk_...`)
- JWTs
- Database connection strings (`postgres://user:password@...`, `mongodb://`, `mysql://`, `redis://`)
- Any `password=...`, `api_key: ...`, `secret: ...`, `token: ...`-shaped pair
- **Every literal value from your `.env` files**, wherever it appears

This is enforced by a test that seeds a fixture with six fake secrets (a live Stripe key, a prod DB password, a JWT, API tokens) and asserts none of them appear in any LLM payload, log line, report, or the database. It passes 6/6.

**Bottom line:** with no key set, the tool is fully local. With a key set, redacted text summaries leave; nothing else does.

## Running with no LLM (`--no-llm` mode)

There is no flag — **just don't set `LLM_API_KEY`**. The tool notices and switches:

- **Static scan:** identical — all static detectors run
- **Plan:** generated from the app map alone (default personas and seed routes)
- **Swarm:** runs fully — agents are policy-driven and don't need an LLM
- **Report:** a mechanical version — findings ranked with evidence and screenshots, but no LLM-written root causes or fix prompts

You get the full bug list either way; the LLM only adds the prose that explains and suggests fixes.

## Safety behaviors you should know about

- Only `localhost` (or hosts you explicitly allow-list) can be targeted
- Destructive-looking buttons (delete, reset, remove…) are **never clicked** unless you explicitly opt in — the report lists every skipped control with its reason, so nothing is silently untested
- If a safe database can't be confirmed, the run is **read-only**: writes and form submits are skipped, and the report's first lines say which detection classes were NOT run — a clean read-only report is never a clean bill of health
