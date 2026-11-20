import { openDb } from '../src/db/index.js';
import { initWorkspace } from '../src/workspace.js';
const ws = initWorkspace('/tmp/opencode/app2-ws');
const db = openDb(ws.db);
const rows = db.prepare("SELECT type, evidence_json FROM findings WHERE type IN ('dead_click','failed_request') ORDER BY type").all() as any[];
const seen = new Map<string, number>();
for (const r of rows) {
  const ev = JSON.parse(r.evidence_json);
  const key = r.type === 'dead_click' ? `dead: ${ev.action}` : `fail: ${ev.url?.replace('http://localhost:3000','')} [${ev.status}]`;
  seen.set(key, (seen.get(key) ?? 0) + 1);
}
for (const [k, v] of seen) console.log(`  ${v}× ${k}`);
db.close();
