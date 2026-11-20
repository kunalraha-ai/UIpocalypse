# Blind-app held-out findings (stage 3) — for user classification

## App 3: Notes app (Vite + React + Supabase, agent-built)

**Stack:** Vite + React + Tailwind + Supabase Auth + `notes` table with RLS
**Swarm:** 20 agents, 60 s budget, glm-5.3 + llama-3.2-3b
**Graph:** 5 states / 20 actions / 20 transitions, 100% coverage

### Findings (verdict column left blank)

| # | Type | Severity | Finding | Evidence | Repro steps | Your verdict (real / FP / unsure) |
|---|---|---|---|---|---|---|
| 1 | inconsistent_feedback | low | "Sign in" — produced feedback on some interactions but not others | 2 observations; the sign-in form submits to Supabase Auth; empty-field submits are browser-validation-blocked (no DOM feedback), valid submissions show error messages on failure / redirect on success | go to the app, click Sign in with empty fields (nothing happens), then fill valid credentials (redirects) | |
| 2 | inconsistent_feedback | low | "Sign up" — produced feedback on some interactions but not others | 2 observations; same validation-blocked pattern as #1 on the sign-up tab | click Sign up tab, submit empty (nothing), then fill and submit (works) | |

### Manual testing results (bugs UIpocalypse missed)

None found. Sign-up, sign-in, note creation, note editing, note deletion, search (including special characters), and RLS isolation (user A can't see user B's notes) all work correctly. No page errors, no failed HTTP requests, no crashes under edge-case input (10k-char bodies, emoji, RTL text).

---

## App 4: Recipe organizer (SvelteKit + TypeScript, agent-built)

**Stack:** SvelteKit 2 + Svelte 5 (runes) + TypeScript, localStorage, adapter-static
**Swarm:** 20 agents, 60 s budget, glm-5.3 + llama-3.2-3b
**Graph:** 54 states / 278 actions / 326 transitions, 100% coverage

### Findings (verdict column left blank)

| # | Type | Severity | Finding | Evidence | Repro steps | Your verdict (real / FP / unsure) |
|---|---|---|---|---|---|---|
| 1 | inconsistent_feedback | low | "Save recipe" — produced feedback on some interactions but not others | 1 observation; saving a valid recipe redirects; saving with an empty/invalid name is blocked by form validation (no DOM feedback) | go to /new, click Save with empty name (nothing), then fill name and save (redirects) | |

### Manual testing results (bugs UIpocalypse missed)

None found. Recipe creation, ingredient rows, step-by-step instructions, browsing, search, ingredient filtering, shopping-list aggregation with duplicate merging, localStorage persistence across reloads, and the "load sample recipes" flow all work correctly. No page errors, no crashes under edge-case input (emoji in recipe names, empty ingredient rows, 0-step recipes). The agent that built this app ran 23/23 end-to-end browser tests and fixed the one issue it found (a Svelte 5 runes naming conflict).

---

## Detector notes from the tuning pair (apps 1–2)

| App | Detector findings | Manual bugs missed by the detector | Tuning actions taken |
|---|---|---|---|
| App 1: Habit tracker (Vite + React + localStorage) | 1 inconsistent_feedback ("Sign up"), 0 dead_clicks, 26 suppressed repeats | none found — app is clean | none needed |
| App 2: Invoice tool (Next.js + JSON file) | 3 dead_click clusters on date/number input fields ("Issue date", "Due date", "Unit price"), 8 inconsistent_feedback clusters on action buttons, 111 raw failed_request observations (all correctly classified as cancellation artifacts) | none found — the invoice builder's own testing covered the full API lifecycle | **date/time inputs added to isTextLike** (native-UI inputs no longer read as dead clicks) — commit fadcdb5. This was the only tuning change; the detector was then frozen. |

**Tuning was minimal: one runtime fix (date-input handling).** The inconsistent_feedback clusters across all 4 apps are the same class: form-submit buttons that produce feedback when fields are valid but nothing when browser validation blocks the submit — a known, low-severity, low-confidence finding type.
