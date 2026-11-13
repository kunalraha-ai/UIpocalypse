import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * .uipocalypse/ workspace layout (IMPLEMENTATION_PLAN Phase 1):
 * one directory per project holding the SQLite DB, run logs, screenshots and
 * traces. Root resolution order: explicit arg > UIP_WORKSPACE env > cwd.
 */

export type Workspace = {
  root: string;
  db: string;
  logs: string;
  plans: string;
  runs: string;
  screenshots: string;
  traces: string;
};

export function initWorkspace(explicitRoot?: string): Workspace {
  const root = explicitRoot ?? process.env.UIP_WORKSPACE ?? process.cwd();
  const base = root.endsWith('.uipocalypse') ? root : join(root, '.uipocalypse');
  const ws: Workspace = {
    root: base,
    db: base,
    logs: join(base, 'logs'),
    plans: join(base, 'plans'),
    runs: join(base, 'runs'),
    screenshots: join(base, 'screenshots'),
    traces: join(base, 'traces'),
  };
  for (const dir of Object.values(ws)) mkdirSync(dir, { recursive: true });
  return ws;
}
