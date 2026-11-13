# UIpocalypse: Architecture

**Status:** Draft v0.1 · **Date:** 2026-11-13

## 1. Principles

1. **LLM at the edges, code in the middle.** The model plans, explores unfamiliar states, and writes the report. The hot loop is deterministic code.
2. **Real browser is the oracle.** We never simulate the browser. Findings come from observed behavior.
3. **Learn once, reuse everywhere.** A shared state graph turns the first agent's slow exploration into every later agent's fast path.
4. **Safe by default.** Local/staging only, destructive actions skipped, load rate-limited.
5. **Local-first.** Source code never leaves the user's machine (only structured summaries go to the LLM).

## 2. System overview

```mermaid
flowchart TD
    CLIENT["Claude Code / Cursor / Lovable<br/>(MCP client)"]
    MCP["UIpocalypse MCP Server (local)<br/>scan_codebase · plan_swarm · run_swarm · get_report"]

    subgraph PIPE["Pipeline"]
        direction TB
        S1["1. Code Analyzer<br/>AST + rule engine, no LLM"]
        S2["2. Planner<br/>LLM call #1"]
        S3["3. Scouts (3-5)<br/>LLM-driven exploration"]
        S4["4. Swarm Orchestrator"]
        S5["5. Collector & Aggregator"]
        S6["6. Reviewer<br/>LLM call #2"]
    end

    GRAPH[("State Graph (SQLite)")]

    subgraph BROWSER["One Chromium"]
        direction LR
        C1["ctx 1"]
        C2["ctx 2"]
        CN["... ctx N"]
    end

    ESC["LLM escalation<br/>(stuck / unknown only)"]
    TARGET["Target App<br/>localhost / staging + local or branch DB"]
    GUARD{{"Safety Guard"}}

    CLIENT -->|tool calls| MCP
    MCP --> S1 --> S2
    S2 -->|seeds| GRAPH
    S2 --> S3
    S3 -->|writes| GRAPH
    S3 --> S4
    S4 <-->|reads/writes| GRAPH
    S4 --> BROWSER
    BROWSER -->|clicks, inputs, concurrent hits| TARGET
    BROWSER -.->|stuck| ESC
    ESC -.-> BROWSER
    TARGET -->|events, errors, screenshots| S5
    S5 --> S6
    S6 -->|report + fix prompts| MCP
    MCP -->|results| CLIENT
    GUARD -.- S3
    GUARD -.- S4
    GUARD -.- BROWSER

    classDef llm fill:#ffe4b5,stroke:#d2691e,color:#000
    classDef code fill:#e0f0ff,stroke:#4682b4,color:#000
    classDef safe fill:#ffd6d6,stroke:#c0392b,color:#000
    class S2,S3,S6,ESC llm
    class S1,S4,S5,C1,C2,CN code
    class GUARD safe
```

Orange = uses an LLM. Blue = plain code. Red = safety.

## 3. Components

| # | Component | Responsibility | LLM? |
|---|---|---|---|
| 0 | **MCP Server** | Tool surface, config loading, progress streaming, run lifecycle | No |
| 1 | **Code Analyzer** | AST parse, app map extraction, static rules, issue output | No |
| 2 | **Planner** | App map → personas, goals, seed states, nasty-input sets (validated JSON) | 1 call |
| 3 | **Scouts** | Slow, LLM-driven exploration to populate the state graph | Yes (3-5 agents) |
| 4 | **Swarm Orchestrator** | Spawns contexts, assigns personas, runs barrier/race mode, enforces budgets | No |
| 5 | **In-page Runtime** | Injected script: state signature, action enumeration, event capture, action execution | No |
| 6 | **State Graph** | SQLite store of states, actions, transitions, visit counts, coverage | No |
| 7 | **Safety Guard** | Host allow-list, prod refusal, destructive-action filter, rate limiter | No |
| 8 | **Collector** | Dedupe/cluster findings, compute coverage, attach evidence | No |
| 9 | **Reviewer** | Cluster list → report + fix prompts | 1 call |

## 4. Run sequence

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant CC as Claude Code (MCP client)
    participant MCP as UIpocalypse MCP
    participant CA as Code Analyzer
    participant PL as Planner (LLM)
    participant SC as Scouts (LLM)
    participant SG as State Graph
    participant OR as Orchestrator
    participant BR as Chromium (N contexts)
    participant APP as Target App
    participant RV as Reviewer (LLM)

    Dev->>CC: "Use UIpocalypse and verify deployment safety"
    CC->>MCP: scan_codebase(repo)
    MCP->>CA: parse AST, run rules
    CA-->>MCP: issues + app map
    MCP-->>CC: static issues
    CC->>MCP: plan_swarm(app map)
    MCP->>PL: app map
    PL-->>MCP: personas, goals, seeds
    MCP->>SG: write seeds
    CC->>MCP: run_swarm(url, agents)
    MCP->>MCP: Safety Guard checks
    MCP->>SC: launch scouts
    loop until discovery saturates or budget hit
        SC->>APP: act
        APP-->>SC: new state
        SC->>SG: write transition
    end
    MCP->>OR: release swarm
    OR->>BR: spawn contexts + persona policies
    par Agents 1..N
        loop each step
            BR->>SG: lookup state, choose action
            BR->>APP: click / fill / double-click / abandon
            APP-->>BR: response + DOM change
            BR->>SG: record transition
        end
    and Race mode
        BR->>APP: M contexts fire same write at once
    end
    BR-->>OR: findings + evidence
    OR->>MCP: aggregate, cluster, coverage
    CC->>MCP: get_report
    MCP->>RV: clustered findings
    RV-->>MCP: report + fix prompts
    MCP-->>CC: report
    CC->>Dev: summary, applies fixes, re-runs
```

## 5. Data flow

1. **Repo → app map** (Analyzer): routes, elements, handlers, API calls, tables, env vars.
2. **App map → plan** (Planner): personas, goals, seeds. Only a summary crosses to the LLM.
3. **Plan + seeds → state graph** (initial nodes/edges, unvisited).
4. **Scouts → graph**: observed transitions fill in the map.
5. **Swarm ↔ graph**: agents read visit counts to prefer unexplored actions and write new transitions.
6. **Browser events → collector**: raw events become findings with evidence.
7. **Findings → reviewer → report**: clustered, ranked, mapped back to code via the app map.

## 6. Key design decisions

| # | Decision | Rationale | Alternatives rejected |
|---|---|---|---|
| D1 | Do **not** fork Chromium | Maintenance burden is huge; the bottleneck is the LLM loop, not the browser | Custom browser, Lightpanda as primary |
| D2 | **Contexts**, not tabs | Isolated cookies/storage per simulated user; ms spin-up | 50 tabs (shared session), 50 browsers (RAM) |
| D3 | Swarm agents are **code policies** | Speed and cost: no LLM per step | 50 LLM-driven agents (minutes, expensive, rate limits) |
| D4 | **Shared state graph** keyed by normalized accessibility signature | Reuse exploration across agents and runs | Per-agent exploration |
| D5 | Accessibility/DOM text over screenshots | Orders of magnitude cheaper and faster | Screenshot loop |
| D6 | Static code scan **before** the swarm | Seeds the graph, flags obvious issues instantly | Pure black-box crawl |
| D7 | MCP server, local | Fits AI-coding workflow; code stays local | Hosted-only SaaS |
| D8 | SQLite | Zero-ops, embeddable, queryable | Postgres, JSON files |
| D9 | In-page runtime + thin runner | Few CDP round trips per step | Pure Playwright locator calls per element |
| D10 | Lightpanda/jsdom as optional fast pre-pass (later) | Cheap first filter; Chromium remains the oracle | Replacing Chromium |

## 7. Deployment topology (MVP)

Everything runs on the developer's machine: MCP server process (stdio) → Playwright-managed Chromium → target app on localhost/staging. Only LLM API calls leave the machine, carrying structured summaries (app map, clustered findings, accessibility text), not source files. Optional later: a cloud runner for 100+ agents and CI.

## 8. Scalability limits to be aware of

- ~50-150 MB per context, so ~30 contexts is comfortable on a laptop; beyond ~50, use more cores/RAM or multiple Chromium processes.
- The **target app** is often the bottleneck (DB connection limits, free-tier rate limits). The orchestrator ramps concurrency and reports the level at which the app degraded.
- First run is dominated by scouts' LLM latency; reruns are dominated by app response time.

## 9. Cross-cutting concerns

- **Reproducibility:** seeded RNG per agent; each finding stores seed + action history.
- **Observability:** structured run log, timing per phase, LLM call count and cost estimate, coverage report.
- **Privacy:** no source upload; redact secrets from any summary sent to the LLM; `--no-llm` mode.
- **Extensibility:** persona and rule plug-in interfaces; stack adapters (Next.js + Supabase first; Vite, SvelteKit, Firebase later).
