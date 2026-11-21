import { z } from 'zod';
import { loadDotEnv } from '../envfile.js';

/**
 * Provider-agnostic LLM layer (TRD §2/§10): Anthropic by default in spirit,
 * implemented against the OpenAI-compatible chat-completions API so it covers
 * OpenAI, Cloudflare Workers AI, local servers, etc. via LLM_BASE_URL.
 * Every payload must pass through guard.redactForLlm before it gets here.
 */

export interface LLM {
  readonly model: string;
  readonly configured: boolean;
  /** LLM calls made through this instance — the Phase 3 gate metric. */
  calls: number;
  maxCalls: number;
  completeJSON<T>(opts: {
    system?: string;
    user: string;
    schema: z.ZodType<T, z.ZodTypeDef, unknown>;
    maxTokens?: number;
    label?: string;
  }): Promise<T>;
}

export function createLlm(envOverrides?: Record<string, string>): LLM {
  const env = mergedEnv(envOverrides);
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) return new NullLlm();
  const baseURL = (env.LLM_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const models = (env.LLM_MODEL ?? 'gpt-4o-mini')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return new OpenAICompatLlm({ apiKey, baseURL, models });
}

/**
 * Planner + scout LLMs sharing one call counter (budgets and the Phase 3 gate
 * measure total calls). Scouts default to LLM_SCOUT_MODEL — use a fast
 * non-reasoning model there; reasoning models spend their token budget on
 * reasoning and are slow per call (PHASE3_RESULTS.md).
 */
export type LlmSet = { planner: LLM; scout: LLM };

export function createLlmSet(envOverrides?: Record<string, string>): LlmSet {
  const env = mergedEnv(envOverrides);
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) {
    const nullLlm = new NullLlm();
    return { planner: nullLlm, scout: nullLlm };
  }
  const baseURL = (env.LLM_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const counter = { calls: 0 };
  const chain = (value: string | undefined, fallbackModel: string) =>
    (value ?? fallbackModel)
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
  const plannerModel = env.LLM_MODEL ?? 'gpt-4o-mini';
  const scoutModel = env.LLM_SCOUT_MODEL ?? plannerModel;
  return {
    planner: new OpenAICompatLlm({ apiKey, baseURL, models: chain(env.LLM_MODEL, plannerModel), counter }),
    scout: new OpenAICompatLlm({ apiKey, baseURL, models: chain(env.LLM_SCOUT_MODEL, scoutModel), counter }),
  };
}

function mergedEnv(envOverrides?: Record<string, string>): Record<string, string | undefined> {
  return {
    ...loadDotEnv([`${process.cwd()}/.env`, `${process.cwd()}/uipocalypse/.env`]),
    ...process.env,
    ...(envOverrides ?? {}),
  };
}

class NullLlm implements LLM {
  readonly model = 'none';
  readonly configured = false;
  calls = 0;
  maxCalls = Infinity;
  async completeJSON(): Promise<never> {
    throw new Error('No LLM configured (set LLM_API_KEY / LLM_BASE_URL / LLM_MODEL). Running in degraded mode.');
  }
}

/** HTTP statuses meaning "this model is gone / not available on this account". */
const MODEL_UNAVAILABLE = new Set([404, 410]);

class OpenAICompatLlm implements LLM {
  private readonly shared: { calls: number };
  maxCalls = Infinity;
  /** candidate chain; activeModel is sticky after the first success */
  private activeModel: string;
  private readonly tried: Set<string> = new Set();
  constructor(
    private readonly opts: {
      apiKey: string;
      baseURL: string;
      models: string[];
      counter?: { calls: number };
    },
  ) {
    this.shared = opts.counter ?? { calls: 0 };
    this.activeModel = opts.models[0]!;
  }
  get model(): string {
    return this.activeModel;
  }
  get configured(): boolean {
    return true;
  }
  get calls(): number {
    return this.shared.calls;
  }
  set calls(value: number) {
    this.shared.calls = value;
  }

  async completeJSON<T>(opts: {
    system?: string;
    user: string;
    schema: z.ZodType<T, z.ZodTypeDef, unknown>;
    maxTokens?: number;
    label?: string;
  }): Promise<T> {
    if (this.calls >= this.maxCalls) {
      throw new Error(`LLM call budget exhausted (${this.maxCalls}) at ${opts.label ?? 'unknown'}`);
    }
    this.calls++;
    // walk the fallback chain while models are deprecated/unavailable (410/404)
    for (;;) {
      let failure: Error;
      try {
        const text = await this.request(this.activeModel, opts);
        return this.parseAndValidate(text, opts.schema);
      } catch (e) {
        failure = e as Error;
      }
      const next = this.opts.models.find((m) => !this.tried.has(m) && m !== this.activeModel);
      if (next && this.isModelUnavailable(failure)) {
        this.tried.add(this.activeModel);
        this.activeModel = next;
        continue;
      }
      if (this.isModelUnavailable(failure)) {
        throw new Error(
          `LLM models unavailable (${this.opts.models.join(', ')}); last error: ${failure.message}. Set LLM_MODEL / LLM_SCOUT_MODEL in .env to a current catalog model — deprecations happen (phase 5 lost both its models to HTTP 410 on 2026-11-20).`,
        );
      }
      throw failure;
    }
  }

  private isModelUnavailable(e: Error): boolean {
    const status = /LLM HTTP (\d+)/.exec(e.message)?.[1];
    return status !== undefined && MODEL_UNAVAILABLE.has(Number(status));
  }

  private async request(
    model: string,
    opts: { system?: string; user: string; maxTokens?: number; label?: string },
  ): Promise<string> {
    const body = {
      model,
      messages: [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        { role: 'user', content: opts.user },
      ],
      max_tokens: opts.maxTokens ?? 1024,
      temperature: 0,
    };
    const res = await fetch(`${this.opts.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const errText = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`LLM HTTP ${res.status}: ${errText}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content ?? '';
  }

  private parseAndValidate<T>(text: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
    const stripped = text
      .replace(/^[\s\S]*?```(?:json)?\s*\n?/, '') // leading prose + fence
      .replace(/\n?```\s*[\s\S]*$/, '') // trailing fence + prose
      .trim();
    const candidate = stripped.startsWith('{') || stripped.startsWith('[') ? stripped : text.trim();
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    const jsonText = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
    const parsed = JSON.parse(jsonText) as unknown; // throws on garbage → caller degrades
    return schema.parse(parsed);
  }
}

/**
 * Startup health check (phase 5 model-deprecation scope): one cheap call to
 * confirm the configured model answers. Fails with an actionable message
 * naming the env var to set, instead of a stack trace mid-run.
 */
export async function healthCheck(llm: LLM, envVar: string): Promise<string> {
  try {
    await llm.completeJSON({
      user: 'Reply with the JSON {"ok": 1}',
      schema: z.object({ ok: z.number() }),
      maxTokens: 500,
      label: 'health-check',
    });
    return llm.model;
  } catch (e) {
    // the advice must match the failure class — "set a current model" is
    // wrong, unhelpful advice when the key is bad or the provider is down
    const msg = String(e);
    const status = /LLM HTTP (\d+)/.exec(msg)?.[1];
    const advice =
      status === '401' || status === '403'
        ? 'Auth rejected — check LLM_API_KEY, and that LLM_BASE_URL points at the right provider/account.'
        : status === '404' || status === '410'
          ? `Set ${envVar} in .env to a current catalog model — deprecations happen (both phase-5 models returned HTTP 410 on 2026-11-20).`
          : status && Number(status) >= 500
            ? 'The provider returned a server error — check LLM_BASE_URL, or retry later.'
            : 'Check LLM_API_KEY, LLM_BASE_URL, and the model names in .env.';
    throw new Error(
      `LLM health check failed (model chain starting "${llm.model}"): ${msg.slice(0, 200)}. ${advice}`,
      { cause: e },
    );
  }
}

/** Deterministic scripted LLM for tests. */
export class FakeLlm implements LLM {
  readonly model = 'fake';
  readonly configured = true;
  calls = 0;
  maxCalls = Infinity;
  private readonly queue: Array<(user: string) => unknown> = [];

  script(response: (user: string) => unknown): this {
    this.queue.push(response);
    return this;
  }

  async completeJSON<T>(opts: { user: string; schema: z.ZodType<T, z.ZodTypeDef, unknown> }): Promise<T> {
    if (!this.queue.length) throw new Error(`FakeLlm: unexpected call #${this.calls + 1}: ${opts.user.slice(0, 120)}`);
    this.calls++;
    const raw = this.queue.shift()!(opts.user);
    return opts.schema.parse(raw);
  }
}
