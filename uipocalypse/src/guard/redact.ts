/**
 * LLM privacy (SAFETY.md §4): only structured, secret-free summaries ever
 * leave the machine. Every payload destined for an LLM passes through
 * redactForLlm(); the guard acceptance test (SAFETY.md §6 row 6) proves
 * .env values cannot survive the pipeline.
 */

const KEY_NAME_RE =
  /(?:api[_-]?key|secret|password|passwd|token|credential|private[_-]?key|bearer)/i;

const KEY_VALUE_RE =
  /((?:api[_-]?key|secret|password|passwd|token|credential|private[_-]?key|bearer)[a-z0-9_-]*\s*[:=]\s*)["']?([^\s"']{4,})["']?/gi;

export function redactSecrets(text: string, extraSecrets: Array<string | undefined> = []): string {
  let out = text;
  // caller-provided literal secrets (e.g., every value from the target's .env)
  for (const s of extraSecrets) {
    if (s && s.length >= 6) out = out.split(s).join('[REDACTED]');
  }
  out = out
    // Stripe-style keys
    .replace(/(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, '[REDACTED:stripe-key]')
    // JWTs
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED:jwt]')
    // connection strings with credentials
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s"']+/gi, '[REDACTED:db-url]')
    // key: value pairs in free text
    .replace(KEY_VALUE_RE, (_m, keyPart: string) => `${keyPart}[REDACTED]`);
  return out;
}

export function redactEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    out[key] = KEY_NAME_RE.test(key) ? '[REDACTED]' : value;
  }
  return out;
}

export function redactForLlm<T>(payload: T, env?: Record<string, string | undefined>): T {
  const secrets = Object.values(env ?? {}).filter((v): v is string => typeof v === 'string');
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return redactSecrets(value, secrets);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };
  return walk(payload) as T;
}
