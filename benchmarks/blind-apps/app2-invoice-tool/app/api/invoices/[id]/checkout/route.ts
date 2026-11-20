import { NextResponse } from 'next/server';
import { getInvoice, updateInvoice } from '@/lib/db';
import { invoiceTotal } from '@/lib/calc';
import { APP_URL, getStripe, isTestKey, STRIPE_SECRET_KEY } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

/**
 * POST /api/invoices/:id/checkout
 *
 * Creates a Stripe Checkout Session in TEST mode. With the bundled
 * placeholder key (or any unreachable Stripe API) we transparently fall back
 * to the built-in checkout simulator page, so the flow always works locally.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  }
  if (invoice.status === 'paid') {
    return NextResponse.json({ error: 'Invoice is already paid.' }, { status: 400 });
  }

  const { total } = invoiceTotal(invoice);
  const simulatedUrl = `/invoices/${invoice.id}/pay?simulated=1`;

  // No usable test key configured → use the built-in simulator.
  if (!isTestKey(STRIPE_SECRET_KEY)) {
    return NextResponse.json({
      url: simulatedUrl,
      simulated: true,
      reason: 'No valid Stripe test key configured — using the built-in checkout simulator.',
    });
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: invoice.clientEmail || undefined,
      client_reference_id: invoice.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(total * 100), // Stripe expects cents
            product_data: {
              name: `Invoice ${invoice.number}`,
              description: `Freelance services for ${invoice.clientName}`,
            },
          },
        },
      ],
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
      },
      success_url: `${APP_URL}/checkout/success?invoice_id=${invoice.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/checkout/cancel?invoice_id=${invoice.id}`,
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL.');
    }
    return NextResponse.json({ url: session.url, simulated: false });
  } catch (error) {
    // The placeholder test key cannot authenticate against the real Stripe
    // API, so fall back to the built-in test checkout simulator.
    const reason = error instanceof Error ? error.message : 'Stripe checkout unavailable.';
    return NextResponse.json({ url: simulatedUrl, simulated: true, reason });
  }
}
