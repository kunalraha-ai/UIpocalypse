# Plain Pages — the Phase 6 held-out detector check

**Status: USED (2026-11-20; root cause of the one non-detection found 2026-11-21, after the run).** UIpocalypse ran once against this app during the Phase 6 benchmark. Results: 2 of 2 REACHABLE planted dead controls detected ("Save note" ×192 obs, "Clear filters" ×98 obs), 0 false positives. The third planted control, "Reset preferences", was not a detection miss — it was skipped by the safety policy: its label contains "reset", which the Guard's destructive-label regex matches, so no agent was ever allowed to click it. (At run time this was misdiagnosed as "below the fold"; the fixture source has no lazy rendering and `isVisible` doesn't check viewport position — the regex skip is proven, see `benchmarks/plain-pages/result.md`.) No tuning was performed on this app before or after the run. The app remains a fixture; any future changes to it should be logged here as post-hoc.

**Scope of what was tested:** dead_click detection on vanilla-JS controls.
The app has no backend, no API routes, no auth — so this check only exercises
the browser-side detectors (dead_click, inconsistent_feedback, navigation).
Static-scan rules, race mode, duplicate detection, and auth-gated flows were
NOT tested by this fixture.

**What GrowthSent history testing can and cannot see (scope):**
GrowthSent is a tuning fixture. Of the 5 picked historical bugs, 2 are
deployment-specific (invisible locally), 1 is infrastructure-level (invisible
to a browser), and only 2 are potentially browser-visible — of which 1 run
was interrupted and 1 was never attempted. The history detection rate of
0-of-1 says more about GrowthSent's bug distribution than the tool.

## Why this one

- **No framework, no build step** — hand-written vanilla JS doing direct DOM
  work (appends, class toggles, text writes). Both other apps are React, so
  their idempotency semantics run through React's identical-state bail-out;
  this one has no virtual DOM at all. A generalization check on a third React
  app would not test the interesting axis.
- **Plain multi-page navigation** (real `<a>` round trips), like neither the
  Next.js app router nor the Vite SPA.
- Small enough to eyeball in five minutes; every control's ground truth is
  below.

## Ground truth (planted on purpose, documented for Phase 6 scoring)

**Must be flagged as dead (3 real dead controls):**

| Control | Where | Kind of dead |
|---|---|---|
| "Reset preferences" | `index.html` | no handler at all |
| "Clear filters" | `catalog.html` | empty `onclick=""` attribute |
| "Save note" | `catalog.html` `plain.js` | handler exists but touches nothing — the subtle dead |

**Must NOT be flagged (the interesting controls):**

| Control | Why it is alive / excluded |
|---|---|
| "Join list" (submit) | browser-blocked on invalid email (validation-blocked surface); alive on valid input (renders a receipt) |
| "Toggle dark mode" | always flips `classList` both directions — never idempotent |
| "Contact support" | `alert()`-only feedback (native-dialog wrap surface) |
| "Delete account" | destructive label — Guard must skip it, never click |
| "Show tools" / "Show books" | idempotent early-return when already active (vanilla-JS repeat-activation surface) |
| "Load more" | alive until the category list is exhausted, then no-op by design |
| "Shipping FAQ" (`<details>`) | DOM-only toggle, no network |
| nav links | real navigations |

Phase 6 scoring: dead_click should land on exactly the three planted dead
controls (the "Save note" case is the hard one — a handler that runs but does
nothing); `inconsistent_feedback` (low confidence) is acceptable on the
idempotent toggles; anything else is a false positive to count.

## Run it (Phase 6 only)

```bash
python3 -m http.server 4180 --directory held-out-app-2   # or any static server
```
