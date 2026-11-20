import { newId } from './id';
import type { CreateInvoicePayload, InvoiceStatus, LineItem } from './types';
import { addDaysISO, todayISO } from './calc';

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid'];

export function isValidStatus(value: unknown): value is InvoiceStatus {
  return typeof value === 'string' && (INVOICE_STATUSES as string[]).includes(value);
}

/** Validate and normalize an invoice payload coming from the client. */
export function parseInvoiceInput(body: unknown): ParseResult<CreateInvoicePayload> {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Invalid request body.' };
  }
  const b = body as Record<string, unknown>;

  const clientName = typeof b.clientName === 'string' ? b.clientName.trim() : '';
  if (!clientName) return { ok: false, error: 'Client name is required.' };

  const clientEmail = typeof b.clientEmail === 'string' ? b.clientEmail.trim() : '';
  if (clientEmail && !EMAIL_RE.test(clientEmail)) {
    return { ok: false, error: 'Client email is not a valid email address.' };
  }

  const issueDate =
    typeof b.issueDate === 'string' && DATE_RE.test(b.issueDate) ? b.issueDate : todayISO();
  const dueDate =
    typeof b.dueDate === 'string' && DATE_RE.test(b.dueDate)
      ? b.dueDate
      : addDaysISO(issueDate, 14);

  // Default tax rate: 10%.
  const rawTax = b.taxRate;
  const taxRate =
    rawTax === undefined || rawTax === null || rawTax === '' ? 10 : Number(rawTax);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    return { ok: false, error: 'Tax rate must be between 0 and 100.' };
  }

  const notes = typeof b.notes === 'string' ? b.notes.trim() : '';

  const rawItems = Array.isArray(b.items) ? b.items : [];
  const items: LineItem[] = [];
  for (const raw of rawItems) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const description = typeof r.description === 'string' ? r.description.trim() : '';
    const quantity = Number(r.quantity);
    const unitPrice = Number(r.unitPrice);
    if (!description) {
      return { ok: false, error: 'Every line item needs a description.' };
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return {
        ok: false,
        error: `Line item "${description}" needs a quantity greater than zero.`,
      };
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return {
        ok: false,
        error: `Line item "${description}" needs a price of zero or more.`,
      };
    }
    items.push({
      id: newId(),
      description,
      quantity,
      unitPrice: Math.round(unitPrice * 100) / 100,
    });
  }
  if (items.length === 0) {
    return { ok: false, error: 'Add at least one line item.' };
  }

  return { ok: true, data: { clientName, clientEmail, issueDate, dueDate, taxRate, notes, items } };
}
