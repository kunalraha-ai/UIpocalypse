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

  it('detects navigation as a liveness signal (context destroyed mid-perform -> nav)', async () => {
    const actions = await page.evaluate(() => window.__uip.getActions());
    const link = actions.find((a: { name: string }) => a.name === 'Page 2')!;
    // a full page navigation kills the JS context before perform can return -
    // the runner treats that rejection as a nav signal
    await expect(page.evaluate((id) => window.__uip.perform(id), link.id)).rejects.toThrow(
      /destroyed|navigation/i,
    );
    await page.waitForLoadState('load');
    // the runtime re-installs on the new document
    const state = await page.evaluate(() => window.__uip.getState());
    expect(state.url).toContain('page2.html');
  });
});
