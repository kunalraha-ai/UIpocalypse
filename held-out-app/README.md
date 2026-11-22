opencode
# Messy Mart — hash-validation + detector-tuning fixture

**Historical note (Phase 4):** this app served as the *held-out* validation for
the state-hash normalization (Phase 2/3 gate — that result stands) and then,
during Phase 4, as the held-out detector check. The dead-click
repeat-activation suppression and the native-dialog wrap were tuned with its
source in view, so **it is no longer held out for detectors** — it is a tuning
fixture like CreditCraft. The untouched generalization check is
`held-out-app-2/` (Plain Pages), reserved for Phase 6.

A deliberately **structurally different** app:

- **Vite + React Router SPA** — client-side routing, no SSR, vs the Next.js
  sample app
- "vibecoded" UI: divs with `role="button"`, emoji-heavy labels, inline
  styles, decorative `aria-hidden` text
- native `<dialog>`, fake slow reload (loading flag), dynamic `/item/:id`
  routes, user switcher (same screen, different text)

The hash gate: the pipeline in `spikes/src/lib/statehash.ts` must hit
≥ 90% same-screen collision and ≥ 95% different-screen separation here,
without re-tuning. Run `spikes/src/s2-heldout.ts` against it.
