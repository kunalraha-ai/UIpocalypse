import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { analyze } from '../src/analyzer/analyzer.js';
import { DetectorHub } from '../src/browser/detectors.js';
import {
  checkIdempotency,
  isNavigationLink,
  operationOf,
  rankDuplicateSubmit,
  shouldFlagConsoleError,
  shouldFlagDeadClick,
  WIDE_PENDING_SIGNALS,
} from '../src/browser/detectors-filters.js';

/**
 * FP-reduction filters (the 8 fixes). Each filter is a pure function —
 * testable without a browser. The runtime and detector changes are thin
 * wrappers around these decisions.
 */

describe('fix 1+7: dead-click vs navigation — links are not dead controls', () => {
  it('a link with a real href should NOT be flagged as dead (navigation expected)', () => {
    // simulate what the runtime reports
    const isLink = isNavigationLink({ tagName: 'A', href: '/about' });
    expect(isLink).toBe(true);
    expect(shouldFlagDeadClick({ isLink, reasons: [], urlChanged: false })).toBe(false);
  });
  it('a link with href="#" (hash-only) IS dead — it goes nowhere', () => {
    const isLink = isNavigationLink({ tagName: 'A', href: '#' });
    expect(isLink).toBe(false); // not a real navigation link
    expect(shouldFlagDeadClick({ isLink: false, reasons: [], urlChanged: false })).toBe(true);
  });
  it('a button with no reasons IS flagged (that is the bug class we hunt)', () => {
    expect(shouldFlagDeadClick({ isLink: false, reasons: [], urlChanged: false })).toBe(true);
  });
  it('a link that caused a URL change is NOT dead (it navigated)', () => {
    expect(shouldFlagDeadClick({ isLink: true, reasons: [], urlChanged: true })).toBe(false);
    expect(shouldFlagDeadClick({ isLink: false, reasons: [], urlChanged: true })).toBe(false);
  });
  it('a button that already had feedback is NOT dead (reasons present)', () => {
    expect(shouldFlagDeadClick({ isLink: false, reasons: ['mutation'], urlChanged: false })).toBe(false);
  });
});

describe('fix 3: Chromium sandbox artifacts are never reported', () => {
  it('about:blank sandbox CSP errors are filtered', () => {
    expect(shouldFlagConsoleError("Blocked script execution in 'about:blank' because the document's frame is sandboxed")).toBe(false);
  });
  it('data:, CSP violations are filtered (headless browser restriction)', () => {
    expect(shouldFlagConsoleError("Connecting to 'data:,' violates the following Content Security Policy directive")).toBe(false);
    expect(shouldFlagConsoleError("Fetch API cannot load data:,. Refused to connect")).toBe(false);
  });
  it('real JS errors pass through', () => {
    expect(shouldFlagConsoleError('Uncaught TypeError: Cannot read properties of undefined')).toBe(true);
    expect(shouldFlagConsoleError('TypeError: Failed to fetch')).toBe(true);
  });
});

describe('fix 5: console.log formatting is not an error', () => {
  it('%c styled output with NaN is filtered', () => {
    expect(shouldFlagConsoleError('%c%d font-size:#;color:transparent NaN')).toBe(false);
    expect(shouldFlagConsoleError('%c%o font-size:#;color:transparent {}')).toBe(false);
  });
  it('real errors containing NaN still pass', () => {
    expect(shouldFlagConsoleError('Uncaught TypeError: result is NaN')).toBe(true);
  });
  it('403 console errors pass through (real finding)', () => {
    expect(shouldFlagConsoleError('Failed to load resource: the server responded with a status of 403')).toBe(true);
  });
});

describe('fix 4: wider submit-guard pattern', () => {
  it('catches isDeletingWebsite (the GrowthSent FP class)', () => {
    const dir = mkdtempSync('/tmp/opencode/uip-guardfix-');
    writeFileSync(join(dir, 'comp.tsx'),
      'export default function C() { const [isDeletingWebsite, setDel] = useState(false); await fetch("/api/w", {method:"DELETE"}); }');
    const { issues } = analyze(dir);
    expect(issues.filter((i) => i.rule === 'missing-submit-guard')).toEqual([]);
  });
  it('still fires when there is truly no guard', () => {
    const dir = mkdtempSync('/tmp/opencode/uip-guardfix2-');
    writeFileSync(join(dir, 'comp.tsx'),
      'export default function C() { await fetch("/api/w", {method:"POST"}); }');
    const { issues } = analyze(dir);
    expect(issues.some((i) => i.rule === 'missing-submit-guard')).toBe(true);
  });
});

describe('fix 6: duplicate-submit endpoint impact ranking', () => {
  it('payment/checkout endpoints are HIGH severity', () => {
    expect(rankDuplicateSubmit('/api/checkout')).toBe('high');
    expect(rankDuplicateSubmit('/api/pay')).toBe('high');
    expect(rankDuplicateSubmit('/api/order')).toBe('high');
  });
  it('tracking/beacon endpoints are LOW severity', () => {
    expect(rankDuplicateSubmit('/cdn-cgi/rum')).toBe('low');
    expect(rankDuplicateSubmit('/api/op/track')).toBe('low');
    expect(rankDuplicateSubmit('/api/analytics')).toBe('low');
  });
  it('unknown endpoints are MEDIUM (the default)', () => {
    expect(rankDuplicateSubmit('/api/data/write')).toBe('medium');
  });
});

describe('fix 4 (pattern): WIDE_PENDING_SIGNALS is the single submit-guard regex', () => {
  it('matches GrowthSent-style guards (isDeletingWebsite, isSaving)', () => {
    expect(WIDE_PENDING_SIGNALS.test('const [isDeletingWebsite, setDel] = useState(false)')).toBe(true);
    expect(WIDE_PENDING_SIGNALS.test('const [isSaving, setSaving] = useState(false)')).toBe(true);
  });
  it('matches short state names the old pattern missed (isBusy, isLoading)', () => {
    expect(WIDE_PENDING_SIGNALS.test('const [isBusy] = useState(false)')).toBe(true);
    expect(WIDE_PENDING_SIGNALS.test('const isLoading = useApp().loading')).toBe(true);
  });
  it('does not match a file with no guard at all', () => {
    expect(WIDE_PENDING_SIGNALS.test('export default function C() { await fetch("/api/w", {method:"POST"}); }')).toBe(false);
  });
});

describe('fix 5 (dup keying): GraphQL/Server-Action operations are distinct keys', () => {
  it('extracts the GraphQL operationName from the request body', () => {
    expect(operationOf({ postData: '{"operationName":"IncA","query":"mutation IncA { incA }"}' })).toBe('graphql:IncA');
  });
  it('falls back to the first field of the query when operationName is absent', () => {
    expect(operationOf({ postData: '{"query":"mutation RedeemCoupon { redeem }"}' })).toBe('graphql:RedeemCoupon');
  });
  it('keys Next.js Server Actions by their Next-Action id', () => {
    expect(operationOf({ postData: 'anything', nextAction: 'abc123' })).toBe('action:abc123');
  });
  it('plain POSTs without operation markers stay URL-keyed', () => {
    expect(operationOf({ postData: '{"foo":"bar"}' })).toBeUndefined();
    expect(operationOf({ postData: null })).toBeUndefined();
    expect(operationOf({})).toBeUndefined();
  });
  it('never looks at more than the first 2 KB of a body', () => {
    const big = 'x'.repeat(5000) + '"operationName":"Hidden"';
    expect(operationOf({ postData: big })).toBeUndefined();
  });
});

describe('fix 8: idempotency replay — one extra request decides the verdict', () => {
  it('identical response on replay = idempotent (server absorbs repeats)', async () => {
    const verdict = await checkIdempotency(
      async () => ({ status: 200, body: '{"ok":true}' }),
      { status: 200, body: '{"ok":true}' },
    );
    expect(verdict).toBe('idempotent');
  });
  it('a 4xx rejection on replay = idempotent (server has a guard)', async () => {
    const verdict = await checkIdempotency(
      async () => ({ status: 409, body: 'conflict' }),
      { status: 200, body: '{"ok":true}' },
    );
    expect(verdict).toBe('idempotent');
  });
  it('a fresh 2xx with a DIFFERENT body = harmful (real second effect)', async () => {
    const verdict = await checkIdempotency(
      async () => ({ status: 200, body: '{"id":2}' }),
      { status: 200, body: '{"id":1}' },
    );
    expect(verdict).toBe('harmful');
  });
  it('replay that throws = unknown (never guess)', async () => {
    const verdict = await checkIdempotency(
      async () => { throw new Error('network'); },
      { status: 200, body: '{"ok":true}' },
    );
    expect(verdict).toBe('unknown');
  });
  it('no original response captured = unknown (nothing to compare against)', async () => {
    const verdict = await checkIdempotency(
      async () => ({ status: 200, body: '{"ok":true}' }),
      undefined as unknown as { status: number; body?: string },
    );
    expect(verdict).toBe('unknown');
  });
});


describe('fix 6 (WAF fingerprint): the detector names the wall it hit', () => {
  /** minimal Page stand-in — only the events DetectorHub.attachPage registers */
  function fakePage(): Page & { emit: (event: string, arg: unknown) => void } {
    const listeners = new Map<string, Array<(arg: unknown) => void>>();
    return {
      on(event: string, cb: (arg: unknown) => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      },
      emit(event: string, arg: unknown) {
        for (const cb of listeners.get(event) ?? []) cb(arg);
      },
      url: () => 'https://audora.art/',
    } as unknown as Page & { emit: (event: string, arg: unknown) => void };
  }

  it('a 403 with cf-mitigated: challenge is fingerprinted as a Cloudflare challenge', () => {
    const hub = new DetectorHub({ appOrigin: 'https://audora.art' });
    const page = fakePage();
    hub.attachPage(page);
    page.emit('response', {
      status: () => 403,
      url: () => 'https://audora.art/_app/chunk-a.js',
      headers: () => ({ 'cf-mitigated': 'challenge', 'cf-ray': '9f2c…' }),
      request: () => ({ method: () => 'GET', headers: () => ({}) }),
      text: async () => '<html>challenge</html>',
    });
    const findings = hub.take();
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe('failed_request');
    expect(findings[0]!.evidence.waf).toBe('cloudflare-challenge');
  });

  it('a plain 403 without challenge headers carries no WAF guess', () => {
    const hub = new DetectorHub({ appOrigin: 'https://audora.art' });
    const page = fakePage();
    hub.attachPage(page);
    page.emit('response', {
      status: () => 403,
      url: () => 'https://audora.art/api/thing',
      headers: () => ({}),
      request: () => ({ method: () => 'GET', headers: () => ({}) }),
      text: async () => 'nope',
    });
    const findings = hub.take();
    expect(findings[0]!.evidence.waf).toBeUndefined();
  });
});
