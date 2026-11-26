import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Logger } from '../logger.js';
import type { Db } from '../db/index.js';
import { hostMatches } from '../guard/index.js';

const run = promisify(execFile);

/**
 * Safe database branching (2026-11-26). Many vibecoders have exactly one
 * (production-shaped) database, so UIpocalypse's write-mode testing falls
 * back to read-only runs. This engine clones the LOCAL Postgres database the
 * app uses into a throwaway sibling database, so the app can restart against
 * the copy and the swarm can fire writes, race volleys and destructive
 * clicks into something disposable.
 *
 * Scope, deliberately narrow:
 *  - LOCAL Postgres only (the source host must be in db.allowedHosts). Cloning
 *    a remote database DOWN would move data the product promises never
 *    leaves the machine; Supabase/Neon hosted branches are a separate,
 *    explicit-consent feature.
 *  - Standard client tools (psql, pg_dump, pg_restore) via execFile — no
 *    shell, connection strings passed as single argv entries.
 *  - One clone per source: re-cloning replaces the previous copy (it is
 *    stale by definition once the app changed).
 *  - A failed restore drops the half-created clone — no orphans.
 */

export type CloneRecord = { name: string; sourceName: string; url: string; createdAt: string };

const NAME_RE = /^[A-Za-z0-9_]+$/;

function parseSourceUrl(sourceUrl: string): { maintenanceUrl: string; dbName: string } {
  let u: URL;
  try {
    u = new URL(sourceUrl);
  } catch {
    throw new Error(`invalid connection string: could not parse "${sourceUrl.slice(0, 40)}"`);
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
    throw new Error('the source must be a postgres:// connection string');
  }
  const dbName = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!dbName || !NAME_RE.test(dbName)) {
    throw new Error(`the source database name must be a plain identifier, got "${dbName || '(none)'}"`);
  }
  const maintenance = new URL(sourceUrl);
  maintenance.pathname = '/postgres';
  return { maintenanceUrl: maintenance.href, dbName };
}

function cloneUrlFor(sourceUrl: string, name: string): string {
  const u = new URL(sourceUrl);
  u.pathname = `/${name}`;
  return u.href;
}

async function runTool(bin: string, args: string[], opts: { binDir?: string; timeoutMs: number }, what: string): Promise<string> {
  const binPath = opts.binDir ? join(opts.binDir, bin) : bin;
  try {
    const { stdout, stderr } = await run(binPath, args, { timeout: opts.timeoutMs, maxBuffer: 10 * 1024 * 1024 });
    return `${stdout}${stderr}`;
  } catch (e) {
    const err = e as { killed?: boolean; stderr?: string; message?: string };
    const tail = (err.stderr ?? err.message ?? '').slice(-300);
    throw new Error(`${what} failed${err.killed ? ` (timeout after ${opts.timeoutMs} ms)` : ''}: ${tail}`);
  }
}

async function toolWorks(bin: string, binDir?: string): Promise<boolean> {
  const binPath = binDir ? join(binDir, bin) : bin;
  try {
    await run(binPath, ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function psql(sql: string, maintenanceUrl: string, opts: { binDir?: string; timeoutMs: number }): Promise<string> {
  return runTool('psql', [maintenanceUrl, '-v', 'ON_ERROR_STOP=1', '-c', sql], opts, `psql: ${sql.slice(0, 40)}`);
}

async function dropDatabase(name: string, maintenanceUrl: string, opts: { binDir?: string; timeoutMs: number }, logger: Logger): Promise<void> {
  // PG 13+: WITH (FORCE) disconnects an app still pointed at the old clone
  // (the restart the flow requires anyway). Older servers: plain drop.
  try {
    await psql(`DROP DATABASE "${name}" WITH (FORCE)`, maintenanceUrl, opts);
  } catch (e) {
    logger.warn('drop with force failed, retrying plain', { name, error: String(e).slice(0, 120) });
    await psql(`DROP DATABASE "${name}"`, maintenanceUrl, opts);
  }
}

/** List the tracked clones (workspace DB). */
export function listClones(db: Db): CloneRecord[] {
  const rows = db.prepare('SELECT name, source_name, clone_url, created_at FROM db_clones ORDER BY id DESC').all() as Array<{
    name: string;
    source_name: string;
    clone_url: string;
    created_at: string;
  }>;
  return rows.map((r) => ({ name: r.name, sourceName: r.source_name, url: r.clone_url, createdAt: r.created_at }));
}

/**
 * Clone the local Postgres database into a fresh throwaway sibling.
 * Replaces any previous clone of the same source (stale by definition).
 */
export async function cloneLocalPostgres(opts: {
  sourceUrl: string;
  db: Db;
  allowHosts: string[];
  logger: Logger;
  /** injectable client-tools directory (tests stub the binaries) */
  binDir?: string;
  timeoutMs?: number;
}): Promise<{ clone: CloneRecord; droppedPrevious?: string }> {
  const { maintenanceUrl, dbName } = parseSourceUrl(opts.sourceUrl);
  const host = new URL(opts.sourceUrl).hostname;
  if (!hostMatches(host, opts.allowHosts)) {
    throw new Error(
      `refusing to clone: the source host "${host}" is not local (db.allowedHosts: ${opts.allowHosts.join(', ')}). ` +
        'Safe DB copies are local Postgres only — data never leaves the machine.',
    );
  }

  const toolOpts = { binDir: opts.binDir, timeoutMs: opts.timeoutMs ?? 300_000 };
  const db = opts.db;
  for (const bin of ['psql', 'pg_dump', 'pg_restore']) {
    if (!(await toolWorks(bin, opts.binDir))) {
      throw new Error(
        `"${bin}" is not available — install the PostgreSQL client tools (postgresql-client / postgresql) and try again.`,
      );
    }
  }

  // one clone per source: the previous copy is stale once anything changed
  let droppedPrevious: string | undefined;
  const previous = db.prepare('SELECT name FROM db_clones WHERE source_name = ?').all(dbName) as Array<{ name: string }>;
  for (const prev of previous) {
    await dropDatabase(prev.name, maintenanceUrl, toolOpts, opts.logger);
    droppedPrevious = prev.name;
  }
  db.prepare('DELETE FROM db_clones WHERE source_name = ?').run(dbName);

  const name = `uip_${dbName}_${Date.now().toString(36)}`.slice(0, 63).toLowerCase();
  const cloneUrl = cloneUrlFor(opts.sourceUrl, name);

  await psql(`CREATE DATABASE "${name}"`, maintenanceUrl, toolOpts);

  // dump -> restore; the temp file is removed on every path (success,
  // failure, crash between the two) so /tmp never accumulates copies
  const dumpDir = mkdtempSync(join(tmpdir(), 'uip-dump-'));
  const dumpFile = join(dumpDir, 'source.dump');
  try {
    await runTool('pg_dump', [opts.sourceUrl, '--no-owner', '--no-privileges', '-Fc', '-f', dumpFile], toolOpts, 'pg_dump');
    await runTool('pg_restore', ['-d', cloneUrl, '--no-owner', '--no-privileges', dumpFile], toolOpts, 'pg_restore');
  } catch (e) {
    // never leave a half-created clone behind
    await dropDatabase(name, maintenanceUrl, toolOpts, opts.logger).catch(() => {});
    throw e;
  } finally {
    rmSync(dumpDir, { recursive: true, force: true });
  }

  db.prepare('INSERT INTO db_clones (name, source_name, clone_url) VALUES (?, ?, ?)').run(name, dbName, cloneUrl);
  opts.logger.info('safe DB clone ready', { source: dbName, clone: name });
  return {
    clone: { name, sourceName: dbName, url: cloneUrl, createdAt: new Date().toISOString() },
    droppedPrevious,
  };
}

/** Drop a clone (database + tracking row). Unknown names answer false. */
export async function dropClone(opts: {
  name: string;
  sourceUrl: string;
  db: Db;
  allowHosts: string[];
  logger: Logger;
  binDir?: string;
  timeoutMs?: number;
}): Promise<boolean> {
  const db = opts.db;
  if (!NAME_RE.test(opts.name)) return false;
  const row = db.prepare('SELECT name, source_name, clone_url FROM db_clones WHERE name = ?').get(opts.name) as
    | { name: string; source_name: string; clone_url: string }
    | undefined;
  if (!row) return false;
  const { maintenanceUrl } = parseSourceUrl(opts.sourceUrl);
  const toolOpts = { binDir: opts.binDir, timeoutMs: opts.timeoutMs ?? 120_000 };
  await dropDatabase(opts.name, maintenanceUrl, toolOpts, opts.logger);
  db.prepare('DELETE FROM db_clones WHERE name = ?').run(opts.name);
  return true;
}
