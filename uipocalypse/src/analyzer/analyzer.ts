import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Issue, ScanOutput } from './types.js';
import { extractAppMap, readEnvFileKeys } from './extract.js';
import { makeFileTextFn, runRules } from './rules.js';

/**
 * Code Analyzer (FR-A1..A5): stack detection → AST extraction → static rules.
 * Syntactic-only (no full type-check) so a 500-file repo scans in ~seconds.
 */

export function analyze(root: string): ScanOutput {
  if (!existsSync(root)) throw new Error(`Scan target does not exist: ${root}`);
  const appMap = extractAppMap(root);

  const migrations: Array<{ rel: string; text: string }> = [];
  const migDir = join(root, 'supabase', 'migrations');
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
