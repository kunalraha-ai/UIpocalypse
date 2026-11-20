import { NextResponse } from 'next/server';
import { deleteInvoice, getInvoice, updateInvoice } from '@/lib/db';
import { applyStatusChange } from '@/lib/status';
import { isValidStatus, parseInvoiceInput } from '@/lib/validate';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  }
  return NextResponse.json({ invoice });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const record = body as Record<string, unknown>;

  // Optional status change (draft | sent | paid).
  const status = record.status;
  if (status !== undefined && !isValidStatus(status)) {
    return NextResponse.json(
      { error: 'Status must be one of: draft, sent, paid.' },
      { status: 400 },
    );
  }

  // Full field edit (used by the edit form) — validated and normalized.
  const editableFields = [
    'clientName',
    'clientEmail',
    'issueDate',
    'dueDate',
    'taxRate',
    'notes',
    'items',
  ];
  const isFullEdit = editableFields.some((field) => record[field] !== undefined);
  const parsed = isFullEdit ? parseInvoiceInput(record) : null;
  if (parsed && !parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const updated = await updateInvoice(id, (invoice) => {
    let next = invoice;
    if (parsed) {
      Object.assign(next, parsed.data);
    }
    if (status !== undefined) {
      next = applyStatusChange(next, status);
    }
    next.updatedAt = new Date().toISOString();
    return next;
  });

  if (!updated) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  }
  return NextResponse.json({ invoice: updated });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const removed = await deleteInvoice(id);
  if (!removed) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
