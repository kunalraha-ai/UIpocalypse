import { describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, createRun } from '../src/db/index.js';
import { cloneLocalPostgres, dropClone, listClones } from '../src/tools/clone-db.js';
import { createLogger } from '../src/logger.js';

/**
 * Safe database branching (2026-11-26): many vibecoders have exactly one
 * (production-shaped) database, so write-mode testing falls back to read-only.
 * A throwaway clone of the local Postgres changes that: the app restarts
 * against the copy, and duplicate writes, race damage and destructive clicks
 * all land somewhere disposable.
 *
 * The engine shells out to the standard Postgres client tools (psql, pg_dump,
 * pg_restore) with an injectable binary directory — the tests below run the
 * ENTIRE flow against stub binaries, so the contract is pinned without
 * needing a server. A live test runs only when UIP_PG_TEST_URL is set.
 */

const ALLOWED = ['localhost', '127.0.0.1'];

/** a bin dir of stub binaries that log their argv and succeed */
function stubBins(failRestore = false): { dir: string; log: string } {
  const dir = mkdtempSync('/tmp/opencode/uip-bins-');
  const log = join(dir, 'argv.log');
  const write = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!/bin/sh\necho "${name} $@" >> ${JSON.stringify(log)}\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  write('psql', 'exit 0');
  write('pg_dump', 'exit 0');
  write(
    'pg_restore',
    failRestore
      ? '[ "$1" = "--version" ] && exit 0\necho "restore failed: role does not exist" >&2\nexit 1'
      : 'exit 0',
  );
  return { dir, log };
}

const argvLog = (log: string): string[] =>
  existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];

function freshDb() {
  const db = openDb(join(mkdtempSync('/tmp/opencode/uip-clone-'), 'db.sqlite'));
  createRun(db, { targetUrl: 'http://localhost:3000', agents: 1 });
  return db;
}

const SOURCE = 'postgres://u:secret@localhost:5432/mydb';

describe('safe DB clone: engine contract (stub binaries)', () => {
  it('happy path: create -> dump -> restore -> track, and the caller gets a usable URL', async () => {
    const bins = stubBins();
    const db = freshDb();
    const { clone, droppedPrevious } = await cloneLocalPostgres({
      sourceUrl: SOURCE,
      db,
      allowHosts: ALLOWED,
      logger: createLogger({}),
      binDir: bins.dir,
    });

    // the clone is named after the source, on the same server
    expect(clone.name).toMatch(/^uip_mydb_[a-z0-9]+$/);
    expect(clone.url).toBe(`postgres://u:secret@localhost:5432/${clone.name}`);
    expect(clone.sourceName).toBe('mydb');
    expect(droppedPrevious).toBeUndefined();

    // the exact commands, in order, with the exact arguments
    // (--version probes from the availability check are filtered out)
    const log = argvLog(bins.log).filter((l) => !l.includes('--version'));
    expect(log[0]).toMatch(/^psql .*CREATE DATABASE "uip_mydb_/);
    expect(log[0]).toContain('postgres://u:secret@localhost:5432/postgres'); // maintenance connection
    expect(log[1]).toMatch(/^pg_dump postgres:\/\/u:secret@localhost:5432\/mydb --no-owner --no-privileges -Fc/);
    expect(log[2]).toMatch(/^pg_restore -d postgres:\/\/u:secret@localhost:5432\/uip_mydb_/);
    expect(log[2]).toContain('--no-owner --no-privileges');
    // no stray dump files left behind
    expect(readdirSync(bins.dir).filter((f) => f.endsWith('.dump'))).toHaveLength(0);

    // tracked in the workspace DB
    expect(listClones(db)).toHaveLength(1);
    expect(listClones(db)[0]!.name).toBe(clone.name);
    db.close();
  }, 30_000);

  it('refuses remote sources — data never leaves the machine', async () => {
    const bins = stubBins();
    const db = freshDb();
    await expect(
      cloneLocalPostgres({
        sourceUrl: 'postgres://u:p@db.example.com/prod',
        db,
        allowHosts: ALLOWED,
        logger: createLogger({}),
        binDir: bins.dir,
      }),
    ).rejects.toThrow(/local/);
    // nothing was executed — the gate fires before any subprocess
    expect(argvLog(bins.log)).toHaveLength(0);
    expect(listClones(db)).toHaveLength(0);
    db.close();
  });

  it('one clone per source: re-cloning replaces the previous copy', async () => {
    const bins = stubBins();
    const db = freshDb();
    const first = await cloneLocalPostgres({ sourceUrl: SOURCE, db, allowHosts: ALLOWED, logger: createLogger({}), binDir: bins.dir });
    const second = await cloneLocalPostgres({ sourceUrl: SOURCE, db, allowHosts: ALLOWED, logger: createLogger({}), binDir: bins.dir });

    expect(second.droppedPrevious).toBe(first.clone.name);
    const log = argvLog(bins.log);
    expect(log.some((l) => l.includes(`DROP DATABASE "${first.clone.name}" WITH (FORCE)`))).toBe(true);
    expect(listClones(db).map((c) => c.name)).toEqual([second.clone.name]);
    db.close();
  }, 30_000);

  it('a failed restore cleans up the half-created clone and reports the pg error', async () => {
    const bins = stubBins(true);
    const db = freshDb();
    await expect(
      cloneLocalPostgres({ sourceUrl: SOURCE, db, allowHosts: ALLOWED, logger: createLogger({}), binDir: bins.dir }),
    ).rejects.toThrow(/restore failed: role does not exist/);

    const log = argvLog(bins.log);
    // the clone database was created…
    expect(log.some((l) => l.includes('CREATE DATABASE'))).toBe(true);
    // …and dropped again after the failure — no orphaned half-clones
    expect(log.filter((l) => l.includes('DROP DATABASE')).length).toBe(1);
    expect(listClones(db)).toHaveLength(0);
    db.close();
  }, 30_000);

  it('missing client tools is a clean, actionable error', async () => {
    const db = freshDb();
    const empty = mkdtempSync('/tmp/opencode/uip-emptybins-');
    await expect(
      cloneLocalPostgres({ sourceUrl: SOURCE, db, allowHosts: ALLOWED, logger: createLogger({}), binDir: empty }),
    ).rejects.toThrow(/postgresql-client|psql/);
    db.close();
  });

  it('dropClone drops the database and the row; unknown names answer false', async () => {
    const bins = stubBins();
    const db = freshDb();
    const { clone } = await cloneLocalPostgres({ sourceUrl: SOURCE, db, allowHosts: ALLOWED, logger: createLogger({}), binDir: bins.dir });

    expect(await dropClone({ name: clone.name, sourceUrl: SOURCE, db, allowHosts: ALLOWED, logger: createLogger({}), binDir: bins.dir })).toBe(true);
    expect(listClones(db)).toHaveLength(0);
    expect(await dropClone({ name: 'never_existed', sourceUrl: SOURCE, db, allowHosts: ALLOWED, logger: createLogger({}), binDir: bins.dir })).toBe(false);
    db.close();
  }, 30_000);
});
