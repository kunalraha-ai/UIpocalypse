import { NextResponse } from 'next/server';
import { insertInvoice, listInvoices, nextInvoiceNumber } from '@/lib/db';
import { newId } from '@/lib/id';
import { parseInvoiceInput } from '@/lib/validate';
import type { Invoice } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const invoices = await listInvoices();
  return NextResponse.json({ invoices });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = parseInvoiceInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const now = new Date().toISOString();
  const existing = await listInvoices();
  const invoice: Invoice = {
    id: newId(),
    number: nextInvoiceNumber(existing, parsed.data.issueDate),
    ...parsed.data,
    currency: 'USD',
    status: 'draft',
    sentAt: null,
    paidAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const created = await insertInvoice(invoice);
  return NextResponse.json({ invoice: created }, { status: 201 });
}
