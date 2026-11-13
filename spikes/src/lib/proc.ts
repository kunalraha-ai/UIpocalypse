import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Process metrics, Linux /proc based.
 *
 * Playwright's bundled headless Chromium runs as "chrome-headless" (older
 * builds: "headless_shell"), which is distinct from a user's desktop Chrome
 * ("chrome" via flatpak etc.). We match only our own browser processes so the
 * measurements aren't polluted by whatever else is running.
 */
const OUR_CHROMIUM = /^(chrome-headless|headless_shell|chromium)/i;

function chromiumPids(): number[] {
  const pids: number[] = [];
  let entries: string[];
  try {
    entries = readdirSync('/proc');
  } catch {
    return pids;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const comm = readFileSync(`/proc/${entry}/comm`, 'utf8').trim();
      if (OUR_CHROMIUM.test(comm)) pids.push(Number(entry));
    } catch {
      // process gone — ignore
    }
  }
  return pids;
}

/** Sum of RSS (MB) of only the Chromium processes we spawned. */
export function chromiumRssMb(): number {
  let pages = 0;
  for (const pid of chromiumPids()) {
    try {
      // statm field 2 = resident pages
      const statm = readFileSync(`/proc/${pid}/statm`, 'utf8').trim().split(' ');
      const rss = parseInt(statm[1] ?? '0', 10);
      if (Number.isFinite(rss)) pages += rss;
    } catch {
      // process gone — ignore
    }
  }
  return (pages * 4096) / 1024 / 1024;
}

/** Total CPU jiffies (utime+stime) used by our Chromium processes. */
export function chromeCpuJiffies(): number {
  let total = 0;
  for (const pid of chromiumPids()) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      // comm can contain spaces/parens — parse after the final ')'
      const rest = stat.slice(stat.lastIndexOf(')') + 2);
      const f = rest.split(' ');
      const utime = parseInt(f[11] ?? '0', 10); // field 14 overall
      const stime = parseInt(f[12] ?? '0', 10); // field 15 overall
      if (Number.isFinite(utime)) total += utime;
      if (Number.isFinite(stime)) total += stime;
    } catch {
      // process gone — ignore
    }
  }
  return total;
}

/** RSS (MB) of the `next start` server process tree (worker titles include "next"). */
export function appRssMb(): number {
  let out: string;
  try {
    out = execSync('ps -eo rss,args --no-headers', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return 0;
  }
  let mb = 0;
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const args = parts.slice(1).join(' ');
    if (args.includes('next') && !args.includes('tsx')) mb += parseInt(parts[0] ?? '0', 10) / 1024;
  }
  return mb;
}
