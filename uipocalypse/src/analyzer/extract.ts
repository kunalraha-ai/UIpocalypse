import { Project, SyntaxKind, type JsxElement, type JsxSelfClosingElement, type Node, type CallExpression, type StringLiteral, type TemplateExpression, type ObjectLiteralExpression, type PropertyAssignment } from 'ts-morph';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiCallInfo, AppMap, ElementInfo, EnvVarInfo, RouteInfo } from './types.js';
import { detectStack, listSourceFiles } from './stack.js';

/**
 * AST extraction (FR-A2): routes, interactive elements, handlers, API calls,
 * env vars, Supabase tables — using ts-morph, syntactic analysis only (fast:
 * no full type-check), which is enough for the MVP rule set.
 */

const INTERESTING_TAGS = new Set(['button', 'form', 'input', 'a', 'select', 'textarea']);

export function extractAppMap(root: string): AppMap {
  const files = listSourceFiles(root);
  const { framework, stack } = detectStack(root);

  const project = new Project({ skipAddingFilesFromTsConfig: true, compilerOptions: { allowJs: true } });
  for (const rel of files) {
    try {
      project.addSourceFileAtPath(join(root, rel));
    } catch {
      // unparsable file — skip
    }
  }

  const routes: RouteInfo[] = [];
  const elements: ElementInfo[] = [];
  const apiCalls: ApiCallInfo[] = [];
  const envVars: EnvVarInfo[] = [];
  const supabaseTables = new Set<string>();
  const clientFiles = new Set<string>();
  const imports: Record<string, string[]> = {};
  const clientEntryFiles: string[] = [];
  const knownFiles = new Set(files.map((f) => f.replaceAll('\\', '/')));

  for (const sourceFile of project.getSourceFiles()) {
    const rel = sourceFile.getFilePath().slice(root.length + 1).replaceAll('\\', '/');
    const text = sourceFile.getFullText();

    // ---------------- routes (file-based, framework-specific)
    routes.push(...fileRoutes(rel, framework));

    // ---------------- client entry detection + import graph
    if (/^\s*['"]use client['"]/.test(text)) clientEntryFiles.push(rel);
    imports[rel] = [];
    for (const decl of sourceFile.getImportDeclarations()) {
      const spec = decl.getModuleSpecifierValue();
      const resolved = spec.startsWith('@/')
        ? resolveWithin(spec.slice(2), knownFiles)
        : spec.startsWith('.')
          ? resolveWithin(join(dirnamePosix(rel), spec), knownFiles)
          : null;
      if (resolved) imports[rel]!.push(resolved);
    }

    // ---------------- JSX elements
    for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement)) {
      collectElement(node, rel, elements);
    }
    for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)) {
      collectElement(node, rel, elements);
    }

    // ---------------- fetch calls
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const exprText = call.getExpression().getText();
      if (/(^|\.)fetch$/.test(exprText) || /(^|\.)(post|put|patch|del|remove)\($/.test(exprText)) {
        apiCalls.push({
          file: rel,
          line: call.getStartLineNumber(),
          url: staticUrl(call),
          method: httpMethod(call),
          enclosingFnHasErrorHandling: enclosingFunctionHasErrorHandling(call),
        });
      }
      // supabase .from('table')
      if (exprText.endsWith('.from') || exprText === 'from') {
        const arg = call.getArguments()[0];
        if (arg && arg.getKind() === SyntaxKind.StringLiteral) {
          supabaseTables.add(arg.getText().replace(/['"`]/g, ''));
        }
      }
    }

    // ---------------- supabase client files
    if (text.includes('@supabase/supabase-js') || /createClient\s*\(/.test(text)) {
      clientFiles.add(rel);
    }

    // ---------------- env var reads (regex over text — robust for MVP)
    const lineStarts = lineStartIndexes(text);
    for (const match of text.matchAll(
      /process\.env\.([A-Za-z0-9_]+)|process\.env\[['"]([A-Za-z0-9_]+)['"]\]|import\.meta\.env\.([A-Za-z0-9_]+)/g,
    )) {
      const name = match[1] ?? match[2] ?? match[3];
      if (name) envVars.push({ name, file: rel, line: lineFor(lineStarts, match.index ?? 0) });
    }
  }

  const migrations = listMigrations(root);
  for (const sql of migrations) {
    for (const m of sql.text.matchAll(/\.from\(\s*['"`]([a-z_]+)['"`]/gi)) {
      supabaseTables.add(m[1]!);
    }
  }

  return {
    framework,
    stack,
    files,
    routes,
    elements,
    apiCalls,
    envVars,
    imports,
    clientEntryFiles,
    supabase: {
      tables: [...supabaseTables],
      clientFiles: [...clientFiles],
      migrations: migrations.map((m) => m.rel),
    },
    fileCount: files.length,
    extractedAt: new Date().toISOString(),
  };
}

// ------------------------------------------------------------------ JSX

function collectElement(node: JsxElement | JsxSelfClosingElement, rel: string, out: ElementInfo[]): void {
  const opening =
    node.getKind() === SyntaxKind.JsxElement
      ? (node as JsxElement).getOpeningElement()
      : (node as JsxSelfClosingElement);
  const tag = opening.getTagNameNode().getText().toLowerCase();
  if (!INTERESTING_TAGS.has(tag)) return;

  const attrs = new Map<string, string | null>();
  for (const attrLike of opening.getAttributes()) {
    if (attrLike.getKind() !== SyntaxKind.JsxAttribute) continue; // skip spreads
    const attr = attrLike as import('ts-morph').JsxAttribute;
    const name = attr.getNameNode().getText();
    const init = attr.getInitializer();
    attrs.set(name, init ? init.getText() : null);
  }

  const label =
    firstJsxText(node) ||
    attrs.get('aria-label')?.replace(/['"`]/g, '') ||
    attrs.get('placeholder')?.replace(/['"`]/g, '') ||
    tag;

  const handlers: string[] = [];
  const emptyHandlers: string[] = [];
  for (const [name, value] of attrs) {
    if (/^on[A-Z]/.test(name)) {
      handlers.push(name);
      if (value && isEmptyHandler(value)) emptyHandlers.push(name);
    }
  }

  out.push({
    tag,
    file: rel,
    line: node.getStartLineNumber(),
    label: label.slice(0, 80),
    handlers,
    emptyHandlers,
    inForm: insideTag(node, 'form'),
    ariaHidden: attrs.get('aria-hidden') === '"true"' || attrs.get('aria-hidden') === "'true'" || attrs.get('aria-hidden') === '{true}',
    hasAction: attrs.has('action'),
    hasOnSubmit: handlers.includes('onSubmit') && !emptyHandlers.includes('onSubmit'),
    hasMethodAttr: attrs.has('method'),
    submitType: tag === 'button' || tag === 'input',
  });
}

function firstJsxText(node: Node): string {
  const texts: string[] = [];
  // direct JsxText children
  for (const t of node.getChildrenOfKind(SyntaxKind.JsxText)) texts.push(t.getText());
  // JsxElement keeps its children inside a SyntaxList node
  for (const child of node.getChildren()) {
    if (child.getKind() === SyntaxKind.SyntaxList) {
      for (const t of child.getChildrenOfKind(SyntaxKind.JsxText)) texts.push(t.getText());
    }
  }
  return texts.join(' ').trim();
}

function isEmptyHandler(valueText: string): boolean {
  // () => {} or () => { /* nothing */ or function () {}
  const stripped = valueText.replace(/^\{|\}$/g, '').replace(/^['"`]|['"`]$/g, '').trim();
  if (/^\(\s*\)\s*=>\s*\{\s*\}$/.test(stripped)) return true;
  if (/^\(\s*\)\s*=>\s*\{\s*\/\*[\s\S]*\*\/\s*\}$/.test(stripped)) return true;
  if (/^function\s*\w*\s*\(\s*\)\s*\{\s*\}$/.test(stripped)) return true;
  return false;
}

function insideTag(node: Node, tag: string): boolean {
  let parent: Node | undefined = node.getParent();
  while (parent) {
    if (parent.getKind() === SyntaxKind.JsxElement) {
      const p = parent as JsxElement;
      if (p.getOpeningElement().getTagNameNode().getText().toLowerCase() === tag) return true;
    }
    parent = parent.getParent();
  }
  return false;
}

// ------------------------------------------------------------------ fetch calls

function staticUrl(call: CallExpression): string {
  const arg = call.getArguments()[0];
  if (!arg) return '';
  if (arg.getKind() === SyntaxKind.StringLiteral) {
    return (arg as StringLiteral).getLiteralText();
  }
  if (arg.getKind() === SyntaxKind.TemplateExpression) {
    const head = (arg as TemplateExpression).getHead().getText().replace(/`/g, '');
    return head.replace(/[?#].*$/, '');
  }
  return ''; // fully dynamic — cannot resolve statically
}

function httpMethod(call: CallExpression): ApiCallInfo['method'] {
  const second = call.getArguments()[1];
  if (second && second.getKind() === SyntaxKind.ObjectLiteralExpression) {
    for (const prop of (second as ObjectLiteralExpression).getProperties()) {
      if (prop.getKind() === SyntaxKind.PropertyAssignment) {
        const pa = prop as PropertyAssignment;
        if (pa.getNameNode().getText() === 'method') {
          const v = pa.getInitializerIfKind(SyntaxKind.StringLiteral);
          const m = (v?.getLiteralText() ?? 'GET').toUpperCase();
          if (m === 'GET' || m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') return m;
          return 'OTHER';
        }
      }
    }
  }
  return 'GET';
}

function enclosingFunctionHasErrorHandling(call: CallExpression): boolean {
  let fn: Node | undefined = call;
  const fnKinds = new Set([
    SyntaxKind.FunctionDeclaration,
    SyntaxKind.FunctionExpression,
    SyntaxKind.ArrowFunction,
    SyntaxKind.MethodDeclaration,
    SyntaxKind.Constructor,
  ]);
  while (fn && !fnKinds.has(fn.getKind())) fn = fn.getParent();
  if (!fn) return false;
  const text = fn.getText();
  return /\bcatch\b\s*\(|\bcatch\b\s*\{|\.catch\s*\(/.test(text);
}

// ------------------------------------------------------------------ routes

function fileRoutes(rel: string, framework: string): RouteInfo[] {
  const norm = rel.replaceAll('\\', '/');
  if (framework === 'next-app') {
    let m = norm.match(/^app\/(.*)\/page\.tsx?$/);
    if (m) return [{ path: pathFromSegments(m[1]!.split('/')), kind: 'page', file: rel }];
    m = norm.match(/^app\/(.*)\/route\.ts$/);
    if (m) return [{ path: pathFromSegments(m[1]!.split('/')), kind: 'api', file: rel }];
  } else if (framework === 'next-pages') {
    let m = norm.match(/^pages\/api\/(.*)\.tsx?$/);
    if (m && !norm.includes('/_')) {
      return [{ path: '/api/' + pathFromSegments(m[1]!.split('/')).slice(1), kind: 'api', file: rel }];
    }
    m = norm.match(/^pages\/(.*)\.tsx?$/);
    if (m && !norm.includes('/_')) {
      return [{ path: pathFromSegments(m[1]!.split('/')), kind: 'page', file: rel }];
    }
  }
  return [];
}

function pathFromSegments(segments: string[]): string {
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.startsWith('(') && seg.endsWith(')')) continue; // route groups
    parts.push(seg.startsWith('[') && seg.endsWith(']') ? ':' + seg.slice(1, -1) : seg);
  }
  return '/' + parts.join('/');
}

// ------------------------------------------------------------------ migrations / env files

function listMigrations(root: string): Array<{ rel: string; text: string }> {
  const dir = join(root, 'supabase', 'migrations');
  if (!existsSync(dir)) return [];
  const out: Array<{ rel: string; text: string }> = [];
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.sql')) {
      out.push({ rel: `supabase/migrations/${file}`, text: readFileSync(join(dir, file), 'utf8') });
    }
  }
  return out;
}

export function readEnvFileKeys(root: string): Set<string> {
  const keys = new Set<string>();
  const dir = root;
  for (const name of ['.env', '.env.local', '.env.example', '.env.development', '.env.production']) {
    const file = join(dir, name);
    if (!existsSync(file)) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/gm)) {
      keys.add(m[1]!);
    }
  }
  return keys;
}

// ------------------------------------------------------------------ utils

function dirnamePosix(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

function normalizePosix(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/** Resolve an import specifier to a known project file (relative to repo root). */
function resolveWithin(base: string, knownFiles: Set<string>): string | null {
  const norm = normalizePosix(base);
  for (const suffix of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']) {
    const candidate = `${norm}${suffix}`;
    if (knownFiles.has(candidate)) return candidate;
  }
  return null;
}

function lineStartIndexes(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineFor(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
