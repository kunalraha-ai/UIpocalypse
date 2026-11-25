import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { chromium, type Page } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { RUNTIME_SOURCE } from '../src/runtime/runtime-source.js';
import { loadConfig } from '../src/config.js';
import { swarm } from '../src/browser/orchestrator.js';
import { applyVerdict, type VerifiableFinding } from '../src/browser/verify.js';
import { PlanSchema } from '../src/plan/schema.js';
import { createLlm } from '../src/llm/index.js';
import { openDb, listFindings } from '../src/db/index.js';
import { serveStatic, tmpWorkspace } from './helpers.js';

/**
 * Reproducibility precision pass (2026-11-25):
 *  - storage + console deltas in the runtime's before/after snapshot (a
 *    control whose only effect is a localStorage write or a console.error is
 *    wired, not dead)
 *  - settle-wait: the verdict window extends until DOM/network counters go
 *    quiet (bounded), so slow handlers inside ~1.5 s are no longer "dead"
 *  - the post-swarm verification sweep: every dead_click / inconsistent_feedback
 *    finding is re-performed once on a fresh page. Still dead → reproduced
 *    (high confidence). Works on retry → flaky (downgraded). This kills the
 *    "agent clicked too early / UI hadn't loaded" false-positive class.
 */

const FIXTURE = join(import.meta.dirname, 'fixtures', 'flaky-site');

describe('runtime signals: storage, console, settlement', () => {
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

  it('a localStorage-only control is ALIVE (storage signal)', async () => {
    const actions = await page.evaluate(() => window.__uip.getActions());
    const store = actions.find((a: { name: string }) => a.name === 'Store only')!;
    const result = await page.evaluate((id) => window.__uip.perform(id), store.id);
    expect(result.dead).toBe(false);
    expect(result.reasons).toContain('storage');
  });

  it('a console.error-only control is ALIVE (console signal)', async () => {
    const actions = await page.evaluate(() => window.__uip.getActions());
    const err = actions.find((a: { name: string }) => a.name === 'Error only')!;
    const result = await page.evaluate((id) => window.__uip.perform(id), err.id);
    expect(result.dead).toBe(false);
    expect(result.reasons).toContain('console');
  });

  it('a handler that lands at ~900 ms is ALIVE (settle-wait, not a fixed 500 ms window)', async () => {
    const actions = await page.evaluate(() => window.__uip.getActions());
    const slow = actions.find((a: { name: string }) => a.name === 'Slow handler')!;
    const result = await page.evaluate((id) => window.__uip.perform(id), slow.id);
    expect(result.dead).toBe(false);
    expect(result.reasons).toContain('mutation');
  });

  it('a control with no effect whatsoever is still DEAD', async () => {
    const actions = await page.evaluate(() => window.__uip.getActions());
    const dead = actions.find((a: { name: string }) => a.name === 'Truly dead')!;
    const result = await page.evaluate((id) => window.__uip.perform(id), dead.id);
    expect(result.dead).toBe(true);
    expect(result.reasons).toEqual([]);
  });
});

describe('verdict mapping (pure)', () => {
  const mk = (type: string, evidence: Record<string, unknown>, severity = 'medium', confidence = 'high'): VerifiableFinding =>
    ({ type, severity, confidence, evidence });

  it('dead_click reproduced on retry → confidence high, reproduced: true', () => {
    const out = applyVerdict(mk('dead_click', { action: 'Truly dead' }), { status: 'dead' });
    expect(out.evidence.reproduced).toBe(true);
    expect(out.confidence).toBe('high');
    expect(String(out.evidence.reproNote)).toContain('reproduced');
  });

  it('dead_click that WORKS on retry → flaky: downgraded to low severity', () => {
    const out = applyVerdict(mk('dead_click', { action: 'X' }), { status: 'alive', reasons: ['mutation'] });
    expect(out.evidence.reproduced).toBe(false);
    expect(out.severity).toBe('low');
    expect(out.confidence).toBe('low');
    expect(String(out.evidence.reproNote)).toContain('flaky');
  });

  it('inconsistent_feedback confirmed dead on retry → confidence raised to medium', () => {
    const out = applyVerdict(mk('inconsistent_feedback', { action: 'X', note: 'prior' }, 'low', 'low'), { status: 'dead' });
    expect(out.evidence.reproduced).toBe(true);
    expect(out.confidence).toBe('medium');
  });

  it('element missing on the fresh page → unverifiable, original verdict untouched', () => {
    const out = applyVerdict(mk('dead_click', { action: 'Gone' }), { status: 'unverifiable', reason: 'control not present' });
    expect(out.evidence.reproduced).toBe('unverifiable');
    expect(out.severity).toBe('medium'); // untouched
    expect(out.confidence).toBe('high'); // untouched
  });

  it('config defaults: verifyFindings is on', () => {
    const { config } = loadConfig();
    expect(config.verifyFindings).toBe(true);
  });
});

describe('verification sweep (end-to-end)', () => {
  it('dead controls are reproduced and flaky controls downgraded by a post-swarm re-verification', async () => {
    const server = await serveStatic(FIXTURE);
    const ws = tmpWorkspace();
    const db = openDb(join(mkdtempSync('/tmp/opencode/uip-repro-'), 'db.sqlite'));
    const plan = PlanSchema.parse({ summary: 'fixture', goals: [], seedRoutes: [server.url], nastyInputs: { long: ['z'.repeat(50)] } });
    const result = await swarm({
      url: server.url,
      config: ws.config,
      plan,
      db,
      routes: ['/'],
      llm: createLlm({ LLM_API_KEY: '' }),
      logger: ws.logger,
      agents: 4,
      budgetSeconds: 60,
      perAgentSteps: 16,
    });

    // the sweep ran and reported its tally
    expect(result.verification.attempted).toBeGreaterThan(0);

    const rows = listFindings(db, result.runId);
    const dead = rows.find((r) => r.type === 'dead_click');
    expect(dead).toBeDefined();
    const deadEv = JSON.parse(dead!.evidence_json!);
    expect(deadEv.action).toBe('Truly dead');
    expect(deadEv.reproduced).toBe(true); // dead again on a fresh page

    // "Wears out" worked at least once in-run and was clicked again →
    // inconsistent_feedback; on the sweep's fresh page its FIRST click works
    // → reproduced: false, the flaky downgrade
    const inconsistent = rows.find((r) => r.type === 'inconsistent_feedback');
    expect(inconsistent).toBeDefined();
    const incEv = JSON.parse(inconsistent!.evidence_json!);
    expect(incEv.reproduced).toBe(false);
    expect(incEv.reproNote).toContain('flaky');

    db.close();
    await server.close();
    ws.cleanup();
  }, 120_000);
});
