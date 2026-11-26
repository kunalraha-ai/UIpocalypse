/**
 * FP-reduction filters (the 8 fixes, 2026-11-25). Pure functions — the
 * runtime, detectors, and collector call these to decide what to report.
 *
 * Each filter targets a specific false-positive class identified by running
 * the tool against real sites (audora.art, cap.so, tryvela.ai, GrowthSent).
 *
 * Where each fix lives:
 *  1+7 dead-click vs navigation — shouldFlagDeadClick/isNavigationLink
 *     (decision logic here; runtime reports isLink + urlChanged)
 *  2 bot-protection clustering — collector.ts mergeBotProtectionClusters
 *     (operates on clusters, not raw requests)
 *  3+5 console noise — shouldFlagConsoleError
 *  4 wide submit-guard — WIDE_PENDING_SIGNALS (rules.ts imports it)
 *  6 duplicate-submit ranking — rankDuplicateSubmit
 *  8 idempotency replay — checkIdempotency (orchestrator, explicit opt-in
 *     only: optIn.idempotencyReplay or config idempotencyOptIn)
 */

// ---- fix 1+7: dead-click vs navigation ----

/** Is this element a semantic link that navigates? Links are never "dead"
 *  just because the headless browser can't track the navigation. */
export function isNavigationLink(el: { tagName: string; href?: string | null }): boolean {
  if (el.tagName !== 'A') return false;
  const href = el.href ?? '';
  if (!href || href === '#' || href.startsWith('javascript:')) return false;
  return true;
}

/** Should a dead-click verdict be emitted? Links that navigate are excluded;
 *  URL changes prove the control worked regardless of what it is. */
export function shouldFlagDeadClick(input: {
  isLink: boolean;
  reasons: string[];
  urlChanged: boolean;
}): boolean {
  if (input.reasons.length > 0) return false; // had feedback — not dead
  if (input.urlChanged) return false; // navigation happened — not dead
  if (input.isLink) return false; // semantic link — navigation is expected
  return true; // a button/control with no feedback and no navigation = dead
}

// ---- fix 3: Chromium sandbox artifacts ----

const CHROMIUM_SANDBOX_PATTERNS = [
  /Blocked script execution in 'about:blank'/i,
  /Connecting to 'data:,' violates/i,
  /Fetch API cannot load data:,/i,
  /Refused to connect because it violates the document's Content Security Policy/i,
];

// ---- fix 5: console.log formatting is not an error ----

const CONSOLE_LOG_FORMATTING = /^%[co]/; // %c (CSS) or %o (object) format specifiers
const REAL_ERROR_KEYWORDS = /TypeError|ReferenceError|SyntaxError|RangeError|Uncaught|Error:|Failed to|Cannot read|is not a function|is undefined|is null/i;

/** Should this console.error text be reported? Filter Chromium sandbox
 *  artifacts and styled console.log output that contains false "NaN" matches. */
export function shouldFlagConsoleError(text: string): boolean {
  for (const pat of CHROMIUM_SANDBOX_PATTERNS) {
    if (pat.test(text)) return false;
  }
  // styled console.log output (%c / %o prefix) is not an error unless it
  // also contains real error keywords
  if (CONSOLE_LOG_FORMATTING.test(text.trim())) {
    return REAL_ERROR_KEYWORDS.test(text);
  }
  return true;
}

// ---- fix 4: wider submit-guard pattern ----
// Single source of truth — rules.ts imports this. Matches isDeletingWebsite,
// isSaving, isWorking (the -ing branch), plus the short non-gerund names that
// branch cannot reach (isBusy, isLoading) via explicit literals.
export const WIDE_PENDING_SIGNALS =
  /disabled|isPending|submitting|useFormStatus|setLoading|isLoading|isBusy|is[A-Z][a-z]*(ing|Saving|Deleting|Creating|Updating|Submitting|Loading|Processing|Working|Busy)/i;

// ---- fix 6: duplicate-submit endpoint impact ranking ----

const HIGH_IMPACT_ENDPOINTS = /pay|charge|checkout|order|purchase|subscribe|buy|transfer|withdraw/i;
const LOW_IMPACT_ENDPOINTS = /track|analytics|rum|beacon|telemetry|metrics|log(?!in)|event|monitor|healthcheck|ping/i;

export function rankDuplicateSubmit(url: string): 'high' | 'medium' | 'low' {
  if (HIGH_IMPACT_ENDPOINTS.test(url)) return 'high';
  if (LOW_IMPACT_ENDPOINTS.test(url)) return 'low';
  return 'medium';
}

// ---- fix 5 (dup keying): GraphQL operations and Next.js Server Actions ----
// All GraphQL mutations hit ONE endpoint and Server Actions POST the page
// URL — keying duplicates by URL conflates different operations. The
// discriminator extracts ONLY the operation identifier from the request
// (never the body — bodies can carry user data and must not be stored).

/** Operation discriminator for write requests. Returns a stable operation id
 *  when one is detectable (GraphQL operationName/query name, Next-Action id),
 *  else undefined (plain URL keying). Pure + testable. */
export function operationOf(input: { postData?: string | null; nextAction?: string | null }): string | undefined {
  if (typeof input.nextAction === 'string' && input.nextAction) {
    return `action:${input.nextAction.slice(0, 64)}`;
  }
  const body = typeof input.postData === 'string' ? input.postData.slice(0, 2000) : '';
  if (!body) return undefined;
  const opName = body.match(/"operationName"\s*:\s*"([^"]{1,80})"/);
  if (opName?.[1]) return `graphql:${opName[1]}`;
  const query = body.match(/"(?:query|mutation)"\s*:\s*"(mutation|query)\s+([A-Za-z_][\w]{0,80})/);
  if (query?.[2]) return `graphql:${query[2]}`;
  return undefined;
}

// ---- fix 8: idempotency check for duplicate-submits ----

/** After detecting a double-submit, make one more request. If the server
 *  returns the same response (or a conflict), the endpoint is idempotent —
 *  downgrade. This is called by the orchestrator after the duplicate fires,
 *  ONLY when the operator opted in (one extra write per duplicate found). */
export async function checkIdempotency(
  makeRequest: () => Promise<{ status: number; body?: string }>,
  originalResponse: { status: number; body?: string } | undefined | null,
): Promise<'idempotent' | 'harmful' | 'unknown'> {
  // No original response captured → nothing to compare against. Never guess.
  if (!originalResponse) return 'unknown';
  try {
    const third = await makeRequest();
    if (third.status === originalResponse.status && third.body === originalResponse.body) {
      return 'idempotent';
    }
    if (third.status >= 400) {
      return 'idempotent'; // server rejected the replay — it has a guard
    }
    return 'harmful'; // the third request succeeded differently — real damage
  } catch {
    return 'unknown';
  }
}

