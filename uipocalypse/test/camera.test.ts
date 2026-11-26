import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { swarm, type SwarmFrame } from '../src/browser/orchestrator.js';
import { PlanSchema } from '../src/plan/schema.js';
import { createLlm } from '../src/llm/index.js';
import { openDb } from '../src/db/index.js';
import { serveStatic, tmpWorkspace } from './helpers.js';

/**
 * Swarm camera (2026-11-26): the web UI's live-run page shows what the
 * agents' real browsers are doing. The orchestrator samples JPEG frames from
 * the agents' pages and hands them to the caller — only while cameraActive()
 * says someone is watching, and never after the swarm phase ends.
 */

const FIXTURE = join(import.meta.dirname, 'fixtures', 'static-site');

describe('swarm camera', () => {
  it('streams JPEG frames from agent pages, respects cameraActive, and stops with the swarm', async () => {
    const server = await serveStatic(FIXTURE);
    const ws = tmpWorkspace();
    const db = openDb(join(mkdtempSync('/tmp/opencode/uip-cam-'), 'db.sqlite'));
    const frames: SwarmFrame[] = [];

    const plan = PlanSchema.parse({ summary: 'fixture', goals: [], seedRoutes: [server.url], nastyInputs: { long: ['z'.repeat(50)] } });
    await swarm({
      url: server.url,
      config: ws.config,
      plan,
      db,
      routes: ['/', '/page2.html'],
      llm: createLlm({ LLM_API_KEY: '' }),
      logger: ws.logger,
      agents: 3,
      budgetSeconds: 45,
      perAgentSteps: 8,
      frameIntervalMs: 300,
      // the viewer "disconnects" after 5 frames — sampling must stop with it
      cameraActive: () => frames.length < 5,
      onFrame: (f) => frames.push(f),
    });

    // frames streamed while the viewer watched, then stopped at the cap
    expect(frames.length).toBe(5);

    for (const f of frames) {
      expect(f.agent).toBeGreaterThanOrEqual(0);
      expect(f.agent).toBeLessThan(3);
      expect(typeof f.persona).toBe('string');
      expect(f.url).toContain(server.url);
      expect(typeof f.at).toBe('number');
      // real JPEG bytes (SOI marker), base64-encoded
      const bytes = Buffer.from(f.data, 'base64');
      expect(bytes.length).toBeGreaterThan(500);
      expect(bytes[0]).toBe(0xff);
      expect(bytes[1]).toBe(0xd8);
    }

    // the camera is cleared with the swarm phase — no frames leak out afterwards
    const countAfter = frames.length;
    await new Promise((r) => setTimeout(r, 1200));
    expect(frames.length).toBe(countAfter);

    db.close();
    await server.close();
    ws.cleanup();
  }, 120_000);
});
