# Gate re-run attempt 1 (2026-11-20) — INVALID: environment failure

The 3 gate re-runs after the escalation fix produced 0 dupObs, 0 rejections,
0 artifacts, 0 screenshots in every run. Root cause: the original sample-app
was NOT running on :3123 (only the stripped benchmark copy was up on :3124).
The gate script targets :3123. The tool ran against a dead port; the 8
"findings" per run were connection-refused noise, not real detections.

All 3 runs are INVALID. Not a code regression — the escalation fix was never
actually exercised. Re-run after starting the original app on :3123.
