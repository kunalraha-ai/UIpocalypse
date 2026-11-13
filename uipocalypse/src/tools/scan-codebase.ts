import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { newRunId, type Logger } from '../logger.js';

/**
 * Phase 1 stub for scan_codebase (IMPLEMENTATION_PLAN: "MCP server connectable
 * from Claude Code that returns a stub scan"). The real AST analyzer + rule
 * engine lands in Phase 2; this stub walks the repo honestly (file inventory)
 * and reports itself as a stub so nobody mistakes it for real findings.
 */

const IGNORED_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'build', '.uipocalypse', 'coverage', '.turbo', '.cache',
]);
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

export type ScanIssue = {
  rule: string;
  severity: 'info' | 'low' | 'medium' | 'high';
  file: string;
  line: number;
  message: string;
  fixHint?: string;
};

export type AppMap = {
  framework: string;
  stack: string[];
  routes: string[];
  fileCount: number;
  extractedAt: string;
};

export type ScanResult = {
  scanId: string;
  issues: ScanIssue[];
  appMap: AppMap;
};

export async function scanCodebase(
  input: { path: string },
  deps: { logger: Logger },
): Promise<ScanResult> {
  const scanId = newRunId();
  const root = input.path;
  if (!existsSync(root)) {
    throw new Error(`Scan target does not exist: ${root}`);
  }

  let fileCount = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > 12 || fileCount >= 5000) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(full, depth + 1);
      } else if (CODE_EXT.test(entry.name)) {
        fileCount++;
      }
    }
  };
  walk(root, 0);

  deps.logger.child({ scanId }).info('stub scan complete', { root, fileCount });

  return {
    scanId,
    issues: [
      {
        rule: 'stub',
        severity: 'info',
        file: '',
        line: 0,
        message:
          'This is the Phase 1 stub scan. The static analyzer (dead handlers, unwired forms, missing endpoints, RLS checks, secrets, …) ships in Phase 2.',
      },
    ],
    appMap: {
      framework: 'unknown',
      stack: [],
      routes: [],
      fileCount,
      extractedAt: new Date().toISOString(),
    },
  };
}
