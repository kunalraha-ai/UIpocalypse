# Plain Pages held-out check (stage 2) — 2026-11-20

UIpocalypse ran ONCE against `held-out-app-2/` (Plain Pages), untouched since it was written. Default config: 20 agents, 60 s budget, no config file, no invariants, glm-5.3 + llama-3.2-3b. **No tuning afterward.**

## Ground truth (from held-out-app-2/README.md)

**Must be flagged (3 planted dead controls):**
1. "Reset preferences" — no handler at all (`index.html`)
2. "Clear filters" — empty `onclick=""` attribute (`catalog.html`)
3. "Save note" — handler exists but touches nothing (`plain.js` — the subtle dead)

**Must NOT be flagged:**
- "Join list" submit (browser-blocked on invalid; alive on valid)
- "Toggle dark mode" (always flips)
- "Contact support" (alert() feedback — wrapped since phase 4)
- "Delete account" (destructive — Guard skips)
- "Show tools" / "Show books" (idempotent early-return on active filter)
- "Load more" (alive until exhausted, then no-op)
- "Shipping FAQ" (DOM-only toggle)
- nav links (real navigations)

## Results

285 dead_click observations, 4 inconsistent_feedback, 1,978 steps, 100% graph coverage (3 states, 14 actions), 60 s wall.

| Action | Verdict | Count | Assessment |
|---|---|---|---|
| dead_click: **Save note** | **TRUE POSITIVE** ✅ (planted #3, the subtle one) | 192 | The handler-runs-but-touches-nothing case — found |
| dead_click: **Clear filters** | **TRUE POSITIVE** ✅ (planted #2) | 98 | The empty-onclick case — found |
| dead_click: **Reset preferences** | **NOT FOUND** ❌ (planted #1) | 0 | Missed — no dead_click verdict for this control |
| inconsistent_feedback: Load more | benign | 2 | Idempotent when exhausted — correct classification, ranked low |
| inconsistent_feedback: you@example.com | benign | 1 | Validation-blocked form — correct, not a dead click |
| inconsistent_feedback: Show books | benign | 1 | Idempotent filter — correct |
| inconsistent_feedback: Show tools | benign | 1 | Idempotent filter — correct |

**Detection: 2 of 3 planted dead controls (66.7%). Missed the no-handler "Reset preferences" button.**

## Why "Reset preferences" was missed

"Reset preferences" is on `index.html` — the newsletter page. The runtime graph shows only 3 states / 14 actions, which maps to the catalog page + about + home. The button is a plain `<button>` with NO handler, NO form, and NO `type` — it's outside any form. The dead-handler static rule would catch it, but `scan_codebase` was not run against Plain Pages (it's a static app with no package.json — the analyzer doesn't know the framework). The dynamic swarm's 3 states suggest the scouts didn't fully explore the newsletter section of index.html (it's below the fold — the "Join list" form, "Reset preferences", and the FAQ are all on the same page but below the catalog content).

## False positives

**0** — every non-planted control was either correctly exercised (no finding) or correctly classified as `inconsistent_feedback` (benign, low confidence). The "Delete account" button was correctly skipped by the Guard (destructive label).

## Post-hoc change log

None. No tuning was performed after this run. The miss is recorded as-is; if a fix is warranted (e.g., seeding the swarm to explore below-the-fold content), it would be logged here and the fixture would be marked "used" in its README.

## Raw output

`benchmarks/plain-pages/run.json`
