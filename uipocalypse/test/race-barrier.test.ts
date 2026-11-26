import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { chromium, type Route } from 'playwright';
import { runRace, createRequestBarrier } from '../src/browser/race.js';
import { createLogger } from '../src/logger.js';
import type { UiConfig } from '../src/config.js';

/**
 * Deterministic race reproducer (2026-11-26): race mode already synchronizes
 * the CLICK; the network barrier additionally holds every matching request at
 * the browser's network boundary until all contexts' requests have arrived,
 * then releases them in one tick — the volley hits the server as close to
 * simultaneously as HTTP allows. "Sometimes the coupon is redeemed twice"
 * becomes repeatable enough to measure.
 *
 * Honest limit: the barrier sits at the HTTP boundary, not inside Postgres —
 * transaction interleaving still jitters server-side. The claim is arrival
 * simultaneity, not 100% deterministic outcomes.
 */

const PAGE = `<!doctype html><html><body>
  <button id="fire">Fire race</button>
  <script>
    // real apps do async work between the click and the request — this
    // jitter (0-400 ms) is what an uncoordinated volley looks like
    document.getElementById('fire').onclick = function () {
      setTimeout(function () { fetch('/api/race', { method: 'POST' }); }, Math.random() * 400);
    };
  </script></body></html>`;

/** fixture that records high-resolution arrival times for POST /api/race */
function raceFixture(): Promise<{ url: string; arrivals: () => number[]; close: () => Promise<void> }> {
  const times: number[] = [];
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/race') {
      times.push(Number(process.hrtime.bigint() / 1_000_000n));
      res.end('ok');
    } else if (req.url === '/arrivals') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(times));
    } else {
      res.setHeader('content-type', 'text/html');
      res.end(PAGE);
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        arrivals: () => [...times],
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

const config = { invariants: [] } as unknown as UiConfig;

describe('network barrier (unit)', () => {
  it('holds matching requests until all expected arrivals, then releases together', async () => {
    const barrier = createRequestBarrier(3, 5000);
    let continued = 0;
    const hold = (pattern?: string) => barrier.intercept({
      continue: async () => { continued++; },
      request: () => ({ method: () => 'POST', url: () => 'http://127.0.0.1:1/api/race' }),
    } as unknown as Route, { appOrigin: 'http://127.0.0.1:1', pattern });

    hold();
    hold();
    await new Promise((r) => setTimeout(r, 50));
    expect(continued).toBe(0); // two arrived — still waiting for the third
    hold();
    await new Promise((r) => setTimeout(r, 50));
    expect(continued).toBe(3); // all three released in the same tick
  });

  it('a straggler can never deadlock the volley — the timeout releases whatever arrived', async () => {
    const barrier = createRequestBarrier(3, 80);
    let continued = 0;
    barrier.intercept({ continue: async () => { continued++; }, request: () => ({ method: () => 'POST', url: () => 'http://127.0.0.1:1/x' }) } as unknown as Route, { appOrigin: 'http://127.0.0.1:1' });
    barrier.intercept({ continue: async () => { continued++; }, request: () => ({ method: () => 'POST', url: () => 'http://127.0.0.1:1/x' }) } as unknown as Route, { appOrigin: 'http://127.0.0.1:1' });
    await new Promise((r) => setTimeout(r, 60));
    expect(continued).toBe(0); // waiting for the third
    await new Promise((r) => setTimeout(r, 120));
    expect(continued).toBe(2); // timeout released the two that arrived
  });

  it('non-matching traffic (GETs, other origins, pattern misses) passes through untouched', async () => {
    const barrier = createRequestBarrier(3, 5000);
    let passed = 0;
    const tryRoute = (method: string, url: string, pattern?: string) =>
      barrier.intercept({ continue: async () => { passed++; }, request: () => ({ method: () => method, url: () => url }) } as unknown as Route, { appOrigin: 'http://127.0.0.1:1', pattern });
    tryRoute('GET', 'http://127.0.0.1:1/api/race'); // not a write
    tryRoute('POST', 'http://elsewhere.example/x'); // different origin
    tryRoute('POST', 'http://127.0.0.1:1/api/other', '/api/race'); // pattern miss
    await new Promise((r) => setTimeout(r, 30));
    expect(passed).toBe(3); // all three passed straight through
  });
});

describe('barrier race volley (end-to-end)', () => {
  it('with the barrier, jittered requests arrive at the server together', async () => {
    const fixture = await raceFixture();
    const browser = await chromium.launch();
    try {
      const result = await runRace(
        browser,
        {
          url: fixture.url,
          actionLabel: 'Fire race',
          contexts: 4,
          config,
          logger: createLogger({}),
          barrier: { timeoutMs: 6000 },
        },
        { runInvariants: async (i) => ({ ...i, actual: 0, pass: true }) },
      );

      expect(result.fired).toBe(4);
      expect(result.barrier?.held).toBe(4);
      const times = fixture.arrivals();
      expect(times).toHaveLength(4);
      // the fixture delays each request by 0-400 ms AFTER the click — the
      // barrier absorbs all of it: arrivals cluster within 80 ms
      const spread = Math.max(...times) - Math.min(...times);
      expect(spread).toBeLessThan(80);
    } finally {
      await browser.close().catch(() => {});
      await fixture.close();
    }
  }, 60_000);

  it('without the barrier the volley still fires (regression guard)', async () => {
    const fixture = await raceFixture();
    const browser = await chromium.launch();
    try {
      const result = await runRace(
        browser,
        { url: fixture.url, actionLabel: 'Fire race', contexts: 4, config, logger: createLogger({}) },
        { runInvariants: async (i) => ({ ...i, actual: 0, pass: true }) },
      );
      expect(result.fired).toBe(4);
      expect(fixture.arrivals()).toHaveLength(4); // jittered, but all landed
      expect(result.barrier).toBeUndefined();
    } finally {
      await browser.close().catch(() => {});
      await fixture.close();
    }
  }, 60_000);
});
