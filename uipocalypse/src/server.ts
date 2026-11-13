import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { join } from 'node:path';
import { initWorkspace } from './workspace.js';
import { createLogger } from './logger.js';
import { openDb, type Db } from './db/index.js';
import { scanCodebase } from './tools/scan-codebase.js';
import type { Workspace } from './workspace.js';
import type { Logger } from './logger.js';

/**
 * MCP server (stdio, local-first). Phase 1 tool surface: scan_codebase (stub).
 * plan_swarm / run_swarm / get_report arrive with Phases 3-5.
 */

export type ServerContext = {
  server: McpServer;
  db: Db;
  logger: Logger;
  workspace: Workspace;
};

export function createServer(opts: { workspaceRoot?: string } = {}): ServerContext {
  const workspace = initWorkspace(opts.workspaceRoot);
  const logger = createLogger({ filePath: join(workspace.logs, 'server.jsonl') });
  const db = openDb(workspace.db);

  const server = new McpServer(
    { name: 'uipocalypse', version: '0.0.1' },
    {
      instructions:
        'UIpocalypse: chaotic-user QA for vibecoded apps. Static code scan now; swarm + report land in later phases. All runs are local-only and safety-guarded (see SAFETY.md).',
    },
  );

  server.registerTool(
    'scan_codebase',
    {
      title: 'Scan codebase',
      description:
        'Statically scan a Next.js/Vite + Supabase codebase for vibecoder bugs and launch-safety holes: dead handlers, unwired forms, missing endpoints, missing RLS, service keys in client code, undefined env vars, unverified Stripe webhooks, missing error/loading states, exposed secrets.',
      inputSchema: { path: z.string().describe('Path to the repo root to scan') },
    },
    async ({ path }) => {
      const result = await scanCodebase({ path }, { logger });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return { server, db, logger, workspace };
}
