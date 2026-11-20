import { openDb } from '../src/db/index.js';
import { initWorkspace } from '../src/workspace.js';
const ws = initWorkspace('/tmp/opencode/app1-ws');
const db = openDb(ws.db);
const rows = db.prepare("SELECT type, evidence_json FROM findings").all() as any[];
for (const r of rows) {
  const ev = JSON.parse(r.evidence_json);
  console.log(`[${r.type}] action="${ev.action ?? ev.label ?? '?'}" note="${ev.note ?? ''}"`);
}
db.close();
