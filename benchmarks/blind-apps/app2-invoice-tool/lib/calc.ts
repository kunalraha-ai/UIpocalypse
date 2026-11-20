import type { Invoice, InvoiceTotals, LineItem } from './types';

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

export function lineTotal(item: LineItem): number {
  return round2(toNumber(item.quantity) * toNumber(item.unitPrice));
}

/**
 * Running total for an invoice: subtotal, tax (taxRate is a percentage,
 * 10 by default in the app), and grand total.
 */
export function computeTotals(items: LineItem[], taxRate: number): InvoiceTotals {
  const subtotal = round2(items.reduce((sum, item) => sum + lineTotal(item), 0));
  const taxAmount = round2(subtotal * (toNumber(taxRate) / 100));
  return { subtotal, taxAmount, total: round2(subtotal + taxAmount) };
}

export function invoiceTotal(invoice: Invoice): InvoiceTotals {
  return computeTotals(invoice.items, invoice.taxRate);
}

export function formatMoney(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Format a YYYY-MM-DD or ISO-timestamp string for display. */
export function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** An unpaid invoice whose due date is in the past. */
export function isOverdue(invoice: Pick<Invoice, 'status' | 'dueDate'>): boolean {
  return invoice.status !== 'paid' && Boolean(invoice.dueDate) && invoice.dueDate < todayISO();
}
