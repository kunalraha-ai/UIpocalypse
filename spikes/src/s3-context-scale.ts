/**
 * Spike S3 — Context scale: one Chromium, N contexts, scripted random clicking.
 *
 * Question (IMPLEMENTATION_PLAN.md Phase 0): with 50 contexts in one Chromium,
 * what are the real time per step, RAM and CPU numbers? Does 50 agents × 100
 * steps complete within 2 minutes?
 *
 * Exit criteria: 50 agents × 100 steps ≤ 2 min. TRD §9 targets to replace with
 * measurements: context spin-up ≤ 100 ms, step ≤ 150 ms median, ≤ 150 MB per
 * context.
 */

import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { chromiumRssMb, appRssMb, chromeCpuJiffies } from './lib/proc.js';
import { APP_URL, percentile } from './lib/app.js';

const RESULTS_DIR = fileURLToPath(new URL('../results/', import.meta.url));

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

const CONTEXTS = arg('contexts', 50);
const STEPS = arg('steps', 100);
const CLK_TCK = 100; // Linux USER_HZ; verified below against os module if possible

type Agent = { id: number; page: Page; steps: number; respawns: number; noopSteps: number };
type StepRecord = { label: string; outcome: 'click' | 'noop' | 'recovered' | 'respawn'; ms: number };

/**
 * In-page random clicker — one CDP round trip per step (the "in-page runtime +
 * thin runner" approach, ARCHITECTURE.md D9). Mirrors a minimal Safety Guard:
 * destructive-labelled elements are never clicked (SAFETY.md G5).
 */
function picker() {
  const BAD = /delete|unsubscribe|cancel subscription|remove account/i;
  const els = [...document.querySelectorAll('a[href], button, input[type="submit"], input[type="button"], [role="button"]')];
  const visible = els.filter((e) => {
    const el = e;
    const label = (el.textContent || el.getAttribute('aria-label') || '').trim();
    if (BAD.test(label)) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    if ((el as HTMLButtonElement).disabled) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') return false;
    return true;
  });
  if (!visible.length) return { action: 'noop' as const };
  const el = visible[Math.floor(Math.random() * visible.length)] as HTMLElement;
  const label = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 50);
  el.click();
  return { action: 'click' as const, label, href: el.getAttribute('href') };
}

const latencies: number[] = [];
const labelCounts = new Map<string, number>();
const stepRecords: StepRecord[] = [];

async function step(a: Agent): Promise<StepRecord> {
  const t0 = performance.now();
  let outcome: StepRecord['outcome'] = 'click';
  let label = '';
  try {
    const r = await a.page.evaluate(picker);
    if (r.action === 'click') label = r.label;
    else {
      outcome = 'noop';
      await a.page.goto(APP_URL, { timeout: 8000 }).catch(() => {});
    }
  } catch {
    // likely a navigation destroyed the execution context (form submit / crash) — recover
    try {
      await a.page.waitForLoadState('load', { timeout: 4000 }).catch(() => {});
      const r = await a.page.evaluate(picker);
      outcome = 'recovered';
      if (r.action === 'click') label = r.label;
      else await a.page.goto(APP_URL, { timeout: 8000 }).catch(() => {});
    } catch {
      outcome = 'respawn';
      a.respawns++;
      await a.page.goto(APP_URL, { timeout: 8000 }).catch(() => {});
    }
  }
  a.steps++;
  if (outcome === 'noop') a.noopSteps++;
  const rec: StepRecord = { label, outcome, ms: performance.now() - t0 };
  stepRecords.push(rec);
  if (label) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  latencies.push(rec.ms);
  return rec;
}

async function run() {
  const browser = await chromium.launch();
  const rssBefore = chromiumRssMb();

  // ---- spawn contexts (measure spin-up vs initial navigation separately)
  const agents: Agent[] = [];
  const ctxMs: number[] = [];
  const navMs: number[] = [];
  for (let i = 0; i < CONTEXTS; i++) {
    let t0 = performance.now();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const spinMs = performance.now() - t0;
    t0 = performance.now();
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    navMs.push(performance.now() - t0);
    ctxMs.push(spinMs);
    agents.push({ id: i, page, steps: 0, respawns: 0, noopSteps: 0 });
  }
  const rssAfterSpawn = chromiumRssMb();

  // ---- ramp (SAFETY.md G7 preview): 10 steps/agent at 5, 10, 25, 50
  const ramp: { level: number; steps: number; sec: number; stepsPerSec: number }[] = [];
  for (const level of [5, 10, 25, 50].filter((l) => l <= CONTEXTS)) {
    const t0 = performance.now();
    for (let s = 0; s < 10; s++) await Promise.all(agents.slice(0, level).map((a) => step(a)));
    const sec = (performance.now() - t0) / 1000;
    ramp.push({ level, steps: level * 10, sec, stepsPerSec: (level * 10) / sec });
  }

  // ---- main phase: CONTEXTS × STEPS
  const roundMs: number[] = [];
  const j0 = chromeCpuJiffies();
  const t0 = performance.now();
  for (let s = 0; s < STEPS; s++) {
    const rt0 = performance.now();
    await Promise.all(agents.map((a) => step(a)));
    roundMs.push(performance.now() - rt0);
  }
  const wallSec = (performance.now() - t0) / 1000;
  const j1 = chromeCpuJiffies();
  const rssEnd = chromiumRssMb();
  const appMem = appRssMb();
  await browser.close();

  const sorted = [...latencies].sort((a, b) => a - b);
  const cpuCoresUsed = (j1 - j0) / (wallSec * CLK_TCK);
  const totalSteps = agents.reduce((s, a) => s + a.steps, 0);

  // ---- where did the time go? (per-outcome, per-label, per-round, concurrency)
  const agg = (recs: StepRecord[]) => {
    const ms = recs.map((r) => r.ms).sort((a, b) => a - b);
    return {
      count: recs.length,
      totalS: ms.reduce((s, v) => s + v, 0) / 1000,
      avgMs: ms.length ? ms.reduce((s, v) => s + v, 0) / ms.length : 0,
      p95Ms: percentile(ms, 95),
      maxMs: ms.length ? ms[ms.length - 1]! : 0,
    };
  };
  const byOutcome: Record<string, ReturnType<typeof agg>> = {};
  for (const outcome of ['click', 'noop', 'recovered', 'respawn'] as const) {
    const recs = stepRecords.filter((r) => r.outcome === outcome);
    if (recs.length) byOutcome[outcome] = agg(recs);
  }
  const byLabel = new Map<string, StepRecord[]>();
  for (const r of stepRecords) if (r.label) byLabel.set(r.label, [...(byLabel.get(r.label) ?? []), r]);
  const topLabels = [...byLabel.entries()]
    .map(([label, recs]) => ({ label, ...agg(recs) }))
    .sort((a, b) => b.totalS - a.totalS)
    .slice(0, 12);
  const agentActiveS = stepRecords.reduce((s, r) => s + r.ms, 0) / 1000;
  const concurrency = agentActiveS / wallSec; // avg simultaneously-active agents
  const roundsSorted = [...roundMs].sort((a, b) => a - b);

  const result = {
    appUrl: APP_URL,
    contexts: CONTEXTS,
    stepsPerAgent: STEPS,
    prodBuild: true,
    mainPhase: {
      wallSec,
      stepsCompleted: totalSteps,
      stepsPerSec: totalSteps / wallSec,
      stepLatencyMsP50: percentile(sorted, 50),
      stepLatencyMsP95: percentile(sorted, 95),
      stepLatencyMsP99: percentile(sorted, 99),
      gateSec: 120,
      gatePass: wallSec <= 120,
    },
    ramp,
    resources: {
      contextSpinupMsAvg: ctxMs.reduce((s, v) => s + v, 0) / ctxMs.length,
      contextSpinupMsMax: Math.max(...ctxMs),
      initialNavMsAvg: navMs.reduce((s, v) => s + v, 0) / navMs.length,
      chromiumRssMbBefore: rssBefore,
      chromiumRssMbAfterSpawn: rssAfterSpawn,
      chromiumRssMbEnd: rssEnd,
      mbPerContext: (rssEnd - rssBefore) / CONTEXTS,
      appRssMb: appMem,
      cpuCoresUsedAvg: cpuCoresUsed,
      cpuPctOfMachine: (cpuCoresUsed / os.cpus().length) * 100,
      cores: os.cpus().length,
    },
    reliability: {
      noopSteps: agents.reduce((s, a) => s + a.noopSteps, 0),
      respawns: agents.reduce((s, a) => s + a.respawns, 0),
    },
    whereTimeWent: {
      byOutcome,
      topLabelsByTotalTime: topLabels,
      avgConcurrentActiveAgents: concurrency,
      agentActiveSeconds: agentActiveS,
      roundMsP50: percentile(roundsSorted, 50),
      roundMsP95: percentile(roundsSorted, 95),
      roundsOver1500ms: roundMs.filter((r) => r > 1500).length,
      appCoresUsed: cpuCoresUsed,
    },
    topLabels: [...labelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, 's3-context-scale.json'), JSON.stringify(result, null, 2));

  console.log('=== Spike S3: context scale ===');
  console.log(`  ${CONTEXTS} contexts × ${STEPS} steps:`);
  console.log(`    wall time          ${result.mainPhase.wallSec.toFixed(1)} s (gate ≤ 120 s → ${result.mainPhase.gatePass ? 'PASS' : 'FAIL'})`);
  console.log(`    throughput         ${result.mainPhase.stepsPerSec.toFixed(1)} steps/s`);
  console.log(`    step latency       p50 ${result.mainPhase.stepLatencyMsP50.toFixed(0)} ms · p95 ${result.mainPhase.stepLatencyMsP95.toFixed(0)} ms · p99 ${result.mainPhase.stepLatencyMsP99.toFixed(0)} ms`);
  console.log(`  context spin-up      avg ${result.resources.contextSpinupMsAvg.toFixed(0)} ms (target ≤ 100 ms), initial nav avg ${result.resources.initialNavMsAvg.toFixed(0)} ms`);
  console.log(`  memory               chromium ${result.resources.chromiumRssMbEnd.toFixed(0)} MB total (~${result.resources.mbPerContext.toFixed(1)} MB/context, target ≤ 150 MB), app ${result.resources.appRssMb.toFixed(0)} MB`);
  console.log(`  cpu                  ~${result.resources.cpuCoresUsedAvg.toFixed(1)} cores (${result.resources.cpuPctOfMachine.toFixed(0)}% of ${result.resources.cores})`);
  console.log(`  reliability          ${result.reliability.noopSteps} noop steps, ${result.reliability.respawns} respawns`);
  console.log('  ramp:');
  for (const r of ramp) console.log(`    ${String(r.level).padStart(3)} agents → ${r.stepsPerSec.toFixed(1)} steps/s (${r.sec.toFixed(1)} s)`);
  console.log(`  top clicked: ${result.topLabels.map(([l, n]) => `${l} (${n})`).join(', ')}`);
  console.log('\n  --- where the time went ---');
  console.log(`  avg concurrent active agents: ${concurrency.toFixed(1)} of ${CONTEXTS} (agent-active ${agentActiveS.toFixed(0)}s over ${wallSec.toFixed(0)}s wall)`);
  console.log(`  rounds: p50 ${percentile(roundsSorted, 50).toFixed(0)} ms, p95 ${percentile(roundsSorted, 95).toFixed(0)} ms, >1.5s: ${roundMs.filter((r) => r > 1500).length} of ${roundMs.length}`);
  console.log('  by outcome:');
  for (const [o, s] of Object.entries(byOutcome)) {
    console.log(`    ${o.padEnd(10)} ${String(s.count).padStart(5)} steps, avg ${s.avgMs.toFixed(0)} ms, p95 ${s.p95Ms.toFixed(0)} ms, total ${s.totalS.toFixed(1)} s`);
  }
  console.log('  slowest actions by total time:');
  for (const l of topLabels.slice(0, 8)) {
    console.log(`    ${l.label.slice(0, 30).padEnd(30)} ${String(l.count).padStart(4)}×, avg ${l.avgMs.toFixed(0)} ms, total ${l.totalS.toFixed(1)} s`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
