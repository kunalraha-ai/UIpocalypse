import type { Page } from 'playwright';

/**
 * Mechanical failure detectors (TRD §3.6). Every candidate carries evidence so
 * the reviewer (Phase 5) can cluster with context.
 *
 * Phase 0 findings baked in: navigation_error matches framework error UI
 * ("This page couldn't load"), not just blank pages.
 */

export type Severity = 'low' | 'medium' | 'high';

export type FindingCandidate = {
  type:
    | 'page_error'
    | 'console_error'
    | 'failed_request'
    | 'dead_click'
    | 'infinite_spinner'
    | 'navigation_error';
  severity: Severity;
  confidence: 'low' | 'medium' | 'high';
  evidence: Record<string, unknown>;
  steps: string[];
  url: string;
  actionId?: number;
};

const BENIGN = /(favicon|\.map$|sentry|analytics|hotjar|googletagmanager)/i;

export class DetectorHub {
  private candidates: FindingCandidate[] = [];
  private readonly appOrigin: string;

  constructor(opts: { appOrigin: string }) {
    this.appOrigin = opts.appOrigin;
  }

  attachPage(page: Page): void {
    const url = () => page.url();
    page.on('pageerror', (err) => {
      this.candidates.push({
        type: 'page_error',
        severity: 'high',
        confidence: 'high',
        evidence: { message: String(err).slice(0, 500) },
        steps: [],
        url: url(),
      });
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.candidates.push({
          type: 'console_error',
          severity: 'low',
          confidence: 'medium',
          evidence: { text: msg.text().slice(0, 500) },
          steps: [],
          url: url(),
        });
      }
    });
    page.on('response', (res) => {
      const status = res.status();
      if (status < 400) return;
      const requestUrl = res.url();
      if (BENIGN.test(requestUrl)) return;
      try {
        if (new URL(requestUrl).origin !== this.appOrigin) return;
      } catch {
        return;
      }
      this.candidates.push({
        type: 'failed_request',
        severity: status >= 500 ? 'high' : 'medium',
        confidence: 'high',
        evidence: { url: requestUrl.slice(0, 300), status },
        steps: [],
        url: url(),
      });
    });
    page.on('requestfailed', (req) => {
      const requestUrl = req.url();
      if (BENIGN.test(requestUrl)) return;
      try {
        if (new URL(requestUrl).origin !== this.appOrigin) return;
      } catch {
        return;
      }
      this.candidates.push({
        type: 'failed_request',
        severity: 'medium',
        confidence: 'medium',
        evidence: { url: requestUrl.slice(0, 300), status: 0, failure: req.failure()?.errorText },
        steps: [],
        url: url(),
      });
    });
  }

  /** Dead-click verdict from the runtime's perform() result (TRD §3.6, 500 ms window). */
  deadClick(evidence: {
    actionLabel: string;
    reasons: string[];
    steps: string[];
    url: string;
    actionId?: number;
  }): FindingCandidate | null {
    if (evidence.reasons.length > 0) return null;
    return {
      type: 'dead_click',
      severity: 'medium',
      confidence: 'high',
      evidence: {
        action: evidence.actionLabel,
        why: 'no DOM mutation, network request, URL change, focus or ARIA state change within 500 ms',
      },
      steps: evidence.steps,
      url: evidence.url,
      actionId: evidence.actionId,
    };
  }

  /** Spinners that have been visible for more than thresholdMs (TRD: 10 s). */
  infiniteSpinners(
    drainSpinners: Array<{ label: string; since: number; stillVisible: boolean }>,
    opts: { thresholdMs?: number; steps?: string[]; url: string },
  ): FindingCandidate[] {
    const threshold = opts.thresholdMs ?? 10_000;
    const now = Date.now();
    return drainSpinners
      .filter((s) => s.stillVisible && now - s.since > threshold)
      .map((s) => ({
        type: 'infinite_spinner' as const,
        severity: 'medium' as const,
        confidence: 'high' as const,
        evidence: { label: s.label, visibleMs: now - s.since },
        steps: opts.steps ?? [],
        url: opts.url,
      }));
  }

  /** Framework error UI = broken state even when the page is not blank (Phase 0). */
  navigationError(page: Page, steps: string[]): Promise<FindingCandidate | null> {
    return page
      .evaluate(() => ({
        text: (document.body?.innerText ?? '').slice(0, 400),
        blank: (document.body?.innerText ?? '').trim().length === 0,
      }))
      .then((state) => {
        const broken = state.blank || /this page couldn.?t load|application error/i.test(state.text);
        if (!broken) return null;
        return {
          type: 'navigation_error' as const,
          severity: 'high' as const,
          confidence: 'high' as const,
          evidence: { snippet: state.text.slice(0, 200), blank: state.blank },
          steps,
          url: page.url(),
        };
      })
      .catch(() => null);
  }

  push(candidate: FindingCandidate): void {
    this.candidates.push(candidate);
  }

  take(): FindingCandidate[] {
    return this.candidates.splice(0);
  }
}
