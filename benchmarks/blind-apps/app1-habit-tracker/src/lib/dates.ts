/** Format a Date as a local-time `YYYY-MM-DD` string. */
export function dateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's date as a local `YYYY-MM-DD` string. */
export function today(): string {
  return dateStr(new Date());
}

/** The last `n` dates (inclusive of today), oldest first. */
export function lastNDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    out.push(dateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Short weekday label ("M", "T", "W"...) for a `YYYY-MM-DD` string. */
export function weekdayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return ["S", "M", "T", "W", "T", "F", "S"][date.getDay()];
}
