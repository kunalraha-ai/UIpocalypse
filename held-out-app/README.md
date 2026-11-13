# Messy Mart — held-out hash-validation fixture

A deliberately **structurally different** app for validating the state-hash
normalization without tuning on it (implementation-plan Phase 3 gate):

- **Vite + React Router SPA** — client-side routing, no SSR, vs the Next.js
  sample app
- "vibecoded" UI: divs with `role="button"`, emoji-heavy labels, inline
  styles, decorative `aria-hidden` text
- native `<dialog>`, fake slow reload (loading flag), dynamic `/item/:id`
  routes, user switcher (same screen, different text)

The point: the hash pipeline in `spikes/src/lib/statehash.ts` must hit
≥ 90% same-screen collision and ≥ 95% different-screen separation here too,
without any re-tuning. Run `spikes/src/s2-heldout.ts` against it.
