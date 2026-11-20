# Blind setup verification (stage 1 audit)

## Stripped copy: clean

- **Comment hints**: zero — `grep -rc "planted|decoy|quirk|benchmark|fixture|PHASE"` across all source dirs returns nothing.
- **Filenames**: one file contains "fixture" in its name: `supabase/migrations/0002_password_fixture.sql`. This reveals that the password-check is a deliberate simplification (already obvious from the 5-line handler), but it does NOT hint at any of the 11 planted bugs. Noted as a minor residual, not a leak.
- **README/PHASE*/BENCHMARK***: absent from the stripped copy entirely.
- **Seed data**: clean.

## Subagent sessions: fresh

- 4 distinct session IDs across 4 launches (B1-attempt-1, B1-retry, B2, B3) — each was a new child session with only the prompt text. The subagent tool creates fresh context; no parent context is inherited.
- The prompt explicitly forbade reading README, PHASE*, BENCHMARK*, docs/, and git history. These files exist in the parent repo and are technically accessible via the filesystem — there is no enforcement beyond the prompt's instruction. However:

## Evidence the runs were genuinely blind

Each run found **different bugs** the others missed:
- B1: found the search punctuation matrix; missed the garbage-name crash; deleted Bob's account
- B2: found the garbage-name crash (first blind run to do so); missed B1's breadth of search testing
- B3: found price tampering (client-supplied order total) and session-revocation failure — bugs NO other run or contender found

If the agents had access to the bug list, they would have all found the same bugs. The variance across runs is consistent with independent exploration.

## Limitation recorded

The subagents share the same filesystem as the parent project. A determined agent could read `sample-app/README.md` (which labels the planted bugs) or the `PHASE*` files despite the instruction not to. The prompt-level restriction is a trust boundary, not a technical one. A stronger isolation would use a container or separate machine.
