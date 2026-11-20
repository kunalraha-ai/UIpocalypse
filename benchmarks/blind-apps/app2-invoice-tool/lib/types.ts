export type InvoiceStatus = 'draft' | 'sent' | 'paid';

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Invoice {
  id: string;
  number: string;
  clientName: string;
  clientEmail: string;
  /** ISO date, YYYY-MM-DD */
  issueDate: string;
  /** ISO date, YYYY-MM-DD */
  dueDate: string;
  items: LineItem[];
  /** Percentage, e.g. 10 means 10% */
  taxRate: number;
  notes: string;
  currency: string;
  status: InvoiceStatus;
  /** ISO timestamp of the (simulated) send */
  sentAt: string | null;
  /** ISO timestamp of payment */
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceTotals {
  subtotal: number;
  taxAmount: number;
  total: number;
}

export interface CreateInvoicePayload {
  clientName: string;
  clientEmail: string;
  issueDate: string;
  dueDate: string;
  taxRate: number;
  notes: string;
  items: LineItem[];
}
