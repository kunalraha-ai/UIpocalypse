# Release-tarball verification — fresh account, no repo access (2026-11-21)

Item 2 of pre-volunteer hardening. The tarball flow from QUICKSTART was
verified on this machine under a simulated fresh account.

## How "fresh account, no repo access" was simulated (honestly)

The machine has no passwordless sudo, so a separate UID was not possible. The
simulation instead used an **unprivileged user namespace** in which the private
repo is bind-mounted to an empty directory — the install script literally
cannot see the repo (`repo entries visible: 0`) — plus a **fresh empty HOME**
(no `~/.uipocalypse/config`, no shell history, cold browser cache) and a minimal
PATH. Same UID, so the shared npm package cache was warm; a truly cold npm
cache would add roughly 1–2 minutes. Nothing else was borrowed from the
developer environment.

## Steps performed (exactly the QUICKSTART tarball flow)

```bash
mkdir uipocalypse && tar -xzf uipocalypse-0.0.1.tgz -C uipocalypse --strip-components=1
cd uipocalypse
npm install --omit=dev
npx playwright install chromium
# MCP server: node <abs>/uipocalypse/dist/index.cjs over stdio
# tool call: verify_deployment_safety { path, url }
```

## Results

| Step | Time |
|---|---|
| `npm install --omit=dev` (114 packages) | 25 s |
| `npx playwright install chromium` (**cold** — fresh HOME, real download) | 57 s |
| **Install total (extract → ready)** | **82 s** |
| First server output | `LLM mode: off — no LLM_API_KEY configured (fully local run; mechanical report)` |
| `verify_deployment_safety` | 49 s |
| **Time-to-first-report, clean start** | **~2 min 11 s** |

The run:

- **found the planted dead control** ("Export data") with reproduction steps
  and a template fix prompt — fully local, `llmCalls: 0`
- report states **Reviewed by: mechanical**, models `planner=none;scout=none`,
  agents 30 (the corrected count)
- the tarball shipped the whole volunteer kit in `dist/docs/volunteer/` plus
  LICENSE and TERMS.md
- no repo access at any point: the tool ran entirely from the tarball

## Verdict

A volunteer with only the 6 MB tarball, Node 22, and a localhost app gets a
bug-finding report in about two minutes on a broadband connection — including
the one-time browser download. Within the five-minute promise.
