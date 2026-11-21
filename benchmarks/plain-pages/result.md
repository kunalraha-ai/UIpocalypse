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

285 dead_click observations, 4 inconsistent_feedback, 1,978 steps, graph coverage **87.5% (14/16)** — recorded at run time as 100% because the two Guard-skipped actions ("Reset preferences", "Delete account") were silently dropped from the denominator; recomputed 2026-11-21 after the skip-visibility fix (14 reached + 2 skipped-by-policy = 16 discovered). 60 s wall.

| Action | Verdict | Count | Assessment |
|---|---|---|---|
| dead_click: **Save note** | **TRUE POSITIVE** ✅ (planted #3, the subtle one) | 192 | The handler-runs-but-touches-nothing case — found |
| dead_click: **Clear filters** | **TRUE POSITIVE** ✅ (planted #2) | 98 | The empty-onclick case — found |
| dead_click: **Reset preferences** | **SKIPPED BY SAFETY POLICY** ⚠️ (planted #1) | 0 | Never clicked — destructively-labeled (regex matches "reset"). At run time this skip was invisible (the run predates the skip-visibility fix: not listed, and the action was dropped from the coverage denominator, which is why coverage read 100%); the skip-visibility fix now lists such actions and counts them as unreached |
| inconsistent_feedback: Load more | benign | 2 | Idempotent when exhausted — correct classification, ranked low |
| inconsistent_feedback: you@example.com | benign | 1 | Validation-blocked form — correct, not a dead click |
| inconsistent_feedback: Show books | benign | 1 | Idempotent filter — correct |
| inconsistent_feedback: Show tools | benign | 1 | Idempotent filter — correct |

**Detection: 2 of 2 REACHABLE planted dead controls (100%). The third, "Reset preferences", was never tested — skipped by safety policy (its label contains "reset", which the Guard's destructive-label regex matches). Reframed 2026-11-21 after the root cause was found; the original framing ("2 of 3, 66.7%, missed") counted a safety-policy skip as a detector miss.**

**Reframed honestly:**
- **Detector recall on reachable dead controls: 2 of 2.** Both controls the Guard allowed it to click, it correctly flagged — including the subtle handler-runs-but-touches-nothing case.
- **1 control was skipped by safety policy, not tested.** "Reset preferences" is destructively-labeled by regex, so the Guard refused every attempt to click it. That is a coverage limitation of the safety-first design (dead buttons labeled reset/delete/remove are invisible without opt-in), not a detection failure. See the correction below and the README "Scope and limits".

## Why "Reset preferences" was missed

**CORRECTION (2026-11-21, volunteer-readiness audit): the original "below the fold" explanation below was WRONG. The real cause is the Safety Guard's destructive-label filter.**

The Guard's `DESTRUCTIVE_RE` (`src/guard/actions.ts`) includes the word `reset`:

```
/\b(delete|remove|cancel\s+subscription|unsubscribe|deactivate|destroy|purge|reset)\b/i
```

`"Reset preferences"` matches `\breset\b`, so the button was classified **destructive and skipped on every enumeration** — the same treatment "Delete account" correctly got. It was never offered to a single agent, which is why it has 0 observations. Verified against the fixture source: the button is a plain `<button id="dead1">` in static DOM at the top level of `index.html` — no lazy rendering, no IntersectionObserver; the runtime's `isVisible` doesn't check viewport position, so a below-the-fold placement would NOT have prevented enumeration. The `node -e` regex check confirms: `"Reset preferences" => DESTRUCTIVE (skipped)`.

**Implication (a real detection blind spot, documented in the README "Scope and limits"):** any dead control whose label contains delete/remove/reset/purge/destroy/unsubscribe/deactivate is invisible to the dynamic swarm unless the user opts in to destructive actions. Safety-first by design; the cost is recorded here honestly. No detector or threshold was changed for this finding.

---

Original (wrong) explanation, kept for the record:

> "Reset preferences" is on `index.html` — the newsletter page. The runtime graph shows only 3 states / 14 actions, which maps to the catalog page + about + home. The button is a plain `<button>` with NO handler, NO form, and NO `type` — it's outside any form. The dead-handler static rule would catch it, but `scan_codebase` was not run against Plain Pages (it's a static app with no package.json — the analyzer doesn't know the framework). The dynamic swarm's 3 states suggest the scouts didn't fully explore the newsletter section of index.html (it's below the fold — the "Join list" form, "Reset preferences", and the FAQ are all on the same page but below the catalog content).

(One true part survives from the original: the static dead-handler rule would have caught this button if `scan_codebase` had run — but Plain Pages has no package.json, so the analyzer had no entry point. Two independent gaps, both now recorded.)

## Post-hoc change log

None. No tuning was performed after this run. The miss is recorded as-is; if a fix is warranted (e.g., seeding the swarm to explore below-the-fold content), it would be logged here and the fixture would be marked "used" in its README.

## False positives

**0** — every non-planted control was either correctly exercised (no finding) or correctly classified as `inconsistent_feedback` (benign, low confidence). The "Delete account" button was correctly skipped by the Guard (destructive label).

## Raw output

`benchmarks/plain-pages/run.json`
