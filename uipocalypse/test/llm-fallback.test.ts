import { describe, expect, it, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { z } from 'zod';
import { createLlm, createLlmSet, healthCheck } from '../src/llm/index.js';

/**
 * Model deprecations are a product risk (both Workers AI models died with
 * HTTP 410 on 2026-11-20, mid-phase). LLM_MODEL / LLM_SCOUT_MODEL accept
 * comma-separated fallback chains; a 410/404 model failure walks to the next
 * candidate; a startup health check fails with an actionable message that
 * names the env var to set.
 */

let server: Server | null = null;
let url = '';

async function stubServer(handler: (model: string, res: import('node:http').ServerResponse) => void) {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}') as { model?: string };
      handler(parsed.model ?? '', res);
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
}

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
});

function ok(res: import('node:http').ServerResponse) {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }));
}

function dead(res: import('node:http').ServerResponse, status = 410) {
  res.statusCode = status;
  res.end(JSON.stringify({ errors: [{ message: 'AiError: Model has been deprecated', code: 5028 }] }));
}

describe('LLM model fallback chains + health check (2026-11-20 deprecations)', () => {
  it('falls through deprecated models to the working one and sticks to it', async () => {
    await stubServer((model, res) => (model === 'good-model' ? ok(res) : dead(res)));
    const llm = createLlm({ LLM_API_KEY: 'k', LLM_BASE_URL: url, LLM_MODEL: 'deprecated-a,deprecated-b,good-model' });
    const out = await llm.completeJSON({ user: 'x', schema: z.object({ ok: z.number() }) });
    expect(out).toEqual({ ok: 1 });
    expect(llm.model).toBe('good-model');
    // sticky: the next call goes straight to the working model
    await llm.completeJSON({ user: 'x', schema: z.object({ ok: z.number() }) });
    expect(llm.calls).toBe(2);
  });

  it('every candidate dead → actionable error naming the models and the env var', async () => {
    await stubServer((_model, res) => dead(res));
    const llm = createLlm({ LLM_API_KEY: 'k', LLM_BASE_URL: url, LLM_MODEL: 'dead-a,dead-b' });
    await expect(llm.completeJSON({ user: 'x', schema: z.object({ ok: z.number() }) })).rejects.toThrow(
      /dead-a.*dead-b.*Set LLM_MODEL/s,
    );
  });

  it('healthCheck returns the working model, or the actionable message on a dead chain', async () => {
    await stubServer((model, res) => (model === 'scout-live' ? ok(res) : dead(res)));
    const live = createLlm({ LLM_API_KEY: 'k', LLM_BASE_URL: url, LLM_MODEL: 'scout-live' });
    expect(await healthCheck(live, 'LLM_MODEL')).toBe('scout-live');

    await stubServer((_m, res) => dead(res, 404));
    const deadLlm = createLlm({ LLM_API_KEY: 'k', LLM_BASE_URL: url, LLM_MODEL: 'gone' });
    await expect(healthCheck(deadLlm, 'LLM_MODEL')).rejects.toThrow(/gone.*Set LLM_MODEL/s);
  });

  it('createLlmSet: planner and scout chains are independent; model ids are visible', async () => {
    await stubServer((model, res) => (model.startsWith('scout') ? ok(res) : dead(res)));
    const set = createLlmSet({
      LLM_API_KEY: 'k',
      LLM_BASE_URL: url,
      LLM_MODEL: 'plan-dead,plan-live',
      LLM_SCOUT_MODEL: 'scout-a',
    });
    // scout works, planner chain falls through
    const s = await set.scout.completeJSON({ user: 'x', schema: z.object({ ok: z.number() }) });
    expect(s).toEqual({ ok: 1 });
    await expect(set.planner.completeJSON({ user: 'x', schema: z.object({ ok: z.number() }) })).rejects.toThrow(
      /Set LLM_MODEL/,
    );
  });

  it('a single-model config behaves exactly as before (no chain, no behavior change)', async () => {
    await stubServer((_m, res) => ok(res));
    const llm = createLlm({ LLM_API_KEY: 'k', LLM_BASE_URL: url, LLM_MODEL: 'solo' });
    expect(llm.model).toBe('solo');
    expect(await llm.completeJSON({ user: 'x', schema: z.object({ ok: z.number() }) })).toEqual({ ok: 1 });
  });
});
