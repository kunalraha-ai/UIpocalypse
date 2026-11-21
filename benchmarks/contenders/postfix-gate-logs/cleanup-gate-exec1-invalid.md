# Cleanup gate execution 1 (2026-11-21) — INVALID: target app died mid-execution

The 2026-11-21 gate run produced a healthy first-run 1 (4990 steps, dupObs 20,
dup_effect 1) and then collapsed: run 2 lost the database mid-run (1561
failed_request, "orders service unavailable" in the app log), runs 3–4 ran
against a dead port (app process gone, net::ERR_CONNECTION_REFUSED; 0/0
graph coverage).

Same failure mode as gate-rerun1-invalid.md (app down), except here the app
died MID-execution. The likely contributors, recorded honestly:

- The app log ends with DB-unreachable errors and no crash trace — the Next
  process was killed externally or lost its DB mid-run; Docker Desktop on
  this machine has been flaky all phase (multiple restarts recorded).
- CONFOUND INTRODUCED BY THE AUTHOR: the quickstart-prompt-test subagent ran
  concurrently with this gate on the same machine (npm install + chromium
  download + a 30-agent verify run of its own, plus an MCP server spawned
  from the main repo's cwd). CPU contention at minimum; the overlap was a
  scheduling mistake — a gate measures one thing at a time.

Run 1 is valid in isolation and confirms the skip-visibility fix on
CreditCraft: graph coverage 105/111 (95%) with 2 skipped-by-policy actions
("Email", "Delete account") listed — under the old computation those two were
silently dropped from the denominator. The full gate re-ran cleanly after
the app restart; see the valid execution for scored numbers.
