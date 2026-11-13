import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/index.cjs',
  external: ['better-sqlite3', 'playwright'],
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: true,
});
