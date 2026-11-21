# UIpocalypse Volunteer Feedback

Your answers decide what happens next. Honest negatives are more useful than polite silence. Fill in what you can, skip what you can't — a partial reply helps.

**About your machine and app:** operating system + version (e.g. Ubuntu 24.04, macOS 15): ______ · Node version (`node --version`): ______ · app stack (framework, DB, size): ______ · is the app live in production? ______

---

## Setup

1. Did the install work following QUICKSTART.md (tarball → `npm install --omit=dev` → `npx playwright install chromium`)? ▢ Yes ▢ No — what broke:
2. Minutes from receiving the tarball to your first report: ______
3. Did you make a safe test copy first (SAFE_TEST_COPY.md)? ▢ Yes, my coding agent did it ▢ Yes, manually ▢ No — why not:
4. Did the tool's first output line say `LLM mode: off` or `on`? Did that match what you expected? ▢ Yes ▢ No:
5. Which step was the most confusing?

## Findings

For each finding in your report, mark one:

| # | Finding | Real bug | False positive | Not sure | Did the fix prompt work when pasted into your agent? |
|---|---|---|---|---|---|
| 1 | | ▢ | ▢ | ▢ | ▢ yes ▢ partly ▢ no ▢ didn't try |
| 2 | | ▢ | ▢ | ▢ | ▢ yes ▢ partly ▢ no ▢ didn't try |
| 3 | | ▢ | ▢ | ▢ | ▢ yes ▢ partly ▢ no ▢ didn't try |
| 4 | | ▢ | ▢ | ▢ | ▢ yes ▢ partly ▢ no ▢ didn't try |
| 5 | | ▢ | ▢ | ▢ | ▢ yes ▢ partly ▢ no ▢ didn't try |

(More rows: copy-paste. For "real bug" — a shipped bug you didn't already know about counts double; tell us about those in a sentence.)

## Trust and safety

5. Before running, were you worried the tool might break something? What reassured you or didn't?
6. Did anything the tool did surprise or worry you (traffic volume, LLM use, files touched)?
7. Was the "what leaves your machine" explanation (WHAT_WE_SEE.md) clear? ▢ Yes ▢ No — what was unclear:

## Bottom line

8. Would you run it again on your next app? ▢ Yes ▢ Maybe ▢ No — the one thing that would change your answer:
9. The single most valuable thing it found (or the fact it found nothing, if that's the truth):
10. The single most annoying thing about the whole experience:

---

**Where to send it:** reply in the volunteer channel or attach it to your issue. Include the report file (`.uipocalypse/runs/`) if you're comfortable — it contains no secrets by design (see WHAT_WE_SEE.md), and it makes your feedback actionable.
