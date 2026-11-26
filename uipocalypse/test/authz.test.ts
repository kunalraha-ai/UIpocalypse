import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { auditAuthorization, classifyExposure, looksLikeResourceId } from '../src/browser/authz.js';
import { openDb, createRun, listFindings } from '../src/db/index.js';
import { createLogger } from '../src/logger.js';

/**
 * Cross-user authorization audit (2026-11-26): vibecoded apps often miss
 * ownership checks — the static missing-rls rule flags the precondition,
 * this proves it end to end. The audit crawls the app as user A, then
 * replays every resource URL A saw as user B and a guest, read-only (GET
 * only, by design), and classifies each answer:
 *
 *   exposed    200 with the same body A received — someone else's data, verbatim
 *   possible   200 with different content for an id-scoped resource — inspect
 *   own-data   200 with different content on a user-scoped endpoint (e.g.
 *              /api/me correctly returns the viewer's own data)
 *   guarded    401/403/404/redirect — the check exists
 *
 * The cheap-first-test: two seeded users and one deliberately planted leak.
 */

describe('classifier (pure)', () => {
  it('identical 200 body on an id-scoped resource = exposed', () => {
    expect(classifyExposure({ status: 200, body: '{"owner":"alice"}' }, { status: 200, body: '{"owner":"alice"}' }, true)).toBe('exposed');
  });
  it('identical 200 body on a public page = shared — never a finding', () => {
    expect(classifyExposure({ status: 200, body: '<html>public</html>' }, { status: 200, body: '<html>public</html>' }, false)).toBe('shared');
  });
  it('200 with different body on an id-scoped resource = possible', () => {
    expect(classifyExposure({ status: 200, body: 'a' }, { status: 200, body: 'b' }, true)).toBe('possible');
  });
  it('200 with different body on a user-scoped endpoint = own-data (correct behavior)', () => {
    expect(classifyExposure({ status: 200, body: 'alice' }, { status: 200, body: 'bob' }, false)).toBe('own-data');
  });
  it('401/403/404/redirect = guarded', () => {
    expect(classifyExposure({ status: 200, body: 'x' }, { status: 401, body: '' }, true)).toBe('guarded');
    expect(classifyExposure({ status: 200, body: 'x' }, { status: 403, body: '' }, true)).toBe('guarded');
    expect(classifyExposure({ status: 200, body: 'x' }, { status: 404, body: '' }, true)).toBe('guarded');
    expect(classifyExposure({ status: 200, body: 'x' }, { status: 302, body: '' }, true)).toBe('guarded');
  });
  it('id-scoped detection: trailing ids, uuids, hex — not /api/me', () => {
    expect(looksLikeResourceId('/api/orders/1')).toBe(true);
    expect(looksLikeResourceId('/api/orders/abc-123')).toBe(true);
    expect(looksLikeResourceId('/api/notes/9f2c')).toBe(true);
    expect(looksLikeResourceId('/api/me')).toBe(false);
    expect(looksLikeResourceId('/api/profile')).toBe(false);
  });
});

/**
 * The planted-leak fixture: cookie sessions, alice owns order 1 and note 9.
 *   /api/me        — correctly user-scoped (alice/bob see their own name)
 *   /api/orders/1  — THE LEAK: bob gets alice's order verbatim; guest 401
 *   /api/notes/9   — correctly guarded (bob 403, guest 401)
 */
function leakyApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const page = `<!doctype html><html><body><h1>Dashboard</h1><script>
    fetch('/api/me'); fetch('/api/orders/1'); fetch('/api/notes/9');
  </script></body></html>`;
  const server = createServer((req, res) => {
    const session = (req.headers.cookie ?? '').match(/session=(\w+)/)?.[1] ?? null;
    const send = (status: number, body: string) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(body);
    };
    if (req.url === '/style.css') { res.setHeader('content-type', 'text/css'); res.end('body{}'); return; }
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end(page); return; }
    if (req.url === '/api/me') {
      if (!session) return send(401, '{"error":"unauthorized"}');
      return send(200, JSON.stringify({ me: session }));
    }
    if (req.url === '/api/orders/1') {
      if (!session) return send(401, '{"error":"unauthorized"}');
      return send(200, '{"order":"A1","owner":"alice","total":42}'); // no ownership check — the leak
    }
    if (req.url === '/api/notes/9') {
      if (!session) return send(401, '{"error":"unauthorized"}');
      if (session !== 'alice') return send(403, '{"error":"forbidden"}');
      return send(200, '{"note":"alice private note"}');
    }
    return send(404, '{"error":"nope"}');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function profileFile(name: string, session: string): string {
  const file = join(mkdtempSync('/tmp/opencode/uip-auth-'), `${name}.json`);
  writeFileSync(
    file,
    JSON.stringify({ cookies: [{ name: 'session', value: session, domain: '127.0.0.1', path: '/' }] }),
  );
  return file;
}

describe('authorization audit (end-to-end, planted leak)', () => {
  let app: Awaited<ReturnType<typeof leakyApp>>;
  beforeAll(async () => {
    app = await leakyApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('finds the leak, respects the guards, and records findings on a run', async () => {
    const db = openDb(join(mkdtempSync('/tmp/opencode/uip-authz-'), 'db.sqlite'));
    createRun(db, { targetUrl: app.url, agents: 1 }); // reserve id 1 — audit creates its own
    const browser = await chromium.launch();
    try {
      const result = await auditAuthorization({
        browser,
        url: app.url,
        db,
        profiles: [
          { name: 'alice', storageState: profileFile('alice', 'alice') },
          { name: 'bob', storageState: profileFile('bob', 'bob') },
        ],
        logger: createLogger({}),
      });

      const by = (url: string, profile: string) =>
        result.results.find((r) => r.url.endsWith(url) && r.profile === profile);

      // the planted leak: bob reads alice's order verbatim
      expect(by('/api/orders/1', 'bob')!.classification).toBe('exposed');
      expect(by('/api/orders/1', 'guest')!.classification).toBe('guarded'); // guest is blocked
      // correctly guarded note
      expect(by('/api/notes/9', 'bob')!.classification).toBe('guarded');
      // user-scoped endpoint: different body is CORRECT — never a finding
      expect(by('/api/me', 'bob')!.classification).toBe('own-data');
      // the public dashboard page is identical for everyone — shared, not a leak
      expect(result.results.find((r) => r.profile === 'bob' && r.url.endsWith('/'))!.classification).toBe('shared');
      // assets never enter the audit
      expect(result.results.some((r) => r.url.includes('style.css'))).toBe(false);
      // and only the real leak became a finding (shared/own-data/guarded never do)
      const exposures = listFindings(db, result.runId).filter((f) => f.type === 'authorization_exposure');
      expect(exposures.every((f) => JSON.parse(f.evidence_json!).url.includes('/api/orders/1'))).toBe(true);
      const leak = exposures.find((f) => JSON.parse(f.evidence_json!).url.includes('/api/orders/1'));
      expect(leak).toBeDefined();
      expect(leak!.severity).toBe('high');
      expect(JSON.parse(leak!.evidence_json!).profile).toBe('bob');
      db.close();
    } finally {
      await browser.close().catch(() => {});
    }
  }, 90_000);

  it('no configured profiles is an honest error, not a guess', async () => {
    const db = openDb(join(mkdtempSync('/tmp/opencode/uip-authz2-'), 'db.sqlite'));
    const browser = await chromium.launch();
    try {
      await expect(
        auditAuthorization({ browser, url: app.url, db, profiles: [], logger: createLogger({}) }),
      ).rejects.toThrow(/profiles/);
    } finally {
      await browser.close().catch(() => {});
      db.close();
    }
  }, 60_000);
});
