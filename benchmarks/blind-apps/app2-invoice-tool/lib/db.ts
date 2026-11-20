import { promises as fs } from 'fs';
import path from 'path';
import type { Invoice } from './types';

/**
 * Tiny JSON-file "database". All invoice data lives in data/invoices.json
 * under the project root; the file is created on first use.
 */
const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'invoices.json');

/**
 * Serialize every read-modify-write through a promise queue so concurrent
 * requests can't clobber each other.
 */
let operationQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function ensureStorage(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({ invoices: [] }, null, 2), 'utf8');
  }
}

async function readAll(): Promise<Invoice[]> {
  await ensureStorage();
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { invoices?: Invoice[] };
    return Array.isArray(parsed.invoices) ? parsed.invoices : [];
  } catch {
    // Unreadable or corrupt file — fall back to an empty store instead of crashing.
    return [];
  }
}

async function writeAll(invoices: Invoice[]): Promise<void> {
  await ensureStorage();
  await fs.writeFile(DATA_FILE, JSON.stringify({ invoices }, null, 2), 'utf8');
}

export async function listInvoices(): Promise<Invoice[]> {
  return serialized(async () => {
    const invoices = await readAll();
    return [...invoices].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

export async function getInvoice(id: string): Promise<Invoice | undefined> {
  return serialized(async () => (await readAll()).find((invoice) => invoice.id === id));
}

export async function insertInvoice(invoice: Invoice): Promise<Invoice> {
  return serialized(async () => {
    const invoices = await readAll();
    invoices.push(invoice);
    await writeAll(invoices);
    return invoice;
  });
}

export async function updateInvoice(
  id: string,
  mutate: (invoice: Invoice) => Invoice,
): Promise<Invoice | undefined> {
  return serialized(async () => {
    const invoices = await readAll();
    const index = invoices.findIndex((invoice) => invoice.id === id);
    if (index === -1) return undefined;
    const updated = mutate({ ...invoices[index] });
    invoices[index] = updated;
    await writeAll(invoices);
    return updated;
  });
}

export async function deleteInvoice(id: string): Promise<boolean> {
  return serialized(async () => {
    const invoices = await readAll();
    const remaining = invoices.filter((invoice) => invoice.id !== id);
    if (remaining.length === invoices.length) return false;
    await writeAll(remaining);
    return true;
  });
}

/** Sequential invoice number such as INV-2026-0007, scoped to the issue year. */
export function nextInvoiceNumber(existing: Invoice[], issueDate: string): string {
  const year = issueDate.slice(0, 4) || String(new Date().getFullYear());
  const prefix = `INV-${year}-`;
  const highest = existing.reduce((max, invoice) => {
    if (!invoice.number.startsWith(prefix)) return max;
    const current = parseInt(invoice.number.slice(prefix.length), 10);
    return Number.isFinite(current) && current > max ? current : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}
