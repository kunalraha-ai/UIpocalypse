import { openDb } from '../src/db/index.js';
import { initWorkspace } from '../src/workspace.js';
const ws = initWorkspace('/tmp/opencode/app2-ws');
const db = openDb(ws.db);
const rows = db.prepare("SELECT type, evidence_json FROM findings WHERE type = 'failed_request' LIMIT 3").all() as any[];
for (const r of rows) {
  const ev = JSON.parse(r.evidence_json);
  console.log(JSON.stringify({ url: ev.url?.slice(0, 60), status: ev.status, failure: ev.failure?.slice(0, 40) ?? 'MISSING' }));
}
db.close();
