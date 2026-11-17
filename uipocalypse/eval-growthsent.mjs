// Evaluation driver: acts as a real MCP client over stdio, exactly like the
// README config snippet describes. Temporary — not part of the uipocalypse
// package. Usage: node eval-growthsent.mjs <command> [args...]
//   list                              — connect, confirm the 7 tools, exit
//   scan <repo>                       — call scan_codebase
//   verify <repo> <url>               — call verify_deployment_safety
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PKG = resolve(import.meta.dirname);
const EVAL_WS = process.env.UIP_EVAL_WS ?? mkdtempSync('/tmp/opencode/uip-eval-ws-');
const command = process.argv[2] ?? 'list';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(PKG, 'dist', 'index.cjs')],
  cwd: EVAL_WS, // the server loads uipocalypse.config.yaml from its cwd
  env: { ...process.env, UIP_WORKSPACE: EVAL_WS },
});
const client = new Client({ name: 'uipocalypse-eval', version: '0.0.0' }, { capabilities: {} });
await client.connect(transport);

try {
  if (command === 'list') {
    const tools = await client.listTools();
    console.log(JSON.stringify({ workspace: EVAL_WS, tools: tools.tools.map((t) => t.name) }, null, 2));
  } else if (command === 'scan') {
    const res = await client.callTool({ name: 'scan_codebase', arguments: { path: resolve(process.argv[3]) } });
    console.log(res.content[0].text);
  } else if (command === 'verify') {
    const res = await client.callTool({
      name: 'verify_deployment_safety',
      arguments: { path: resolve(process.argv[3]), url: process.argv[4], agents: 20, budgetSeconds: 60 },
    });
    console.log(res.content[0].text);
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} catch (e) {
  console.error('TOOL ERROR:', String(e));
  process.exitCode = 1;
} finally {
  await client.close();
}
