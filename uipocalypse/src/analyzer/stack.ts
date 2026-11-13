import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Framework } from './types.js';

/** Stack detection (FR-A1): Next.js app/pages router, Vite+React, Supabase. */

export function detectStack(root: string): { framework: Framework; stack: string[] } {
  const stack: string[] = [];
  const pkg = readPackageJson(root);

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);

  if (has('next')) stack.push('next');
  if (has('vite')) stack.push('vite');
  if (has('react')) stack.push('react');
  if (has('vue')) stack.push('vue');
  if (has('svelte')) stack.push('svelte');
  if (has('@supabase/supabase-js')) stack.push('supabase');
  if (has('stripe')) stack.push('stripe');

  let framework: Framework = 'unknown';
  if (has('next') && existsSync(join(root, 'app'))) framework = 'next-app';
  else if (has('next') && existsSync(join(root, 'pages'))) framework = 'next-pages';
  else if (has('vite') && has('react')) framework = 'vite-react';

  return { framework, stack };
}

function readPackageJson(root: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  const file = join(root, 'package.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch {
    return {};
  }
}

/** Files worth analyzing, with noise excluded. Relative paths returned. */
export function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const SKIP_DIRS = new Set([
    'node_modules', '.next', '.git', 'dist', 'build', '.uipocalypse', 'coverage', '.turbo', '.cache', '.vscode',
  ]);
  const walk = (dir: string, depth: number) => {
    if (depth > 10 || out.length > 3000) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.git')) walk(full, depth + 1);
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        out.push(relative(root, full));
      }
    }
  };
  walk(root, 0);
  return out;
}
