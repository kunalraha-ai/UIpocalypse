# UIpocalypse: Technical Requirements Document

**Status:** Draft v0.1 · **Date:** 2026-11-13

## 1. Scope

Technical spec for the MVP: a local MCP server that (a) statically analyzes a Next.js/Vite + Supabase codebase, (b) runs a swarm of persona agents in one Chromium against a target URL, and (c) produces a clustered report with fix prompts. Component layout lives in ARCHITECTURE.md; safety rules in SAFETY.md.

## 2. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript (Node 20+) | One language across MCP server, runner, in-page runtime |
| MCP | Official TypeScript MCP SDK, stdio transport | Local-first |
| AST analysis | `ts-morph` (TS compiler API); tree-sitter as fallback for non-TS | JSX handler/AST queries |
| Browser | Playwright with Chromium (headless shell build) | One browser process, many contexts |
| In-page runtime | Injected via `addInitScript` / CDP `Page.addScriptToEvaluateOnNewDocument` | Bundled with esbuild |
| Storage | SQLite (`better-sqlite3`), one DB per project in `.uipocalypse/` | State graph, runs, findings |
| LLM | Anthropic API by default, provider-agnostic interface | Planner, scouts, reviewer, escalations |
| Validation | `zod` | Tool inputs, plan JSON, config |
| Tests | Vitest + a sample app with planted bugs | See BENCHMARK.md |
| Packaging | npm package + `npx uipocalypse`, MCP config snippet | |

## 3. Functional requirements

### 3.1 Code Analyzer
- **FR-A1.** Detect stack (Next.js app/pages router, Vite+React, Supabase client usage).
- **FR-A2.** Extract: routes, components, interactive elements (buttons, links, forms, inputs), handlers, `fetch`/`supabase` calls per handler, env var references, Supabase tables queried, API route files.
- **FR-A3.** Produce an **app map** JSON consumed by the Planner and used to seed the state graph.
- **FR-A4.** Run the static rule library (section 8) and return issues with file, line, severity, and a one-line fix hint.
- **FR-A5.** Complete in ≤ 3 s for a 500-file repo.

### 3.2 Planner
- **FR-P1.** One LLM call: input is the app map summary (not raw repo); output is a validated JSON plan: personas to use, goals (e.g., "complete signup with these inputs"), seed routes, nasty-input sets, expected outcomes per action where derivable. **Invariant drafting (Phase 5, review directive):** the Planner also drafts `atMost` invariants from the DB schema and app map (single-use/unique constraints mapped to write endpoints) and preflight-validates each against a clean DB — an `atMost` already violated before the run is a bad invariant, not a finding. Apps without a reachable DB keep `duplicate_request` as the standalone signal (no `duplicate_effect`).
- **FR-P2.** Plan is cached by app-map hash; reused on reruns unless the map changed.

### 3.3 Scouts
- **FR-S1.** 3-5 LLM-driven agents explore from seed states, using accessibility snapshots (not screenshots) by default; screenshots only on failure or ambiguity.
- **FR-S2.** Write every observed `(state, action, next_state)` to the state graph.
- **FR-S3.** Stop when new-state discovery rate falls below a threshold or the time budget (default 90 s) is hit.

### 3.4 Swarm
- **FR-W1.** N contexts (default 30, max configurable, hard cap 100) in one Chromium process.
- **FR-W2.** Each agent runs a **persona policy**: a pure function `(currentState, history, rng) → action`. No LLM calls in the normal path.
- **FR-W3.** Escalation: if an agent makes no progress for K steps or lands on an unknown state, it may make one LLM call (rate-limited globally) or log and abandon.
- **FR-W4.** Race mode: M contexts (default 20-30) synchronize on a barrier and fire the same write action simultaneously; post-run invariants checked (see 3.6).
- **FR-W5.** Per-agent step budget (default 100) and global wall-clock budget (default 60 s).

### 3.5 In-page runtime
Injected into every page. Responsibilities:
- Enumerate actionable elements (role, accessible name, bounding visibility, enabled state, `data-testid` if present) and produce a normalized **state signature**.
- Observe DOM mutations (`MutationObserver`), `fetch`/XHR activity (wrap), console errors, unhandled rejections, and long-pending spinners.
- **Install defensively:** `addInitScript` can run before `document.documentElement` exists, which silently kills eager `MutationObserver` setup — defer observation via `readystatechange` and never let init failure break the whole runtime (Phase 0 S4 finding).
- Expose a small API to the runner: `getState()`, `getActions()`, `perform(actionId)`, `drainEvents()`.
- Keep payloads small: send diffs and hashes to the runner, not full DOMs.

### 3.6 Failure detectors (all mechanical)
| Finding type | Detection |
|---|---|
| `console_error` / `page_error` | `console.error`, `pageerror`, unhandled rejection |
| `failed_request` | HTTP 4xx/5xx or network failure on app-origin requests (ignoring known benign: favicon, analytics) |
| `dead_click` | Click on enabled visible element produces no DOM mutation, no network request, no URL/hash change, and no focus or ARIA state change within 500 ms. **State-saturated controls are excluded** (an already-selected radio cannot produce feedback by design) — Phase 0 S4 found them as a false-positive class. **Validation-blocked submits are excluded too** (a submit on an invalid form is stopped by the browser before any app handler runs; the browser supplies its own bubble feedback) — Phase 4 found them as a false-positive class once the Garbage Paster deliberately fills constrained fields with garbage before hitting submit. **No-op text actions are excluded as well** (re-pasting an identical value into a still-focused field; "clicking" a focused field without typing) — they cannot produce feedback by design, since React bails on identical state; found by the Phase 4 swarm fixture test, and the aria-state comparison now uses the full input value, not just its length. **Native-dialog feedback counts** (`alert`/`confirm`/`prompt` are wrapped — a button whose only effect is `alert()` is alive). **Repeat-activation suppression is RUN-SCOPED via per-run alive marks:** a control that produced real feedback (mutation/request/nav/aria/dialog) earlier in the *same* run is not re-reported dead — its later zero-feedback verdicts are idempotent re-activation (nav-to-self, same-user re-click, re-selecting the active category), counted as suppressed, with the first such verdict reported once as low-confidence `inconsistent_feedback`. **Prior runs never suppress** — a control that worked in run N must not mask a regression in run N+1; the fix-verify loop (`diff_runs` "fixed / new / still failing") depends on regressions being reported. Found on the held-out app, where this class alone was 15% of all swarm steps |
| `infinite_spinner` | Element matching loading heuristics (role=progressbar, `aria-busy`, common spinner classes) persists > 10 s |
| `duplicate_request` | Same write request observed ≥ 2 times within 1 s from a single agent after double-click — **medium confidence: it proves the app has no submit guard, not that the damage happened** (the second POST may have been rejected server-side) |
| `duplicate_effect` | A configured SQL invariant confirms duplicate/corrupted rows after `duplicate_request` observations — **high confidence: the damage landed** (e.g. two transaction rows within 1 s, lost-update balance drift). Attributed after the agents finish and **before race mode** (so volley damage can never be misattributed to double-clicks), through the G4 gate; only point-in-time `atMost` invariants are evaluated — exact `expect` end-state checks are post-run only (an unredeemed coupon reads 0 mid-run, which is "not yet", not damage) |
| `race_violation` | After race mode, invariant check fails (e.g., balance negative, duplicate unique-intent rows). Invariants come from the Planner's expectations or user config. **Attribution: the race measures a pre-volley baseline and owns only pass→fail transitions** — an invariant already failing before the volley is swarm damage (owned by the `duplicate_effect` sweep) or unattributed, never a race violation. Only point-in-time `atMost` invariants are evaluated mid-run. **Proven only against a mock DB so far (Phase 0); must be re-verified against real Supabase/Postgres before it counts as demonstrated** |
| `inconsistent_feedback` | A control produced real feedback on some interactions in this run and none on others (repeat-activation verdicts suppressed as `dead_click` noise). Low severity and confidence: usually an idempotent toggle re-activated, occasionally a genuine intermittent fault ("works once, then stops") — the shape of a real bug, so it is **reported, never silently swallowed** (a swarm that misses regressions is worse than one that over-reports). One finding per control per run; Phase 5's reviewer ranks it |
| `navigation_error` | Navigation to 404/500 or a blank page **or a framework error UI (e.g., Next.js "This page couldn't load")** after an in-app action; the `pageerror` signal counts too — Next 16 does not blank the page on client crashes (Phase 0 finding) |
| `unreachable_action` | Action present in code map but never reachable by any agent (reported in coverage, not as a bug) |

Every finding carries: type, severity, confidence (high/med/low), persona, state ID, action ID, steps to reproduce (the agent's recent action history), evidence (console text, request/response summary), screenshot path, trace path.

### 3.7 Collector and reviewer
- **FR-C1.** Deduplicate and cluster findings by (type, normalized message/route/action). **Cluster key decided pre-Phase 5 (so `diff_runs` "fixed / new / still failing" is stable across runs): `type-family + normalized endpoint (app-map route template; DB table for invariant findings) + action label (masked, occurrence-collapsed)`** — never raw URLs, DOM indices or observation counts. Type-family rules: `duplicate_request`/`duplicate_effect`/`race_violation` share one family per endpoint (52 observations → one issue per flawed endpoint); `page_error`/`console_error`/`failed_request` cluster per endpoint; `dead_click` per action. The reviewer maps failing-request clusters back through the app map: a 4xx on a route that exists in the map is a *correct rejection* (downgrade), a 4xx on a missing route is a finding.
- **FR-C2.** Compute coverage: `reached_actions / discovered_actions`, plus a list of unreached actions with probable reasons (auth wall, requires input, destructive-skipped).
- **FR-R1.** One LLM call over clustered findings (not raw logs) to produce the report: plain-English summary, root-cause hypotheses tied to file/line when the code map has it, and fix prompts for the calling agent.

## 4. State graph and hashing

**Goal:** two visits to "the same screen" must hash identically even when content differs; different screens must hash differently.

**Extraction method (decided in Phase 0):** Playwright `ariaSnapshot` — 100% same-screen collision and 100% different-screen separation on the sample app, 73 ms / 0.9 KB per capture. CDP `DOMSnapshot` was rejected: it captures the DOM regardless of visibility (closed dialogs still hash), needs a `layout` join to fix that, and costs 17× the payload. See PHASE0_RESULTS.md. **Open risk:** validated on one app; must also pass on a second, structurally different held-out app before Phase 3 leans on it.

**Normalization pipeline**
1. Route template: strip dynamic segments (`/orders/123` → `/orders/:id`) using the app map's route list.
2. Interactive-element signature set: `role + normalized accessible name`, where digits, UUIDs, dates and emails in names are masked.
3. Collapse repeated siblings (lists, tables, feeds) to `role:name-pattern ×N` with N bucketed (0, 1, 2-5, 6+).
4. Include coarse flags: modal/dialog open, auth state, form validity state, loading present.
5. State hash = SHA-1 of sorted, joined signature set.

**Acceptance:** on the sample app, ≥ 90% of manually labelled "same screen" pairs collide and ≥ 95% of "different screen" pairs don't. Tuned in the Week 0 spike.

**Schema (SQLite)**
```sql
states(id INTEGER PK, hash TEXT UNIQUE, route TEXT, signature_json TEXT, first_run INTEGER);
actions(id INTEGER PK, state_id INTEGER, locator TEXT, kind TEXT, label TEXT,
        risk_class TEXT,            -- safe | write | destructive | external
        UNIQUE(state_id, locator));
transitions(from_state INTEGER, action_id INTEGER, to_state INTEGER,
            count INTEGER, avg_ms REAL, error_count INTEGER,
            PRIMARY KEY(from_state, action_id, to_state));
runs(id INTEGER PK, started_at TEXT, target_url TEXT, agents INTEGER,
     duration_ms INTEGER, llm_calls INTEGER, coverage REAL);
findings(id INTEGER PK, run_id INTEGER, type TEXT, severity TEXT, confidence TEXT,
         persona TEXT, state_id INTEGER, action_id INTEGER, cluster_id TEXT,
         evidence_json TEXT, screenshot TEXT, trace TEXT);
```

## 5. Persona policy interface

```ts
interface Persona {
  id: string;
  describe(): string;
  chooseAction(ctx: {
    state: StateSnapshot;
    actions: Action[];             // already filtered by Safety Guard
    history: Step[];
    graph: GraphView;              // read-only; visit counts per transition
    rng: () => number;             // seeded for reproducibility
  }): Decision;                    // { action, input?, repeat?, delayMs? } | { abandon: true } | { escalate: true }
}
```

**MVP personas**
| Persona | Behavior |
|---|---|
| Wanderer | Weighted random; prefers least-visited transitions (coverage-guided) |
| Double-Clicker | Re-fires submit-like actions 2-3× within 50 ms |
| Garbage Pasting | Fills inputs from nasty sets: empty, 10k chars, emoji/RTL, HTML/SQL fragments, negative/huge numbers, whitespace-only |
| Abandoner | Leaves mid-flow, then returns via back/refresh/new tab-equivalent |
| Race Runner | Joins barrier, fires target write action simultaneously with peers |

v1.5: Mobile-3G (viewport + throttling), Network Chaos (route interception with 500s, timeouts, malformed JSON), Keyboard-Only.

All randomness is seeded; every finding records the seed so runs are reproducible.

## 6. MCP tool surface

| Tool | Input (zod) | Output |
|---|---|---|
| `scan_codebase` | `{ path, stack? }` | `{ scanId, issues[], appMap }` |
| `plan_swarm` | `{ scanId, agents?, personas?, goals? }` | `{ planId, personas[], goals[] }` |
| `run_swarm` | `{ url, planId?, agents?, budgetSeconds?, optIn?: { destructive?, externalSideEffects? } }` | `{ runId, summary, coverage, findingCounts }` (streams progress notifications) |
| `get_report` | `{ runId, format?: "markdown" \| "json" }` | report + fix prompts |
| `list_runs` / `diff_runs` | `{ a, b }` | fixed / new / still failing |

`verify_deployment_safety` can be a convenience wrapper chaining the four main tools, so one natural-language request maps to one call.

## 7. Configuration (`uipocalypse.config.yaml`)

```yaml
target: http://localhost:3000
allowHosts: [localhost, "*.vercel.app"]     # verified-ownership list
agents: 30
budgetSeconds: 60
auth:
  storageState: .uipocalypse/auth.json     # or loginScript
skipActions: ["Delete account", "Send invite"]
destructiveOptIn: false
db:
  allowedHosts: [localhost, 127.0.0.1]
invariants:
  # atMost = point-in-time damage predicate: checked by race mode (baseline →
  # post-volley transition) and the duplicate_effect sweep mid-run.
  - name: credits never negative
    sql: "select count(*) from profiles where credits < 0"
    atMost: 0
  # expect = exact end-state check, evaluated only in the post-run report —
  # mid-run it reads "not yet", which is not damage.
  - name: exactly one welcome coupon redeemed
    sql: "select count(*) from coupon_redemptions where code = 'WELCOME'"
    expect: 1
```

## 8. Static rule library (MVP, ~15-20 rules)

- `dead-handler`: onClick missing, empty, or `() => {}`
- `unwired-form`: `<form>` with no submit handler/action
- `missing-endpoint`: `fetch('/api/x')` with no matching route file
- `missing-rls`: Supabase table in migrations without RLS enabled
- `permissive-rls`: policy `using (true)` on user-data tables
- `service-key-in-client`: service-role key referenced in client code
- `exposed-secret`: key-shaped strings in client bundle sources
- `undefined-env`: env var read but absent from `.env.example`/config
- `no-error-state`: async call with no catch/error UI
- `no-loading-state`: async submit with no pending state/disabled button
- `unverified-stripe-webhook`: webhook route without signature verification
- `missing-submit-guard`: write handler with no double-submit protection
- `unauth-write-route`: API route that writes without an auth check
- `no-rate-limit-auth`: auth endpoints without any rate limiting (heuristic)
- `missing-meta`: no title/description/OG tags (low severity)

## 9. Performance targets

Measured numbers from Phase 0 (PHASE0_RESULTS.md) replace the original estimates; the original "50 agents × 100 steps ≤ 30 s" was ~4× off — per-step CDP transport under 50-way contention costs ~160 ms regardless of app speed, and lockstep rounds are gated by stragglers (post-navigation recoveries average ~1.5 s).

| Metric | Target | Phase 0 measurement |
|---|---|---|
| Static scan | ≤ 3 s / 500 files | Phase 2 measures |
| Context spin-up | ≤ 100 ms | 83–95 ms avg ✅ |
| Swarm step time | ≤ 200 ms median | p50 155–167 ms (50 contexts, one Chromium; avg concurrency only ~11 agents — CDP channel serialization) |
| 50 agents × 100 steps | ≤ 2 min (capacity) | 109.7–118.0 s — **a couple of minutes**, gate headroom < 10% |
| Memory per context | ≤ 160 MB incl. shared browser overhead | ~157–160 MB |
| First run total | ≤ 4 min | Phase 5 measures |
| Rerun total | ≤ 90 s | Phase 5 measures — runs are capped by `budgetSeconds` (default 60 s), so the swarm phase's ~2-min *capacity* is not the run *duration* |
| LLM calls per rerun | ≤ 20 | Phase 3 measures |

Optimization levers if the swarm phase must get faster (not needed for current gates): step agents independently instead of lockstep rounds (removes straggler gating); shard across multiple Chromium processes for > 50 agents.

## 10. LLM usage budget

- Planner: 1 call (cached). Reviewer: 1 call. Scouts: 3-5 agents × ≤ 30 steps on first run, mostly reused later. Escalations: global cap (default 15/run).
- Use accessibility-tree text as input; screenshots only on failure/ambiguity.
- **Reasoning-model note (Phase 3 finding): `reasoning_content` tokens count against `max_tokens` — leave headroom (scouts use 1500) and count *calls*, not tokens, against the rerun budget.**
- Provider-agnostic interface, cost estimate shown before run, and a `--no-llm` mode that runs static scan + graph-only swarm (degraded but free).

## 11. Error handling and resilience

- Per-context crash isolation: a crashed context is logged as a finding and replaced; it doesn't stop the run.
- Global watchdog: abort at budget; always emit a partial report.
- Target-app health probe; stop the swarm early if the app is down or returning 5xx on > 50% of requests (report as "app collapsed under load" with the concurrency level reached).

## 12. Testing strategy

- Unit: rule engine, hash normalization, persona policies (seeded), detectors.
- Integration: swarm against the sample app with planted bugs (BENCHMARK.md), asserting detection rate, FP rate, and timing.
- Regression: golden app-map and golden state-hash fixtures.
- Safety tests: guard must refuse prod-like hosts and skip destructive actions (see SAFETY.md).

## 13. Open technical questions

1. **RESOLVED (Phase 0 S2):** `ariaSnapshot` — 100% collision / 100% separation on the sample app at 73 ms and 0.9 KB per capture. CDP `DOMSnapshot` rejected (visibility-blind: closed dialogs still hash; 17× payload). See PHASE0_RESULTS.md. Remaining risk: single-app validation; a second held-out app is a Phase 3 gate.
2. How to detect "write" vs "destructive" actions reliably (labels, HTTP method, handler analysis).
3. Barrier-synchronized race firing: in-page `fetch` loop vs Playwright `request` API: which better reproduces real browser concurrency?
4. Handling apps that use websockets/realtime heavily.
5. Auth: how to avoid 50 simultaneous logins tripping rate limits (pre-seed N test users vs reuse one storage state).
