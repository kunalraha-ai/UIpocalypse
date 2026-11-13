import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

const tmp = mkdtempSync('/tmp/opencode/uip-cfg-');

describe('config loader (zod, TRD §7)', () => {
  it('falls back to safe defaults when no file exists', () => {
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      const { config, source } = loadConfig();
      expect(source).toBe('defaults');
      expect(config.target).toBe('http://localhost:3000');
      expect(config.allowHosts).toEqual(['localhost', '127.0.0.1', '*.local', '*.vercel.app', '*.netlify.app']);
      expect(config.agents).toBe(30);
      expect(config.budgetSeconds).toBe(60);
      expect(config.destructiveOptIn).toBe(false);
      expect(config.externalOptIn).toBe(false);
      expect(config.db.allowedHosts).toEqual(['localhost', '127.0.0.1']);
      expect(config.maxRps).toBe(50);
      expect(config.invariants).toEqual([]);
    } finally {
      process.chdir(cwd);
    }
  });

  it('fails loudly when an explicitly requested config file is missing', () => {
    expect(() => loadConfig(join(tmp, 'does-not-exist.yaml'))).toThrow(/not found/i);
  });

  it('loads and validates a yaml file', () => {
    const file = join(tmp, 'config.yaml');
    writeFileSync(
      file,
      [
        "target: http://localhost:3123",
        "allowHosts: [localhost, '*.example.dev']",
        'agents: 45',
        'budgetSeconds: 90',
        'skipActions: [Delete account, Send invite]',
        'invariants:',
        '  - name: credits never negative',
        '    sql: select count(*) from profiles where credits < 0',
        '    expect: 0',
        'auth:',
        '  storageState: .uipocalypse/auth.json',
      ].join('\n'),
    );
    const { config, source } = loadConfig(file);
    expect(source).toBe('file');
    expect(config.target).toBe('http://localhost:3123');
    expect(config.allowHosts).toContain('*.example.dev');
    expect(config.agents).toBe(45);
    expect(config.budgetSeconds).toBe(90);
    expect(config.skipActions).toEqual(['Delete account', 'Send invite']);
    expect(config.invariants[0]!.name).toBe('credits never negative');
    expect(config.auth?.storageState).toBe('.uipocalypse/auth.json');
  });

  it('rejects invalid config with useful errors', () => {
    const file = join(tmp, 'bad.yaml');
    writeFileSync(file, 'agents: lots\n');
    expect(() => loadConfig(file)).toThrow(/agents/i);
  });

  it('rejects out-of-range agent counts', () => {
    const file = join(tmp, 'over.yaml');
    writeFileSync(file, 'agents: 500\n'); // hard cap 100 (SAFETY.md G7)
    expect(() => loadConfig(file)).toThrow();
  });

  it('picks up uipocalypse.config.yaml from the cwd by default', () => {
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      writeFileSync(join(tmp, 'uipocalypse.config.yaml'), 'agents: 7\n');
      const { config, source } = loadConfig();
      expect(source).toBe('file');
      expect(config.agents).toBe(7);
    } finally {
      process.chdir(cwd);
      rmSync(join(tmp, 'uipocalypse.config.yaml'), { force: true });
    }
  });
});
