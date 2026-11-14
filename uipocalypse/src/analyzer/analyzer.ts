import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Issue, ScanOutput } from './types.js';
import { extractAppMap, readEnvFileKeys } from './extract.js';
import { makeFileTextFn, runRules } from './rules.js';

/**
 * Code Analyzer (FR-A1..A5): stack detection → AST extraction → static rules.
 * Syntactic-only (no full type-check) so a 500-file repo scans in ~seconds.
 */

export function analyze(root: string): ScanOutput {
  const resolvedRoot = resolve(root);
  if (!existsSync(resolvedRoot)) throw new Error(`Scan target does not exist: ${resolvedRoot}`);
  const appMap = extractAppMap(resolvedRoot);

  const migrations: Array<{ rel: string; text: string }> = [];
  const migDir = join(resolvedRoot, 'supabase', 'migrations');
  if (existsSync(migDir)) {
    for (const file of readdirSync(migDir)) {
      if (file.endsWith('.sql')) {
        migrations.push({
          rel: `supabase/migrations/${file}`,
          text: readFileSync(join(migDir, file), 'utf8'),
        });
      }
    }
  }

  const issues: Issue[] = runRules({
    root,
    appMap,
    envKeys: readEnvFileKeys(root),
    migrations,
    fileText: makeFileTextFn(root),
  });

  return { appMap, issues };
}
