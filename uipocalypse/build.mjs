import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/index.cjs',
  external: ['better-sqlite3', 'playwright', 'pg'],
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: true,
});

// ship the volunteer docs + license terms inside dist/, so the release
// tarball (npm pack ships only dist/ + package files) carries the kit
rmSync('dist/docs', { recursive: true, force: true });
mkdirSync('dist/docs', { recursive: true });
cpSync(join(here, '..', 'docs', 'volunteer'), join('dist', 'docs', 'volunteer'), { recursive: true });
cpSync(join(here, 'LICENSE'), join('dist', 'LICENSE'));
cpSync(join(here, 'TERMS.md'), join('dist', 'TERMS.md'));
