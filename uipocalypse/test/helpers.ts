import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initWorkspace } from '../src/workspace.js';
import { openDb } from '../src/db/index.js';
import { createLogger } from '../src/logger.js';
import { loadConfig } from '../src/config.js';
import type { ServerContext } from '../src/server.js';

/** Tiny static file server for the browser-test fixtures (no dependencies).
 * POST requests are answered 200 — write-path fixtures (duplicate_request
 * detection) need a real endpoint to fire at. */
export async function serveStatic(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    if (req.method === 'POST') {
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
      return;
    }
    const path = req.url === '/' ? '/index.html' : req.url ?? '/';
    try {
      const data = readFileSync(join(dir, path));
      res.setHeader('content-type', path.endsWith('.html') ? 'text/html' : 'application/octet-stream');
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export function tmpWorkspace(): {
  dir: string;
  db: ReturnType<typeof openDb>;
  config: ReturnType<typeof loadConfig>['config'];
  logger: ReturnType<typeof createLogger>;
  cleanup: () => void;
} {
  const dir = mkdtempSync('/tmp/opencode/uip-p3-');
  const ws = initWorkspace(dir);
  const db = openDb(ws.db);
  const { config } = loadConfig();
  const logger = createLogger({});
  return { dir, db, config, logger, cleanup: () => db.close() };
}

export type { ServerContext };
