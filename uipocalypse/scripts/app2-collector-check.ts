import { openDb } from '../src/db/index.js';
import { initWorkspace } from '../src/workspace.js';
import { collectRun } from '../src/collect/collector.js';
const ws = initWorkspace('/tmp/opencode/app2-ws');
const db = openDb(ws.db);
// find the run id
const run = db.prepare('SELECT id FROM runs ORDER BY id LIMIT 1').get() as { id: number };
const appMap = {
  framework: 'next-app' as const,
  stack: [], files: [], routes: [], elements: [], apiCalls: [], envVars: [],
  imports: {}, clientEntryFiles: [], supabase: { tables: [], clientFiles: [], migrations: [] },
  fileCount: 0, extractedAt: '',
};
const collected = collectRun(db, run.id, appMap);
console.log('finding clusters:', collected.findingClusters.length);
console.log('correct rejections:', collected.correctRejections.length);
console.log('cancellation artifacts:', collected.artifacts.length);
for (const c of collected.findingClusters) console.log('  [finding]', c.key.slice(0, 80));
for (const c of collected.correctRejections) console.log('  [rejection]', c.key.slice(0, 80));
for (const c of collected.artifacts.slice(0, 5)) console.log('  [artifact]', c.key.slice(0, 80));
db.close();
