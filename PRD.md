# UIpocalypse: Product Requirements Document

**Status:** Draft v0.1 · **Date:** 2026-11-13 · **Owner:** (you)

> One tool call launches an army of chaotic bot users against your app in a real browser, reads your codebase to find broken buttons and launch-safety holes, and reports back in minutes.

---

## 1. Problem

Vibecoders and small teams ship apps built with Lovable, Bolt, Cursor, and Claude Code without a QA process. Things that break in production:

- Buttons wired to nothing, forms with no handler, calls to endpoints that don't exist
- Double-submits creating duplicate orders, race conditions on credits/inventory
- Unhandled errors, infinite spinners, broken states after back/refresh
- Launch-safety holes: missing Supabase RLS, unverified Stripe webhooks, exposed keys

Existing options fall short for this audience:

| Option | Why it falls short |
|---|---|
| LLM-driven Playwright (Playwright MCP) | One user, one step per LLM round trip. Minutes per flow, no concurrency, no shared learning between runs. |
| AI QA platforms (QA Wolf, Momentic, Mabl, Octomind) | Priced and designed for teams with QA budgets and CI. |
| Load tools (k6, Artillery) | Need scripted scenarios, don't click UI. |
| Claude Code writing its own script | Single-user scripted flows. No swarm, personas, coverage tracking or race testing unless you build it each time. |

## 2. Product

A **local MCP server** (plus CLI) exposing tools an AI coding agent calls:

1. **Scan the codebase** (seconds, no LLM): static rules for dead handlers, missing RLS, unverified webhooks, exposed secrets, undefined env vars.
2. **Release a swarm** (20-50 persona agents) into one Chromium via isolated browser contexts. Agents run as code policies walking a shared state graph. LLM scouts explore only unseen states.
3. **Report**: funnel, failures clustered by cause, coverage %, race-condition findings, replays, and paste-ready fix prompts. The calling agent applies fixes and re-runs.

**Positioning line:** *"50 chaotic users try to break your app in a few minutes."* Be explicit that it finds **breakage**, not bad design.

## 3. Target users

- **Primary:** solo vibecoders and small teams shipping with AI builders, on Next.js/Vite + Supabase to start.
- **Secondary:** freelancers and agencies shipping many client apps (higher willingness to pay).
- **Later:** startup eng teams wanting pre-deploy chaos checks in CI.

## 4. Goals and non-goals

**Goals (v1)**
- G1. First-run time-to-report ≤ 4 min; rerun ≤ 90 s on a mid-size app.
- G2. Find real, reproducible bugs in a majority of vibecoded repos tested.
- G3. False-positive rate ≤ 20% of reported findings.
- G4. One-call UX from an AI coding tool, and fix prompts that the agent can act on.
- G5. Code never leaves the user's machine.

**Non-goals (v1)**
- Judging UX quality, copy, or "is this confusing" (premium LLM mode later).
- Production testing or real load testing (integrate k6 later).
- Forking or building a custom browser.
- Visual regression testing.
- Anti-bot-protected sites (Cloudflare, CAPTCHA).

## 5. User stories

- As a vibecoder, I say "use UIpocalypse to verify deployment safety" in Claude Code and get a ranked bug list with fixes.
- As a vibecoder, I want to see what the bots couldn't reach (coverage), so I know what's untested.
- As a founder, I want to know if two people hitting "redeem credit" simultaneously breaks my balance.
- As an agency dev, I want to run it on every client app before handoff and keep reports.
- As a safety-conscious user, I want a guarantee it will never touch production or fire destructive actions without my opt-in.

## 6. Features

| Priority | Feature |
|---|---|
| **MVP** | `scan_codebase` with ~15-20 rules (Next.js/Vite + Supabase) |
| **MVP** | Scout agents (LLM) + shared state graph |
| **MVP** | Swarm of 5 persona policies in one Chromium, 20-50 contexts |
| **MVP** | Failure detectors: console/page errors, 4xx/5xx, dead clicks, infinite spinners, duplicate writes |
| **MVP** | Concurrency/race check on write endpoints |
| **MVP** | Report with coverage %, clustered failures, screenshots, fix prompts |
| **MVP** | Safety Guard (prod refusal, destructive-action skip, rate limits) |
| v1 | Replay videos/traces, rerun diff ("fixed / new / still failing") |
| v1 | Test credential + Stripe test-mode support, goal agents for signup/checkout |
| v1 | Auto-inject `data-testid` via MCP (opt-in) |
| v1.5 | Network chaos (500s, timeouts, malformed JSON via request interception) |
| v1.5 | Mobile / slow-3G persona profiles |
| Later | Hosted dashboard, CI integration, badges, additional stacks, k6 handoff, UX-judgment LLM mode |

## 7. Success metrics

| Metric | Target |
|---|---|
| Time-to-report, first run / rerun | **Results depend on the LLM.** Current-config measurements (glm-5.3 planner + llama-3.2-3b scout via Workers AI, 2026-11-20): first run **median 136 s** (range 127–138 s excl. db reset) over 3 gate pipelines; rerun **72 s** — both inside the targets (≤ 4 min / ≤ 90 s). Previously validated on Kimi K2.7 + llama-3.1-8b (first-run median 200 s, rerun 87 s — both models deprecated with HTTP 410 on 2026-11-20, so those numbers are history, not current claims). Scout latency dominates: model IDs live in config (`LLM_MODEL`/`LLM_SCOUT_MODEL`, comma-separated fallback chains supported) and are recorded in every run row and report |
| Real bugs found per repo (median, on 10 test repos) | ≥ 3 |
| False-positive rate | ≤ 20% |
| LLM calls per rerun | ≤ 20 |
| Benchmark detection of planted bugs (see BENCHMARK.md) | ≥ 80% |
| Weekly active repos after launch (30 days) | 100 (stretch 300) |

## 8. Pricing hypothesis (to validate)

- Free: local CLI/MCP, unlimited scans (open-source core).
- Paid (later): hosted reports/history, CI integration, team features. About $15-29/mo per project; agency tier higher.
- Expect low willingness to pay and high churn among solo vibecoders. The free tool is the funnel; agencies and teams are the revenue.

## 9. Competitive landscape and differentiation

- **Real differentiators:** coverage-guided swarm with shared state graph; code-policy agents (no LLM in hot loop); concurrency/race detection; vibecoder-stack rule library; one-call MCP UX; local-first.
- **Adjacent, not competing:** MiroFish simulates social/opinion behavior from documents, with no browser, UI or bug detection. Concept overlap only ("many personas, parallel, synthesized report"). It is AGPL-3.0, so don't reuse its code in a commercial product without legal review.
- **Threats:** Claude Code or Playwright MCP shipping built-in parallel test agents; QA platforms moving down-market; Lovable/Supabase expanding built-in checks.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| State-graph hashing too volatile, so every page looks new and the speed gain vanishes | Normalization spike in Week 0; kill criterion below |
| False positives erode trust | Conservative detectors, evidence attached to every finding, confidence field, FP tracking in benchmarks |
| Swarm used as a load/DDoS tool | Domain verification, rate limits, local/staging-only defaults (SAFETY.md) |
| Destructive actions (delete account, send email, charge) | Default skip list + opt-in; test-mode requirements |
| Auth/payment walls limit coverage | Test credentials config; goal agents; report coverage honestly |
| Platform/incumbent absorbs the feature | Stay stack-specific and rule-rich; ship fast |
| AGPL contamination | Don't copy from AGPL projects; license core as MIT/Apache-2.0 |

## 11. Kill criteria (decide at end of Phase 0 and Phase 3)

- 50-agent swarm run > 2 min on a mid-size sample app → rethink architecture. (Phase 0 measured 109.7–118.0 s at 50 × 100 on the sample app: the criterion holds, but with < 10% headroom — swarm-transport optimizations are on the backlog if it tightens.)
- > 1/3 of reported findings are false positives → pause and fix detectors before adding features.
- State graph reuse saves < 50% of LLM calls from run 1 to run 2 → the speed thesis is wrong.
- Fewer than 5 of 10 real repos yield a real bug → the value prop is weak.

## 12. Open questions

1. Accessibility-tree snapshot via Playwright `ariaSnapshot` vs CDP `DOMSnapshot`: which gives a more stable state hash? (Week 0 spike)
2. How should auth be handled in v1: user-supplied storage state, or scripted login in config?
3. Does the target app tolerate 50 concurrent sessions (free-tier Supabase rate limits)? Need a default concurrency ramp.
4. Naming/trademark check on "UIpocalypse."
5. Core license: MIT vs Apache-2.0 vs source-available.
