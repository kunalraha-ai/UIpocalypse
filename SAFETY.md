# UIpocalypse: Safety and Abuse Spec

**Status:** Draft v0.1 · **Date:** 2026-11-13

A swarm that clicks everything and hits endpoints concurrently is, by design, a load generator and a potential destruction tool. This doc defines what stops it from hurting the user, their customers, or third parties.

## 1. Threats

| # | Threat | Example |
|---|---|---|
| T1 | Run against production by accident | User points swarm at live site; agents delete data, send emails, charge cards |
| T2 | Destructive actions in staging | "Delete account," "Send invite to all," bulk-email buttons |
| T3 | Real external side effects | Real payments, SMS, emails, webhooks to third parties |
| T4 | Tool used to attack a site the user doesn't own | DDoS or probing against someone else's app |
| T5 | Leaking source or secrets to the LLM | Raw repo or `.env` contents sent to API |
| T6 | Run overwhelms a shared backend | Free-tier Supabase/DB exhausted, other users affected |
| T7 | Report/vuln disclosure harm | Publicly naming apps with live vulnerabilities |

## 2. Principles

- Default deny: unknown hosts and unknown action types are skipped, not tried.
- Explicit opt-in for anything with external side effects.
- Make the safe path the easy path (zero config for localhost).
- Fail closed: if the guard can't decide, it refuses and explains why.

## 3. Safety Guard rules

**G1. Host allow-list.** Targets must match `allowHosts` in config. Default: `localhost`, `127.0.0.1`, `*.local`, and common preview hosts (`*.vercel.app`, `*.netlify.app`) only after the ownership check (G2).

**G2. Ownership verification** for any non-local host: user must place a token (`/.well-known/uipocalypse.txt` or a meta tag) that the tool checks before the swarm starts. No token, no run. This blocks T4. *Web-UI exception (owner decision, 2026-11-22):* the local web UI may run a one-click **ownership attestation** instead ("I own this target or have permission to test it") — no token fetch, recorded as a warning on the run. The strict token path remains the default for MCP/config users and anyone who wants proof.

**G3. Prod-look refusal.** Refuse (overridable only with an explicit, loudly-worded flag plus the G2 token) when the target looks like production: custom apex domain without a staging-like subdomain, `NODE_ENV=production` detected, DB host not in `db.allowedHosts`, Stripe live keys (`sk_live_`, `pk_live_`) detected in config or app env.

**G4. DB check.** Before race/fuzz modes, resolve the DB connection used by the app (from env in the repo) and require it to be local, Docker, or a branch/dev database listed in `db.allowedHosts`. Otherwise refuse write-heavy modes.

**G5. Action risk classes.** Each discovered action is classified `safe | write | destructive | external`:
- Signals: label text (delete, remove, cancel subscription, send, invite, pay, purchase, publish, deactivate), HTTP method (DELETE/POST to certain paths), handler analysis (calls to email/SMS/payment SDKs), config `skipActions`.
- `destructive` and `external` are **never** executed unless `optIn.destructive` / `optIn.externalSideEffects` is set. Skipped actions are listed in the report as "not tested (by safety policy)".
- Unknown/unclassifiable actions that submit forms default to `write` and run only in an allowed DB environment.

**G6. Payments.** Stripe interactions only in test mode (test keys detected). Live keys → refuse the run.

**G7. Rate limiting and ramp.** Start at 5 agents, ramp to N while monitoring error rate and latency; stop ramping on degradation (default: p95 latency 3× baseline or 5xx > 5%). Global cap of 100 contexts and per-host requests/sec ceiling (default 50 rps).

**G8. Kill switch.** Global watchdog aborts on budget, or when the target returns 5xx on > 50% of requests, or on user interrupt; always emits a partial report.

**G9. Email/SMS sinks.** Where the app sends mail in dev, recommend a local sink (Mailpit); the tool warns if an SMTP/SMS provider with live credentials is detected.

## 4. LLM privacy

- Send **structured summaries** (app map, clustered findings, accessibility text), never whole files by default.
- Redact secret-like strings and `.env` values before any LLM call.
- Show a "what will be sent" preview in verbose mode; support `--no-llm`.
- Allow user-chosen LLM provider/endpoint (including local models) later.

## 5. Responsible disclosure and marketing

- Never publish names of apps with live vulnerabilities found in testing. Use aggregate/anonymized stats only.
- Notify owners privately and give a reasonable window before any public mention.
- Only scan third-party apps with owner permission; the product has no "scan any URL" mode for non-owned targets.

## 6. Acceptance tests (must pass before beta)

| Test | Expected |
|---|---|
| Target `https://example.com` with no token | Refused with clear message |
| Target prod-like domain with live Stripe key in env | Refused |
| App with "Delete account" button, no opt-in | Never clicked; listed as skipped |
| DB host is remote and not allow-listed | Race/fuzz modes refused |
| Target starts returning 5xx at 50 agents | Ramp stops, report states the degradation level |
| Secrets in `.env` | Absent from every LLM payload (verified by payload capture test) |
| Interrupt (Ctrl-C) mid-run | Contexts closed, partial report written |

## 7. Residual risks

- Heuristic classification will miss some destructive actions; opt-in defaults and the allowed-DB requirement are the backstop.
- Ownership tokens can't prove legal ownership, only control of the host.
- Users can fork and disable the guard in open-source builds. Accept this and keep the defaults strong.
