import { dateStr, today } from "./dates";

/**
 * Current streak: consecutive days completed ending today. If today is not
 * (yet) completed, the streak still counts back from yesterday, so a streak
 * only shows as broken once a full day is actually missed.
 */
export function computeStreak(completions: string[]): number {
  const done = new Set(completions);
  const cursor = new Date();

  if (!done.has(dateStr(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!done.has(dateStr(cursor))) return 0;
  }

  let streak = 0;
  while (done.has(dateStr(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Longest run of consecutive completed days ever achieved. */
export function bestStreak(completions: string[]): number {
  const days = [...new Set(completions)].sort();
  let best = 0;
  let run = 0;
  let prev: Date | null = null;

  for (const iso of days) {
    const [y, m, d] = iso.split("-").map(Number);
    const cur = new Date(y, m - 1, d);
    if (prev && cur.getTime() - prev.getTime() === 86_400_000) {
      run++;
    } else {
      run = 1;
    }
    best = Math.max(best, run);
    prev = cur;
  }
  return best;
}

export function isDoneToday(completions: string[]): boolean {
  return completions.includes(today());
}
