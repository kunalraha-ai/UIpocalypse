import { describe, expect, it, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PKG = resolve(import.meta.dirname, '..');

describe('MCP server over stdio (Phase 1 deliverable: connectable + stub scan)', () => {
  beforeAll(() => {
    execSync('node build.mjs', { cwd: PKG });
  });

  it('lists tools and answers scan_codebase with a stub scan', async () => {
    const workspace = mkdtempSync('/tmp/opencode/uip-mcp-ws-');
    const target = mkdtempSync('/tmp/opencode/uip-mcp-target-');
    writeFileSync(
      join(target, 'page.tsx'),
      'export default function P() { return <button onClick={() => {}}>x</button>; }',
    );

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(PKG, 'dist', 'index.cjs')],
      env: { ...process.env, UIP_WORKSPACE: workspace } as Record<string, string>,
    });
    const client = new Client({ name: 'uipocalypse-test', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'scan_codebase',
        'plan_swarm',
        'run_swarm',
        'get_report',
        'list_runs',
        'diff_runs',
        'verify_deployment_safety',
        'verify_fix',
        'prepare_safe_db',
        'drop_safe_db',
      ]),
    );

    const res = (await client.callTool({
      name: 'scan_codebase',
      arguments: { path: target },
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(res.isError).toBeFalsy();
    const text = res.content.find((c) => c.type === 'text')!.text;
    const payload = JSON.parse(text) as {
      scanId: string;
      issues: Array<{ rule: string }>;
      appMap: { fileCount: number };
    };
    expect(payload.scanId).toMatch(/^run_/);
    expect(Array.isArray(payload.issues)).toBe(true);
    expect(payload.appMap.fileCount).toBeGreaterThan(0);

    // Phase 5 surface: list_runs works over the empty workspace; get_report
    // on a missing run explains the path requirement instead of crashing
    const listed = (await client.callTool({ name: 'list_runs', arguments: {} })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(listed.isError).toBeFalsy();
    expect(JSON.parse(listed.content[0]!.text)).toEqual([]);

    const missing = (await client.callTool({ name: 'get_report', arguments: { runId: 999 } })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(missing.isError).toBe(true);
    expect(missing.content[0]!.text).toMatch(/pass .*path/i);

    await client.close();
  });
});
