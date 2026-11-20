#!/usr/bin/env node
/**
 * Builds benchmarks/creditcraft-stripped: a copy of sample-app with every
 * comment that labels or hints at planted bugs removed (contender runs use
 * ONLY this copy — the original source literally labels its bugs inline).
 * Comments only: no code is touched, so behavior is identical by construction.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../sample-app', import.meta.url).pathname;
const DST = new URL('../benchmarks/creditcraft-stripped', import.meta.url).pathname;

// patterns that label/hint at the planted bugs or benchmark structure
const HINT = /planted|decoy|fixture|bug #|bugs #|benchmark ground truth|missing-rls|dead.?handler|unwired|missing-submit-guard|undefined-env|stack-detection|TODO: enable row level security|deliberately naive|no RLS/i;

mkdirSync(DST, { recursive: true });
cpSync(join(SRC, '.next'), join(DST, '.next'), { recursive: true }); // reuse the verified prod build
cpSync(join(SRC, 'node_modules'), join(DST, 'node_modules'), { recursive: true, dereference: true });
for (const d of ['public', 'supabase']) {
  try {
    cpSync(join(SRC, d), join(DST, d), { recursive: true });
  } catch {}
}

const COPY_FILES = ['package.json', 'package-lock.json', 'next.config.mjs', 'next-env.d.ts', 'tsconfig.json', '.env.local'];
for (const f of COPY_FILES) {
  try {
    cpSync(join(SRC, f), join(DST, f));
  } catch {}
}

let stripped = 0;
let kept = 0;
const strip = (dir) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (/node_modules|\.next|\.git/.test(entry)) continue;
      strip(p);
      continue;
    }
    if (!/\.(tsx?|jsx?|sql|sh)$/.test(entry)) continue;
    let text = readFileSync(p, 'utf8');
    const before = text;
    // line comments
    text = text
      .split('\n')
      .filter((line) => {
        const isComment = /^\s*(\/\/|--|#)/.test(line);
        if (isComment && HINT.test(line)) {
          stripped++;
          return false;
        }
        if (isComment) kept++;
        return true;
      })
      .join('\n');
    // trailing inline comments that label the bugs
    text = text.replace(/[ \t]*(\/\/|--)[^\n]*(planted|bug #|decoy|fixture|quirk|no `alter table)[^\n]*/gi, '');
    // block comments
    text = text.replace(/\/\*[\s\S]*?\*\//g, (m) => (HINT.test(m) ? (stripped++, '') : m));
    if (text !== before) writeFileSync(p, text);
  }
};
// copy + strip the source dirs (supabase included: its migration/seed comments label the bugs too)
for (const d of ['app', 'components', 'lib', 'scripts', 'supabase']) {
  cpSync(join(SRC, d), join(DST, d), { recursive: true });
  strip(join(DST, d));
}
console.log(`stripped ${stripped} hint comments, kept ${kept} ordinary comments`);
