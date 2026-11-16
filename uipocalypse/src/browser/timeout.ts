import type { Logger } from '../logger.js';

/**
 * Hard per-operation timeout (TRD §11). A wedged renderer stalls
 * page.evaluate/ariaSnapshot forever — Playwright has no default timeout for
 * evaluate — and one hung operation defeats every cooperative budget check
 * (the phase 5 gate sat 4h09m on 11 scout calls this way). Every browser op
 * races this timeout; the phase watchdog then force-closes the browser at
 * budget + overshoot so a run always emits its partial report.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** The per-op cap for browser operations inside the runner/orchestrator. */
export const OP_TIMEOUT_MS = 30_000;

/**
 * Phase watchdog: force-close the browser at `deadlineMs` so pending
 * (possibly wedged) operations reject and the phase always finishes and
 * emits its partial report. Returns the cancel function — call it in finally.
 */
export function armWatchdog(closeBrowser: () => Promise<unknown>, deadlineMs: number, logger?: Logger): () => void {
  const timer = setTimeout(() => {
    logger?.warn('watchdog fired — force-closing the browser to end a wedged phase', { deadlineMs });
    void closeBrowser().catch(() => {});
  }, deadlineMs);
  return () => clearTimeout(timer);
}
