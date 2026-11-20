import { openDb } from '../src/db/index.js';
import { initWorkspace } from '../src/workspace.js';
import { collectRun } from '../src/collect/collector.js';
const ws = initWorkspace('/tmp/opencode/growthsent-hist');
const db = openDb(ws.db);
const run = db.prepare('SELECT id FROM runs ORDER BY id LIMIT 1').get() as { id: number };
const appMap = {
  framework: 'vite-react' as const,
  stack: [], files: [], routes: [], elements: [], apiCalls: [], envVars: [],
  imports: {}, clientEntryFiles: [], supabase: { tables: [], clientFiles: [], migrations: [] },
  fileCount: 0, extractedAt: '',
};
const collected = collectRun(db, run.id, appMap);
console.log('finding clusters:', collected.findingClusters.length);
console.log('rejections:', collected.correctRejections.length);
console.log('artifacts:', collected.artifacts.length);
for (const c of collected.findingClusters) {
  console.log(`  [${c.severity}] ${c.key.slice(0, 90)} — ${c.observations} obs`);
}
db.close();
