import type { Invoice, InvoiceStatus } from './types';

/**
 * Apply a status change to an invoice, keeping sentAt/paidAt timestamps
 * consistent (a paid invoice is always considered sent as well).
 */
export function applyStatusChange(invoice: Invoice, status: InvoiceStatus): Invoice {
  const now = new Date().toISOString();
  const next = { ...invoice, status };

  if (status === 'draft') {
    next.sentAt = null;
    next.paidAt = null;
  } else if (status === 'sent') {
    next.sentAt = next.sentAt ?? now;
    next.paidAt = null;
  } else {
    next.sentAt = next.sentAt ?? now;
    next.paidAt = now;
  }
  return next;
}
