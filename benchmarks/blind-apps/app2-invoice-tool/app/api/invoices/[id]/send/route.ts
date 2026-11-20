import { NextResponse } from 'next/server';
import { getInvoice, updateInvoice } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/invoices/:id/send
 *
 * Simulates emailing the invoice to the client. There is no real mail
 * transport — this flips the invoice to "sent", stamps sentAt, and returns a
 * confirmation message the UI shows in an email-preview modal.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  }
  if (invoice.status === 'paid') {
    return NextResponse.json(
      { error: 'This invoice is already paid — no need to send it.' },
      { status: 400 },
    );
  }

  // Tiny artificial latency so the simulated delivery feels real.
  await new Promise((resolve) => setTimeout(resolve, 500));

  const updated = await updateInvoice(id, (current) => {
    const now = new Date().toISOString();
    return {
      ...current,
      status: 'sent',
      sentAt: now,
      paidAt: null,
      updatedAt: now,
    };
  });
  if (!updated) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  }

  const recipient = updated.clientEmail || updated.clientName;
  const message = updated.clientEmail
    ? `Invoice ${updated.number} was emailed to ${recipient}. (Simulated delivery — no real email was sent.)`
    : `Invoice ${updated.number} was marked as sent for ${recipient}. (No client email on file, so this is a simulated delivery.)`;

  return NextResponse.json({ invoice: updated, message });
}
