# UIpocalypse — Terms of Use

Plain language. The full license (MIT) is in `LICENSE`.

**This is experimental software.** It is pre-1.0, built and tested on one
Linux machine by a small project. Expect rough edges, missed bugs, and false
positives. It has not been tested on Windows or any non-Linux setup.

**Run it only against test copies of apps you own — never production.** The
tool clicks everything in the web app you point it at. Production databases,
live payment keys, and real user data must never be in reach. Make a safe
test copy first (`dist/docs/volunteer/SAFE_TEST_COPY.md`). The tool's safety
guards are heuristics, not guarantees; where you point it is your decision and
your responsibility.

**What leaves your machine, and when:**

- **No LLM key configured (the default):** nothing leaves your machine. All
  findings, screenshots, and the SQLite database live under `.uipocalypse/`
  in the workspace you configure. Delete that folder and every trace is gone.
- **LLM key configured:** redacted text summaries — app-map summaries, page
  and button names, finding clusters — go to the LLM **provider you
  configured**, at your cost. Never your source code, file contents,
  screenshots, or database rows. The report states which mode ran; the
  server's first output line (`LLM mode: off — …` / `on — provider …, key
  source: …`) says where the key came from.

**How to run with no LLM:** simply don't set a key (the MCP config `env`
block and `~/.uipocalypse/config` are the only two places the tool reads one).
Everything still runs — the swarm, all detectors, and a mechanical report
with template fix prompts; you lose only the LLM-written review, the
app-aware plan, and LLM-guided scout exploration.

**No warranty.** The software is provided "as is" (see LICENSE). It can miss
bugs and report things that are not bugs. A clean report — especially a
read-only run — is never a clean bill of health; the report tells you what
was NOT tested.

**Your infrastructure.** You are responsible for the machine it runs on, the
API keys it uses, and any charges from your LLM provider.
