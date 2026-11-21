# UIpocalypse — Terms of Use

Short version, in plain language. The full license is in `LICENSE`.

**Test only what you have the right to test.** This tool clicks everything in
the web app you point it at. Run it only against apps you own or have explicit
permission to test, on a safe copy of the app (see the volunteer docs:
`dist/docs/volunteer/SAFE_TEST_COPY.md`). If you point it at a production
system, that is your decision and your responsibility — the tool's safety
guards are heuristics, not guarantees.

**Your data stays on your machine.** All findings, screenshots, and the
database live under `.uipocalypse/` in the workspace you configure. Nothing is
uploaded. If you configure an LLM key, redacted text summaries go to the LLM
provider you chose, at your cost — see
`dist/docs/volunteer/WHAT_WE_SEE.md` for exactly what leaves the machine.

**No warranty.** The software is provided "as is" (see LICENSE). It can miss
bugs, and it can report things that are not bugs. A clean report — especially
a read-only run — is never a clean bill of health; the report tells you what
was NOT tested.

**Your infrastructure.** You are responsible for the machine it runs on, the
API keys it uses, and any charges from your LLM provider.
