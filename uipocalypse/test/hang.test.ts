import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { withTimeout } from '../src/browser/timeout.js';
import { explore } from '../src/browser/runner.js';
import { swarm } from '../src/browser/orchestrator.js';
import { PlanSchema } from '../src/plan/schema.js';
import { initWorkspace } from '../src/workspace.js';
import { openDb } from '../src/db/index.js';
import { createLogger } from '../src/logger.js';
import { loadConfig } from '../src/config.js';
import { createLlm } from '../src/llm/index.js';
import { serveStatic } from './helpers.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'static-site');

/**
 * A wedged renderer stalls page.evaluate/ariaSnapshot FOREVER — Playwright has
 * no default timeout for evaluate — and one hung operation defeats every
 * cooperative budget check (the phase 5 gate sat 4h09m on 11 scout calls this
 * way). The fix: every browser op races a hard timeout, and the phase
 * watchdog force-closes the browser at budget + overshoot (TRD §11).
 */

describe('hang protection (TRD §11 watchdog, phase 5)', () => {
  it('withTimeout: a never-resolving promise rejects with its label', async () => {
    const never = new Promise<never>(() => {});
    await expect(withTimeout(never, 50, 'getActions')).rejects.toThrow(/getActions timed out/);
    await expect(withTimeout(Promise.resolve('ok'), 50, 'fast')).resolves.toBe('ok');
  }, 10_000);

  it('explore resolves within budget + overshoot even when every runtime op hangs', async () => {
    const server = await serveStatic(FIXTURE);
    const hangUrl = `${server.url}/hang.html`;
    const ws = initWorkspace(mkdtempSync('/tmp/opencode/uip-hang-'));
    const db = openDb(ws.db);
    const { config } = loadConfig();
    const plan = PlanSchema.parse({ summary: 'hang', seedRoutes: [hangUrl], nastyInputs: { long: ['z'] } });

    const t0 = Date.now();
    const result = await explore({
      url: hangUrl,
      config: { ...config, scoutBudgetSeconds: 3 },
      plan,
      db,
      routes: [],
      llm: createLlm({ LLM_API_KEY: '' }),
      scoutLlm: createLlm({ LLM_API_KEY: '' }),
      logger: createLogger({}),
      budgetSeconds: 5,
      scoutSteps: 4,
      wandererSteps: 4,
    });
    const wall = Date.now() - t0;

    // it RESOLVED (on the old code this never returns) and the watchdog kept
    // the whole phase inside budget + bounded overshoot (5 s budget + 60 s
    // watchdog slack + cleanup), not hours
    expect(wall).toBeLessThan(80_000);
    expect(result.summary.findingsTotal).toBe(0); // nothing fabricated from a wedged page

    db.close();
    await server.close();
  }, 120_000);

  it('swarm resolves within budget + overshoot when every runtime op hangs (crash isolation + watchdog)', async () => {
    const server = await serveStatic(FIXTURE);
    const hangUrl = `${server.url}/hang.html`;
    const ws = initWorkspace(mkdtempSync('/tmp/opencode/uip-hang-sw-'));
    const db = openDb(ws.db);
    const { config } = loadConfig();
    const plan = PlanSchema.parse({ summary: 'hang', seedRoutes: [hangUrl], nastyInputs: { long: ['z'] } });

    const t0 = Date.now();
    const result = await swarm({
      url: hangUrl,
      config,
      plan,
      db,
      routes: [],
      llm: createLlm({ LLM_API_KEY: '' }),
      logger: createLogger({}),
      agents: 3,
      budgetSeconds: 5,
      perAgentSteps: 5,
    });
    const wall = Date.now() - t0;

    expect(wall).toBeLessThan(150_000); // resolved and bounded — the old code wedges forever (budget 5 s + 90 s watchdog slack + cleanup)
    expect(result.aborted).toBe(false);
    expect(result.steps).toBeLessThan(3 * 5); // clearly no real progress happened

    db.close();
    await server.close();
  }, 120_000);

  it('sanity: the same server serves a healthy page fine (hang is per-page, not the harness)', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('about:blank');
    await browser.close();
  }, 30_000);
});
