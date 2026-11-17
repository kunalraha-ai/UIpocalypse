import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppMap, Issue, Severity } from './types.js';

/**
 * Static rule library (TRD §8, 15 rules). All rules are conservative:
 * they fire on clear signals and attach evidence + a fix hint.
 */

export type RuleContext = {
  root: string;
  appMap: AppMap;
  envKeys: Set<string>;
  migrations: Array<{ rel: string; text: string }>;
  fileText: (rel: string) => string | null;
};

const SERVER_FILE = /(^|\/)(api|server)\//;

function isServerFile(rel: string): boolean {
  return SERVER_FILE.test(rel.replaceAll('\\', '/'));
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

// ---------------------------------------------------------------- 1. dead-handler

/** Server-action machinery in the file: buttons likely compose into forms elsewhere. */
const FORM_MACHINERY = /useActionState|useFormStatus|formAction/;

export function deadHandler(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  const machineryCache = new Map<string, boolean>();
  const hasFormMachinery = (file: string): boolean => {
    if (!machineryCache.has(file)) {
      const text = ctx.fileText(file);
      machineryCache.set(file, text ? FORM_MACHINERY.test(text) : false);
    }
    return machineryCache.get(file)!;
  };
  for (const el of ctx.appMap.elements) {
    for (const prop of el.emptyHandlers) {
      issues.push({
        rule: 'dead-handler',
        severity: 'high',
        file: el.file,
        line: el.line,
        message: `${el.tag} "${el.label}" has an empty ${prop} handler — clicking it does nothing.`,
        fixHint: 'Wire the handler to real logic, or remove the element.',
      });
    }
    // speculative branch (low severity) — must clear every known-unknowable:
    // disabled controls, submit machinery, spread props (handlers may arrive at
    // call sites), and server-action composition (FP audit: vercel/commerce,
    // shadcn/taxonomy, supabase user-management)
    if (
      (el.tag === 'button' || el.tag === 'input') &&
      !el.inForm &&
      el.handlers.length === 0 &&
      el.emptyHandlers.length === 0 &&
      !el.ariaHidden &&
      !el.disabled &&
      el.typeAttr !== 'submit' &&
      !el.hasSpread &&
      !hasFormMachinery(el.file)
    ) {
      issues.push({
        rule: 'dead-handler',
        severity: 'low',
        file: el.file,
        line: el.line,
        message: `${el.tag} "${el.label}" has no ${el.tag === 'input' ? 'submit' : 'click'} handler and is not part of a form — likely does nothing.`,
        fixHint: 'Add an onClick/onSubmit handler or remove the element.',
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------- 2. unwired-form

export function unwiredForm(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  for (const el of ctx.appMap.elements) {
    if (el.tag !== 'form') continue;
    // only forms that actually attempt a submission (a submit control) and are
    // not wired by any mechanism: onSubmit, action, method, or formAction
    // server actions on descendants (FP audit: radio filter groups and
    // skeleton forms have no submit control and must not fire)
    if (
      el.hasSubmitControl &&
      !el.hasOnSubmit &&
      !el.hasAction &&
      !el.hasMethodAttr &&
      !el.hasFormActionDescendant
    ) {
      issues.push({
        rule: 'unwired-form',
        severity: 'medium',
        file: el.file,
        line: el.line,
        message: `form "${el.label}" has a submit control but no submit handler, action or formAction — submissions go nowhere useful (native GET reload).`,
        fixHint: 'Add onSubmit={...} or an action; handle errors and pending state.',
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------- 3. missing-endpoint

function pathSegments(url: string): string[] {
  return url.split(/[?#]/)[0]!.split('/').filter(Boolean);
}

export function missingEndpoint(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  const apiRoutes = ctx.appMap.routes.filter((r) => r.kind === 'api');
  const matches = (fetchSegs: string[], routePath: string): boolean => {
    const rSegs = pathSegments(routePath);
    const catchIdx = rSegs.findIndex((s) => s.startsWith(':...'));
    if (catchIdx !== -1) {
      // serverless catch-all (api/v1/[...path].ts): prefix must match and the
      // fetch must have at least one segment in the catch-all position
      const fetchBefore = fetchSegs.slice(0, catchIdx);
      const routeBefore = rSegs.slice(0, catchIdx);
      return (
        fetchSegs.length > catchIdx &&
        fetchBefore.length === routeBefore.length &&
        fetchBefore.every((s, i) => routeBefore[i]!.startsWith(':') || routeBefore[i]!.toLowerCase() === s.toLowerCase())
      );
    }
    if (fetchSegs.length !== rSegs.length) return false;
    return fetchSegs.every((s, i) => rSegs[i]!.startsWith(':') || rSegs[i]!.toLowerCase() === s.toLowerCase());
  };
  for (const call of ctx.appMap.apiCalls) {
    if (!call.url.startsWith('/') || call.url.startsWith('//')) continue;
    const segs = pathSegments(call.url);
    const matched = apiRoutes.some((route) => matches(segs, route.path));
    if (!matched) {
      issues.push({
        rule: 'missing-endpoint',
        severity: 'medium',
        file: call.file,
        line: call.line,
        message: `fetch('${call.url}') has no matching API route — the request will 404.`,
        fixHint: 'Create the route, or fix the path.',
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------- 4. missing-rls

export function missingRls(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  const created = new Set<string>();
  const rlsEnabled = new Set<string>();
  for (const migration of ctx.migrations) {
    // strip comments — explanatory text can contain the very statements we look for
    const text = migration.text
      .replace(/--[^\n]*/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const m of text.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi,
    )) {
      created.add(m[1]!);
    }
    for (const m of text.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+enable\s+row\s+level\s+security/gi)) {
      rlsEnabled.add(m[1]!);
    }
  }
  for (const table of created) {
    if (table.startsWith('auth.') || table.startsWith('storage.')) continue;
    if (rlsEnabled.has(table)) continue;
    issues.push({
      rule: 'missing-rls',
      severity: 'high',
      file: 'supabase/migrations',
      line: 1,
      message: `Table "${table}" has no row level security — any client can read/write it with the anon key.`,
      fixHint: `alter table ${table} enable row level security;`,
    });
  }
  return issues;
}

/**
 * Files a client bundle can actually reach: BFS from 'use client' entries over
 * project-internal imports. Server-only modules (used by app/api routes and
 * server components) are excluded — the service-role key is legitimate there.
 */
export function clientReachableFiles(appMap: AppMap): Set<string> {
  const seen = new Set(appMap.clientEntryFiles);
  const queue = [...seen];
  while (queue.length) {
    const file = queue.pop()!;
    for (const dep of appMap.imports[file] ?? []) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return seen;
}

// ---------------------------------------------------------------- 5. service-key-in-client

export function serviceKeyInClient(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  const reachable = clientReachableFiles(ctx.appMap);
  for (const env of ctx.appMap.envVars) {
    if (!/SERVICE_ROLE|SERVICE_KEY/i.test(env.name)) continue;
    if (isServerFile(env.file)) continue;
    if (!reachable.has(env.file.replaceAll('\\', '/'))) continue; // server-only module — fine
    issues.push({
      rule: 'service-key-in-client',
      severity: 'high',
      file: env.file,
      line: env.line,
      message: `process.env.${env.name} is read in client-reachable code — the service-role key bypasses RLS if it ships to the browser.`,
      fixHint: 'Move service-role usage to server routes; never expose it client-side.',
    });
  }
  return issues;
}

// ---------------------------------------------------------------- 6. undefined-env

/** Platform-injected env vars: always present at runtime, never in .env files. */
const PLATFORM_ENV = /^VERCEL(_|$)|^NODE_ENV$|^PORT$|^FIGMA_/;

export function undefinedEnv(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const env of ctx.appMap.envVars) {
    if (PLATFORM_ENV.test(env.name)) continue;
    if (ctx.envKeys.has(env.name)) continue;
    const key = `${env.name}@${env.file}:${env.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({
      rule: 'undefined-env',
      severity: 'medium',
      file: env.file,
      line: env.line,
      message: `process.env.${env.name} is read but not defined in any .env / .env.example file.`,
      fixHint: `Add ${env.name} to .env.example (and your local .env), or remove the dead read.`,
    });
  }
  return issues;
}

// ---------------------------------------------------------------- 7. unverified-stripe-webhook

export function unverifiedStripeWebhook(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  for (const route of ctx.appMap.routes.filter((r) => r.kind === 'api')) {
    if (!/webhook/i.test(route.file)) continue;
    const text = ctx.fileText(route.file);
    if (!text) continue;
    if (/constructEvent|verifySignature|sig_header|stripe-signature/i.test(text)) continue;
    issues.push({
      rule: 'unverified-stripe-webhook',
      severity: 'high',
      file: route.file,
      line: 1,
      message: 'Webhook route does not verify the event signature — anyone can POST fake events.',
      fixHint: 'Use stripe.webhooks.constructEvent(rawBody, sig, secret) before trusting the payload.',
    });
  }
  return issues;
}

// ---------------------------------------------------------------- 8. no-error-state

/** UI-state rules only make sense in components (.tsx/.jsx with JSX). */
function isComponentFile(file: string): boolean {
  return /\.(tsx|jsx)$/.test(file);
}

export function noErrorState(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  for (const call of ctx.appMap.apiCalls) {
    if (isServerFile(call.file)) continue;
    if (call.enclosingFnHasErrorHandling) continue;
    if (!isComponentFile(call.file)) continue; // server libs / plain modules
    issues.push({
      rule: 'no-error-state',
      severity: 'medium',
      file: call.file,
      line: call.line,
      message: `async call to '${call.url || '<dynamic>'}' has no error handling — a rejection becomes an unhandled error with no user feedback.`,
      fixHint: 'Wrap in try/catch (or .catch) and render an error state.',
    });
  }
  return issues;
}

// ---------------------------------------------------------------- 9. no-loading-state

export function noLoadingState(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  for (const call of ctx.appMap.apiCalls) {
    if (isServerFile(call.file)) continue;
    if (call.method !== 'POST' && call.method !== 'PUT' && call.method !== 'PATCH' && call.method !== 'DELETE') continue;
    const text = ctx.fileText(call.file);
    if (!text) continue;
    if (!isComponentFile(call.file)) continue; // server libs / plain modules
    if (/loading|pending|busy|submitting|isSubmitting|disabled/i.test(text)) continue; // some pending state exists in this file
    issues.push({
      rule: 'no-loading-state',
      severity: 'medium',
      file: call.file,
      line: call.line,
      message: `async ${call.method} submit has no pending state in this file — double-clicks can double-submit.`,
      fixHint: 'Disable the submit button while the request is in flight (or add an idempotency key server-side).',
    });
  }
  return issues;
}

// ---------------------------------------------------------------- 10. exposed-secret

const SECRET_LITERALS = [
  /(?:sk|rk)_live_[A-Za-z0-9]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{30,}/,
];

export function exposedSecret(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  for (const rel of ctx.appMap.files) {
    const text = ctx.fileText(rel);
    if (!text) continue;
    for (const pattern of SECRET_LITERALS) {
      const m = text.match(pattern);
      if (m) {
        issues.push({
          rule: 'exposed-secret',
          severity: 'high',
          file: rel,
          line: text.slice(0, m.index).split('\n').length,
          message: `Secret-looking literal "${m[0].slice(0, 18)}…" is hardcoded in source.`,
          fixHint: 'Move it to an env var / secret manager; rotate the exposed key.',
        });
        break;
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------- registry

// ---------------------------------------------------------------- 11–15. Phase 5 rules

const POLICY_PERMISSIVE =
  /create\s+policy\s+\S+\s+on\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?(?:(?!using).)*?using\s*\(\s*true\s*\)/gis;

/** 11. permissive-rls: a policy of `using (true)` exposes the table to the anon role. */
export function permissiveRls(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  for (const migration of ctx.migrations) {
    const text = migration.text
      .replace(/--[^\n]*/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const m of text.matchAll(POLICY_PERMISSIVE)) {
      issues.push({
        rule: 'permissive-rls',
        severity: 'high',
        file: migration.rel,
        line: lineOf(migration.text, m.index ?? 0),
        message: `Policy on "${m[1]}" grants access with using (true) — every row is readable/writable by the anon role.`,
        fixHint: `Scope the policy: using (auth.uid() = user_id) or similar.`,
      });
    }
  }
  return issues;
}

const WRITE_METHOD = /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/;
const AUTH_SIGNALS = /getSession|getUser\s*\(|supabase\.auth|getServerSession|requireUser|auth\s*\(\)|currentUser|Bearer/i;
const AUTH_PATH = /\/auth\b|login|signup|register|password|session|otp|magic|webhook/i;
const RATE_LIMIT_SIGNALS = /rate.?limit|throttle|limiter|upstash/i;

/** 12. unauth-write-route: a write endpoint with no auth check at all. */
export function unauthWriteRoute(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  for (const r of ctx.appMap.routes) {
    if (r.kind !== 'api' || !r.file) continue;
    if (AUTH_PATH.test(r.path)) continue; // auth endpoints are unauthenticated by design
    const text = ctx.fileText(r.file);
    if (!text || !WRITE_METHOD.test(text)) continue;
    if (AUTH_SIGNALS.test(text)) continue;
    issues.push({
      rule: 'unauth-write-route',
      severity: 'high',
      file: r.file,
      line: 1,
      message: `API route ${r.path} writes (POST/PUT/PATCH/DELETE) without any auth check — anyone can call it.`,
      fixHint: 'Verify the session before writing: const user = await getSessionUser(); if (!user) return 401.',
    });
  }
  return issues;
}

/** 13. no-rate-limit-auth: auth endpoints without any rate limiting (heuristic). */
export function noRateLimitAuth(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  for (const r of ctx.appMap.routes) {
    if (r.kind !== 'api' || !r.file) continue;
    if (!/login|signup|register|password|otp|magiclink/i.test(r.path)) continue;
    const text = ctx.fileText(r.file);
    if (!text) continue;
    if (RATE_LIMIT_SIGNALS.test(text)) continue;
    issues.push({
      rule: 'no-rate-limit-auth',
      severity: 'medium',
      file: r.file,
      line: 1,
      message: `Auth endpoint ${r.path} has no rate limiting — brute-forceable.`,
      fixHint: 'Add a rate limiter (per-IP) in front of auth routes; see upstash/ratelimit or your platform middleware.',
    });
  }
  return issues;
}

const PENDING_SIGNALS = /disabled|isPending|submitting|useFormStatus|setLoading|isLoading/i;
const COMPONENT_FILE = /\.(tsx|jsx)$/;

/** 14. missing-submit-guard: write call in a component with no pending/disable state anywhere. */
export function missingSubmitGuard(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  const guarded = new Map<string, boolean>();
  for (const call of ctx.appMap.apiCalls) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(call.method)) continue;
    if (!COMPONENT_FILE.test(call.file)) continue; // route files have no button to disable
    if (!guarded.has(call.file)) {
      const text = ctx.fileText(call.file);
      guarded.set(call.file, text ? PENDING_SIGNALS.test(text) : true);
    }
    if (guarded.get(call.file)) continue;
    issues.push({
      rule: 'missing-submit-guard',
      severity: 'medium',
      file: call.file,
      line: call.line,
      message: `Write to ${call.url} with no pending state — rapid double-clicks double-fire the request (duplicate_write class).`,
      fixHint: 'Disable the control while the request is in flight (const [pending, setPending] = useState(false)).',
    });
  }
  return issues;
}

/** 15. missing-meta: no title in the root layout (Next) or index.html (Vite). */
export function missingMeta(ctx: RuleContext): Issue[] {
  const issues: Issue[] = [];
  const meta = /metadata|generateMetadata|<title/i;
  if (ctx.appMap.framework === 'next-app') {
    const layout = ctx.appMap.files.find((f) => /app\/layout\.(tsx|ts|jsx|js)$/.test(f.replaceAll('\\', '/')));
    if (!layout) {
      issues.push({
        rule: 'missing-meta',
        severity: 'low',
        file: 'app/layout.tsx',
        line: 1,
        message: 'No root layout found — the app has no <title>/description metadata.',
        fixHint: 'Add app/layout.tsx exporting `metadata` with title and description.',
      });
    } else {
      const text = ctx.fileText(layout);
      if (!text || !meta.test(text)) {
        issues.push({
          rule: 'missing-meta',
          severity: 'low',
          file: layout,
          line: 1,
          message: 'Root layout has no metadata export — no <title>/description for users or link previews.',
          fixHint: 'export const metadata = { title: ..., description: ... };',
        });
      }
    }
  } else if (ctx.appMap.framework === 'vite-react') {
    const html = ctx.fileText('index.html');
    if (html && !/<title/i.test(html)) {
      issues.push({
        rule: 'missing-meta',
        severity: 'low',
        file: 'index.html',
        line: 1,
        message: 'index.html has no <title>.',
        fixHint: 'Add <title> and a description meta tag.',
      });
    }
  }
  return issues;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

export const RULES: Array<{ name: string; run: (ctx: RuleContext) => Issue[] }> = [
  { name: 'dead-handler', run: deadHandler },
  { name: 'unwired-form', run: unwiredForm },
  { name: 'missing-endpoint', run: missingEndpoint },
  { name: 'missing-rls', run: missingRls },
  { name: 'service-key-in-client', run: serviceKeyInClient },
  { name: 'undefined-env', run: undefinedEnv },
  { name: 'unverified-stripe-webhook', run: unverifiedStripeWebhook },
  { name: 'no-error-state', run: noErrorState },
  { name: 'no-loading-state', run: noLoadingState },
  { name: 'exposed-secret', run: exposedSecret },
  { name: 'permissive-rls', run: permissiveRls },
  { name: 'unauth-write-route', run: unauthWriteRoute },
  { name: 'no-rate-limit-auth', run: noRateLimitAuth },
  { name: 'missing-submit-guard', run: missingSubmitGuard },
  { name: 'missing-meta', run: missingMeta },
];

export function runRules(ctx: RuleContext): Issue[] {
  const issues = RULES.flatMap((rule) => rule.run(ctx));
  return issues.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.file.localeCompare(b.file) || a.line - b.line,
  );
}

export function makeFileTextFn(root: string): (rel: string) => string | null {
  const cache = new Map<string, string | null>();
  return (rel: string) => {
    if (!cache.has(rel)) {
      try {
        cache.set(rel, readFileSync(join(root, rel), 'utf8'));
      } catch {
        cache.set(rel, null);
      }
    }
    return cache.get(rel) ?? null;
  };
}
