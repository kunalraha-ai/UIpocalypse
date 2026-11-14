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
    | 'navigation_error'
    | 'duplicate_request'
    | 'duplicate_effect'
    | 'race_violation';
  severity: Severity;
  confidence: 'low' | 'medium' | 'high';
  evidence: Record<string, unknown>;
  steps: string[];
  url: string;
  actionId?: number;
};

const BENIGN = /(favicon|\.map$|sentry|analytics|hotjar|googletagmanager)/i;

/** perform() reasons that count as REAL app feedback (repeat-activation suppression). */
export const ALIVE_REASONS = ['mutation', 'request', 'nav', 'aria', 'dialog', 'dialog-feedback'];

export class DetectorHub {
  private candidates: FindingCandidate[] = [];
  private readonly appOrigin: string;
  /** per-page POST log for duplicate_request detection (same write ≥2× within 1 s from one agent) */
  private readonly postLog = new Map<object, Array<{ url: string; time: number }>>();

  constructor(opts: { appOrigin: string }) {
    this.appOrigin = opts.appOrigin;
  }

  attachPage(page: Page): void {
    const url = () => page.url();
    const posts: Array<{ url: string; time: number }> = [];
    this.postLog.set(page, posts);
    page.on('request', (req) => {
      const method = req.method();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
      const requestUrl = req.url();
      try {
        if (new URL(requestUrl).origin !== this.appOrigin) return;
      } catch {
        return;
      }
      posts.push({ url: requestUrl, time: Date.now() });
      if (posts.length > 200) posts.splice(0, 100);
    });
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

  /**
   * duplicate_request (TRD §3.6): same write request ≥ 2× within 1 s from a
   * single agent (double-click). Request-level signal only — it proves the app
   * has no submit guard, NOT that the damage happened (the second POST may
   * have been rejected server-side). The invariant-confirmed upgrade is
   * duplicate_effect, emitted by the orchestrator's post-swarm sweep.
   * Race mode (one click per agent) never trips it.
   */
  duplicateRequests(page: Page, sinceIndex: number, opts: { steps: string[] }): { findings: FindingCandidate[]; newIndex: number } {
    const posts = this.postLog.get(page) ?? [];
    const findings: FindingCandidate[] = [];
    const seen = new Map<string, number>();
    for (let i = sinceIndex; i < posts.length; i++) {
      const post = posts[i]!;
      seen.set(post.url, (seen.get(post.url) ?? 0) + 1);
    }
    for (const [requestUrl, count] of seen) {
      if (count >= 2) {
        findings.push({
          type: 'duplicate_request',
          severity: 'medium',
          confidence: 'medium',
          evidence: { url: requestUrl.slice(0, 300), count, window: '1 step, <1s apart', note: 'no submit guard — the damage is not confirmed' },
          steps: opts.steps,
          url: page.url(),
        });
      }
    }
    return { findings, newIndex: posts.length };
  }

  take(): FindingCandidate[] {
    return this.candidates.splice(0);
  }
}
