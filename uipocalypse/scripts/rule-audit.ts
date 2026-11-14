/**
 * Static-rule FP audit: run the analyzer on an arbitrary repo and print every
 * finding with location + evidence for manual true/false classification.
 * Usage: npx tsx scripts/rule-audit.ts <repoPath>
 */

import { analyze } from '../src/analyzer/analyzer.js';

const repo = process.argv[2];
if (!repo) {
  console.error('usage: npx tsx scripts/rule-audit.ts <repoPath>');
  process.exit(1);
}
const started = Date.now();
const { appMap, issues } = analyze(repo);
console.log(
  `repo: ${repo}\nframework: ${appMap.framework} | stack: ${appMap.stack.join(', ')} | files: ${appMap.fileCount} | scan: ${Date.now() - started}ms\n`,
);
const byRule = new Map<string, typeof issues>();
for (const issue of issues) {
  byRule.set(issue.rule, [...(byRule.get(issue.rule) ?? []), issue]);
}
for (const [rule, list] of [...byRule.entries()].sort()) {
  console.log(`\n## ${rule} (${list.length})`);
  for (const i of list) console.log(`  ${i.file}:${i.line} [${i.severity}] ${i.message}`);
}
if (!issues.length) console.log('\n(no findings)');
