import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { chromium, type Page } from 'playwright';
import { join } from 'node:path';
import { RUNTIME_SOURCE } from '../src/runtime/runtime-source.js';
import { serveStatic } from './helpers.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'static-site');

describe('in-page runtime (TRD §3.5) on the static fixture', () => {
  let server: { url: string; close: () => Promise<void> };
  let page: Page;

  beforeAll(async () => {
    server = await serveStatic(FIXTURE);
    const browser = await chromium.launch();
    const context = await browser.newContext();
    await context.addInitScript(RUNTIME_SOURCE);
    page = await context.newPage();
    await page.goto(server.url);
  });

  afterAll(async () => {
    await page.context().browser()!.close();
    await server.close();
  });

  it('enumerates actionable elements with roles and names', async () => {
    const actions = await page.evaluate(() => window.__uip.getActions());
    const names = actions.map((a: { name: string }) => a.name);
    expect(names).toContain('Dead button');
    expect(names).toContain('Alive button');
    expect(names).toContain('Boom button');
    expect(names).toContain('Page 2');
    expect(names).toContain('Subscribe');
    const roles = actions.map((a: { role: string | null }) => a.role);
    expect(roles).toContain('link');
    expect(roles).toContain('button');
    expect(roles).toContain('textbox');
  });

  it('flags a dead click (no signals within 500 ms)', async () => {
    const actions = await page.evaluate(() => window.__uip.getActions());
    const dead = actions.find((a: { name: string }) => a.name === 'Dead button')!
    const result = await page.evaluate((id) => window.__uip.perform(id), dead.id);
    expect(result.dead).toBe(true);
  });

  it('sees DOM mutations on a live button', async () => {
    const actions = await page.evaluate(() => window.__uip.getActions());
    const alive = actions.find((a: { name: string }) => a.name === 'Alive button')!
    const result = await page.evaluate((id) => window.__uip.perform(id), alive.id);
    expect(result.dead).toBe(false);
    expect(result.reasons).toContain('mutation');
  });

  it('counts alert() as app feedback — never a dead click (held-out-app finding)', async () => {
    const actions = await page.evaluate(() => window.__uip.getActions());
    const alerts = actions.find((a: { name: string }) => a.name === 'Alert button')!
    const result = await page.evaluate((id) => window.__uip.perform(id), alerts.id);
    expect(result.dead).toBe(false);
    expect(result.reasons).toContain('dialog-feedback');
  });

  it('captures unhandled errors from a click', async () => {
    const actions = await page.evaluate(() => window.__uip.getActions());
    const boom = actions.find((a: { name: string }) => a.name === 'Boom button')!
    await page.evaluate((id) => window.__uip.perform(id), boom.id);
    const drain = await page.evaluate(() => window.__uip.drain());
    expect(drain.pageErrors.length).toBeGreaterThan(0);
    expect(drain.pageErrors[0]).toMatch(/notAFunction|is not defined/i);
  });

  it('fills text inputs via the React-compatible native setter and reports the change', async () => {
    const actions = await page.evaluate(() => window.__uip.getActions());
    const input = actions.find((a: { name: string }) => a.name === 'your name')!
    const result = await page.evaluate(
      ({ id, value }) => window.__uip.perform(id, { input: value }),
      { id: input.id, value: 'hello world' },
    );
    expect(result.dead).toBe(false);
    const value = await page.evaluate(() => (document.getElementById('name') as HTMLInputElement).value);
    expect(value).toBe('hello world');
  });

  it('does not flag a validation-blocked submit as a dead click (browser supplies its own feedback)', async () => {
    const actions = await page.evaluate(() => window.__uip.getActions());
    const email = actions.find((a: { name: string }) => a.name === 'you@example.com')!;
    // garbage-paster behavior: garbage in the field, then hit the submit button
    await page.evaluate(
      ({ id, value }) => window.__uip.perform(id, { input: value, waitMs: 100 }),
      { id: email.id, value: 'not-an-email 🎉' },
    );
    const sub = actions.find((a: { name: string }) => a.name === 'Subscribe')!;
    const result = await page.evaluate(
      (id) => window.__uip.perform(id, { doubleClick: true, interClickDelayMs: 50 }),
      sub.id,
    );
    expect(result.blocked).toBe(true);
    expect(result.dead).toBe(false);
    expect(result.reasons).toContain('validation-blocked');
    // and with a valid email the submit runs its handler again (title mutation)
    await page.evaluate(
      ({ id, value }) => window.__uip.perform(id, { input: value, waitMs: 100 }),
      { id: email.id, value: 'a@b.co' },
    );
    const alive = await page.evaluate((id) => window.__uip.perform(id), sub.id);
    expect(alive.dead).toBe(false);
    expect(alive.blocked).toBe(false);
    expect(alive.reasons).toContain('mutation');
    await page.goto(server.url); // restore the shared page for the tests below
  });

  it('does not flag no-op text actions (identical refill, refocus) as dead clicks', async () => {
    const actions = await page.evaluate(() => window.__uip.getActions());
    const name = actions.find((a: { name: string }) => a.name === 'your name')!;
    // first fill is alive (focus + value change)
    const first = await page.evaluate(
      ({ id, v }) => window.__uip.perform(id, { input: v }),
      { id: name.id, v: 'same value' },
    );
    expect(first.dead).toBe(false);
    // re-pasting the identical value into the still-focused field cannot change anything
    const refill = await page.evaluate(
      ({ id, v }) => window.__uip.perform(id, { input: v }),
      { id: name.id, v: 'same value' },
    );
    expect(refill.dead).toBe(false);
    expect(refill.reasons).toContain('already-filled');
    // clicking the already-focused field without typing is also a no-op
    const refocus = await page.evaluate((id) => window.__uip.perform(id), name.id);
    expect(refocus.dead).toBe(false);
    expect(refocus.reasons).toContain('already-focused');
    // typing a DIFFERENT value is still alive via the value change
    const other = await page.evaluate(
      ({ id, v }) => window.__uip.perform(id, { input: v }),
      { id: name.id, v: 'different value' },
    );
    expect(other.dead).toBe(false);
    expect(other.reasons).toContain('aria');
  });

  it('detects navigation as a liveness signal (context destroyed mid-perform -> nav)', async () => {
    const actions = await page.evaluate(() => window.__uip.getActions());
    const link = actions.find((a: { name: string }) => a.name === 'Page 2')!;
    // a full page navigation kills the JS context before perform can return -
    // the runner treats that rejection as a nav signal. Under parallel suite
    // load the same death can surface as "closed" instead of "destroyed".
    await expect(page.evaluate((id) => window.__uip.perform(id), link.id)).rejects.toThrow(
      /destroyed|navigation|closed/i,
    );
    await page.waitForLoadState('load');
    // the runtime re-installs on the new document
    const state = await page.evaluate(() => window.__uip.getState());
    expect(state.url).toContain('page2.html');
  });
});
