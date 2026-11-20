import { NextResponse } from 'next/server';
import { getInvoice, updateInvoice } from '@/lib/db';
import { applyStatusChange } from '@/lib/status';

export const dynamic = 'force-dynamic';

/**
 * POST /api/checkout/confirm  { invoiceId: string, sessionId?: string }
 *
 * Marks an invoice as paid. This is the "webhook-style" callback used by the
 * checkout success page and by the built-in test-mode checkout simulator.
 * It is idempotent — confirming an already-paid invoice is a no-op.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const invoiceId = typeof record.invoiceId === 'string' ? record.invoiceId : '';
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined;

  if (!invoiceId) {
    return NextResponse.json({ error: 'invoiceId is required.' }, { status: 400 });
  }

  const invoice = await getInvoice(invoiceId);
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  }

  const alreadyPaid = invoice.status === 'paid';
  if (alreadyPaid) {
    return NextResponse.json({ invoice, alreadyPaid: true, sessionId: sessionId ?? null });
  }

  const updated = await updateInvoice(invoiceId, (current) => {
    const paid = applyStatusChange(current, 'paid');
    paid.updatedAt = new Date().toISOString();
    return paid;
  });
  if (!updated) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  }

  return NextResponse.json({
    invoice: updated,
    alreadyPaid: false,
    sessionId: sessionId ?? null,
  });
}
