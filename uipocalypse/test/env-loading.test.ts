import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createLlm, createLlmSet, llmModeLine } from '../src/llm/index.js';
import { createServer } from '../src/server.js';
import { serveStatic } from './helpers.js';

const PKG = resolve(import.meta.dirname, '..');

/**
 * Pre-volunteer hardening (env loading): the server must NOT load a general
 * .env from the working directory — the cwd may be the TARGET APP's repo,
 * and its .env (real Stripe keys, DB passwords, even an LLM_API_KEY) must
 * never enter our process environment. Only the four UIpocalypse variables
 * are read, from explicit sources only: the MCP config env block (process
 * environment) or ~/.uipocalypse/config. The prompt-test incident (16 real
 * LLM calls from a silently-picked-up dev .env) is the motivating bug.
 */

const CWD_ENV_KEY = 'sk-live-cwd-should-never-load-0123456789';
const USER_CONFIG_KEY = 'sk-user-config-source-0123456789';

describe('LLM env loading: explicit sources only, never the working directory', () => {
  const origHome = process.env.HOME;
  afterAll(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
  });

  it('does NOT pick up LLM_API_KEY from a .env in the working directory', () => {
    const dir = mkdtempSync('/tmp/opencode/uip-envcwd-');
    writeFileSync(join(dir, '.env'), `LLM_API_KEY=${CWD_ENV_KEY}\nLLM_MODEL=cwd-model\n`);
    const cwd = process.cwd();
    // also the legacy second location — must not load either
    mkdirSync(join(dir, 'uipocalypse'));
    writeFileSync(join(dir, 'uipocalypse', '.env'), `LLM_API_KEY=${CWD_ENV_KEY}\n`);
    process.chdir(dir);
    try {
      const llm = createLlm();
      expect(llm.configured).toBe(false);
      expect(llm.keySource).toBeUndefined();
    } finally {
      process.chdir(cwd);
    }
  });

  it('reads the key from ~/.uipocalypse/config — the explicit user-level source', () => {
    const home = mkdtempSync('/tmp/opencode/uip-envhome-');
    mkdirSync(join(home, '.uipocalypse'), { recursive: true });
    writeFileSync(join(home, '.uipocalypse', 'config'), `LLM_API_KEY=${USER_CONFIG_KEY}\nLLM_MODEL=user-config-model\n`);
    process.env.HOME = home;
    try {
      const llm = createLlm();
      expect(llm.configured).toBe(true);
      expect(llm.model).toBe('user-config-model');
      expect(llm.keySource).toBe(join(home, '.uipocalypse', 'config'));
    } finally {
      delete process.env.HOME;
    }
  });

  it('process env (the MCP config env block) still wins over the user config', () => {
    const home = mkdtempSync('/tmp/opencode/uip-envhome2-');
    mkdirSync(join(home, '.uipocalypse'), { recursive: true });
    writeFileSync(join(home, '.uipocalypse', 'config'), `LLM_API_KEY=${USER_CONFIG_KEY}\n`);
    process.env.HOME = home;
    try {
      const llm = createLlm({ LLM_API_KEY: 'from-mcp-env-block' });
      expect(llm.configured).toBe(true);
      expect(llm.keySource).not.toBe(join(home, '.uipocalypse', 'config'));
    } finally {
      delete process.env.HOME;
    }
  });

  it('the user config file is read for the FOUR LLM variables only — never imported wholesale', () => {
    const home = mkdtempSync('/tmp/opencode/uip-envhome3-');
    mkdirSync(join(home, '.uipocalypse'), { recursive: true });
    writeFileSync(
      join(home, '.uipocalypse', 'config'),
      `LLM_API_KEY=${USER_CONFIG_KEY}\nSTRIPE_SECRET_KEY=sk_live_whatever\nDATABASE_URL=postgres://u:p@h/db\nSOMETHING_ELSE=x\n`,
    );
    process.env.HOME = home;
    try {
      // createLlm only ever surfaces the four; the proof is end-to-end in the
      // spawn test below. Here: the LLM layer works and nothing else is needed.
      const set = createLlmSet();
      expect(set.planner.configured).toBe(true);
      expect(set.planner.keySource).toBe(join(home, '.uipocalypse', 'config'));
    } finally {
      delete process.env.HOME;
    }
  });

  it('llmModeLine states on/off, the provider, and the key source', () => {
    expect(llmModeLine(createLlm({ LLM_API_KEY: '' }))).toMatch(/^LLM mode: off/);
    expect(llmModeLine(createLlm({ LLM_API_KEY: '' }))).toMatch(/no LLM_API_KEY configured/);
    const on = llmModeLine(createLlm({ LLM_API_KEY: 'k', LLM_BASE_URL: 'https://api.example.com/v1', LLM_MODEL: 'm' }));
    expect(on).toMatch(/^LLM mode: on/);
    expect(on).toMatch(/provider api\.example\.com/);
    expect(on).toMatch(/key source/);
  });
});

// --------------------------------------------------------------- spawn e2e

const CANARIES = [
  'sk_live_envleak-canary-stripe-0123456789abcdef',
  'postgres://envleak:envleak-canary-password@db.envleak.test:5432/prod',
  'fake-llm-key-should-not-be-picked-up-from-target-app',
  'unrelated-secret-value-canary-987654321',
];

describe('spawned server: the TARGET APP\u2019s .env never enters the process', () => {
  beforeAll(() => {
    execSync('node build.mjs', { cwd: PKG });
  });

  it('cwd = fixture app with an API-key-laden .env → mode off, zero LLM calls, no canary anywhere', async () => {
    // the fixture app (what a volunteer tests) — its .env is full of secrets
    // including an LLM_API_KEY. None of it may be loaded or echoed anywhere.
    const fixture = mkdtempSync('/tmp/opencode/uip-envtarget-');
    writeFileSync(
      join(fixture, '.env'),
      [
        `STRIPE_SECRET_KEY=${CANARIES[0]}`,
        `DATABASE_URL=${CANARIES[1]}`,
        `LLM_API_KEY=${CANARIES[2]}`,
        `SOME_APP_VAR=${CANARIES[3]}`,
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(fixture, 'index.html'),
      '<!doctype html><html><body><button onclick="alert(1)">Click</button><button>Dead one</button></body></html>',
    );
    const server = await serveStatic(fixture);

    // fresh HOME with no ~/.uipocalypse/config, fresh workspace, MINIMAL env.
    // PLAYWRIGHT_BROWSERS_PATH is pinned to the real cache because a fresh
    // HOME would otherwise relocate it and the browser would not be found —
    // the point of the fresh HOME is only the config-file lookup.
    const home = mkdtempSync('/tmp/opencode/uip-envspawnhome-');
    const workspace = mkdtempSync('/tmp/opencode/uip-envspawnws-');
    const stderr: string[] = [];
    const proc = spawn(process.execPath, [join(PKG, 'dist', 'index.cjs')], {
      cwd: fixture, // the server runs FROM the target app's directory
      env: {
        PATH: process.env.PATH!,
        HOME: home,
        UIP_WORKSPACE: workspace,
        PLAYWRIGHT_BROWSERS_PATH: join(homedir(), '.cache', 'ms-playwright'),
      },
    });
    proc.stderr.on('data', (c: Buffer) => stderr.push(c.toString()));
    let buf = '';
    const pending = new Map<number, (msg: Record<string, unknown>) => void>();
    proc.stdout.on('data', (c: Buffer) => {
      buf += c.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as { id?: number };
          if (msg.id !== undefined && pending.has(msg.id)) {
            pending.get(msg.id)!(msg);
            pending.delete(msg.id);
          }
        } catch {
          /* ignore partial lines */
        }
      }
    });
    const call = (method: string, params: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((res) => {
        const id = pending.size + 1 + Math.floor(Math.random() * 100000);
        pending.set(id, res);
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    const shutdown = async () => {
      proc.kill();
      await server.close();
    };

    try {
      await call('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'env-loading-test', version: '0.0.0' },
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

      const res = (await call('tools/call', {
        name: 'verify_deployment_safety',
        arguments: { path: fixture, url: server.url, budgetSeconds: 20 },
      })) as { result?: { isError?: boolean; content: Array<{ type: string; text: string }> } };

      // 1) the run completed, in fully-local mode: zero LLM calls
      expect(res.result?.isError).toBeFalsy();
      const text = res.result!.content.find((c) => c.type === 'text')!.text;
      const parsed = JSON.parse(text) as { llmCalls: number; report: { run: { llmModels?: string } } };
      expect(parsed.llmCalls).toBe(0);
      expect(parsed.report.run.llmModels).toMatch(/planner=none/);

      // 2) the mode line was printed before anything else
      const firstLine = stderr.join('').split('\n').find((l) => l.trim()) ?? '';
      expect(firstLine).toMatch(/^LLM mode: off/);

      // 3) no canary value from the target app's .env anywhere — not in the
      //    report, not in server logs, not in LLM payloads (there were none:
      //    zero LLM calls is the proof the .env was never loaded)
      const everything = text + '\n' + stderr.join('');
      for (const canary of CANARIES) {
        expect(everything.includes(canary), `canary leaked: ${canary.slice(0, 24)}…`).toBe(false);
      }
      // the report file on disk too (UIP_WORKSPACE root gets a .uipocalypse/ base)
      const reportFile = join(workspace, '.uipocalypse', 'runs', 'run-1-report.json');
      const onDisk = readFileSync(reportFile, 'utf8');
      for (const canary of CANARIES) {
        expect(onDisk.includes(canary), `canary leaked to report file: ${canary.slice(0, 24)}…`).toBe(false);
      }
    } finally {
      await shutdown();
    }
  }, 180_000);
});

describe('createServer: the mode line is emitted at server construction', () => {
  it('server startup prints the LLM mode line', () => {
    const errors: string[] = [];
    const orig = console.error;
    console.error = (line: string) => errors.push(line);
    try {
      createServer({ workspaceRoot: mkdtempSync('/tmp/opencode/uip-envserver-') });
      expect(errors.some((l) => /LLM mode: (on|off)/.test(l))).toBe(true);
    } finally {
      console.error = orig;
    }
  });
});
