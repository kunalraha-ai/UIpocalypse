import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main() {
  const { server, logger } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('uipocalypse MCP server ready (stdio)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
