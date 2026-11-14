# Plain Pages — the Phase 6 held-out detector check

**Do not run any UIpocalypse detector, swarm, spike, or gate against this app
before Phase 6.** It exists to answer one question: do the Phase 4 dead-click
exclusion/suppression rules generalize to an app they were never tuned on?
Messy Mart was the held-out app once, but the repeat-activation suppression and
the native-dialog wrap were designed with its source in view, so it is now a
tuning fixture like CreditCraft. This app is untouched.

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
