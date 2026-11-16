import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { initWorkspace } from './workspace.js';
import { openDb } from './db/index.js';
import { createLogger } from './logger.js';
import { loadConfig } from './config.js';
import { createLlmSet } from './llm/index.js';
import { PlanSchema, DEFAULT_NASTY_INPUTS, FULL_PERSONA_ROSTER } from './plan/schema.js';
import { explore } from './browser/runner.js';
import { swarm } from './browser/orchestrator.js';

/**
 * Entry point: `uipocalypse` starts the MCP stdio server (default);
 * `uipocalypse swarm --url <url> [--agents N] [--budget S] [--race action]`
 * runs a full scout+swarm cycle in-process with Ctrl-C → partial report
 * (SAFETY.md §6 row 7).
 */

function parseCli(argv: string[]): { url?: string; agents?: number; budget?: number; raceAction?: string; raceInput?: string } {
  const out: { url?: string; agents?: number; budget?: number; raceAction?: string; raceInput?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--url') out.url = next;
    else if (arg === '--agents') out.agents = Number(next);
    else if (arg === '--budget') out.budget = Number(next);
    else if (arg === '--race') out.raceAction = next;
    else if (arg === '--race-input') out.raceInput = next;
  }
  return out;
}

async function runSwarmCli(argv: string[]): Promise<void> {
  const args = parseCli(argv);
  if (!args.url) {
    console.error('usage: uipocalypse swarm --url http://localhost:3000 [--agents 30] [--budget 60] [--race "Redeem coupon"] [--race-input WELCOME10]');
    process.exit(1);
  }
  const workspace = initWorkspace(process.env.UIP_WORKSPACE ?? process.cwd());
  const logger = createLogger({ filePath: `${workspace.logs}/cli.jsonl` });
  const db = openDb(workspace.db);
  const { config } = loadConfig();
  const llms = createLlmSet();
  llms.planner.maxCalls = config.llm.maxCallsPerRun;
  llms.scout.maxCalls = config.llm.maxCallsPerRun;

  const abort = new AbortController();
  const onSigint = () => {
    console.error('\n[SIGINT] stopping agents — writing partial report…');
    abort.abort();
  };
  process.on('SIGINT', onSigint);

  const plan = PlanSchema.parse({
    summary: 'CLI plan',
    personas: [...FULL_PERSONA_ROSTER],
    goals: [],
    seedRoutes: [args.url],
    nastyInputs: DEFAULT_NASTY_INPUTS,
  });

  try {
    const exploreResult = await explore({
      url: args.url!,
      config,
      plan,
      db,
      routes: [],
      llm: llms.planner,
      scoutLlm: llms.scout,
      logger,
      budgetSeconds: 90,
      screenshotDir: workspace.screenshots,
      traceDir: workspace.traces,
    });
    const result = await swarm({
      url: args.url!,
      config,
      plan,
      db,
      routes: [],
      llm: llms.scout,
      logger,
      agents: args.agents,
      budgetSeconds: args.budget,
      runId: exploreResult.runId,
      abort: abort.signal,
      screenshotDir: workspace.screenshots,
      raceTarget: args.raceAction
        ? { url: args.url!, actionLabel: args.raceAction, input: args.raceInput, contexts: 20 }
        : undefined,
    });
    console.log(JSON.stringify({ explore: exploreResult, swarm: result }, null, 2));
  } finally {
    process.off('SIGINT', onSigint);
  }
}

async function main() {
  if (process.argv[2] === 'swarm') {
    await runSwarmCli(process.argv);
    return;
  }
  const { createServer } = await import('./server.js');
  const { server, logger } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('uipocalypse MCP server ready (stdio)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
