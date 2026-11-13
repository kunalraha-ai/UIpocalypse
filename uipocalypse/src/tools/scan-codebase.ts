import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { newRunId, type Logger } from '../logger.js';
import { analyze } from '../analyzer/analyzer.js';
import type { Issue } from '../analyzer/types.js';

/**
 * scan_codebase (TRD §6): static scan of a repo. Phase 2: real rules —
 * dead-handler, unwired-form, missing-endpoint, missing-rls,
 * service-key-in-client, undefined-env, unverified-stripe-webhook,
 * no-error-state, no-loading-state, exposed-secret.
 */

export type ScanResult = {
  scanId: string;
  issues: Issue[];
  appMap: ReturnType<typeof analyze>['appMap'];
  durationMs: number;
};

export async function scanCodebase(
  input: { path: string },
  deps: { logger: Logger },
): Promise<ScanResult> {
  const scanId = newRunId();
  const started = Date.now();
  const root = resolve(input.path);
  if (!existsSync(root)) {
    throw new Error(`Scan target does not exist: ${root}`);
  }

  const { appMap, issues } = analyze(root);
  const durationMs = Date.now() - started;

  deps.logger.child({ scanId }).info('scan complete', {
    root,
    framework: appMap.framework,
    files: appMap.fileCount,
    issues: issues.length,
    durationMs,
  });

  return { scanId, issues, appMap, durationMs };
}
