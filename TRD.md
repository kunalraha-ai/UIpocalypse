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
- **FR-P1.** One LLM call: input is the app map summary (not raw repo); output is a validated JSON plan: personas to use, goals (e.g., "complete signup with these inputs"), seed routes, nasty-input sets, expected outcomes per action where derivable.
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
- Expose a small API to the runner: `getState()`, `getActions()`, `perform(actionId)`, `drainEvents()`.
- Keep payloads small: send diffs and hashes to the runner, not full DOMs.

### 3.6 Failure detectors (all mechanical)
| Finding type | Detection |
|---|---|
| `console_error` / `page_error` | `console.error`, `pageerror`, unhandled rejection |
| `failed_request` | HTTP 4xx/5xx or network failure on app-origin requests (ignoring known benign: favicon, analytics) |
| `dead_click` | Click on enabled visible element produces no DOM mutation, no network request, no URL/hash change, and no focus or ARIA state change within 500 ms |
| `infinite_spinner` | Element matching loading heuristics (role=progressbar, `aria-busy`, common spinner classes) persists > 10 s |
| `duplicate_write` | Same write request observed ≥ 2 times within 1 s from a single agent after double-click, or DB invariant shows duplicate rows |
| `race_violation` | After race mode, invariant check fails (e.g., balance negative, duplicate unique-intent rows). Invariants come from the Planner's expectations or user config |
| `navigation_error` | Navigation to 404/500 or blank page after an in-app action |
| `unreachable_action` | Action present in code map but never reachable by any agent (reported in coverage, not as a bug) |

Every finding carries: type, severity, confidence (high/med/low), persona, state ID, action ID, steps to reproduce (the agent's recent action history), evidence (console text, request/response summary), screenshot path, trace path.

### 3.7 Collector and reviewer
- **FR-C1.** Deduplicate and cluster findings by (type, normalized message/route/action).
- **FR-C2.** Compute coverage: `reached_actions / discovered_actions`, plus a list of unreached actions with probable reasons (auth wall, requires input, destructive-skipped).
- **FR-R1.** One LLM call over clustered findings (not raw logs) to produce the report: plain-English summary, root-cause hypotheses tied to file/line when the code map has it, and fix prompts for the calling agent.

## 4. State graph and hashing

**Goal:** two visits to "the same screen" must hash identically even when content differs; different screens must hash differently.

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
  - name: credits never negative
    sql: "select count(*) from profiles where credits < 0"
    expect: 0
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

| Metric | Target | Environment |
|---|---|---|
| Static scan | ≤ 3 s / 500 files | any laptop |
| Context spin-up | ≤ 100 ms each | |
| Swarm step time (excluding app latency) | ≤ 150 ms median | |
| 50 agents × 100 steps | ≤ 30 s (excluding scouting) | 8 cores, 16 GB |
| Memory per context | ≤ 150 MB | |
| First run total | ≤ 4 min | mid-size app |
| Rerun total | ≤ 90 s | cached graph |
| LLM calls per rerun | ≤ 20 | |

These are targets, not measurements. Week 0 spikes replace them with real numbers.

## 10. LLM usage budget

- Planner: 1 call (cached). Reviewer: 1 call. Scouts: 3-5 agents × ≤ 30 steps on first run, mostly reused later. Escalations: global cap (default 15/run).
- Use accessibility-tree text as input; screenshots only on failure/ambiguity.
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

1. `ariaSnapshot` vs CDP `DOMSnapshot` for stable, fast state extraction.
2. How to detect "write" vs "destructive" actions reliably (labels, HTTP method, handler analysis).
3. Barrier-synchronized race firing: in-page `fetch` loop vs Playwright `request` API: which better reproduces real browser concurrency?
4. Handling apps that use websockets/realtime heavily.
5. Auth: how to avoid 50 simultaneous logins tripping rate limits (pre-seed N test users vs reuse one storage state).
