import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Logger = {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
};

export function newRunId(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
  const rand = Math.random().toString(36).slice(2, 6);
  return `run_${stamp}_${rand}`;
}

export function createLogger(opts: {
  filePath?: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  fields?: Record<string, unknown>;
}): Logger {
  const level = opts.level ?? 'info';
  if (opts.filePath) mkdirSync(dirname(opts.filePath), { recursive: true });

  const levels = { debug: 10, info: 20, warn: 30, error: 40 };
  const write = (lvl: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => {
    if (levels[lvl] < levels[level]) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: lvl,
      msg,
      ...(opts.fields ?? {}),
      ...(data ?? {}),
    });
    if (opts.filePath) appendFileSync(opts.filePath, line + '\n');
    // MCP stdio servers must not write to stdout — stderr is fine
    if (lvl === 'error') console.error(line);
  };

  const make = (fields: Record<string, unknown>): Logger => ({
    info: (msg, data) => write('info', msg, { ...fields, ...(data ?? {}) }),
    warn: (msg, data) => write('warn', msg, { ...fields, ...(data ?? {}) }),
    error: (msg, data) => write('error', msg, { ...fields, ...(data ?? {}) }),
    child: (more) => make({ ...fields, ...more }),
  });

  return make(opts.fields ?? {});
}
